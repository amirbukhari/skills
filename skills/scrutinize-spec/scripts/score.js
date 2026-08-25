#!/usr/bin/env node
/**
 * Deterministic scoring gate for scrutinize-prd.
 *
 * Takes a JSON analysis (produced by Claude reading the PRD against
 * references/rubric.md) and computes a gated confidence score in plain code
 * — so the "95% means 95%" guarantee never depends solely on the model's
 * self-reported numbers.
 *
 * The gates encode the difference between a PRD that reads as complete and a
 * PRD an agent can build from without asking: a term used across several
 * requirements but never defined procedurally, or a named constant left
 * without a value, caps the score no matter how well the document reads.
 *
 * Usage: node score.js <path-to-analysis.json>
 * Prints a JSON result to stdout: { rawWeightedScore, finalScore, cappedBy, isConfident }
 */

const fs = require("fs");

const WEIGHTS = {
  scopeGoalClarity: 8,
  functionalCompleteness: 13,
  dataModelDefinition: 8,
  edgeCaseErrorHandling: 9,
  nonFunctionalRequirements: 6,
  acceptanceCriteria: 14,
  outOfScope: 5,
  technicalConstraints: 6,
  ambiguousLanguage: 4,
  assumptionsSection: 4,
  consistency: 5,
  definitionExecutability: 10,
  constantsEnumerated: 8,
};

const DIMENSION_IDS = Object.keys(WEIGHTS);

const GATE_CAPS = {
  CONTRADICTIONS_DETECTED: 59,
  ACCEPTANCE_CRITERIA_WEAK: 84,
  DATA_MODEL_MISSING_BUT_REQUIRED: 84,
  UNDEFINED_LOAD_BEARING_TERM: 84,
  TOO_MANY_AMBIGUOUS_PHRASES: 89,
  CONSTANTS_UNPOPULATED: 89,
  DEFINITIONS_DUPLICATED: 92,
  UNCONFIRMED_ASSUMPTIONS: 94,
};

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    fail("Usage: node score.js <path-to-analysis.json>");
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

  const dimensionScores = input.dimensionScores || {};
  const missing = DIMENSION_IDS.filter(
    (id) => typeof dimensionScores[id] !== "number"
  );
  if (missing.length > 0) {
    fail(`dimensionScores is missing or non-numeric for: ${missing.join(", ")}`);
  }

  for (const id of DIMENSION_IDS) {
    const v = dimensionScores[id];
    if (v < 0 || v > 100) {
      fail(`dimensionScores.${id} = ${v} is out of range 0-100`);
    }
  }

  const flags = input.flags || {};
  const hasContradictions = !!flags.hasContradictions;
  const dataModelRequiredButMissing = !!flags.dataModelRequiredButMissing;
  const acceptanceCriteriaMissing = !!flags.acceptanceCriteriaMissing;
  const ambiguousPhraseCount = Number(input.ambiguousPhraseCount || 0);
  const unconfirmedAssumptionCount = Number(
    input.unconfirmedAssumptionCount || 0
  );
  const unpopulatedConstantCount = Number(input.unpopulatedConstantCount || 0);
  const duplicatedDefinitionCount = Number(
    input.duplicatedDefinitionCount || 0
  );

  const undefinedLoadBearingTerms = Array.isArray(
    input.undefinedLoadBearingTerms
  )
    ? input.undefinedLoadBearingTerms
    : [];

  // A dimension a named standards document already covers is scored against
  // the PRD and that document together, so a correctly-thin PRD is not
  // penalised for declining to restate what it inherits.
  const inherits = Array.isArray(input.inherits) ? input.inherits : [];
  const inheritedDimensions = new Set();
  for (const entry of inherits) {
    if (!entry || !Array.isArray(entry.dimensionsSatisfied)) continue;
    for (const id of entry.dimensionsSatisfied) {
      if (!DIMENSION_IDS.includes(id)) {
        fail(`inherits names unknown dimension: ${id}`);
      }
      inheritedDimensions.add(id);
    }
  }

  const weightedScore =
    DIMENSION_IDS.reduce(
      (sum, id) => sum + dimensionScores[id] * WEIGHTS[id],
      0
    ) / 100;

  let cap = 100;
  const cappedBy = [];

  if (hasContradictions) {
    cap = Math.min(cap, GATE_CAPS.CONTRADICTIONS_DETECTED);
    cappedBy.push("contradictions_detected");
  }
  if (acceptanceCriteriaMissing || dimensionScores.acceptanceCriteria < 70) {
    cap = Math.min(cap, GATE_CAPS.ACCEPTANCE_CRITERIA_WEAK);
    cappedBy.push("acceptance_criteria_weak");
  }
  if (dataModelRequiredButMissing && !inheritedDimensions.has("dataModelDefinition")) {
    cap = Math.min(cap, GATE_CAPS.DATA_MODEL_MISSING_BUT_REQUIRED);
    cappedBy.push("data_model_missing");
  }
  if (
    undefinedLoadBearingTerms.length > 0 ||
    dimensionScores.definitionExecutability < 60
  ) {
    cap = Math.min(cap, GATE_CAPS.UNDEFINED_LOAD_BEARING_TERM);
    cappedBy.push("undefined_load_bearing_term");
  }
  if (ambiguousPhraseCount > 3) {
    cap = Math.min(cap, GATE_CAPS.TOO_MANY_AMBIGUOUS_PHRASES);
    cappedBy.push("too_many_ambiguous_phrases");
  }
  if (unpopulatedConstantCount > 0) {
    cap = Math.min(cap, GATE_CAPS.CONSTANTS_UNPOPULATED);
    cappedBy.push("constants_unpopulated");
  }
  if (duplicatedDefinitionCount > 0) {
    cap = Math.min(cap, GATE_CAPS.DEFINITIONS_DUPLICATED);
    cappedBy.push("definitions_duplicated");
  }
  if (unconfirmedAssumptionCount > 0) {
    cap = Math.min(cap, GATE_CAPS.UNCONFIRMED_ASSUMPTIONS);
    cappedBy.push("unconfirmed_assumptions");
  }

  const finalScore = Math.min(weightedScore, cap);
  const isConfident = finalScore >= 95 && cappedBy.length === 0;

  console.log(
    JSON.stringify(
      {
        rawWeightedScore: Math.round(weightedScore * 10) / 10,
        finalScore: Math.round(finalScore * 10) / 10,
        cappedBy,
        inheritedDimensions: [...inheritedDimensions],
        isConfident,
      },
      null,
      2
    )
  );
}

main();
