"use strict";
/**
 * reconcile-names.js — the STEADY STATE of naming. Naming is not a one-off pass: people edit code,
 * every re-mine shifts some skeletons, and a name authored for a skeleton that changed has to go
 * back up for renaming. This runs after every re-mine.
 *
 *   1. ORPHAN, NEVER DELETE. A name whose hash is no longer in the catalog moves to `orphans` with
 *      its skeleton and site count intact. Hand-authored names have already been lost once in this
 *      effort; nothing here removes one.
 *   2. MATCH ORPHANS BEFORE GENERATING. Every unnamed leaf is compared against the orphans first,
 *      by token-level edit distance over the canonical skeleton with holes normalised to their
 *      type — which is exactly what moves when the canon shifts. "Slightly" is <= 20% of the token
 *      count, measured, and reported per proposal so a reader can judge it.
 *   3. A MATCH IS A PROPOSAL, NEVER AN AUTO-ATTACH. Output is a review list. A name that silently
 *      followed a word that drifted into meaning something DIFFERENT would be invisible — a wrong
 *      name still compiles — and that is the producer/consumer drift bug in a new costume.
 *   4. THE RENAME QUEUE is what survives orphan matching: leaves in use with no name, frequency
 *      ordered. Its length is a first-class number, reported on every run.
 */
const fs = require("fs");
const path = require("path");
const AC = require("./engine/artifact-contract");
const WN = require("./engine/word-names");

const CENSUS = process.argv[2];
const FILE = process.argv[3] || AC.pathFor("word-names");
const NEAR = +(process.env.NEAR || 0.2); // "slightly changed" = <= 20% of tokens differ
const APPLY = process.env.APPLY === "1";

const tokens = (sym) => sym.replace(/‹[a-z]+›/g, (m) => " " + m + " ").split(/\s+/).filter(Boolean);
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

const leaves = JSON.parse(fs.readFileSync(CENSUS, "utf8"));
const live = new Map(leaves.map((r) => [WN.hashOf(r.axis, r.sym), r]));
const cur = WN.load(FILE);
const names = cur.names, orphans = cur.orphans;
const today = new Date().toISOString().slice(0, 10);

// 1. orphan every name whose skeleton is gone.
let newlyOrphaned = 0;
for (const h of Object.keys(names)) {
  if (live.has(h)) continue;
  orphans[h] = Object.assign({}, names[h], { orphanedAt: today });
  delete names[h];
  newlyOrphaned++;
}

// 2 + 3. propose re-adoptions for unnamed leaves that closely match an orphan.
const proposals = [];
const orphanToks = Object.entries(orphans).map(([h, o]) => [h, o, tokens(o.sym)]);
for (const [h, r] of live) {
  if (names[h]) continue;
  const t = tokens(r.sym);
  let best = null;
  for (const [oh, o, ot] of orphanToks) {
    const d = editDistance(t, ot);
    const frac = d / Math.max(t.length, ot.length, 1);
    if (frac <= NEAR && (!best || frac < best.frac)) best = { oh, o, frac, d };
  }
  if (best) proposals.push({ h, sym: r.sym, sites: r.sites, from: best.oh, en: best.o.en, was: best.o.sym, drift: +(100 * best.frac).toFixed(1) });
}
proposals.sort((a, b) => b.sites - a.sites);

// 4. the rename queue: in use, unnamed, and NOT covered by a proposal.
const proposed = new Set(proposals.map((p) => p.h));
const queue = leaves.filter((r) => { const h = WN.hashOf(r.axis, r.sym); return !names[h] && !proposed.has(h); });

console.log("newly orphaned names ....... " + newlyOrphaned + "  (kept, never deleted; " + Object.keys(orphans).length + " orphans total)");
console.log("re-adoption PROPOSALS ...... " + proposals.length + "  (review required — nothing auto-attaches)");
for (const p of proposals.slice(0, 10)) console.log("   " + p.drift + "% drift  n=" + p.sites + '  "' + p.en + '"');
console.log("RENAME QUEUE ............... " + queue.length + "  unnamed leaves in use, covering "
  + queue.reduce((s, x) => s + x.sites, 0) + " sites");
console.log("named ...................... " + Object.keys(names).length);

if (APPLY) {
  fs.writeFileSync(FILE, JSON.stringify(AC.stamp("word-names", { names, orphans }, { generated: today }), null, 1) + "\n");
  console.log("\nwrote " + FILE + " (orphans moved; proposals NOT applied)");
}
fs.writeFileSync(path.join(AC.corpusRoot(), ".cache", "spec-derived", "name-queue.json"), JSON.stringify({
  schema: "sdd-repo-dsl/name-queue/1", generated: today, newlyOrphaned, orphans: Object.keys(orphans).length,
  proposals, queueLength: queue.length, named: Object.keys(names).length,
  queue: queue.slice(0, 200).map((r) => ({ sites: r.sites, axis: r.axis, sym: r.sym })),
}, null, 1) + "\n");
