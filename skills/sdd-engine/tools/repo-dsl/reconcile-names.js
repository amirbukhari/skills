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
 * WHAT IS DELIBERATELY NOT FIXED HERE. `AC.stamp("word-names", { names, orphans })` at the APPLY
 * branch omits `chunks`, which the registry entry requires, so APPLY refuses. THAT REFUSAL IS
 * LOAD-BEARING and stays: it is the only thing standing between a re-mine and the irrecoverable
 * loss of 3,582 applied chunk names (`Examples/` is gitignored, so word-names.json has no git
 * history). Adding `chunks` to the stamp would let the pass publish while §5C's orphan/re-adoption
 * half is still unwired — a loud refusal converted into a silent drop. Pinned RED in
 * `engine/orphan-ledger.test.js`. Closing it is Amir's call, and it is not needed to publish the
 * queue: report-only already does that. */

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

if (APPLY && newlyOrphaned > 0 && process.env.ALLOW_ORPHANS !== "1") {
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
  console.error(`\nREFUSING to write ${FILE}: this run would orphan ${newlyOrphaned} name(s).`);
  console.error("  An incomplete census is indistinguishable from a corpus that really moved.");
  console.error("  Re-run with ALLOW_ORPHANS=1 if the orphaning is genuinely intended.");
} else if (APPLY) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });   // a fresh corpus has no sen/catalog/ yet
  fs.writeFileSync(FILE, JSON.stringify(AC.stamp("word-names", { names, orphans }, { generated: today }), null, 1) + "\n");
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
}, { generated: today }), null, 1) + "\n");
AC.load("name-queue", queuePath);
