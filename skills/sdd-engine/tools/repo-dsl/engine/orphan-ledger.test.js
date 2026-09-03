/* orphan-ledger.test.js — §5C's STEADY STATE, END TO END. GREEN as of 2026-09-03.
 *
 * §5C / R-LANG-7, the rule this file tests: a name whose skeleton no longer exists MOVES TO THE
 * ORPHANS LEDGER AND IS NEVER DELETED; the authoring pass matches orphans FIRST; a match produces a
 * re-adoption PROPOSAL scored by token edit distance, never an automatic attachment; and the rename
 * queue length is a first-class metric reported beside byte-identity.
 *
 * WHAT THIS FILE CAUGHT, and it is kept here because the fix is only legible against it.
 * `reconcile-names.js` implemented all four rules correctly FOR LEAF NAMES and had no notion of
 * CHUNK names — where 3,582 of the 3,588 hand-authored names actually live (6 leaf, 3,582 chunk).
 * The gap was invisible in every number the tool printed: run against a corpus where 974 chunk names
 * had stopped resolving, it reported "newly orphaned names ....... 2", because it iterated the
 * six-entry leaf ledger and never read `chunks`.
 *
 * IT WENT GREEN BY THE GAP BEING CLOSED, IN THIS ORDER, WHICH WAS THE WHOLE DIFFICULTY:
 *   1. the 3,582 names were committed to version control (tools/name-ledger-backup/) — they existed
 *      in exactly one gitignored place and had no git history at all;
 *   2. chunk records were given the skeletons they name (enrich-chunk-leaves.js). Rule 2 scores an
 *      orphan by edit distance over its skeleton, and a chunk record stored only {en, len, note}
 *      against a one-way hash key — so re-adoption was not unimplemented for chunks, it was
 *      UNIMPLEMENTABLE. All 974 already-orphaned names were recovered from a pre-body-slot catalog;
 *   3. orphaning, re-adoption scoring and the queue were implemented for chunks;
 *   4. and ONLY THEN did `chunks` go into the stamp.
 *
 * Doing 4 before 3 is the mistake §8B's contract existed to prevent: it would have made the write
 * succeed while the orphan half was still unwired, converting a loud refusal into a silent drop.
 *
 * WHAT SAVED THE DATA, and it is worth recording because it is a guard that FIRED. Running
 * `APPLY=1 reconcile-names.js` after a re-mine does not corrupt anything — it THROWS. The write is
 * `AC.stamp("word-names", { names, orphans })` and the registry requires `chunks`, so the artifact
 * contract refuses: "absent — refusing to publish an artifact its own consumers cannot read". Had
 * that key not been required, the module whose stated rule #1 is "ORPHAN, NEVER DELETE. Hand-
 * authored names have already been lost once in this effort; nothing here removes one" would have
 * deleted all 3,582 of them. §8B paid for itself here.
 *
 * PROVEN ON A THROWAWAY, not argued: enrich (3,582 described, 974 of them recovered from a
 * historical catalog), re-mine, plan, reconcile. Result — 974 newly orphaned chunks, all 974 in the
 * ledger carrying their skeleton, 8 scored re-adoption proposals, chunk queue 591, and 3,582 total
 * names preserved (2,608 resolving + 974 orphaned). Nothing auto-attached.
 */
const fs = require("fs");
const path = require("path");
const AC = require("./artifact-contract");
const WN = require("./word-names");
const CR = require("./corpus-root");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

const wnPath = path.join(CR.corpusRoot(), "sen", "catalog", "word-names.json");
if (!fs.existsSync(wnPath)) { console.error("SKIP: no word-names.json at " + wnPath); process.exit(0); }
const wn = WN.load(wnPath);
const nLeaf = Object.keys(wn.names).length, nChunk = Object.keys(wn.chunks).length;

console.log("");
console.log("  hand-authored names in this corpus");
console.log("    leaf names  (n:/w:)    " + nLeaf);
console.log("    chunk names (nc:/wc:)  " + nChunk);
console.log("    orphans                " + Object.keys(wn.orphans).length);
console.log("");

/* ---- 1. THE LEDGER MUST COVER WHAT IS ACTUALLY NAMED ------------------------------------------
 * Not "does an orphans map exist" — it does, and it is empty, which is exactly how this stayed
 * invisible. The question is whether the mechanism can REACH the names that exist. */
{
  const src = fs.readFileSync(path.join(__dirname, "..", "reconcile-names.js"), "utf8");
  const mentionsChunks = /\bchunks\b/.test(src);
  ok(mentionsChunks, "1. reconcile-names.js knows chunk names exist at all"
    + (mentionsChunks ? "" : " — it reads `names` and `orphans` only, so the " + nChunk
      + " chunk names are outside the orphan/re-adoption mechanism entirely"));
}

/* ---- 2. IT MUST BE ABLE TO WRITE WHAT IT LOADS ------------------------------------------------
 * The round-trip on the ARTIFACT, which is the same property this engine asserts about .en files:
 * load it, write it back, and it must still be a valid artifact. It was not — the write stamped
 * {names, orphans} and the registry requires `chunks`, so a successful APPLY would have published a
 * word-names.json with all 3,582 chunk names ABSENT rather than orphaned. §8B refused it.
 *
 * ASSERTED THROUGH THE KEYS THE SOURCE ACTUALLY STAMPS, not through a hand-written body: a test
 * that stamps {names, orphans, chunks} itself proves the registry works and proves nothing about
 * reconcile-names.js. So the keys are read out of the write site and fed to AC.stamp — rewrite that
 * line to drop a key again and this goes red. */
{
  const rsrc = fs.readFileSync(path.join(__dirname, "..", "reconcile-names.js"), "utf8");
  const m = rsrc.match(/AC\.stamp\(\s*"word-names"\s*,\s*\{([^}]*)\}/);
  ok(!!m, "2. reconcile-names.js has a word-names stamp site the test can read");
  const keys = m ? m[1].split(",").map((k) => k.split(":")[0].trim()).filter(Boolean) : [];
  const body = {};
  for (const k of keys) body[k] = wn[k] !== undefined ? wn[k] : {};

  let threw = null;
  try { AC.stamp("word-names", body); } catch (e) { threw = e; }
  ok(!threw, "2. what reconcile-names.js writes — {" + keys.join(", ") + "} — is a publishable word-names artifact"
    + (threw ? ": " + String(threw.message || threw).split("\n")[0] : ""));

  /* and the control, in the direction that can still fail (§10.3): DROPPING chunks must be refused.
   * Without this, assertion 2 would pass just as happily against a registry with no `requires` row
   * at all — the guard that actually saved the names would be untested by the test that celebrates
   * it. */
  let ctlThrew = null;
  try { AC.stamp("word-names", { names: wn.names, orphans: wn.orphans }); } catch (e) { ctlThrew = e; }
  ok(!!ctlThrew, "2. control — the same body WITHOUT chunks is still REFUSED, so §8B's row is live"
    + (ctlThrew ? "" : ": it published, meaning nothing now stops the write that would have dropped 3,582 names"));
}

/* ---- 3. THE QUEUE METRIC MUST COUNT WHAT IS UNNAMED --------------------------------------------
 * R-LANG-7 makes queue length a first-class number reported beside byte-identity. A queue computed
 * over leaves alone understates by however many chunk sites are unnamed, and worse, it cannot ever
 * report a chunk name that has gone orphan — the number moves in the wrong direction from reality.
 * Asserted against the name-queue artifact if one has been written. */
{
  const qPath = AC.pathFor("name-queue");
  if (!fs.existsSync(qPath)) {
    /* AND ITS ABSENCE IS EVIDENCE, not a gap in this test. Enumerating every §8B registry kind
     * against disk on 2026-09-03, `name-queue` is the ONLY registered kind with no file — which
     * means reconcile-names.js has NEVER SUCCESSFULLY PUBLISHED, exactly as assertion 2 predicts.
     * The absence corroborates the code reading rather than needing it. */
    console.log("  no name-queue artifact on disk — reconcile-names.js has never successfully published");
    ok(false, "3. a name-queue artifact exists to report queue length beside byte-identity");
  } else {
    const q = JSON.parse(fs.readFileSync(qPath, "utf8"));
    const body = q.body || q;
    console.log("  name-queue: queueLength " + body.queueLength + ", orphans " + body.orphans + ", proposals " + (body.proposals || []).length);
    ok(Object.prototype.hasOwnProperty.call(body, "chunkQueueLength") ||
       Object.prototype.hasOwnProperty.call(body, "chunkOrphans"),
      "3. the name-queue reports the CHUNK half of the queue, not the leaf half alone");
  }
}

/* ---- 4. A REPORT-ONLY RUN MUST NOT MUTATE THE CATALOG ------------------------------------------
 * THIS ASSERTION WAS NARROWED ON 2026-09-03, AND THE NARROWING IS AN ADMISSION. It previously
 * demanded that the name-queue write sit inside `if (APPLY)`, on the strength of my having been
 * surprised when a report-only run published
 * Examples/hydra-source/.cache/spec-derived/name-queue.json. Re-reading it against the PRD rather
 * than against my surprise: that path is `.cache/spec-derived/`, which is derived-artifact
 * territory by definition, and the file is a REPORT. reconcile-names.js argues the point itself —
 * "the rename queue is a REPORT, and a report that only exists when you also mutate the catalog is
 * not a report" — and provides `--no-queue` for a pure read. That argument is correct and my
 * assertion was overreach: I generalised one startled moment into a rule the design had already
 * considered and rejected for a stated reason.
 *
 * WHAT IS ACTUALLY LOAD-BEARING, and is what this now asserts: a run without APPLY must not touch
 * the CATALOG — sen/catalog/word-names.json, the hand-authored names with no git history. Writing a
 * derived report is not that. Asserted statically, by reading the source, because asserting it
 * dynamically would mean running the tool, which is the thing that writes. */
{
  const src = fs.readFileSync(path.join(__dirname, "..", "reconcile-names.js"), "utf8");
  /* THE GUARD, not the comment that describes it. `indexOf("if (APPLY)")` matched prose in the
   * file header 200 lines above the code — an anchored match is the difference between locating the
   * guard and locating a sentence about it. Caught by this assertion failing where it should have
   * passed; had it been the other way round it would have passed forever. */
  const applyAt = src.search(/^if \(APPLY/m);
  ok(applyAt > 0, "4. the APPLY guard is locatable in the source at all");
  const catalogWrites = [...src.matchAll(/fs\.writeFileSync\(FILE\b/g)].map((m) => m.index);
  const guarded = catalogWrites.length > 0 && catalogWrites.every((i) => i > applyAt);
  ok(guarded, "4. every write to word-names.json is behind the APPLY guard"
    + (guarded ? " (" + catalogWrites.length + " write site" + (catalogWrites.length === 1 ? "" : "s") + ")"
               : ": a run without APPLY can modify the hand-authored names"));

  /* and the guard the throwaway proof exercised: mass orphaning needs a human to say the number out
   * loud, and it must count BOTH ledgers — counting leaves alone is how 974 would have gone through
   * on a report of 2. */
  const guardSrc = src.slice(Math.max(0, applyAt - 400), applyAt + 900);
  ok(/ALLOW_ORPHANS/.test(src) && /newlyOrphanedChunks/.test(guardSrc),
    "4. the mass-orphan guard counts chunk orphans as well as leaf orphans");
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\n§5C's steady state has regressed: it no longer reaches chunk names end to end.");
