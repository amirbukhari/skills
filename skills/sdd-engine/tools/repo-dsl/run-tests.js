#!/usr/bin/env node
"use strict";
/**
 * run-tests.js — the test runner. `npm test` lands here.
 *
 * WHY A RUNNER AND NOT JUST `node engine/*.test.js`. The suite splits into three tiers by what
 * they NEED, and collapsing them makes the suite useless: a fresh clone with an un-mined corpus
 * would show a wall of red that says nothing about whether the engine works.
 *
 *   UNIT      needs nothing but the source. Runs on a fresh clone, no corpus, no mine. This is
 *             the tier that must be green at all times, and it is what `npm test` runs.
 *   CORPUS    needs mined artifacts under <CORPUS>/sen/catalog/. On a fresh corpus these are
 *             legitimately ABSENT, which is a state, not a failure — they are reported SKIPPED
 *             with the command that would produce them. If the artifacts ARE present and a test
 *             fails, that is a real failure and it is reported as one. ("not installed" is a
 *             state, "installed and wrong" is a bug — the same asymmetry as artifact-contract's
 *             `optional: true`.)
 *   SLOW      full-corpus round-trips, minutes each. Never in `npm test`; `npm run test:slow`.
 *
 * Tiering is BY DECLARATION here, not by guessing from an error message, so a test cannot quietly
 * change tier by changing how it fails.
 *
 * AND SO IS EXPECTED COLOUR — `expect`, added 2026-09-04, for the same reason one tier up.
 *
 *   expect: "green"  it must pass. A failure is a REGRESSION and fails the run.
 *   expect: "red"    it is red BY DESIGN — a requirement stated before it is met. Its failure is
 *                    the expected outcome and does NOT fail the run. Its *passing* does: a red
 *                    test that goes green is a stale declaration, and the fix is to update this
 *                    manifest in the same commit that turned it green.
 *   expect: "skip"   it exits 2 on purpose (a permanent, honest skip). Only exit 2 is expected.
 *
 * WHY THIS EXISTS, and it is not tidying. Expected colour used to live in the `why` PROSE —
 * "(RED: 778/1037)" — where nothing could check it, and the exit code was computed from raw
 * failures. Every run was therefore red, because five tests are red by design, so a SIXTH red was
 * invisible. `engine/sentence-authority.test.js` was flipped GREEN by a5501a7 on 2026-09-03 and
 * its entry here was never updated; it then broke and sat at 17 passed / 3 failed, labelled
 * "(RED)" here while the test's own footer said "a failure here is a REGRESSION ... It is not an
 * expected red." Two places disagreed, neither could be checked against the other, and the one a
 * reader saw first was wrong. Fixed 2026-09-04 (the test in the commit before this one).
 *
 * So the exit code is now computed from MISMATCHES, not from failures: red-by-design tests can be
 * red all night without hiding anything, and the moment a green test breaks or a red one is fixed,
 * the run says so by name. A timeout is always a mismatch — it is not a measured red, it is an
 * absence of a measurement.
 *
 * THE DECLARATIONS BELOW WERE TRANSCRIBED FROM THE `why` PROSE, NOT MEASURED. Running the whole
 * suite is banned on this machine (it has OOM-killed it), so the colours are taken from what each
 * entry already claimed about itself. The first tier run reconciles them, loudly and by name —
 * which is the point of declaring them rather than describing them.
 *
 *   node run-tests.js                    # UNIT (+ CORPUS when the artifacts exist)
 *   node run-tests.js --tier=unit        # UNIT only
 *   node run-tests.js --tier=corpus      # CORPUS only
 *   node run-tests.js --tier=slow        # SLOW only
 *   node run-tests.js --tier=all         # everything, round-trips included
 *
 * WHY `--tier=<name>` AND NOT A BARE `--<name>`. The tier used to be a bare flag, and
 * `--corpus` collided head-on with corpus-root.js's `--corpus <path>` ROOT flag: this
 * process resolves roots itself (corpusReady, below), so its own argv was parsed by the
 * resolver, which saw `--corpus` with no path after it and REFUSED. `npm run test:corpus`
 * could therefore never run a single test -- it reported "0 passed, 0 failed, 6 skipped"
 * with "the corpus at null is not mined", which reads as a measurement of the corpus and
 * was in fact a measurement of the flag. One namespace per meaning; a bare tier flag is
 * now refused by name rather than silently reinterpreted as a root.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const CR = require("./engine/corpus-root");

const HERE = __dirname;
const argv = process.argv.slice(2);
const TIERS = ["unit", "corpus", "slow", "all"];

/* A bare `--corpus` reaches the ROOT resolver, not the tier switch (see the header). Refuse it
 * by name instead of letting it be reinterpreted: a wrong flag must read as a wrong flag. */
for (const a of argv) {
  const bare = TIERS.find((t) => a === `--${t}`);
  if (bare) {
    console.error(`run-tests.js REFUSED: \`--${bare}\` is not a tier flag.\n` +
      `  tiers are selected with --tier=${bare}\n` +
      `  a bare --corpus is corpus-root.js's ROOT flag and expects a path after it, so it` +
      ` would be parsed as a root here, not as a tier.`);
    process.exit(2);
  }
}
const asked = argv.filter((a) => a.startsWith("--tier=")).map((a) => a.slice("--tier=".length));
for (const t of asked) {
  if (!TIERS.includes(t)) {
    console.error(`run-tests.js REFUSED: unknown tier \`${t}\`. known tiers: ${TIERS.join(", ")}`);
    process.exit(2);
  }
}
const only = (t) => asked.includes(t);
const ALL = only("all");
const runUnit = ALL || only("unit") || (!only("corpus") && !only("slow"));
const runCorpus = ALL || only("corpus") || (!only("unit") && !only("slow"));
const runSlow = ALL || only("slow");

/* CORPUS-tier tests, declared. Everything else under engine/*.test.js is UNIT by default, so a
 * NEW test is unit until someone says otherwise — the safe direction, since a unit test that
 * secretly needs a corpus fails loudly rather than being silently skipped. */
/* PER TEST, its OWN prerequisites -- not one shared gate. The gate used to be all-or-nothing over
 * ["generators-lzw","word-names"], so a single absent artifact skipped all six, and four of them
 * were reported as "needs a mined corpus" when the corpus they needed was fully mined. A skip has
 * to name the thing that is actually missing, or it is a measurement of the gate, not the corpus.
 *
 * `needs`  registered §8B artifact kinds, resolved through the contract (never by guessing paths).
 *          "*" means EVERY registered kind -- for the test that asserts exactly that.
 * `files`  paths relative to <CORPUS>, for prerequisites that are NOT §8B artifacts (the legacy
 *          STEP-4 catalog/ tree, which is deliberately outside the contract -- see CLAUDE.md 5).
 * An empty `needs` with no `files` means the test has NO corpus prerequisite and always runs. */
const CORPUS_TIER = new Map([
  ["engine/artifact-location.test.js", {
    expect: "green",
    /* WAS `needs: "*"`, which held the file's own strongest assertions hostage. Assertions (a)-(d)
     * are properties of the ENGINE TREE -- no artifact need exist for them to be true or false --
     * and (d) is the leak recurrence guard. Gating the file on every artifact meant one absent
     * artifact silently disabled the guard whose header says "none of it had been pushed" must stop
     * being luck. (e) now checks only artifacts that ARE present and (f) names the absent ones, so
     * the file has no corpus prerequisite and always runs. Existence stays enforced here, per test,
     * where a missing artifact produces a loud SKIP instead of a misattributed failure. */
    needs: [],
    why: "asserts engine-tree properties plus contract-validity of whatever artifacts are present",
  }],
  ["engine/word-names.test.js", {
    expect: "green",
    needs: ["generators-lzw", "word-names"],
    why: "needs the dictionary to have leaves and word-names.json to have named them",
  }],
  ["engine/hand-authored-en.test.js", {
    expect: "green",
    needs: ["generators-lzw"],
    why: "renders a real .en through the dictionary, then hand-edits it (A4)",
  }],
  ["engine/en-idempotence.test.js", {
    expect: "green",
    needs: ["generators-lzw"],
    why: "re-renders every persisted .en against the dictionary and compares bytes (A5, half 1)",
  }],
  /* ── THE STANDARDS SUITE (2026-09-03) ────────────────────────────────────────────────────────
   * Six files that state what the .en must BE rather than what it currently is. Most are RED by
   * design and are registered anyway: an unregistered red test is a report, a registered one is a
   * requirement. `why` says which are red so a run is not misread as a regression. */
  ["engine/english-complete.test.js", {
    expect: "red",
    needs: ["generators-lzw"],
    why: "§7's English-completeness predicate over every file with the WHOLE FILE as denominator (RED: 778/1037)",
  }],
  ["engine/statement-kind-coverage.test.js", {
    expect: "red",
    needs: ["generators-lzw"],
    why: "per-statement-kind production coverage — the §5C work order (RED: 4,193 generic + 65 vacuous + 775 silent)",
  }],
  ["engine/the-lift.test.js", {
    expect: "red",
    needs: ["generators-lzw"],
    why: "§4B THE LIFT as a prohibition — no file hides behind one sealed word (RED: 257 files)",
  }],
  ["engine/review-surface-ratchet.test.js", {
    expect: "green",
    needs: ["generators-lzw"],
    why: "one-way valve on review surface at both scales (GREEN — it guards everything the red tests change)",
  }],
  ["engine/sentence-authority.test.js", {
    /* WAS "(RED)" in `why` and nothing else — see the header. It was written red, flipped GREEN by
     * a5501a7 (2026-09-03), and this entry was not updated, so when it actually broke on
     * 2026-09-04 (17 passed / 3 failed) the label said the failure was expected while the test's
     * own footer said it was a regression. It was the regression. Declared here now, where the
     * runner can check it. */
    expect: "green",
    needs: ["generators-lzw"],
    why: "§5C rules 2 and 3 — an English edit must reach the .ts and must never be resolved silently (GREEN since a5501a7, 2026-09-03 — a failure here is a REGRESSION)",
  }],
  ["engine/round-trip-fixpoint.test.js", {
    expect: "green",
    needs: ["generators-lzw"],
    why: "both round-trip directions are fixpoints: ts->en->ts AND en->ts->en (GREEN)",
  }],
  ["engine/orphan-ledger.test.js", {
    expect: "red",
    needs: ["word-names"],
    why: "§5C's steady state end to end — the orphan ledger does not reach chunk names (RED: 3,582 of 3,588)",
  }],
  /* ── THE SYNTHETIC STRUCTURAL SUITE (2026-09-03) ─────────────────────────────────────────────
   * These three do NOT read the real corpus. Each builds a throwaway fixture in a temp directory,
   * mines it, and asks what the dictionary learned — because the real corpus is one codebase in one
   * house style, so its coverage of the AST is whatever hydra happens to contain, and a target
   * sentence about a domain object confounds AST coverage with domain semantics. They replace the
   * semantic specimen tests retired in 6c87d75. Roots are repointed with SOURCE=/CORPUS= per
   * corpus-root.js; the real corpus is neither read nor written. */
  ["engine/synth-composition.test.js", {
    expect: "red",
    needs: [],
    why: "a three-level synthetic corpus — structural composition at every AST scale (RED)",
  }],
  ["engine/synth-mutation.test.js", {
    expect: "red",
    needs: [],
    why: "Amir's 21-row mutation table — does the vocabulary span the AST (RED: 6 pattern rows, 8 ambiguous renders)",
  }],
  ["engine/synth-novel-composition.test.js", {
    expect: "red",
    needs: [],
    why: "THE BENCHMARK — known pieces + new arrangement = unseen AST, without a new monolithic entry (RED)",
  }],
  ["engine/unit-boundary.test.js", {
    expect: "green",
    needs: ["generators-lzw"],
    why: "reads the recursive dictionary (enlzw.loadLzw)",
  }],
  ["engine/enfile-label-sanitize.test.js", {
    expect: "green",
    needs: [],
    why: "sentinel stripping over an intentionally EMPTY index -- no corpus artifact required",
  }],
  ["engine/operation-idioms.test.js", {
    expect: "skip",
    needs: [],
    files: [path.join("catalog", "operation-idioms.json"), path.join("catalog", "function-archetypes.json")],
    /* THESE TWO ARTIFACTS ARE RETIRED, NOT PENDING — 2026-09-02, Amir: "If we ain't using it put it
     * in the archive folder." Their only producer, archive/build-operation-idioms.js, is archived
     * AND hardcodes a forbidden delonix root at line 26, so it does not load and nothing will
     * produce these again. The test SKIPS with exit 2 and says so honestly at
     * engine/operation-idioms.test.js:30-36 — this entry used to read as "just needs a run", and an
     * honest skip that misdescribes WHY is still a wrong answer. Kept in the suite rather than
     * archived with the producer: the day someone revives the idiom tier, this is the executable
     * specification of what it has to satisfy. Retire the test only with Amir's word. */
    why: "reads the legacy STEP-4 catalog/ tree, which no §8B artifact kind covers. Its two files " +
      "are RETIRED (producer archived + delonix-hardcoded), so it PERMANENTLY skips with exit 2 — " +
      "not a missing run, and not a failure",
  }],
  ["engine/sdd.test.js", {
    expect: "green",
    needs: [],
    why: "builds its own project in a tmpdir; sdd.js names no root and reads no artifact",
  }],
]);
const SLOW_TIER = ["test-gen-roundtrip.js", "test-lzw-roundtrip.js"];

const unit = fs.readdirSync(path.join(HERE, "engine"))
  .filter((f) => f.endsWith(".test.js")).map((f) => path.join("engine", f))
  .filter((f) => !CORPUS_TIER.has(f)).sort();

/* What does the corpus actually hold? Asked ONCE, through the contract, never by guessing paths.
 * A resolver failure is its own state: no root means no question can be answered about it. */
function corpusState() {
  try {
    const AC = require("./engine/artifact-contract");
    const root = CR.corpusRoot();
    const all = AC.kindsOf();
    const present = new Set(all.filter((k) => fs.existsSync(AC.pathFor(k, root))));
    return { ok: true, root, all, present };
  } catch (e) { return { ok: false, root: null, reason: e.message.split("\n")[0] }; }
}

/* Exactly what is missing for ONE test, by name. Empty array = nothing blocks it. */
function blockersFor(spec, st) {
  if (!st.ok) return [`(resolver failed: ${st.reason})`];
  const kinds = spec.needs === "*" ? st.all : spec.needs;
  const out = kinds.filter((k) => !st.present.has(k));
  for (const rel of spec.files || []) if (!fs.existsSync(path.join(st.root, rel))) out.push(rel);
  return out;
}

/* A test with no entry in CORPUS_TIER is a UNIT test and is expected GREEN — the same safe default
 * as tiering: a new test must pass until someone declares otherwise, so nobody can add a red one
 * and have the runner shrug. */
const expectFor = (rel) => (CORPUS_TIER.get(rel) || {}).expect || "green";

const results = [];
function run(rel, tier, timeoutMs) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["--max-old-space-size=2048", path.join(HERE, rel)],
    { cwd: HERE, encoding: "utf8", timeout: timeoutMs });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const timedOut = r.error && r.error.code === "ETIMEDOUT";
  const ok = !timedOut && r.status === 0;
  const want = expectFor(rel);

  /* WHAT HAPPENED vs WHAT WAS DECLARED. A timeout is never a match: it is the absence of a
   * measurement, not a red one, so it cannot satisfy `expect: "red"` either. */
  let mark, mismatch = false;
  if (timedOut) { mark = "TIME"; mismatch = true; }
  else if (want === "skip") {
    if (r.status === 2) mark = "SKIP";
    else { mark = ok ? "GREEN" : "FAIL"; mismatch = true; }
  } else if (want === "red") {
    if (ok) { mark = "GREEN"; mismatch = true; }   /* stale declaration — the good kind of problem */
    else mark = "red ";                             /* red by design, and it stays quiet */
  } else {
    if (ok) mark = "PASS";
    else { mark = "FAIL"; mismatch = true; }        /* the regression case */
  }

  results.push({ rel, tier, ok, secs, timedOut, want, mark, mismatch,
                 out: (r.stdout || "") + (r.stderr || "") });
  console.log(`  ${mark.padEnd(5)} ${rel.padEnd(42)} ${secs.padStart(6)}s`
    + (want === "red" && !mismatch ? "   (red by design)" : "")
    + (want === "skip" && !mismatch ? "   (permanent skip, exit 2)" : ""));
  return !mismatch;
}

let skipped = [];
console.log("");

if (runUnit) {
  console.log(`UNIT — ${unit.length} tests, no corpus required`);
  for (const f of unit) run(f, "unit", 120000);
  console.log("");
}

if (runCorpus) {
  const st = corpusState();
  console.log(`CORPUS — ${CORPUS_TIER.size} tests, gated INDIVIDUALLY on what each one reads`);
  console.log(`  corpus: ${st.ok ? st.root : `UNRESOLVED — ${st.reason}`}`);
  for (const f of [...CORPUS_TIER.keys()].sort()) {
    const blockers = blockersFor(CORPUS_TIER.get(f), st);
    if (blockers.length) {
      skipped.push(f);
      console.log(`  skip  ${f.padEnd(42)} absent: ${blockers.join(", ")}`);
    } else {
      run(f, "corpus", 300000);
    }
  }
  if (skipped.length) {
    console.log(`\n  An absent artifact is a STATE, not a failure. To produce the §8B ones:`);
    console.log(`    npm run mine && npm run name`);
  }
  console.log("");
}

if (runSlow) {
  console.log(`SLOW — full-corpus round-trips, minutes each`);
  for (const f of SLOW_TIER) run(f, "slow", 1800000);
  console.log("");
}

/* THE RUN'S VERDICT IS ITS MISMATCHES, not its failures. Five tests are red by design; computing
 * the exit code from raw failures made every run red and therefore made a SIXTH red invisible,
 * which is exactly how sentence-authority's regression sat unnoticed. See the header. */
const mismatched = results.filter((r) => r.mismatch);
for (const r of mismatched) {
  const what = r.timedOut ? "TIMED OUT"
    : r.want === "red" ? "WENT GREEN — declared red by design, so this declaration is now STALE"
    : r.want === "skip" ? `exited ${r.ok ? 0 : "non-2"} — declared a permanent skip (exit 2)`
    : "FAILED — declared green, so this is a REGRESSION";
  console.log(`──── ${r.rel} ${what} ────`);
  if (r.want === "red" && r.ok) {
    console.log(`  Update its entry in run-tests.js to expect: "green", in the commit that fixed it.`);
    console.log(`  A red test that quietly goes green leaves the next real failure looking expected.`);
  } else {
    console.log(r.out.split("\n").filter((l) => /FAIL|Error|error|REFUSED|ENOENT|Assertion/.test(l)).slice(0, 6).join("\n") || r.out.slice(-600));
  }
  console.log("");
}

const asDeclared = results.filter((r) => !r.mismatch);
const redByDesign = asDeclared.filter((r) => r.want === "red").length;
const tail = skipped.length ? ` (${skipped.length} skipped — each named its own absent prerequisite above)` : "";
console.log(`${asDeclared.length} as declared, ${mismatched.length} not, ${skipped.length} not run${tail}`);
if (redByDesign) console.log(`  ${redByDesign} of those are RED BY DESIGN — requirements stated before they are met, not breakage.`);
if (mismatched.length) console.log(`  A mismatch is the only thing that fails this run: a green test that broke, a red one that was fixed, or a timeout.`);
process.exit(mismatched.length ? 1 : 0);
