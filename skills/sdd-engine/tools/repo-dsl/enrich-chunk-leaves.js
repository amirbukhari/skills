"use strict";
/**
 * enrich-chunk-leaves.js — RECORD WHAT EACH CHUNK NAME IS A NAME *FOR*, WHILE THAT IS STILL KNOWABLE.
 *
 * THE DEFECT. A leaf name stores the skeleton it names:
 *
 *   w:c187e9fc…  { "sym": "return ‹id›(‹args›).‹m› > ‹num› ? ‹arr› : null;", "en": "…", "sites": 2 }
 *
 * A chunk name does not:
 *
 *   wc:a4da75fa…  { "en": "take billingaccountsreceived", "len": 2, "note": "…" }
 *
 * The key is a hash of the ordered leaf skeletons, and a hash is one-way. So a chunk record holds no
 * recoverable description of the thing it names — only a fingerprint of it.
 *
 * WHY THAT MAKES §5C RULE 2 UNIMPLEMENTABLE FOR CHUNKS. "Match orphans BEFORE generating" scores an
 * unnamed word against each orphan by token-level edit distance over the canonical skeleton. With no
 * skeleton on the orphan there is nothing to score, so re-adoption cannot be implemented for chunks
 * at all — not badly, at all. Rules 1, 3 and 4 are likewise hollow: a ledger can hold the orphan, but
 * nothing can ever propose it back.
 *
 * WHY IT IS ITS OWN SCRIPT, AND WHY IT IS ALREADY TOO LATE ONCE. The leaves are recoverable only
 * while SOME catalog still resolves the key. For 974 of the 3,582 chunk names that moment has
 * already passed on the live catalog: they were written at 2026-09-02 07:31 and the corpus was
 * re-mined under the body-slot canon at 22:51 the same day, fifteen hours later, which changed the
 * leaf skeletons beneath them. Nothing noticed, because reconcile-names.js walks the six-entry leaf
 * ledger and never reads `chunks`.
 *
 * They are recoverable anyway, by luck: every pre-body-slot catalog still on disk resolves 974/974.
 * That is what `--also` is for. But "the old catalog happened to still be in a scratch directory" is
 * not a recovery strategy, and the schema change this script performs — a chunk record carries the
 * skeleton it names — is what makes the next one unnecessary.
 *
 * It runs BEFORE a re-mine (describe everything while it resolves); reconcile-names.js runs AFTER
 * one (move what stopped resolving into the ledger). Two different moments, two scripts.
 *
 * It is idempotent, additive, and never touches `en`. A record that already carries `leaves` is left
 * exactly as it is; a record whose key no longer resolves is reported and left alone rather than
 * dropped (§5C rule 1 — nothing here removes a name).
 *
 * HISTORICAL CATALOGS. A name whose key stopped resolving is already beyond the reach of the live
 * catalog — the whole point is that its skeleton is not in there any more. But it WAS in whatever
 * catalog it was authored against, and if a copy of that survives, the leaves are recoverable
 * exactly. `--also <catalog.json>` (repeatable) supplies those, consulted in order after the live
 * one. This is how the 974 chunk names orphaned by the 2026-09-02 22:51 re-mine get described.
 *
 * Recovering from a scratch copy that happens to still exist is LUCK, not a strategy — which is
 * precisely the argument for storing `leaves` on the record from now on, so no future orphan ever
 * needs an archaeological dig.
 *
 *   node enrich-chunk-leaves.js                              report only, live catalog
 *   node enrich-chunk-leaves.js --also /path/old-cat.json    also consult a historical catalog
 *   APPLY=1 node enrich-chunk-leaves.js ...                  write word-names.json
 */
const fs = require("fs");
const path = require("path");
const AC = require("./engine/artifact-contract");
const WN = require("./engine/word-names");

/* `--also <path>` is repeatable and is stripped before FILE is read positionally. */
const argv = process.argv.slice(2);
const ALSO = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== "--also") continue;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) { console.error("REFUSING: --also given with no path after it"); process.exit(2); }
  ALSO.push(v); argv.splice(i, 2); i--;
}
const FILE = argv[0] || AC.pathFor("word-names");
const APPLY = process.env.APPLY === "1";

const catPath = AC.pathFor("generators-lzw");
if (!fs.existsSync(catPath)) {
  console.error("REFUSING: no dictionary at\n  " + catPath +
    "\n  The leaves can only be recovered from the catalog the names were authored against.");
  process.exit(3);
}
const cat = JSON.parse(fs.readFileSync(catPath, "utf8"));
const cur = WN.load(FILE);
const chunks = cur.chunks;

const live = WN.chunkIndexOf(cat);
console.log("catalog ..................... " + catPath);
console.log("distinct chunk keys in it ... " + live.size);
console.log("chunk names on file ......... " + Object.keys(chunks).length);

/* Each historical catalog contributes ONLY keys no earlier source already described. Order is
 * authority: the live catalog wins, then each --also in the order given. A key described by two
 * catalogs has the same leaves in both by construction — the key IS the hash of those leaves — so
 * this is about provenance and cost, not about resolving a conflict. */
const sources = [{ label: "live", path: catPath, index: live }];
for (const a of ALSO) {
  if (!fs.existsSync(a)) { console.error("REFUSING: --also catalog does not exist: " + a); process.exit(3); }
  let idx;
  try { idx = WN.chunkIndexOf(JSON.parse(fs.readFileSync(a, "utf8"))); }
  catch (e) { console.error("REFUSING: --also catalog unreadable (" + e.message + "): " + a); process.exit(3); }
  sources.push({ label: "also", path: a, index: idx });
  console.log("historical catalog .......... " + a + "  (" + idx.size + " chunk keys)");
}
const lookup = (key) => { for (const s of sources) { const hit = s.index.get(key); if (hit) return { hit, src: s }; } return null; };
const fromSource = new Map();   // source path -> count

let enriched = 0, already = 0, unresolved = 0;
const stranded = [];
for (const [key, rec] of Object.entries(chunks)) {
  if (rec && Array.isArray(rec.leaves) && rec.leaves.length) { already++; continue; }
  const found = lookup(key);
  if (!found) { unresolved++; stranded.push({ key, en: rec && rec.en }); continue; }
  rec.leaves = found.hit.leaves;
  /* Provenance on the record: a name described from a historical catalog is a RECOVERED one, and a
   * reader should be able to tell that from the file rather than from a changelog. */
  if (found.src.label !== "live") rec.leavesFrom = path.basename(found.src.path);
  fromSource.set(found.src.path, (fromSource.get(found.src.path) || 0) + 1);
  enriched++;
}

console.log("already carried leaves ...... " + already);
console.log("ENRICHED .................... " + enriched);
for (const [p2, n] of fromSource) console.log("    from " + (p2 === catPath ? "the live catalog" : p2) + " ... " + n);
console.log("unresolved (in NO catalog given) .. " + unresolved);

if (stranded.length) {
  /* These are ALREADY orphans in everything but name: the key does not resolve, so the skeleton is
   * gone and cannot be recovered here either. Reported so the number is never a surprise later, and
   * deliberately NOT deleted or moved — §5C rule 1, and moving them is reconcile-names.js's job. */
  console.log("\n  STRANDED — these chunk names can no longer be described, and re-adoption will never");
  console.log("  be able to propose them. They are kept (§5C rule 1); this is a report, not a change.");
  for (const s of stranded.slice(0, 12)) console.log("    " + s.key + "  \"" + String(s.en).slice(0, 80) + "\"");
  if (stranded.length > 12) console.log("    … and " + (stranded.length - 12) + " more");
}

if (!APPLY) {
  console.log("\nreport only — nothing written. Re-run with APPLY=1 to write " + FILE);
  return;
}
if (!enriched) {
  console.log("\nnothing to enrich; " + FILE + " left untouched.");
  return;
}

/* The full body, `chunks` included. This script does not have reconcile-names.js's problem — it is
 * not dropping a required key, it is writing all three — so the §8B contract passes here for the
 * right reason rather than being worked around. */
fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(AC.stamp("word-names", {
  names: cur.names, orphans: cur.orphans, chunks,
}, { generated: new Date().toISOString().slice(0, 10) }), null, 1) + "\n");
console.log("\nwrote " + FILE + " (" + enriched + " chunk name(s) now carry their leaf skeletons)");
