#!/usr/bin/env node
/**
 * Deterministic scoring gate for spec-folder mode.
 *
 * Document mode (scripts/score.js) asks "could someone build this without
 * asking questions?". Folder mode asks a stricter question: "is this folder
 * the source of truth, such that regenerating from it reproduces the system?"
 *
 * That shifts what matters. A spec folder can contain thirteen beautifully
 * scored module specs and still be unusable as source, because:
 *   - code exists that no module claims, so regeneration silently drops it
 *   - fixtures are prose, so nothing constrains a non-deterministic generator
 *   - nothing is declared unspecified, so the spec grows toward the size of
 *     the code it was meant to replace
 *   - module contracts form a cycle, so no module regenerates independently
 *
 * Usage: node score-folder.js <path-to-folder-analysis.json>
 * Prints: { rawWeightedScore, finalScore, cappedBy, weakestModule,
 *           contractCycles, isRegenerable }
 */

const fs = require("fs");

const WEIGHTS = {
  partitionIntegrity: 15,
  contractCompleteness: 15,
  fixtureExecutability: 20,
  unspecifiedDeclared: 10,
  regenerationContract: 10,
  statefulArtifactHandling: 10,
  provenanceCoverage: 10,
  crossModuleConsistency: 10,
};

const DIMENSION_IDS = Object.keys(WEIGHTS);

const GATE_CAPS = {
  ORPHAN_CODE_DETECTED: 59,
  CONTRACT_CYCLE: 74,
  FIXTURES_NOT_EXECUTABLE: 84,
  REGENERATION_CONTRACT_MISSING: 84,
  STATEFUL_ARTIFACTS_UNHANDLED: 84,
  UNSPECIFIED_NOT_DECLARED: 89,
};

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

/**
 * Finds dependency cycles among module specs.
 *
 * Computed here rather than reported by the analyst: it is pure graph work
 * over declared edges, so it belongs in the deterministic layer where it
 * cannot be talked out of a finding.
 *
 * @param {Array<{name: string, dependsOn?: string[]}>} modules
 * @returns {string[][]} each cycle as the ordered list of module names in it
 */
function findContractCycles(modules) {
  const edges = new Map(
    modules.map((m) => [m.name, Array.isArray(m.dependsOn) ? m.dependsOn : []])
  );
  const cycles = [];
  const seen = new Set();

  const VISITING = 1;
  const DONE = 2;
  const state = new Map();

  function walk(name, stack) {
    if (state.get(name) === DONE) return;
    if (state.get(name) === VISITING) {
      const cycle = stack.slice(stack.indexOf(name));
      const key = [...cycle].sort().join(" ");
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push(cycle);
      }
      return;
    }
    state.set(name, VISITING);
    stack.push(name);
    for (const next of edges.get(name) || []) {
      if (edges.has(next)) walk(next, stack);
    }
    stack.pop();
    state.set(name, DONE);
  }

  for (const m of modules) walk(m.name, []);
  return cycles;
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    fail("Usage: node score-folder.js <path-to-folder-analysis.json>");
  }

  let raw;
  try {
    raw = fs.readFileSync(inputPath, "utf8");
  } catch (e) {
    fail(`Could not read ${inputPath}: ${e.message}`);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    fail(`Invalid JSON in ${inputPath}: ${e.message}`);
  }

  const scores = input.folderDimensionScores || {};
  const missing = DIMENSION_IDS.filter((id) => typeof scores[id] !== "number");
  if (missing.length > 0) {
    fail(
      `folderDimensionScores is missing or non-numeric for: ${missing.join(", ")}`
    );
  }
  for (const id of DIMENSION_IDS) {
    if (scores[id] < 0 || scores[id] > 100) {
      fail(`folderDimensionScores.${id} = ${scores[id]} is out of range 0-100`);
    }
  }

  const modules = Array.isArray(input.modules) ? input.modules : [];
  if (modules.length === 0) {
    fail("modules is empty - a spec folder with no module specs is not source");
  }
  for (const m of modules) {
    if (!m || typeof m.name !== "string" || typeof m.finalScore !== "number") {
      fail("every module needs a string name and a numeric finalScore");
    }
  }

  const flags = input.flags || {};
  const orphanPaths = Array.isArray(input.orphanPaths) ? input.orphanPaths : [];
  const contractCycles = findContractCycles(modules);

  const weightedScore =
    DIMENSION_IDS.reduce((sum, id) => sum + scores[id] * WEIGHTS[id], 0) / 100;

  let cap = 100;
  const cappedBy = [];

  // A folder is only as regenerable as its weakest module: any module that
  // cannot be rebuilt from its own spec breaks the source-of-truth claim,
  // however well the rest of the tree scores.
  const weakest = modules.reduce((a, b) =>
    b.finalScore < a.finalScore ? b : a
  );
  cap = Math.min(cap, weakest.finalScore);
  // Only reported as blocking when it actually holds the folder below the
  // confidence bar. A tree whose weakest module scores 96 is capped at 96
  // numerically, but nothing about that is stopping it from being source.
  if (weakest.finalScore < 95) {
    cappedBy.push(`weakest_module:${weakest.name}`);
  }

  if (flags.orphanCodeDetected || orphanPaths.length > 0) {
    cap = Math.min(cap, GATE_CAPS.ORPHAN_CODE_DETECTED);
    cappedBy.push("orphan_code_detected");
  }
  if (contractCycles.length > 0) {
    cap = Math.min(cap, GATE_CAPS.CONTRACT_CYCLE);
    cappedBy.push("contract_cycle");
  }
  if (flags.fixturesNotExecutable || scores.fixtureExecutability < 70) {
    cap = Math.min(cap, GATE_CAPS.FIXTURES_NOT_EXECUTABLE);
    cappedBy.push("fixtures_not_executable");
  }
  if (flags.regenerationContractMissing) {
    cap = Math.min(cap, GATE_CAPS.REGENERATION_CONTRACT_MISSING);
    cappedBy.push("regeneration_contract_missing");
  }
  if (flags.statefulArtifactsUnhandled) {
    cap = Math.min(cap, GATE_CAPS.STATEFUL_ARTIFACTS_UNHANDLED);
    cappedBy.push("stateful_artifacts_unhandled");
  }
  if (flags.unspecifiedNotDeclared) {
    cap = Math.min(cap, GATE_CAPS.UNSPECIFIED_NOT_DECLARED);
    cappedBy.push("unspecified_not_declared");
  }

  const finalScore = Math.min(weightedScore, cap);
  const isRegenerable = finalScore >= 95 && cappedBy.length === 0;

  console.log(
    JSON.stringify(
      {
        rawWeightedScore: Math.round(weightedScore * 10) / 10,
        finalScore: Math.round(finalScore * 10) / 10,
        cappedBy,
        weakestModule: { name: weakest.name, finalScore: weakest.finalScore },
        contractCycles,
        isRegenerable,
      },
      null,
      2
    )
  );
}

main();
