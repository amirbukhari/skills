#!/usr/bin/env node
"use strict";
/**
 * apply-worksheet-names.js — APPLY the Tier-2 worksheet's proposed names into word-names.json.
 *
 * WHY THIS FILE EXISTS AT ALL, stated plainly because the tool it applies says not to. The
 * worksheet (`name-words-lzw.js worksheet`) is emit-only by design and its artifact carries a
 * `note` field reading "PROPOSED names are suggestions for Amir to edit — DO NOT apply as-is". On
 * 2026-09-02 Amir read the finding and directed the opposite: *"overwrite — worksheet wins, all
 * rows written as-is, including the 4 existing (old values stay recoverable in git history)"*, and
 * then *"skip the 22 unsure rows. Write only the rows tagged confident"*. This script is that
 * instruction, made repeatable and auditable instead of hand-typed.
 *
 * TWO THINGS IT DOES NOT DO, and both are the point:
 *   - It does NOT run engine/naming-gate.js. `name-words.js name --apply` gates its batches
 *     (byte-identity · payload identity · coverage invariance · detail retention · fold invariance)
 *     and REFUSES on failure. This path is an explicit user override of a different producer's
 *     proposals, so the gate is BYPASSED, not silently absent. Run `node verify-register.js` and a
 *     re-render afterwards to see what the names did.
 *   - It does NOT invent a key. Worksheet rows are identified by `axis:id`, and a word id is an
 *     array index that moves on every re-mine (R-PAY-6); word-names.json is "keyed by content hash
 *     and never by word id" (its own registry role). So every row is mapped through
 *     WN.chunkKeyOf(axis, id) against the dictionary ON DISK. A row whose id no longer resolves is
 *     SKIPPED and counted, never guessed at.
 *
 * THE WORKSHEET CARRIES NO DICTIONARY FINGERPRINT, which is R-PAY-6 in a second costume: a
 * worksheet built before a re-mine and applied after it maps names onto whichever words now hold
 * those indices — wrong names, no error. So this script REFUSES when the worksheet is older than
 * the dictionary, and prints both mtimes. `--force-stale` overrides it, loudly.
 *
 *   node apply-worksheet-names.js                 # DRY RUN: counts, samples, overwrites. Writes nothing.
 *   node apply-worksheet-names.js --apply         # writes <CORPUS>/sen/catalog/word-names.json
 *   node apply-worksheet-names.js --include-unsure   # also write rows the worksheet tags `unsure`
 *
 * A SNAPSHOT IS TAKEN BEFORE ANY WRITE. `Examples/` is gitignored at the repo root, so this
 * artifact has NO git history — measured 2026-09-02: `git check-ignore -v` names
 * `.gitignore:32:skills/sdd-engine/Examples/` and `git log -- sen/catalog/word-names.json` is
 * empty. "Recoverable from git" is not true for this file, so the snapshot is the only revert path.
 */
const fs = require("fs");
const path = require("path");
const AC = require("./engine/artifact-contract");
const CR = require("./engine/corpus-root");
const EL = require("./engine/enlzw");
const WN = require("./engine/word-names");

const argv = process.argv.slice(2);
const KNOWN = ["--apply", "--include-unsure", "--force-stale", "--help"];
for (const a of argv) if (a.startsWith("--") && !KNOWN.includes(a)) {
  console.error(`apply-worksheet-names.js REFUSED: unknown flag \`${a}\`. known: ${KNOWN.join(", ")}`);
  process.exit(2);
}
if (argv.includes("--help")) { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]); process.exit(0); }
const APPLY = argv.includes("--apply");
const INCLUDE_UNSURE = argv.includes("--include-unsure");
const FORCE_STALE = argv.includes("--force-stale");

const CORPUS = CR.corpusRoot();
const WORKSHEET = path.join(CORPUS, AC.HOMES.cache, "name-words-lzw-worksheet.json");
const WN_PATH = AC.pathFor("word-names");
const DICT = AC.pathFor("generators-lzw");

const need = (p, what, how) => {
  if (fs.existsSync(p)) return fs.statSync(p);
  console.error(`apply-worksheet-names.js REFUSED: ${what} is not present at\n  ${p}\n  produce it with: ${how}`);
  process.exit(2);
};
const wsStat = need(WORKSHEET, "the Tier-2 worksheet", "npm run name");
const dictStat = need(DICT, "the word dictionary", "npm run mine");
need(WN_PATH, "word-names.json", "node name-words.js name --tier 0 --apply");

/* STALENESS, checked before anything is read into memory. */
if (wsStat.mtime < dictStat.mtime && !FORCE_STALE) {
  console.error(`apply-worksheet-names.js REFUSED: the worksheet is OLDER than the dictionary.\n` +
    `  worksheet   ${wsStat.mtime.toISOString()}  ${WORKSHEET}\n` +
    `  dictionary  ${dictStat.mtime.toISOString()}  ${DICT}\n` +
    `  Word ids are array indices and a re-mine renumbers them (R-PAY-6), so these rows may name\n` +
    `  words they were never about. Re-run \`npm run name\` to rebuild the worksheet, or pass\n` +
    `  --force-stale if you have a reason.`);
  process.exit(3);
}

const ws = JSON.parse(fs.readFileSync(WORKSHEET, "utf8"));
if (!Array.isArray(ws.rows)) { console.error(`apply-worksheet-names.js REFUSED: ${WORKSHEET} carries no \`rows\` array`); process.exit(2); }
const existing = AC.load("word-names", WN_PATH);
const cat = EL.loadLzw(DICT);

const chunks = Object.assign({}, existing.chunks || {});
const names = Object.assign({}, existing.names || {});      // untouched: every worksheet row is multi-leaf
const applied = [], overwritten = [], skippedUnsure = [], unresolved = [], collisions = [];
const seen = new Map();

for (const r of ws.rows) {
  if (r.confidence === "unsure" && !INCLUDE_UNSURE) { skippedUnsure.push(`${r.axis}:${r.id}`); continue; }
  const axisName = r.axis === "n" ? "narrow" : "wide";
  const axis = r.axis === "n" ? cat.narrow : cat.wide;
  const w = axis && axis.words && axis.words[r.id];
  if (!w) { unresolved.push(`${r.axis}:${r.id} (no such word in the dictionary)`); continue; }
  const leaves = WN.leavesOf(axis, r.id);
  if (leaves.length < 2) { unresolved.push(`${r.axis}:${r.id} (single leaf — belongs in \`names\`, not \`chunks\`)`); continue; }
  const key = WN.chunkKeyOf(axisName, axis, r.id);
  if (!key) { unresolved.push(`${r.axis}:${r.id} (no chunk key)`); continue; }
  /* Two ids with the same ordered leaf skeletons ARE the same chunk and share a key. First row
   * wins (rows are occurrence-ordered, so that is the higher-leverage one) and the loser is
   * REPORTED rather than dropped in silence. Measured 2026-09-02: zero of these. */
  if (seen.has(key)) { collisions.push({ key, kept: seen.get(key), dropped: `${r.axis}:${r.id} "${r.proposedName}"` }); continue; }
  seen.set(key, `${r.axis}:${r.id} "${r.proposedName}"`);
  const prior = chunks[key];
  if (prior && prior.en !== r.proposedName) overwritten.push({ key, was: prior.en, now: r.proposedName });
  chunks[key] = {
    en: r.proposedName,
    len: leaves.length,
    /* Provenance in the record itself: which producer, which row, how strong, how much leverage.
     * `name-words.js` writes `note: rationale` here and the worksheet has no rationale — so the
     * note says where the name came from instead of pretending to an argument it never made. */
    note: `name-words-lzw worksheet (${r.basis}, ${r.confidence}); ${r.axis}:${r.id}, ${r.count} site(s)`,
    named: "name-words-lzw/worksheet",
  };
  applied.push({ key, en: r.proposedName, count: r.count });
}

const report = () => {
  console.log(`\nworksheet ${WORKSHEET}`);
  console.log(`  ${ws.rows.length} rows · ${ws.proposedConfident} confident · ${ws.proposedUnsure} unsure · built ${wsStat.mtime.toISOString()}`);
  console.log(`dictionary ${DICT}\n  written ${dictStat.mtime.toISOString()}`);
  console.log(`\nchunk names to write: ${applied.length}`);
  console.log(`  skipped as unsure:   ${skippedUnsure.length}${INCLUDE_UNSURE ? " (--include-unsure: none skipped)" : ""}`);
  console.log(`  unresolved ids:      ${unresolved.length}${unresolved.length ? "  " + unresolved.slice(0, 3).join(", ") : ""}`);
  console.log(`  key collisions:      ${collisions.length}${collisions.length ? "  " + collisions.slice(0, 3).map((c) => c.key).join(", ") : ""}`);
  console.log(`\nexisting artifact: names ${Object.keys(existing.names || {}).length}, chunks ${Object.keys(existing.chunks || {}).length}`);
  console.log(`after:             names ${Object.keys(names).length}, chunks ${Object.keys(chunks).length}`);
  console.log(`\nOVERWRITES an existing name: ${overwritten.length}`);
  for (const o of overwritten) console.log(`  ${o.key}\n    was: ${o.was}\n    now: ${o.now}`);
  const top = applied.slice(0, 5);
  console.log(`\nhighest-leverage names being written:`);
  for (const a of top) console.log(`  ${String(a.count).padStart(4)} sites  ${a.key}  "${a.en}"`);
};

report();

/* Build the body and VALIDATE it before deciding to write, so a dry run proves the shape too. */
const body = AC.stamp("word-names", {
  names, orphans: existing.orphans || {}, chunks,
  modelCalls: existing.modelCalls || 0,          /* the worksheet is deterministic: zero model calls */
  retiredBy: existing.retiredBy,
  namedBy: { source: "name-words-lzw-worksheet", rows: ws.rows.length, applied: applied.length,
             skippedUnsure: skippedUnsure.length, overwritten: overwritten.length,
             gate: "BYPASSED — user override, see apply-worksheet-names.js header",
             at: new Date().toISOString().slice(0, 10) },
});
AC.validate("word-names", body, "(in memory)");
console.log(`\ncontract: OK (schema ${body.schema}, fingerprint ${body.fingerprint})`);

if (!APPLY) {
  console.log(`\nDRY RUN — word-names.json NOT written. Re-run with --apply to write it.\n`);
  process.exit(3);
}

/* SNAPSHOT FIRST. This artifact has no git history (Examples/ is gitignored), so this file is the
 * only revert path. It lives in sen/catalog/ beside the artifact it copies -- the §8A
 * SOURCE-PROTECTED home, which no cleanup deletes (R-CFG-12) -- and its name is not any registered
 * artifact filename, so no consumer will ever read it by accident. */
const snap = path.join(path.dirname(WN_PATH), `word-names.pre-worksheet-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.copyFileSync(WN_PATH, snap);
console.log(`snapshot -> ${snap}`);

fs.writeFileSync(WN_PATH, JSON.stringify(body, null, 1) + "\n");
console.log(`applied  -> ${WN_PATH}   (names ${Object.keys(names).length}, chunks ${Object.keys(chunks).length})`);
console.log(`\nThe gate was BYPASSED. Re-render to see the effect: npm run render\n`);
