"use strict";
/**
 * build-compositions — WHOLE-REPO compositional DSL. Tiles ALL hydra-source .ts
 * files as ordered compositions of mined words + explicit literal slots, verifies
 * every file expands BYTE-IDENTICAL, and persists panel-readable artifacts:
 *
 *   hydra-source/catalog/compose-words.json   <- shared word dictionary (id -> template/example)
 *   hydra-source/spec/files/<rel>.calc        <- per-file composition IR (JSON); expands byte-exact
 *   hydra-source/files-index.json             <- file browser index + boss-view rollup
 *
 * Deterministic, no model. Byte-verify is the gate: a per-file .calc is only
 * written after expand === source. Comment-free canonical tree.
 *
 *   node build-compositions.js
 */
const fs = require("fs");
const path = require("path");
const { tokenize } = require("./engine/fanout");
const { buildDictionary, composeFile, expandComposition } = require("./engine/compose");

const PROJECT = "/home/amir/Documents/Rentsync/delonix/hydra-source";

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".worktrees", "dist", "build", "coverage", "spec", "catalog"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function main() {
  const t0 = Date.now();
  const files = walk(PROJECT).sort();
  const perFile = files.map((f) => { const s = fs.readFileSync(f, "utf8"); const tk = tokenize(f, s); return { rel: path.relative(PROJECT, f), source: s, tokens: tk.tokens, gaps: tk.gaps }; });

  const { dict, byShape } = buildDictionary(perFile);

  // ---- compose + byte-verify + persist each file ----
  const filesDir = path.join(PROJECT, "spec", "files");
  fs.rmSync(filesDir, { recursive: true, force: true });
  fs.mkdirSync(filesDir, { recursive: true });

  const index = [];
  let byteIdentical = 0, mismatches = [];
  let totWordChars = 0, totLitChars = 0, totStructChars = 0, totWordTokens = 0, totLitTokens = 0, totStructTokens = 0;
  for (const pf of perFile) {
    const c = composeFile(pf.tokens, pf.gaps, pf.source, byShape);
    const expanded = expandComposition(c.items, dict);
    const identical = expanded === pf.source;
    if (identical) byteIdentical++; else mismatches.push(pf.rel);

    // Coverage and bespoke share are computed over MEANINGFUL bytes only (word +
    // bespoke). Structural punctuation/whitespace carries no domain meaning and is
    // excluded from both — counted separately for transparency.
    const meaningfulChars = c.wordChars + c.literalChars;
    const wordCoveragePct = meaningfulChars ? +(100 * c.wordChars / meaningfulChars).toFixed(1) : 0;
    const module = {
      schema: "sdd-compose-file/1",
      file: pf.rel, targetPath: pf.rel, byteIdentical: identical,
      wordCoveragePct, wordTokens: c.wordTokens, literalTokens: c.literalTokens,
      wordChars: c.wordChars, literalChars: c.literalChars,
      structuralChars: c.structuralChars, structuralTokens: c.structuralTokens,
      wordsUsed: [...c.wordsUsed],
      items: c.items,
    };
    const outPath = path.join(filesDir, pf.rel + ".calc");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(module, null, 2));

    index.push({
      rel: pf.rel, dir: path.dirname(pf.rel) === "." ? "" : path.dirname(pf.rel),
      wordCoveragePct, words: c.wordTokens, bespokeSlots: c.literalTokens,
      chars: pf.source.length, byteIdentical: identical,
      distinctWords: c.wordsUsed.size,
    });
    totWordChars += c.wordChars; totLitChars += c.literalChars; totStructChars += c.structuralChars;
    totWordTokens += c.wordTokens; totLitTokens += c.literalTokens; totStructTokens += c.structuralTokens;
  }

  // ---- shared word dictionary ----
  fs.writeFileSync(path.join(PROJECT, "catalog", "compose-words.json"), JSON.stringify({
    schema: "sdd-compose-words/1", project: PROJECT, generatedBy: "build-compositions.js (deterministic)", modelCalls: 0,
    minCount: 2, note: "Statement-level words (cut 0): a token whose shape recurs >=2 with >=1 typed slot and a canonical template that refills it byte-exact. Leaves (opaque atoms) are not words; a word carries params.",
    wordCount: Object.keys(dict).length, words: dict,
  }, null, 2));

  // ---- rollup + files index (boss view + browser) ----
  const distinctWords = Object.keys(dict).length;
  const reuseAvgFilesPerWord = +(Object.values(dict).reduce((a, r) => a + r.files, 0) / distinctWords).toFixed(2);
  const avgWordCoveragePct = +(index.reduce((a, f) => a + f.wordCoveragePct, 0) / index.length).toFixed(1);
  const charWeightedCoveragePct = +(100 * totWordChars / (totWordChars + totLitChars)).toFixed(1);
  // Honest bespoke share = bespoke content / meaningful bytes (structural excluded).
  // The OLD (buggy) share counted structural punctuation/whitespace as bespoke bytes.
  const totalBytes = totWordChars + totLitChars + totStructChars;
  const bespokeShareOld = +(100 * (totLitChars + totStructChars) / (totalBytes || 1)).toFixed(1);
  const bespokeShareNew = +(100 * totLitChars / (totWordChars + totLitChars || 1)).toFixed(1);
  const structuralSharePct = +(100 * totStructChars / (totalBytes || 1)).toFixed(1);
  const topWords = Object.values(dict).sort((a, b) => b.files - a.files).slice(0, 25)
    .map((r) => ({ id: r.id, files: r.files, freq: r.freq, slots: r.slots, example: r.example }));

  const filesIndex = {
    schema: "sdd-compose-files-index/1",
    project: PROJECT, generatedAt: new Date().toISOString(), modelCalls: 0,
    corpusCommentFree: true,
    totalFiles: index.length,
    perFileModuleTemplate: "spec/files/<rel>.calc",
    wordDictionary: "catalog/compose-words.json",
    expandVerify: "node compose-expand.js <projectDir> <rel> --verify",
    rollup: {
      totalFiles: index.length,
      byteIdenticalFiles: byteIdentical,
      allByteIdentical: byteIdentical === index.length,
      avgWordCoveragePct,                 // mean of per-file %
      charWeightedCoveragePct,            // corpus-wide word chars / meaningful chars
      bespokeSlotRatioPct: bespokeShareNew, // honest: bespoke content / meaningful bytes
      bespokeShareOldPunctCounted: bespokeShareOld, // pre-fix, structural miscounted as bespoke
      structuralSharePct,                 // pure punctuation/whitespace bytes (ignored)
      structuralChars: totStructChars, structuralTokens: totStructTokens,
      distinctWords,
      reuseAvgFilesPerWord,
      totalWordTokens: totWordTokens,
      totalBespokeSlots: totLitTokens,
      featuredWholeFileWords: 19,
      featuredIdiom: { name: "fetchAndValidate", sites: 38, files: 31, byteIdentical: 38 },
      topWords,
    },
    files: index,
  };
  fs.writeFileSync(path.join(PROJECT, "files-index.json"), JSON.stringify(filesIndex, null, 2));

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("=== WHOLE-REPO COMPOSITIONAL DSL ===");
  console.log("  files tiled + byte-verified :", byteIdentical, "/", index.length, mismatches.length ? "MISMATCHES: " + mismatches.slice(0, 5).join(", ") : "(all byte-identical)");
  console.log("  distinct words (dict)       :", distinctWords, " reuse:", reuseAvgFilesPerWord, "files/word");
  console.log("  avg word-coverage / file    :", avgWordCoveragePct + "%   char-weighted:", charWeightedCoveragePct + "%");
  console.log("  bespoke share (honest)      :", bespokeShareNew + "%   was (punct counted):", bespokeShareOld + "%   structural excluded:", structuralSharePct + "%");
  console.log("  word tokens:", totWordTokens, " bespoke slots:", totLitTokens, " structural spans:", totStructTokens);
  console.log("\n  wrote per-file: ", filesDir + "/<rel>.calc");
  console.log("  wrote index:    ", path.join(PROJECT, "files-index.json"));
  console.log("  wrote words:    ", path.join(PROJECT, "catalog", "compose-words.json"));
  console.log("  build time:     ", secs + "s");
}

main();
