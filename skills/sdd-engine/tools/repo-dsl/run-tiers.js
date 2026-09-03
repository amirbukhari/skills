#!/usr/bin/env node
"use strict";
/**
 * run-tiers — the driver for the TIER pipeline (archetypes -> skeletons -> package rollups).
 *
 *   node run-tiers.js [--dry] [--only <stage>] [--help]      (npm run tiers)
 *
 * WHY THIS EXISTS. These three producers had exactly ONE caller in the whole tree —
 * `engine/sdd.js:101-103` — and `engine/sdd.js` has no npm script and no in-tree caller of its own.
 * So the tier pipeline was reachable only by a human typing a path, and nobody typed it: on
 * 2026-09-02 eight of its artifacts were absent and two Kraken panel surfaces had failed one at a
 * time on the missing indexes. `npm run build` is the LZW/live tier and never touched these.
 *
 * IT DOES NOT CHAIN OFF `npm run build`, deliberately. Amir, 2026-09-02: "I'd lean toward 'ends by
 * running preflight' over silent chaining, so the two pipelines stay legibly separate rather than
 * being fused by accident." `npm run build` therefore ENDS with `preflight --soft`, which SAYS what
 * it did not produce; filling those gaps is this command, typed on purpose.
 *
 * A BLOCKED STAGE IS SKIPPED, NOT ATTEMPTED. `preflight.js` is the single source of truth for what
 * can be produced: if any of a stage's artifacts is BLOCKED, running the stage could only produce a
 * stack trace where a reason belongs, so it prints the reason instead. That machinery has no
 * occupant right now and is kept deliberately — the skeleton stage WAS the occupant until
 * 2026-09-02, when it was archived rather than skipped (build-skeletons.js read the retired
 * catalog/compose-words.json unguarded and exited ENOENT before writing anything). Two stages left:
 *
 *   archetypes -> package
 *
 * The middle one is gone, not disabled. `git log -- tools/repo-dsl/archive/build-skeletons.js`.
 */
const cp = require("child_process");
const path = require("path");
const PF = require("./preflight");
const CR = require("./engine/corpus-root");

/* Dependency order. `artifacts` are preflight row paths — the two files agree by lookup, never by
 * a second copy of the path. `optionalInputs` is what a stage degrades without. */
const STAGES = [
  { id: "archetypes", script: "build-archetypes.js",
    artifacts: ["archetype-index.json", "catalog/archetypes.json", "sen/archetypes"],
    note: "17 archetypes over every file; byte-verifies the 4 generative ones" },
  { id: "package", script: "package-hydra-source.js",
    artifacts: ["COVERAGE.json", "word-library.json", "catalog/mined-library.v6.json", ".sdd-code-provenance.json"],
    optionalInputs: ["archetype-index.json"],
    note: "the rollups; names any tier it could not find in its own output rather than omitting it silently" },
];

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node run-tiers.js [--dry] [--only <stage>]\n\n" +
      "  Runs the tier producers in dependency order: " + STAGES.map((s) => s.id).join(" -> ") + "\n" +
      "  A stage whose artifacts preflight reports as BLOCKED is SKIPPED with the reason.\n" +
      "  --dry   print the plan and each stage's status, run nothing\n" +
      "  --only  run one stage by id\n\n" +
      "  exit 0 every runnable stage succeeded   exit 1 a stage failed   exit 2 bad usage");
    return 0;
  }
  const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
  if (argv.includes("--only") && !STAGES.some((s) => s.id === only)) {
    console.error(`--only needs one of: ${STAGES.map((s) => s.id).join(", ")}`); return 2;
  }
  const bad = argv.filter((a) => a.startsWith("-") && !["--dry", "--only"].includes(a));
  if (bad.length) { console.error(`unknown flag: ${bad[0]}  (see --help)`); return 2; }
  const dry = argv.includes("--dry");

  const pf = PF.check();
  const rowOf = (p) => pf.artifacts.find((a) => a.path === p);

  console.log("=== TIER PIPELINE ===");
  console.log(`CORPUS ${pf.corpus}`);
  console.log(`SOURCE ${pf.source}   (READ-ONLY — no stage writes here)\n`);

  const results = [];
  for (const st of STAGES) {
    if (only && st.id !== only) continue;
    const rows = st.artifacts.map(rowOf).filter(Boolean);
    const blocked = rows.filter((r) => r.status === "BLOCKED");

    if (blocked.length) {
      console.log(`-- ${st.id}: SKIPPED (BLOCKED) — ${st.script}`);
      console.log(`   ${blocked.length} of ${rows.length} artifacts cannot be produced by running anything:`);
      console.log(`   ${blocked[0].fix}`);
      console.log("   Running it anyway would print a stack trace where this reason belongs.\n");
      results.push({ stage: st.id, status: "skipped-blocked" });
      continue;
    }
    if (dry) {
      console.log(`-- ${st.id}: WOULD RUN ${st.script}  (${st.note})`);
      console.log(`   writes: ${st.artifacts.join(", ")}\n`);
      results.push({ stage: st.id, status: "dry" });
      continue;
    }
    console.log(`-- ${st.id}: running ${st.script}  (${st.note})`);
    const t0 = Date.now();
    const rc = cp.spawnSync(process.execPath, ["--max-old-space-size=3072", path.join(__dirname, st.script)],
      { stdio: "inherit" }).status;
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (rc !== 0) {
      console.error(`\n-- ${st.id}: FAILED rc=${rc} after ${secs}s. Stopping — later stages read this one's output.`);
      results.push({ stage: st.id, status: "failed", rc });
      report(results, pf.corpus);
      return 1;
    }
    console.log(`-- ${st.id}: ok in ${secs}s\n`);
    results.push({ stage: st.id, status: "ok", secs: +secs });
  }
  report(results, pf.corpus);
  if (!dry) {
    console.log("\n--- preflight, re-checked after the run ---");
    PF.main(["--soft"]);
  }
  return 0;
}

function report(results, corpus) {
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`stages: ${n("ok")} ok, ${n("skipped-blocked")} skipped (blocked), ${n("failed")} failed, ${n("dry")} planned`);
  if (n("skipped-blocked")) console.log("A skipped stage is a STATE, not a failure — its artifacts stay BLOCKED in preflight.");
}
if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { STAGES, main };
