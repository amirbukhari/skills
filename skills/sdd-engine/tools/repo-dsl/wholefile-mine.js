#!/usr/bin/env node
"use strict";
/**
 * wholefile-mine — CLI for the whole-file mining pass (engine/wholefile.js).
 *
 * Discovers whole-file DOMAIN words from a corpus automatically, byte-verifies
 * every member, and writes them additively into a new catalog version (v5,
 * preserving v1..v4). Fully deterministic — no model.
 *
 *   node wholefile-mine.js <corpusDir> [--project <dir>] [--min N] [--write-v5]
 *
 *   --project <dir>   also write/refresh <dir>/COVERAGE.json with the
 *                     wholeFileModules metric (fragment coverage kept separate).
 *   --min N           minClusterSize (default 2).
 *   --write-v5        write catalog/mined-library.v5.json (default on).
 */

const fs = require("fs");
const AC = require("./engine/artifact-contract");
const CR = require("./engine/corpus-root");
const path = require("path");
const { tokenize } = require("./engine/fanout");
const { walkDir, mine } = require("./engine/pipeline");
const wf = require("./engine/wholefile");

const CATALOG = path.join(CR.senDir(), "catalog");

function tokenizeCorpus(corpusDir) {
  return walkDir(corpusDir).sort().map((f) => {
    const source = fs.readFileSync(f, "utf8");
    const { tokens, gaps } = tokenize(f, source);
    return { rel: path.relative(corpusDir, f), source, tokens, gaps };
  });
}

/** Serialize a minted word into a self-contained catalog entry (re-expandable). */
function wordToEntry(w, handAuthored) {
  const overlaps = handAuthored
    .filter((h) => h.sampleBasename && w.memberFiles.some((m) => path.basename(m) === h.sampleBasename))
    .map((h) => h.name);
  return {
    name: w.name, tier: "domain", minedWholeFile: true, authored: false,
    memberFiles: w.memberFiles,
    params: w.params.map((p) => ({ name: p.name, type: p.type, kind: p.kind })),
    production: w.production,
    byteIdentical: w.allVerified,
    verify: w.verify.map((v) => ({
      file: v.file, byteIdentical: v.byteIdentical, residueChars: v.residueChars,
      residueClass: v.residueClass, params: v.params,
    })),
    overlapsHandAuthored: overlaps,      // provenance: both kept visible
    template: { items: w.items, tokenPlans: w.tokenPlans, bakedGaps: w.bakedGaps }, // for deterministic re-expansion
  };
}

function buildV5(mineResult, wfResult) {
  const v4 = JSON.parse(fs.readFileSync(path.join(CATALOG, "mined-library.v4.json"), "utf8"));
  const handAuthored = (v4.domain || []).map((d) => ({
    name: d.name,
    sampleBasename: d.sampleModule ? d.sampleModule.replace(/\s*\(.*\)$/, "").trim() + ".ts" : null,
  }));

  const minedDomain = wfResult.words.map((w) => wordToEntry(w, handAuthored));
  const v5 = { ...v4 };
  v5.version = "v5";
  v5.corpus = mineResult.library.corpus;
  // keep the 3 hand-authored domain words; ADD the mined whole-file words.
  v5.domain = [...(v4.domain || [])]; // unchanged, not clobbered
  v5.domainMinedWholeFile = minedDomain;
  v5.tiers = { ...(v4.tiers || {}), domain: (v4.domain || []).length, domainMinedWholeFile: minedDomain.length };
  v5.refinement = {
    step: "wholefile-mine", from: "mined-library.v4.json",
    modelCalls: 0, minClusterSize: wfResult.stats.minClusterSize,
    minedWords: wfResult.stats.minedWords, filesCovered: wfResult.stats.filesCovered,
    note: "Whole-file domain words discovered automatically by engine/wholefile.js; "
      + "hand-authored domain[] preserved; overlaps recorded per entry.",
  };
  return v5;
}

function coverageBlock(mineResult, wfResult) {
  const s = wfResult.stats;
  return {
    wholeFileModules: {
      minedWords: s.minedWords,
      wordsFullyVerified: s.wordsFullyVerified,
      filesCovered: s.filesCovered,
      memberByteIdentical: s.memberByteIdentical,
      memberWithResidue: s.memberWithResidue,
      escalationCandidates: s.escalationCandidates,   // singletons — NOT auto-minted
      words: wfResult.words.map((w) => ({
        name: w.name, memberFiles: w.memberFiles, params: w.params.map((p) => p.name),
        allVerified: w.allVerified,
        members: w.verify.map((v) => ({ file: v.file, byteIdentical: v.byteIdentical, residueChars: v.residueChars, residueClass: v.residueClass })),
      })),
      nearMatches: wfResult.nearMatches,
    },
    // fragment coverage kept separate and clearly labelled
    corpusCoveragePct: mineResult.rollup.coveragePct,
    corpusCoveragePctLabel: "fragment coverage (chars reproduced by leaf/mid/high composition) — NOT whole-file",
  };
}

function main() {
  const args = process.argv.slice(2);
  const corpusDir = args[0];
  if (!corpusDir) { console.error("usage: wholefile-mine.js <corpusDir> [--project dir] [--min N]"); process.exit(1); }
  const projectIdx = args.indexOf("--project");
  const project = projectIdx >= 0 ? args[projectIdx + 1] : null;
  const minIdx = args.indexOf("--min");
  const minClusterSize = minIdx >= 0 ? +args[minIdx + 1] : 2;

  const perFile = tokenizeCorpus(corpusDir);
  const wfResult = wf.mineWholeFile(perFile, { minClusterSize });
  const mineResult = mine(corpusDir, { minCount: 2 }); // fragment coverage, separate axis

  // write v5 (preserving v1..v4)
  const v5 = buildV5(mineResult, wfResult);
  fs.writeFileSync(path.join(CATALOG, "mined-library.v5.json"), JSON.stringify(v5, null, 2) + "\n");

  // project COVERAGE.json (merge the wholeFileModules block in)
  if (project) {
    const covPath = path.join(project, "COVERAGE.json");
    let cov = {};
    if (fs.existsSync(covPath)) cov = JSON.parse(fs.readFileSync(covPath, "utf8"));
    Object.assign(cov, coverageBlock(mineResult, wfResult));
    cov.generatedBy = "deterministic:wholefile-mine (no model calls)";
    cov.modelCalls = 0;
    fs.writeFileSync(covPath, JSON.stringify(cov, null, 2) + "\n");
    // copy v5 catalog into the project too
    const pcat = path.join(project, "catalog");
    fs.mkdirSync(pcat, { recursive: true });
    fs.copyFileSync(path.join(CATALOG, "mined-library.v5.json"), path.join(pcat, "mined-library.v5.json"));
  }

  const s = wfResult.stats;
  console.log(`corpus: ${corpusDir}`);
  console.log(`corpus files: ${s.corpusFiles}   (fragment coverage: ${mineResult.rollup.coveragePct}% — separate axis)`);
  console.log(`\nWHOLE-FILE MINING (deterministic, model calls: 0):`);
  console.log(`  mined whole-file words: ${s.minedWords}  (fully byte-verified: ${s.wordsFullyVerified})`);
  console.log(`  files covered by a mined word: ${s.filesCovered}/${s.corpusFiles}`);
  console.log(`    member files byte-identical: ${s.memberByteIdentical}`);
  console.log(`    member files with residue:   ${s.memberWithResidue}`);
  console.log(`  singletons (escalation candidates, NOT auto-minted): ${s.escalationCandidates}`);
  console.log(`  near-match pairs recorded: ${s.nearMatchPairs}`);
  for (const w of wfResult.words) {
    console.log(`\n  ${w.name}${w.overlap ? "" : ""}  [${w.memberFiles.length} files, ${w.params.length} params]`);
    console.log(`     params: ${w.params.map((p) => p.name + ":" + p.type).join(", ")}`);
    for (const v of w.verify) console.log(`     ${v.byteIdentical ? "BYTE-IDENTICAL" : "residue " + v.residueChars + "b/" + v.residueClass}  ${v.file}`);
  }
  console.log(`\nwrote catalog/mined-library.v5.json${project ? ` and ${project}/COVERAGE.json (+catalog)` : ""}`);
}

if (require.main === module) main();
module.exports = { tokenizeCorpus, buildV5, coverageBlock };
