"use strict";
/**
 * naming-gate.js — WHAT REPLACES THE HUMAN AS THE CONSUMER OF A NAME (PRD §5D.2 consequence 2).
 *
 * "A name that changes one output byte, lowers coverage, or breaks grammar injectivity is rejected
 * mechanically." Injectivity is enforced in namer.js, where a proposal can be refused before it is
 * ever applied. The other two are properties of a RENDER, so they live here: apply the batch to the
 * in-memory name maps, re-render every affected file, and demand
 *
 *   1. BYTE-IDENTITY      compileFileEn(render(src)) === src, still, with the names in place;
 *   2. PAYLOAD IDENTITY   every ⟪payload⟫ is unchanged and in the same order — the structural half
 *                         of §5D.3A: a name that moved a payload touched something that is not a
 *                         name, and no amount of "but the bytes came back" makes that acceptable;
 *   3. COVERAGE INVARIANCE  the same spans collapse the same statements as before;
 *   4. DETAIL RETENTION   no file's prose loses a concrete identifier;
 *   5. FOLD INVARIANCE    no file's prose gains a clause.
 *
 * CHECK 4 EXISTS BECAUSE CHECKS 1-3 ALL PASSED WHILE THE PROSE WAS DESTROYED. The 80-leaf pilot
 * gated clean and took the corpus from 27,673 quoted identifiers to 7,644 across 982 files. Nothing
 * above can see that: the bytes still round-trip, the payloads are untouched, coverage is identical
 * — the render simply says less. The cause is structural, not a bad batch of names: A LEAF NAME IS
 * HOLE-FREE AND A NODE-KIND RULE IS HOLE-FILLED, so substituting the first for the second trades a
 * clause that says `getManager` for one that says the same six words everywhere. A name may change
 * how prose reads; it may never delete something only the source could have supplied. Payload
 * regions are excluded from the count on purpose — they are verbatim source, unchanged by
 * construction, and counting them would dilute exactly the loss this check is looking for.
 *
 * AND ONE THAT IS NOT A SAFETY CHECK BUT A HONESTY CHECK: `proseChanged`. If applying a batch of
 * names changes not one file's prose, the names never reached a label and accepting them would be
 * vacuous — the failure mode word-names.test.js calls out by name ("otherwise 3-5 would pass
 * vacuously"). It is reported, not enforced, because a legitimately tiny batch can be swamped by a
 * larger chunk name that outranks it (R-LANG-19).
 *
 * CHECK 5 EXISTS BECAUSE CHECK 4 DID NOT CATCH THE SECOND ONE EITHER. Twenty names, all four
 * checks green, and applying them took import repeats inside a single clause from 1 to 284: a rule
 * that folds a run of imports into ONE clause was dissolved into one clause per statement wherever
 * a single leaf in that run had been named. Every identifier survived — each was simply quoted in
 * its own clause instead of in a shared one — so check 4 saw nothing. §5D.3A as amended
 * (2026-09-01, Amir): STRUCTURE IS COMPUTED FROM THE UNNAMED DICTIONARY AND NAMES ARE APPLIED
 * AFTERWARDS, PURELY AS LABELS. `stats.labelClauses` is the renderer publishing how many clauses it
 * emitted; the gate re-renders WITHOUT the batch and compares.
 *
 * An INCREASE fails: a name split a fold, which is a structural decision a name may not take.
 * A DECREASE is reported and allowed, because it can only come from the adjacent-identical collapse
 * that gives cardinality its parameter (R-LANG-16) — "declare a test suite 5 times". Two adjacent
 * clauses can only become identical if the two statements share a skeleton, since namer.js's
 * injectivity ledger refuses to spend one name on two different keys in an axis.
 *
 * NOTE ON THE CHECK AMIR ASKED FOR — "the word-id sequence must be identical with and without
 * names". It already was, and check 2 is it: a payload is `lzw1 n<id>⟨holes⟫`, so payload identity
 * IS word-id-sequence identity, and it passed throughout. Segmentation was never name-sensitive —
 * `enlzw.genSpans` consults names nowhere, and its `wholeRunOk` hook is `chunkGloss`, which reads
 * the AST and the rules. The defect was one level up, in the LABEL, so the new check is there.
 *
 * WHY THE GATE EXISTS AT ALL WHEN NAMES ARE COSMETIC BY CONSTRUCTION. compileChunk finds the
 * payload with lastIndexOf(PAY_OPEN) and never reads the label, so on paper none of this can fail.
 * That is a reason to EXPECT a pass, not a licence to skip the measurement (CLAUDE.md §0: a claim
 * about runtime behaviour needs a measurement, not a reading of the code). It also costs ~2ms per
 * affected file, which is not a budget worth saving.
 *
 * THE GATE LEAVES NO TRACE. Names are applied to the live maps, measured, and restored in a
 * `finally` — the WRITE is a separate, deliberate step in the caller. A gate that half-applies its
 * subject is worse than no gate.
 */
const fs = require("fs");
const path = require("path");

/** The record written to word-names.json for one accepted proposal. One definition, used by the
 *  gate and by the applier, so the thing measured is exactly the thing written. */
function recordFor(a) {
  return a.depth === 0
    ? { map: "names", rec: { sym: a.sym, en: a.name, sites: a.sites, named: "name-words/model" } }
    : { map: "chunks", rec: { en: a.name, len: a.leaves ? a.leaves.length : undefined, note: a.rationale } };
}

/**
 * @param EN        the enfile module (injected so a test can substitute a renderer and prove the
 *                  comparison logic FIRES — a gate that cannot be shown to fail is not a gate)
 * @param index     a loaded EN.loadIndex()
 * @param srcRoot   the READ root the `files` are relative to
 * @param files     repo-relative paths of every file containing a named word
 * @param applied   accepted proposals from namer.nameBatch
 */
function gateNames(EN, index, srcRoot, files, applied) {
  const before = new Map();
  for (const rel of files) {
    let src;
    try { src = fs.readFileSync(path.join(srcRoot, rel), "utf8"); } catch (_) { continue; }
    const r = EN.renderFileEn(src, index);
    before.set(rel, { src, en: r.en, payloads: payloadsOf(r.en), stats: r.stats || {}, detail: detailOf(r.en) });
  }

  const NAMES = EN.NAMES;
  const savedNames = Object.assign({}, NAMES.names);
  const savedChunks = Object.assign({}, NAMES.chunks);
  for (const a of applied) { const { map, rec } = recordFor(a); NAMES[map][a.key] = rec; }

  const failures = [];
  let checked = 0, proseChanged = 0, detailBefore = 0, detailAfter = 0, clausesBefore = 0, clausesAfter = 0;
  try {
    for (const [rel, b] of before) {
      const r = EN.renderFileEn(b.src, index);
      checked++;
      if (r.en !== b.en) proseChanged++;
      if (EN.compileFileEn(r.en, index) !== b.src) { failures.push({ rel, why: "byte-identity broke under a name" }); continue; }
      const after = payloadsOf(r.en);
      if (after.length !== b.payloads.length || after.some((p, i) => p !== b.payloads[i])) {
        failures.push({ rel, why: "a payload moved under a name — the name touched structure, not spelling" });
        continue;
      }
      const as = r.stats || {};
      if ((as.genSpans || 0) !== (b.stats.genSpans || 0) || (as.genStmtsCollapsed || 0) !== (b.stats.genStmtsCollapsed || 0)) {
        failures.push({ rel, why: `coverage moved: ${b.stats.genSpans}/${b.stats.genStmtsCollapsed} -> ${as.genSpans}/${as.genStmtsCollapsed}` });
        continue;
      }
      const dAfter = detailOf(r.en);
      detailBefore += b.detail; detailAfter += dAfter;
      if (dAfter < b.detail) {
        failures.push({ rel, why: `detail lost: ${b.detail} -> ${dAfter} concrete identifiers — a name replaced a rule that was saying more` });
        continue;
      }
      const cBefore = b.stats.labelClauses || 0, cAfter = as.labelClauses || 0;
      clausesBefore += cBefore; clausesAfter += cAfter;
      if (cAfter > cBefore) {
        failures.push({ rel, why: `fold broken: ${cBefore} -> ${cAfter} clauses — a name split a clause the rules had folded` });
      }
    }
  } finally {
    restore(NAMES.names, savedNames);
    restore(NAMES.chunks, savedChunks);
  }
  return { passed: failures.length === 0, checked, proseChanged, detailBefore, detailAfter, clausesBefore, clausesAfter, failures };
}

function payloadsOf(en) { return String(en).match(/⟪[^⟫]*⟫/g) || []; }
/** Concrete identifiers the PROSE supplies: backtick-quoted tokens outside any verbatim payload.
 *  This is the one measure that would have caught the pilot, so it has exactly one definition. */
function detailOf(en) { return (String(en).replace(/⟪[^⟫]*⟫/g, "").match(/`[^`\n]*`/g) || []).length; }
function restore(live, saved) {
  for (const k of Object.keys(live)) delete live[k];
  Object.assign(live, saved);
}

module.exports = { gateNames, recordFor, payloadsOf, detailOf };
