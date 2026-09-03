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
 *
 * ALL FOUR RULES APPLY TO CHUNK NAMES TOO, AS OF 2026-09-03. They did not before, and the gap was
 * not a subtlety: this script iterated `Object.keys(names)` — the six-entry LEAF ledger — and never
 * read `chunks` at all. Run against a corpus where 974 of 3,582 chunk names had stopped resolving,
 * it reported `newly orphaned names ....... 2`. It was not wrong about what it looked at; it looked
 * at one of the two ledgers and said nothing about the other.
 *
 * TWO DENOMINATORS, DELIBERATELY, because the two questions are different:
 *   ORPHANING asks "does this skeleton still exist?" and is answered against the WHOLE CATALOG.
 *      §5C rule 1 says "a name whose hash is no longer IN THE CATALOG" — not "no longer in use". A
 *      name whose skeleton exists but which nothing currently renders through is not an orphan, and
 *      orphaning it would be a deletion in slow motion.
 *   PROPOSALS AND THE QUEUE ask "what still needs a name?" and are answered against the words IN
 *      USE, from the naming-plan's composite tiers. A proposal for a chunk no file renders is noise,
 *      and rule 4 defines the queue as in-use-and-unnamed.
 *
 * A CHUNK ORPHAN CAN ONLY BE PROPOSED BACK IF IT KNOWS WHAT IT NAMED. Chunk records historically
 * stored `{en, len, note}` and no skeleton, while the key is a one-way hash — so rule 2 was not
 * merely unimplemented for chunks, it was unimplementable. `enrich-chunk-leaves.js` puts `leaves` on
 * the record; this script requires it and REPORTS chunk orphans that lack it rather than silently
 * scoring them against nothing.
 */
const fs = require("fs");
const path = require("path");
const AC = require("./engine/artifact-contract");
const WN = require("./engine/word-names");

const CENSUS = process.argv[2];
const FILE = process.argv[3] || AC.pathFor("word-names");
const NEAR = +(process.env.NEAR || 0.2); // "slightly changed" = <= 20% of tokens differ
const APPLY = process.env.APPLY === "1";

/* WHY THIS RAN ZERO TIMES UNTIL 2026-09-02, and what was NOT the reason.
 *
 * `.cache/spec-derived/name-queue.json` had never published once. The diagnosis handed to me was
 * the §8B requires violation below — real, but not the blocker: the name-queue write sits OUTSIDE
 * `if (APPLY)`, so it never needed the word-names stamp to succeed. MEASURED instead by running the
 * script with no arguments: `ERR_INVALID_ARG_TYPE` at line 40, because `process.argv[2]` was a
 * MANDATORY census file and NOTHING in the live pipeline produced one. `sdd-run.js:85-91` already
 * recorded exactly that. The script could not start, so nothing downstream of it could publish.
 *
 * THE CENSUS ALREADY EXISTS AS A PUBLISHED ARTIFACT. `naming-plan`'s tier 0 rows carry
 * `{ key, axis, sym, sites }` and its `key` IS `WN.hashOf(axis, sym)` — asserted below, not
 * assumed. So the census is derived from the stamped artifact by default, and a caller-supplied
 * file still wins. Two producers of one census would be two answers to drift apart.
 *
 * THE STAMP NOW CARRIES `chunks`, AND THE ORDER MATTERED. It used to write { names, orphans }, which
 * the registry's requires: ["names","orphans","chunks"] refused — and that refusal was LOAD-BEARING.
 * It was the only thing standing between a re-mine and the irrecoverable loss of 3,582 applied chunk
 * names, because `Examples/` is gitignored and word-names.json had no git history at all. Adding
 * `chunks` to the stamp EARLIER, to make the pass publish, would have converted a loud refusal into
 * a silent drop: the write would have succeeded while the orphan/re-adoption half was still unwired.
 *
 * So it was closed LAST, in this order and for this reason: (1) the names were committed to version
 * control (tools/name-ledger-backup/), (2) chunk records were given the skeletons they name, (3)
 * orphaning and re-adoption were implemented for chunks, and only then (4) the stamp was completed.
 * Reversing steps 3 and 4 is the mistake the §8B contract existed to prevent. */

/* Derive the leaf census from the stamped naming-plan. Refuses loudly rather than returning a
 * partial list — a SHORT census would orphan every name missing from it, which is the one thing
 * rule 1 above exists to prevent. */
function censusFromPlan() {
  const p = AC.pathFor("naming-plan");
  if (!fs.existsSync(p)) {
    console.error(`REFUSING: no census given and no naming-plan at\n  ${p}\n` +
      "  Pass a census file as argv[2], or run `npm run name:plan` first.\n" +
      "  A census this script guessed at would orphan every name missing from it.");
    process.exit(3);
  }
  const plan = AC.load("naming-plan", p);
  const tier0 = (plan.tiers || []).find((t) => t.depth === 0);
  if (!tier0 || !(tier0.rows || []).length) {
    console.error("REFUSING: the naming-plan carries no depth-0 tier, so it holds no leaf census.");
    process.exit(3);
  }
  const rows = tier0.rows.map((r) => ({ axis: r.axis, sym: r.sym, sites: r.sites }));
  const bad = tier0.rows.filter((r) => r.key !== WN.hashOf(r.axis, r.sym)).length;
  if (bad) {
    console.error(`REFUSING: ${bad} naming-plan rows have a key that is not hashOf(axis, sym). ` +
      "The plan and word-names.json would be keyed differently and every name would orphan.");
    process.exit(3);
  }
  console.log(`census ..................... ${rows.length} leaves, derived from the stamped naming-plan ` +
    `(fingerprint ${plan.fingerprint})`);
  return rows;
}

const tokens = (sym) => sym.replace(/‹[a-z]+›/g, (m) => " " + m + " ").split(/\s+/).filter(Boolean);
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}

const leaves = CENSUS ? (() => {
  const r = JSON.parse(fs.readFileSync(CENSUS, "utf8"));
  console.log(`census ..................... ${r.length} rows, from the caller-supplied file ${CENSUS}`);
  return r;
})() : censusFromPlan();
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
/* LEAF orphans only. The ledger is shared and the keys are namespaced — "w:"/"n:" for leaves,
 * "wc:"/"nc:" for chunks — so a chunk orphan sitting in the same map must not be offered as a match
 * for a leaf. It has no `sym` and its `leaves` describe a multi-statement run, which is a different
 * kind of thing entirely. */
const isChunkKey = (k) => /^[wn]c:/.test(k);
const orphanToks = Object.entries(orphans)
  .filter(([h, o]) => !isChunkKey(h) && o && typeof o.sym === "string")
  .map(([h, o]) => [h, o, tokens(o.sym)]);
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

/* ---- CHUNK RECONCILIATION (§5C rules 1-4, for `chunks`) --------------------------------------- */
const chunks = cur.chunks;
const catPath = AC.pathFor("generators-lzw");
if (!fs.existsSync(catPath)) {
  console.error("REFUSING: no dictionary at\n  " + catPath +
    "\n  Chunk orphaning asks whether a skeleton is still IN THE CATALOG; with no catalog every\n" +
    "  chunk name would orphan at once, which is the exact outcome rule 1 exists to prevent.");
  process.exit(3);
}
const liveChunks = WN.chunkIndexOf(JSON.parse(fs.readFileSync(catPath, "utf8")));

/* 1. orphan every chunk name whose leaf sequence is gone from the catalog. */
let newlyOrphanedChunks = 0;
for (const k of Object.keys(chunks)) {
  if (liveChunks.has(k)) continue;
  orphans[k] = Object.assign({}, chunks[k], { orphanedAt: today });
  delete chunks[k];
  newlyOrphanedChunks++;
}

/* 1b. THE MIRROR OF RULE 1, AND IT WAS MISSING. Rule 1 catches a name whose skeleton left the
 * catalog. Nothing caught a name whose skeleton CAME BACK. Measured on the live tree after the
 * MIN_SKEL=1 re-mine: 19 chunk orphans had their EXACT content-hash key restored, and every number
 * this tool printed was silent about it — `newly orphaned chunks 0` and `PROPOSALS 8`, with the 19
 * in neither.
 *
 * These are a different KIND of thing from a proposal, and collapsing them would be wrong in both
 * directions. A proposal is a fuzzy match scored by edit distance over skeletons, and it can be
 * wrong. This is an exact match on `sha256(ordered leaf skeletons)` — the key IS the content, so
 * the word in the catalog today is provably the same word the name was authored for. Certainty and
 * a guess do not belong in one bucket.
 *
 * IT STILL DOES NOT AUTO-ATTACH. §5C/R-LANG-7 is a rule about who decides, not about confidence,
 * and re-attaching a chunk name now CHANGES A LABEL — which since a5501a7 is an input to
 * compilation, so an .en rendered under the old naming and compiled under the new one is a refusal.
 * Certainty about WHICH name it is does not make the re-attach free. Reported, ranked first,
 * applied by a human alongside a render. */
const resurrected = Object.entries(orphans)
  .filter(([k]) => isChunkKey(k) && liveChunks.has(k))
  .map(([k, o]) => ({ key: k, en: o.en, len: o.len, orphanedAt: o.orphanedAt, recovered: !!o.leavesFrom }));

/* The chunk orphans that CANNOT be proposed back, because the record never stored what it named.
 * Counted and named rather than quietly scored against nothing — a scorer fed an undefined skeleton
 * returns a confident number, and a confident number about nothing is how the leaf ledger reported
 * 2 against a corpus that had lost 974. Fix: run enrich-chunk-leaves.js BEFORE the re-mine. */
const chunkOrphans = Object.entries(orphans).filter(([k]) => isChunkKey(k));
const describable = chunkOrphans.filter(([, o]) => Array.isArray(o.leaves) && o.leaves.length);
const undescribable = chunkOrphans.length - describable.length;

/* 2 + 3. propose re-adoptions for IN-USE unnamed chunks that closely match a chunk orphan.
 * The in-use set comes from the naming-plan's composite tiers (depth >= 1) — the same artifact the
 * leaf census comes from, so there is one producer of "what is in use" and not two to drift apart. */
const inUseChunks = (() => {
  const p2 = AC.pathFor("naming-plan");
  if (!fs.existsSync(p2)) return [];
  const plan = AC.load("naming-plan", p2);
  const out = [];
  for (const t of plan.tiers || []) {
    if (!t.depth) continue;                       // depth 0 is the leaf census
    for (const r of t.rows || []) if (r.key && Array.isArray(r.leaves)) out.push(r);
  }
  return out;
})();

const chunkToks = (leaves) => tokens(leaves.join(" "));
const orphanChunkToks = describable.map(([k, o]) => [k, o, chunkToks(o.leaves)]);
const chunkProposals = [];
for (const r of inUseChunks) {
  if (chunks[r.key]) continue;                    // already named
  const t = chunkToks(r.leaves);
  let best = null;
  for (const [ok2, o, ot] of orphanChunkToks) {
    /* LENGTH PREFILTER, and it is not just a speed trick: NEAR is a fraction of the longer token
     * count, so a candidate differing in length by more than NEAR can never pass the real test.
     * Skipping it changes no outcome and turns 626 x 974 full edit distances into a fraction. */
    if (Math.abs(t.length - ot.length) > NEAR * Math.max(t.length, ot.length)) continue;
    const d = editDistance(t, ot);
    const frac = d / Math.max(t.length, ot.length, 1);
    if (frac <= NEAR && (!best || frac < best.frac)) best = { ok2, o, frac, d };
  }
  if (best) chunkProposals.push({ key: r.key, sites: r.sites, from: best.ok2, en: best.o.en,
    drift: +(100 * best.frac).toFixed(1), len: r.leaves.length });
}
chunkProposals.sort((a, b) => b.sites - a.sites);
const chunkProposed = new Set(chunkProposals.map((p2) => p2.key));
const chunkQueue = inUseChunks.filter((r) => !chunks[r.key] && !chunkProposed.has(r.key));

console.log("newly orphaned names ....... " + newlyOrphaned + "  (kept, never deleted; " + Object.keys(orphans).length + " orphans total)");
console.log("re-adoption PROPOSALS ...... " + proposals.length + "  (review required — nothing auto-attaches)");
for (const p of proposals.slice(0, 10)) console.log("   " + p.drift + "% drift  n=" + p.sites + '  "' + p.en + '"');
console.log("RENAME QUEUE ............... " + queue.length + "  unnamed leaves in use, covering "
  + queue.reduce((s, x) => s + x.sites, 0) + " sites");
console.log("named ...................... " + Object.keys(names).length);
console.log("");
console.log("CHUNK NAMES (\u00a75D.3D / R-LANG-19)");
console.log("  chunk keys in the catalog . " + liveChunks.size);
console.log("  chunk names still resolving " + Object.keys(chunks).length);
console.log("  newly orphaned chunks ..... " + newlyOrphanedChunks + "  (kept, never deleted; "
  + chunkOrphans.length + " chunk orphans total)");
if (undescribable) {
  console.log("  ...of which UNDESCRIBABLE .. " + undescribable + "  <- no `leaves` on the record, so re-adoption");
  console.log("                                    can never propose them. Run enrich-chunk-leaves.js");
  console.log("                                    BEFORE the re-mine that orphans them.");
}
if (resurrected.length) {
  console.log("  EXACT RE-ADOPTIONS ........ " + resurrected.length + "  <- these orphans' content-hash keys are BACK in");
  console.log("                                    the catalog. Not a guess: the key is the hash of the");
  console.log("                                    skeleton, so this is provably the same word. Still");
  console.log("                                    needs a human + a render (a label is now an input to");
  console.log("                                    compilation), so nothing auto-attaches.");
  for (const r of resurrected.slice(0, 10))
    console.log("     " + r.key + "  len=" + r.len + (r.recovered ? "  [recovered]" : "") + '  "' + r.en + '"');
  if (resurrected.length > 10) console.log("     \u2026 and " + (resurrected.length - 10) + " more");
}
console.log("  chunks in use ............. " + inUseChunks.length);
console.log("  re-adoption PROPOSALS ..... " + chunkProposals.length + "  (review required — nothing auto-attaches)");
for (const p2 of chunkProposals.slice(0, 10))
  console.log("     " + p2.drift + "% drift  n=" + p2.sites + "  len=" + p2.len + '  "' + p2.en + '"');
console.log("  CHUNK RENAME QUEUE ........ " + chunkQueue.length + "  unnamed chunks in use, covering "
  + chunkQueue.reduce((a, b) => a + (b.sites || 0), 0) + " sites");

const totalNewlyOrphaned = newlyOrphaned + newlyOrphanedChunks;
if (APPLY && totalNewlyOrphaned > 0 && process.env.ALLOW_ORPHANS !== "1") {
  /* A census that is merely INCOMPLETE looks exactly like a corpus whose skeletons all moved. The
   * difference is invisible from here, so mass orphaning needs a human to say the number out loud.
   * Nothing is written on this path — the queue below still publishes.
   *
   * WHAT THIS GUARD DELIBERATELY DOES NOT COVER, so nobody later "improves" it to: retuning a
   * MINING PARAMETER. §10 (10-language-and-grammar.md:42) — read, not relayed — states the property
   * that must hold: because names key on the content hash of the canonical skeleton and NEVER on the
   * word id, "retuning MAXWIN, MIN_COUNT or MIN_SKEL cannot orphan a name". So lowering MIN_SKEL
   * orphans zero and this guard will not fire, correctly. It is a CANONICALIZER change that orphans
   * — and §10 says that is correct behaviour, not a failure, because those skeletons genuinely
   * became different skeletons. This guard exists for the third case: a census that is short by
   * accident, which is indistinguishable from the second. */
  console.error(`\nREFUSING to write ${FILE}: this run would orphan ${totalNewlyOrphaned} name(s) `
    + `(${newlyOrphaned} leaf, ${newlyOrphanedChunks} chunk).`);
  console.error("  An incomplete census is indistinguishable from a corpus that really moved.");
  console.error("  Re-run with ALLOW_ORPHANS=1 if the orphaning is genuinely intended.");
} else if (APPLY) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });   // a fresh corpus has no sen/catalog/ yet
  fs.writeFileSync(FILE, JSON.stringify(AC.stamp("word-names", { names, orphans, chunks }, { generated: today }), null, 1) + "\n");
  console.log("\nwrote " + FILE + " (orphans moved; proposals NOT applied)");
}
/* This used to hand-write `schema: "sdd-repo-dsl/name-queue/1"` as a literal, with no fingerprint,
 * and the kind was not in the §8B registry at all — so `validate` could never have been called on
 * it and a shape change would have been silent. That is the exact landmine CLAUDE.md §8 names, in
 * the module whose entire job is reconciliation. Registered kind + AC.stamp + AC.pathFor now, so
 * the schema string and the location both come from the registry rather than from this line. */
/* THIS WRITE IS OUTSIDE `if (APPLY)` ON PURPOSE, and it is the point of the script: the rename
 * queue is a REPORT, and a report that only exists when you also mutate the catalog is not a
 * report. Noted because it surprised a reader on 2026-09-02: a report-only invocation DOES write
 * this one file. `--no-queue` skips it for a pure read. */
const queuePath = AC.pathFor("name-queue");
if (process.argv.includes("--no-queue")) {
  console.log("\n--no-queue: the rename queue was NOT published.");
  return;
}
fs.mkdirSync(path.dirname(queuePath), { recursive: true });
fs.writeFileSync(queuePath, JSON.stringify(AC.stamp("name-queue", {
  newlyOrphaned, orphans: Object.keys(orphans).length,
  proposals, queueLength: queue.length, named: Object.keys(names).length,
  queue: queue.slice(0, 200).map((r) => ({ sites: r.sites, axis: r.axis, sym: r.sym })),
  /* The chunk half, reported beside the leaf half rather than in a second artifact: they are two
   * ledgers of one naming effort, and splitting the report is how the chunk side went unwatched. */
  chunkNewlyOrphaned: newlyOrphanedChunks,
  chunkExactReadoptions: resurrected.length,
  chunkResurrected: resurrected,
  chunkOrphans: chunkOrphans.length,
  chunkOrphansUndescribable: undescribable,
  chunkProposals,
  chunkQueueLength: chunkQueue.length,
  chunkNamed: Object.keys(chunks).length,
  chunkQueue: chunkQueue.slice(0, 200).map((r) => ({ sites: r.sites, axis: r.axis, len: r.leaves.length, key: r.key })),
}, { generated: today }), null, 1) + "\n");
AC.load("name-queue", queuePath);
