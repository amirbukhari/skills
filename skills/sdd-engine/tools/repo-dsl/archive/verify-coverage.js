#!/usr/bin/env node
"use strict";
/**
 * verify-coverage — the falsifiable metric for the SDD CODE stage.
 *
 * For each (composition -> real committed file) target:
 *   1. Expand the composition into code.
 *   2. Line-LCS diff against the REAL file (read-only).
 *   3. Report % of the real file's lines reproduced EXACTLY by pure composition,
 *      and list EXACTLY the real lines composition did not reach (with the leaf
 *      you'd have to mine to reach them).
 *
 * Also proves provenance: every leaf/composite the compositions use carries a
 * patternId that must exist in the mined catalog (structural/trivia bricks are
 * exempt and counted separately) — so coverage isn't achieved with invented
 * generators.
 *
 * No rounding up: coverage = exactMatchedRealLines / totalRealLines, blank lines
 * included. A second "code-only" number excludes blank + comment lines so the
 * comment gap is visible rather than hidden.
 *
 * Usage: node verify-coverage.js   (writes results/coverage.json)
 */

const fs = require("fs");
const AC = require("./engine/artifact-contract");
const path = require("path");
const { expand } = require("./expander");
const { LEAVES, COMPOSITES } = require("./generators");

const CORPUS = "/home/amir/Documents/Rentsync/billing-system/src/rentsync-api/calculators";
const TARGETS = [
  { comp: "compositions/activeFeatureCostCalculator.json", real: "cost-calculators/volumeV2Calculators/activeFeatureCostCalculator.ts" },
  { comp: "compositions/propertyVolumeV2CostCalculator.json", real: "cost-calculators/volumeV2Calculators/propertyVolumeV2CostCalculator.ts" },
  { comp: "compositions/liftBuildingCostCalculator.json", real: "cost-calculators/liftBuildingCostCalculator.ts" },
];

/** Longest common subsequence over lines -> matched line count + matched flags. */
function lcsLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  // Walk to mark which lines of `a` (the real file) were matched.
  const matchedA = new Array(n).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { matchedA[i] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { matched: dp[0][0], matchedA };
}

function collectGenIds(node, into) {
  if (!node || typeof node !== "object") return;
  if (node.leaf) into.leaves.add(node.leaf);
  if (node.composite) {
    into.composites.add(node.composite);
    const comp = COMPOSITES[node.composite];
    if (comp) for (const c of comp.build(fakeParams(comp))) collectGenIds(c, into);
  }
  if (node.children) for (const c of node.children) collectGenIds(c, into);
}
// build() needs params; feed harmless placeholders just to walk the static structure.
function fakeParams(comp) {
  const p = {};
  for (const [k, kind] of Object.entries(comp.params || {})) p[k] = kind === "identifierList" ? ["x"] : kind === "moduleSpecifier" ? "'x'" : "x";
  return p;
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(path.join(AC.corpusRoot(), "spec", "catalog", "patterns.json"), "utf8"));
  const mined = new Set([...catalog.smallPatterns, ...(catalog.midPatterns || []), ...catalog.compositePatterns].map((p) => p.id));

  const results = [];
  const usedLeaves = new Set(), usedComposites = new Set();

  for (const t of TARGETS) {
    const tree = JSON.parse(fs.readFileSync(path.join(__dirname, t.comp), "utf8"));
    const gen = expand(tree);
    const real = fs.readFileSync(path.join(CORPUS, t.real), "utf8");
    const genLines = gen.replace(/\n$/, "").split("\n");
    const realLines = real.replace(/\n$/, "").split("\n");
    const { matched, matchedA } = lcsLines(realLines, genLines);

    const isCode = (l) => { const s = l.trim(); return s !== "" && !s.startsWith("//") && !s.startsWith("*") && !s.startsWith("/*"); };
    const realCode = realLines.map((l, i) => ({ l, i })).filter((x) => isCode(x.l));
    const codeMatched = realCode.filter((x) => matchedA[x.i]).length;

    const unreached = realLines.map((l, i) => ({ l, i })).filter((x) => !matchedA[x.i]).map((x) => ({ line: x.i + 1, text: x.l }));

    const gi = { leaves: new Set(), composites: new Set() };
    collectGenIds(tree, gi);
    gi.leaves.forEach((x) => usedLeaves.add(x));
    gi.composites.forEach((x) => usedComposites.add(x));

    results.push({
      target: t.real,
      composition: t.comp,
      realLines: realLines.length,
      matchedLines: matched,
      coveragePct: +(100 * matched / realLines.length).toFixed(1),
      codeLines: realCode.length,
      codeMatched,
      codeCoveragePct: +(100 * codeMatched / realCode.length).toFixed(1),
      unreached,
    });
  }

  // Provenance: are the used generators backed by mined patterns?
  const genAudit = [];
  for (const id of [...usedLeaves].sort()) {
    const g = LEAVES[id];
    genAudit.push({ gen: id, tier: "leaf", patternId: g.patternId, backedByMined: g.patternId ? mined.has(g.patternId) : false, structural: !!g.structural, trivia: !!g.trivia });
  }
  for (const name of [...usedComposites].sort()) {
    const g = COMPOSITES[name];
    genAudit.push({ gen: name, tier: "composite", patternId: g.patternId, backedByMined: g.patternId ? mined.has(g.patternId) : false, structural: !!g.structural });
  }

  const out = {
    schema: "sdd-repo-dsl/coverage/1",
    corpus: catalog.corpus,
    generatedFrom: "pure composition (readable composites -> opaque-id leaves; typed params only)",
    targets: results,
    generatorAudit: genAudit,
    inventory: {
      leavesUsed: [...usedLeaves].sort(),
      compositesUsed: [...usedComposites].sort(),
      minedSmallTotal: catalog.smallPatterns.length,
      minedCompositeTotal: catalog.compositePatterns.length,
      proseSlotPatterns: catalog.smallPatterns.filter((p) => !p.typedLeafClean).map((p) => p.id),
    },
  };
  fs.mkdirSync(path.join(AC.corpusRoot(), ".cache", "spec-derived"), { recursive: true });
  fs.writeFileSync(path.join(AC.corpusRoot(), ".cache", "spec-derived", "coverage.json"), JSON.stringify(out, null, 2) + "\n");

  // Console report.
  console.log("=== SDD CODE-stage coverage (pure composition vs real committed files) ===\n");
  for (const r of results) {
    console.log(`${r.target}`);
    console.log(`  line coverage: ${r.matchedLines}/${r.realLines} = ${r.coveragePct}%   (code-only: ${r.codeMatched}/${r.codeLines} = ${r.codeCoveragePct}%)`);
    if (r.unreached.length) {
      console.log(`  unreached real lines (${r.unreached.length}):`);
      for (const u of r.unreached) console.log(`    L${u.line}: ${u.text}`);
    } else {
      console.log(`  unreached real lines: none — 100% reproduced`);
    }
    console.log("");
  }
  const backed = genAudit.filter((g) => g.backedByMined).length;
  const struct = genAudit.filter((g) => g.structural || g.trivia).length;
  console.log(`generator provenance: ${backed}/${genAudit.length} used generators backed by a mined pattern; ${struct} structural/trivia (container syntax / comment, exempt).`);
  console.log(`prose-slot (mining-failure) patterns flagged in corpus: ${out.inventory.proseSlotPatterns.join(", ") || "none"}`);
  console.log(`\nwrote results/coverage.json`);
}

main();
