"use strict";
/**
 * naming-plan.js — the DETERMINISTIC half of stage 2 (PRD §5D.2, §5D.3A, §5D.3E).
 *
 * Stage 2 has two inputs and only one of them is a model's: the phrasebook (human, before the run)
 * and the names (model, gated, at the run). This module is neither — it is the CODE that decides
 * WHICH words are asked about, IN WHAT ORDER, and WITH WHAT EVIDENCE. Zero model calls, no I/O.
 * Everything here is a pure function of the mined catalog plus the set of words a render actually
 * used, so two runs over the same corpus produce the same plan, and the only thing that can differ
 * between two naming runs is the spellings (R-LANG-15).
 *
 * THE ORDER IS NOT A PREFERENCE — THE DATA STRUCTURE FORCES IT (R-LANG-20, §5D.3E §4).
 * Every LZW entry is `m: [prefix, appended]` where `appended` is always exactly one LEAF — measured
 * 0 violations across 115,661 wide / 126,167 narrow entries. So the dictionary is a set of strictly
 * left-leaning CHAINS, and the dependency relation along each chain is a TOTAL ORDER: naming d=k
 * requires d=k-1, which requires d=k-2, ... down to d=0. There is nothing to parallelise and no
 * tier to skip. `count` orders rows WITHIN a tier and nothing else.
 *
 * THE LEAF TIER IS NOT OPTIONAL (R-LANG-21). Every chain bottoms out at a leaf and the tail of
 * every deep word is leaves (2,659 of 2,659 appended halves measured), so a scope that excludes
 * d=0 leaves the base of every word unnamed. `tiersOf` therefore always starts at 0 and REFUSES a
 * `from` above it.
 *
 * THE TARGET IS A COST, NOT A SAVING (R-LANG-22): leaves + used shallow words = 2,619 + 2,789 =
 * 5,408 names, against 3,237 if you named only what a render emits today. `summarize()` prints
 * both figures for exactly that reason.
 *
 * KEYS ARE CONTENT HASHES, never word ids — ids are array indices and move on every re-mine
 * (word-names.js documents the measurement). A plan row therefore carries the key it will be
 * written under, so the applier never has to re-derive it from an id that may have moved.
 */
const WN = require("./word-names");

const AXIS_NAME = { w: "wide", n: "narrow" };

/* The tier ceiling §5D.3E §6 records. It is a STOPPING POINT, not a rule: stop after any tier and
 * every deeper word still renders as one named prefix plus a tail of NAMED leaves. That is the
 * whole reason d=0 must be inside the scope wherever you stop. */
const DEFAULT_TO = 8;

/** Aggregate the spans a render emitted into one row per distinct word. Shape is deliberately
 *  small: {axis, id, depth, sites, stmts, files[], snippets[]} — evidence, not prose. */
function usedWordsFromSpans(entries) {
  const used = new Map(); // "a:id" -> row
  for (const e of entries) {
    const key = e.axis + ":" + e.id;
    let row = used.get(key);
    if (!row) { row = { axis: e.axis, id: e.id, depth: e.depth, sites: 0, stmts: e.stmts || 0, files: [], snippets: [] }; used.set(key, row); }
    row.sites++;
    if (row.files.length < 3 && e.file && !row.files.includes(e.file)) row.files.push(e.file);
    if (row.snippets.length < 3 && e.snippet) row.snippets.push(e.snippet);
  }
  return used;
}

/** Every distinct LEAF SKELETON the used words are built from, with the sites that evidence it.
 *  This is the d=0 tier and it is derived from the USED words, not from the whole dictionary —
 *  the dictionary has 3,238 wide leaves; the used words are built from 2,619 of them (§5D.3E). */
function leafTier(cat, used) {
  const rows = new Map(); // name key -> row
  for (const w of used.values()) {
    const axis = cat[AXIS_NAME[w.axis]];
    if (!axis) continue;
    const syms = WN.leavesOf(axis, w.id);
    for (const sym of syms) {
      const key = WN.hashOf(AXIS_NAME[w.axis], sym);
      let row = rows.get(key);
      if (!row) { row = { key, axis: w.axis, depth: 0, sym, sites: 0, inWords: 0, files: [], snippets: [] }; rows.set(key, row); }
      row.sites += w.sites;          // a leaf is seen once per site of every word containing it
      row.inWords++;
      for (const f of w.files) if (row.files.length < 3 && !row.files.includes(f)) row.files.push(f);
      for (const s of w.snippets) if (row.snippets.length < 3) row.snippets.push(s);
    }
  }
  return [...rows.values()].sort(byPriority);
}

/** Composite tiers d=1..to, from the USED words only. A word whose depth exceeds `to` is left for
 *  its named prefix + named leaf tail to account for (§5D.3E §6) — it is NOT a gap. */
function compositeTier(cat, used, depth) {
  const rows = [];
  for (const w of used.values()) {
    if (w.depth !== depth) continue;
    const axis = cat[AXIS_NAME[w.axis]];
    if (!axis) continue;
    const key = WN.chunkKeyOf(AXIS_NAME[w.axis], axis, w.id);
    if (!key) continue;                       // a one-leaf "chunk" is a leaf; it belongs to `names`
    rows.push({ key, axis: w.axis, id: w.id, depth, sites: w.sites, leaves: WN.leavesOf(axis, w.id), files: w.files, snippets: w.snippets });
  }
  return dedupeByKey(rows).sort(byPriority);
}

/* Two words with the same leaf sequence ARE the same chunk and share one key, so they must ask for
 * one name, not two — otherwise the batch collides with itself. Sites add up. */
function dedupeByKey(rows) {
  const out = new Map();
  for (const r of rows) {
    const prev = out.get(r.key);
    if (!prev) { out.set(r.key, r); continue; }
    prev.sites += r.sites;
    for (const f of r.files) if (prev.files.length < 3 && !prev.files.includes(f)) prev.files.push(f);
  }
  return [...out.values()];
}

/* WITHIN a tier only: highest leverage first. The tie-break is the content KEY, not an id, so the
 * order does not move when a re-mine renumbers the dictionary. */
function byPriority(a, b) { return (b.sites - a.sites) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0); }

/**
 * The whole plan: an ARRAY OF TIERS in ascending depth, index 0 being the leaves.
 * `from` exists only so a resumed run can skip tiers already named; it REFUSES to start above 0
 * unless the caller states that d=0 is already named (R-LANG-21).
 */
function tiersOf(cat, used, opts = {}) {
  const to = opts.to === undefined ? DEFAULT_TO : opts.to;
  const from = opts.from || 0;
  if (from !== 0 && !opts.leavesAlreadyNamed) {
    throw new Error("naming-plan: refusing to start above d=0 — R-LANG-21: every chain bottoms out " +
      "at a leaf, so d=0 is inside every naming scope. Pass { leavesAlreadyNamed: true } only when " +
      "word-names.json already carries the leaf tier.");
  }
  const tiers = [];
  for (let d = from; d <= to; d++) tiers.push({ depth: d, rows: d === 0 ? leafTier(cat, used) : compositeTier(cat, used, d) });
  return tiers;
}

/**
 * R-LANG-20, as an executable check rather than a comment: for the plan as ordered, no word is
 * asked about before every leaf it is built from has been asked about. Returns the violations, so
 * a caller can REFUSE rather than discover it in the output.
 */
function orderViolations(cat, tiers) {
  const seen = new Set();
  const bad = [];
  for (const tier of tiers) {
    for (const row of tier.rows) {
      if (tier.depth === 0) { seen.add(row.key); continue; }
      const axis = cat[AXIS_NAME[row.axis]];
      for (const sym of WN.leavesOf(axis, row.id)) {
        const k = WN.hashOf(AXIS_NAME[row.axis], sym);
        if (!seen.has(k)) bad.push({ word: row.key, depth: tier.depth, missingLeaf: k, sym });
      }
    }
    for (const row of tier.rows) seen.add(row.key);
  }
  return bad;
}

/** Split one tier into batches. Batch size is a Q-9 PROPOSAL, not a ruling — see §5D.3F. */
function batches(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** The two figures R-LANG-22 requires any published plan to state together. */
function summarize(tiers, usedCount) {
  const perTier = tiers.map((t) => ({ depth: t.depth, names: t.rows.length }));
  const total = perTier.reduce((s, t) => s + t.names, 0);
  return {
    perTier,
    namingTarget: total,
    todayEveryUsedWord: usedCount,
    statedAsCost: `${total} names against ${usedCount} for every used word today — this target is MORE names, not fewer (R-LANG-22)`,
  };
}

module.exports = { AXIS_NAME, DEFAULT_TO, usedWordsFromSpans, leafTier, compositeTier, tiersOf, orderViolations, batches, summarize };
