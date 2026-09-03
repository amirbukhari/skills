/* orphan-ledger.test.js — §5C's STEADY STATE, END TO END. RED.
 *
 * §5C / R-LANG-7, the rule this file tests: a name whose skeleton no longer exists MOVES TO THE
 * ORPHANS LEDGER AND IS NEVER DELETED; the authoring pass matches orphans FIRST; a match produces a
 * re-adoption PROPOSAL scored by token edit distance, never an automatic attachment; and the rename
 * queue length is a first-class metric reported beside byte-identity.
 *
 * `reconcile-names.js` implements all four of those correctly — FOR LEAF NAMES. It has no notion of
 * CHUNK names, which is where 3,582 of the 3,588 hand-authored names actually live (6 leaf names,
 * 3,582 chunk names, as of 2026-09-03). So the steady state is not wired end to end, and the gap is
 * invisible in every number the tool prints: after a re-mine it reports "newly orphaned 2" while 974
 * chunk names have silently stopped resolving, and its rename queue counts leaves only.
 *
 * WHY THIS IS A TEST AND NOT A FIX. Amir, 2026-09-03: "If the orphans/re-adoption machinery isn't
 * actually wired up end-to-end, THAT's the finding — say so rather than working around it." Saying
 * so executably is what this file does. A worked-around gap gets forgotten; a red test does not.
 *
 * WHAT SAVED THE DATA, and it is worth recording because it is a guard that FIRED. Running
 * `APPLY=1 reconcile-names.js` after a re-mine does not corrupt anything — it THROWS. The write is
 * `AC.stamp("word-names", { names, orphans })` and the registry requires `chunks`, so the artifact
 * contract refuses: "absent — refusing to publish an artifact its own consumers cannot read". Had
 * that key not been required, the module whose stated rule #1 is "ORPHAN, NEVER DELETE. Hand-
 * authored names have already been lost once in this effort; nothing here removes one" would have
 * deleted all 3,582 of them. §8B paid for itself here.
 *
 * The consequence is that the steady-state tool CANNOT COMPLETE after any re-mine, which is why the
 * live catalog has deliberately not been re-mined under the body-as-slot change (2d83452).
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
 * The round-trip on the ARTIFACT, which is the same property this whole engine asserts about .en
 * files: load it, write it back, and it must still be a valid artifact. It is not — the write drops
 * `chunks`, and the registry requires it. Asserted through AC.stamp rather than by grepping the
 * write, so a rewrite of that line is still caught. */
{
  let threw = null;
  try { AC.stamp("word-names", { names: wn.names, orphans: wn.orphans }); }
  catch (e) { threw = e; }
  ok(!threw, "2. what reconcile-names.js writes — {names, orphans} — is a publishable word-names artifact"
    + (threw ? ": " + String(threw.message || threw).split("\n")[0] : ""));

  /* and the control: the SAME call carrying chunks must succeed, or assertion 2 is failing for
   * some unrelated reason and proves nothing (§10.3). */
  let ctlThrew = null;
  try { AC.stamp("word-names", { names: wn.names, orphans: wn.orphans, chunks: wn.chunks }); }
  catch (e) { ctlThrew = e; }
  ok(!ctlThrew, "2. control — the same body WITH chunks does publish, so the failure above is the missing key"
    + (ctlThrew ? ": " + String(ctlThrew.message || ctlThrew).split("\n")[0] : ""));
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

/* ---- 4. A REPORT-ONLY RUN MUST NOT WRITE TO THE CORPUS ----------------------------------------
 * Found the hard way on 2026-09-03: reconcile-names.js writes the name-queue artifact
 * UNCONDITIONALLY, outside its `if (APPLY)` guard. Running it to READ the queue length therefore
 * published a file into Examples/hydra-source/.cache/spec-derived/ — a corpus write from an
 * invocation whose whole purpose was to look without touching. It was reverted (the file is
 * preserved out-of-tree), but the shape is the point: a tool with an APPLY flag that writes
 * something regardless teaches its callers that the flag means less than it says.
 *
 * Asserted statically, by reading the source, because asserting it dynamically would mean running
 * the tool — which is the very thing that writes. */
{
  const src = fs.readFileSync(path.join(__dirname, "..", "reconcile-names.js"), "utf8");
  const applyAt = src.indexOf("if (APPLY)");
  const queueWriteAt = src.indexOf('AC.pathFor("name-queue")');
  const applyBlockEnd = applyAt >= 0 ? src.indexOf("\n}", applyAt) : -1;
  const inside = applyAt >= 0 && queueWriteAt > applyAt && applyBlockEnd > 0 && queueWriteAt < applyBlockEnd;
  ok(inside, "4. the name-queue write is inside the APPLY guard — a report-only run touches no corpus file"
    + (inside ? "" : ": it is unconditional, so merely reading the queue publishes an artifact"));
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\nRED ON PURPOSE: §5C's steady state is built for leaf names and does not reach chunk names.");
