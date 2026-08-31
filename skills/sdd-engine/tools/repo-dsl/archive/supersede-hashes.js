#!/usr/bin/env node
"use strict";
/**
 * supersede-hashes — make the NAMED idioms (throwError / assertOrThrow /
 * fetchAndValidate) supersede the anonymous compose-tier c_ hashes wherever the
 * panel surfaces top words, DETERMINISTICALLY (no model).
 *
 * The compose tier tokenizes at the statement/line grain: a `throw new
 * <Err>(<msg>)` statement is exactly ONE cut-0 token, so shapeId(shape) is its
 * c_ hash. We map every throwError SITE (from the AST matcher) to the smallest
 * dict-word token that covers it -> the exact set of throwError hashes. That set
 * is fragmented (41+ hashes, because template `${...}` substitutions give each
 * message its own token-kind sequence); the single named `throwError` word
 * REUNIFIES them.
 *
 * assertOrThrow's `if (!x) { throw ... }` is split by block-descent into a
 * guard-head token (`if (!x) {`) + the inner throwError token + `}`. The
 * guard-head hash is SHARED with non-throwing guards, so we do NOT rename it
 * (that would over-claim); we record the count and note instead. assertOrThrow
 * is a higher-tier composition the named idiom makes visible.
 *
 * Writes ONLY under hydra-source:
 *   - files-index.json      : rollup.featuredNamedIdioms + inline name on throwError topWords
 *   - word-names.json       : supersededHashes map (c_ -> name); the 3 canonical
 *                             idiom names stay clean (not inflated by hashes)
 *   - catalog/named-idioms.json : authoritative sidecar (3 words + supersededHashes)
 *
 *   node supersede-hashes.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { walkDir } = require("./engine/pipeline");
const { tokenize } = require("./engine/fanout");
const { findThrowError, findAssertOrThrow } = require("./engine/named-idioms.js");
const CR = require("./engine/corpus-root");

const PROJECT = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root
const shapeId = (shape) => "c_" + crypto.createHash("sha256").update(shape).digest("hex").slice(0, 10);

function main() {
  const composeWords = JSON.parse(fs.readFileSync(path.join(PROJECT, "catalog", "compose-words.json"), "utf8")).words;
  const isWordHash = new Set(Object.keys(composeWords)); // c_ ids that are actual dictionary words

  const files = walkDir(SRC).sort();
  const throwErrorHashes = new Map();   // c_ -> {sites, example}
  const guardHeadHashes = new Map();    // c_ -> {aotSites}  (guard-head token of an assertOrThrow)
  let teSites = 0, aotSites = 0;

  // smallest dict-word token covering [s,e)
  const coveringHash = (tokens, s, e) => {
    let best = null;
    for (const t of tokens) {
      if (t.start <= s && t.end >= e) {
        const id = shapeId(t.shape);
        if (!isWordHash.has(id)) continue;
        if (!best || (t.end - t.start) < (best.t.end - best.t.start)) best = { id, t };
      }
    }
    return best;
  };

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(SRC, f);
    let tk; try { tk = tokenize(f, src, undefined, 0); } catch (e) { continue; }
    const tokens = tk.tokens;

    let te; try { te = findThrowError(src, rel); } catch (e) { te = []; }
    for (const m of te) {
      teSites++;
      const c = coveringHash(tokens, m.start, m.end);
      if (c) { const r = throwErrorHashes.get(c.id) || { sites: 0, example: c.t.text.split("\n")[0].slice(0, 80) }; r.sites++; throwErrorHashes.set(c.id, r); }
    }
    let ao; try { ao = findAssertOrThrow(src, rel); } catch (e) { ao = []; }
    for (const m of ao) {
      aotSites++;
      // guard-head token = the dict-word token that OPENS the if (`if (!x) {`),
      // i.e. starts at the if and ends at/before the inner throw.
      let head = null;
      for (const t of tokens) {
        if (t.start === m.start && t.end <= m.innerThrow.start) {
          const id = shapeId(t.shape);
          if (!isWordHash.has(id)) continue;
          if (!head || t.end > head.t.end) head = { id, t };
        }
      }
      if (head) { const r = guardHeadHashes.get(head.id) || { sites: 0, example: head.t.text.split("\n")[0].slice(0, 80) }; r.sites++; guardHeadHashes.set(head.id, r); }
    }
  }

  const teHashList = [...throwErrorHashes.entries()].sort((a, b) => b[1].sites - a[1].sites)
    .map(([id, r]) => ({ id, sites: r.sites, example: r.example, occurrencesInCorpus: composeWords[id] ? composeWords[id].freq : null }));
  const guardHashList = [...guardHeadHashes.entries()].sort((a, b) => b[1].sites - a[1].sites)
    .map(([id, r]) => ({ id, assertOrThrowSites: r.sites, example: r.example, totalOccurrences: composeWords[id] ? composeWords[id].freq : null }));

  // ---- COVERAGE.namedIdioms (source of truth for the summaries) ----
  const cov = JSON.parse(fs.readFileSync(path.join(PROJECT, "COVERAGE.json"), "utf8"));
  const idiomSummaries = cov.idiomWords; // [fetchAndValidate, throwError, assertOrThrow]
  const byName = Object.fromEntries(idiomSummaries.map((w) => [w.name, w]));

  // ---- 1) files-index.json: featuredNamedIdioms + inline names on throwError topWords ----
  const fiPath = path.join(PROJECT, "files-index.json");
  const fi = JSON.parse(fs.readFileSync(fiPath, "utf8"));
  fi.rollup.featuredNamedIdioms = idiomSummaries.map((w) => ({
    name: w.name, tier: "idiom", dsl: w.dsl, sites: w.sites, files: w.files, byteIdentical: w.byteIdentical,
    supersedesHashes: w.name === "throwError" ? teHashList.length : (w.name === "assertOrThrow" ? guardHashList.length : 0),
  }));
  fi.rollup.namedIdiomNote = "NAMED idioms supersede anonymous c_ hashes. throwError reunifies " +
    `${teHashList.length} fragmented throw-statement hashes into one word (${byName.throwError.sites} sites, all byte-identical). ` +
    "assertOrThrow is a higher-tier composition (guard-head + throwError); its guard-head hash is shared with non-throwing guards, so it is annotated, not renamed.";
  const teSet = new Set(teHashList.map((h) => h.id));
  const guardSet = new Set(guardHashList.map((h) => h.id));
  for (const tw of fi.rollup.topWords) {
    if (teSet.has(tw.id)) { tw.name = "throwError"; tw.tier = "idiom"; tw.namedIdiom = true; }
    else if (guardSet.has(tw.id)) { tw.partlyNamedIdiom = "assertOrThrow"; tw.note = "guard-head; assertOrThrow when body is a throwError"; }
  }
  fs.writeFileSync(fiPath, JSON.stringify(fi, null, 1));

  // ---- 2) word-names.json: supersededHashes map (canonical names stay clean) ----
  const wnPath = path.join(PROJECT, "word-names.json");
  const wn = JSON.parse(fs.readFileSync(wnPath, "utf8"));
  const superseded = {};
  for (const h of teHashList) superseded[h.id] = { name: "throwError", tier: "idiom", supersedes: true };
  wn.supersededHashes = superseded;
  wn.supersededHashesNote = "compose-tier c_ hashes reunified by a named idiom. Resolve a c_ id here first: " +
    "if present, render the NAMED word (e.g. throwError) instead of the hash. Canonical `names` keeps the 3 idiom names uninflated.";
  fs.writeFileSync(wnPath, JSON.stringify(wn, null, 1) + "\n");

  // ---- 3) catalog/named-idioms.json: authoritative sidecar ----
  const sidecar = {
    schema: "sdd-named-idioms/1",
    project: PROJECT,
    generatedBy: "deterministic AST matchers (engine/named-idioms.js) + compose-hash mapping (supersede-hashes.js), no model",
    modelCalls: 0,
    corpusCommentFree: true,
    count: idiomSummaries.length,
    totalSites: idiomSummaries.reduce((a, w) => a + w.sites, 0),
    distinctConstructs: cov.namedIdioms ? cov.namedIdioms.distinctConstructs : null,
    allByteIdentical: idiomSummaries.every((w) => w.byteIdentical === w.sites),
    words: [
      { ...byName.fetchAndValidate, supersedesHashes: [], supersedesNote: "multi-statement; not a single compose token." },
      { ...byName.throwError, supersedesHashes: teHashList,
        supersedesNote: `reunifies ${teHashList.length} fragmented throw-statement compose hashes into one named word.` },
      { ...byName.assertOrThrow, supersedesHashes: [], guardHeadHashes: guardHashList,
        supersedesNote: "higher-tier composition (guard-head + throwError). Guard-head hashes are SHARED with non-throwing guards (see guardHeadHashes.assertOrThrowSites vs totalOccurrences), so they are annotated, not renamed." },
    ],
    expandVerify: "node hydra-idiom-expand.js is not needed — membersFull templates in catalog/mined-library.v6.json are self-expanding (fill(template,slots)===span).",
  };
  fs.writeFileSync(path.join(PROJECT, "catalog", "named-idioms.json"), JSON.stringify(sidecar, null, 1));

  console.log("=== supersede-hashes ===");
  console.log(`throwError: ${teSites} sites -> ${teHashList.length} distinct compose hashes reunified`);
  console.log(`  top: ${teHashList.slice(0, 5).map((h) => `${h.id}(${h.sites})`).join(", ")}`);
  console.log(`assertOrThrow: ${aotSites} sites -> ${guardHashList.length} guard-head hashes (SHARED, annotated not renamed)`);
  console.log("wrote:");
  console.log("  files-index.json           (rollup.featuredNamedIdioms + inline throwError names on topWords)");
  console.log("  word-names.json            (supersededHashes map; names.idiom stays 3)");
  console.log("  catalog/named-idioms.json  (authoritative sidecar)");
}

main();
