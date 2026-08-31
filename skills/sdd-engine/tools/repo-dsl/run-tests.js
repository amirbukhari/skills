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
const CORPUS_TIER = new Set([
  "engine/artifact-location.test.js",     // asserts every §8B artifact is present and in its home
  "engine/word-names.test.js",            // reads word-names.json
  "engine/unit-boundary.test.js",         // reads the dictionary
  "engine/enfile-label-sanitize.test.js", // reads the dictionary
  "engine/operation-idioms.test.js",      // reads the legacy STEP-4 catalog/
  "engine/sdd.test.js",                   // reads mined skeletons/archetypes
]);
const SLOW_TIER = ["test-gen-roundtrip.js", "test-lzw-roundtrip.js"];

const unit = fs.readdirSync(path.join(HERE, "engine"))
  .filter((f) => f.endsWith(".test.js")).map((f) => path.join("engine", f))
  .filter((f) => !CORPUS_TIER.has(f)).sort();

/* Is the corpus mined? One question, asked through the contract, not by guessing at paths. */
function corpusReady() {
  try {
    const AC = require("./engine/artifact-contract");
    const root = CR.corpusRoot();
    const missing = ["generators-lzw", "word-names"].filter((k) => !fs.existsSync(AC.pathFor(k, root)));
    return { ready: missing.length === 0, missing, root };
  } catch (e) { return { ready: false, missing: ["(resolver failed: " + e.message.split("\n")[0] + ")"], root: null }; }
}

const results = [];
function run(rel, tier, timeoutMs) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["--max-old-space-size=2048", path.join(HERE, rel)],
    { cwd: HERE, encoding: "utf8", timeout: timeoutMs });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const timedOut = r.error && r.error.code === "ETIMEDOUT";
  const ok = !timedOut && r.status === 0;
  results.push({ rel, tier, ok, secs, timedOut, out: (r.stdout || "") + (r.stderr || "") });
  const mark = ok ? "PASS" : timedOut ? "TIME" : "FAIL";
  console.log(`  ${mark}  ${rel.padEnd(42)} ${secs.padStart(6)}s`);
  return ok;
}

let skipped = [];
console.log("");

if (runUnit) {
  console.log(`UNIT — ${unit.length} tests, no corpus required`);
  for (const f of unit) run(f, "unit", 120000);
  console.log("");
}

if (runCorpus) {
  const st = corpusReady();
  console.log(`CORPUS — ${CORPUS_TIER.size} tests, need mined artifacts under ${CR.LAYOUT.sen}/catalog/`);
  if (!st.ready) {
    skipped = [...CORPUS_TIER];
    console.log(`  SKIPPED — the corpus at ${st.root} is not mined (absent: ${st.missing.join(", ")}).`);
    console.log(`  This is a STATE, not a failure. To produce them:  npm run mine && npm run name`);
    for (const f of skipped) console.log(`  skip  ${f}`);
  } else {
    for (const f of [...CORPUS_TIER].sort()) run(f, "corpus", 300000);
  }
  console.log("");
}

if (runSlow) {
  console.log(`SLOW — full-corpus round-trips, minutes each`);
  for (const f of SLOW_TIER) run(f, "slow", 1800000);
  console.log("");
}

const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  console.log(`──── ${r.rel} ${r.timedOut ? "TIMED OUT" : "failed"} ────`);
  console.log(r.out.split("\n").filter((l) => /FAIL|Error|error|REFUSED|ENOENT|Assertion/.test(l)).slice(0, 6).join("\n") || r.out.slice(-600));
  console.log("");
}

const passed = results.filter((r) => r.ok).length;
console.log(`${passed} passed, ${failed.length} failed, ${skipped.length} skipped (needs a mined corpus)`);
process.exit(failed.length ? 1 : 0);
