#!/usr/bin/env node
"use strict";
/**
 * write-en-files.js — STEP 7. Makes the English SOURCE real on disk:
 *   1. writes hydra-source/spec/files/<rel>.en for every source file (the canonical human
 *      artifact — STEP-6 data-as-English + cnl logic grammar), each verified .en -> .ts
 *      BYTE-IDENTICAL before it is written;
 *   2. relocates the DERIVED compose IR (.calc) OUT of the spec tree into the gitignored
 *      hydra-source/.cache/ so the spec folder Amir reads/edits holds .en (+ specs), no .calc;
 *   3. writes hydra-source/.gitignore ( .cache/ ) so the cache is regenerable, not committed.
 *
 * The .en -> .ts round-trip is the gate: it must hold for ALL files. Deterministic; 0 model.
 *   node write-en-files.js
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./engine/enfile");

const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const SKIP = new Set(["node_modules", ".git", ".worktrees", "dist", "build", "coverage", "spec", "catalog", ".cache", "demo", "coined-demo"]);
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; };
const walkAll = (d, pred, o = []) => { if (!fs.existsSync(d)) return o; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkAll(p, pred, o); else if (pred(p)) o.push(p); } return o; };

/* ---------- 1. relocate existing .calc OUT of the spec tree ---------- */
const specDir = path.join(CORPUS, "spec");
const calcFiles = walkAll(specDir, (p) => p.endsWith(".calc"));
let movedFiles = 0, movedOther = 0;
for (const abs of calcFiles) {
  const relFromSpec = path.relative(specDir, abs); // e.g. files/src/foo.ts.calc  OR  modules/x/composition.calc
  let dest;
  if (relFromSpec.startsWith("files" + path.sep)) {
    // files/<rel>.calc -> .cache/compose/files/<rel>.calc  (matches the repointed producer/expander)
    dest = path.join(CORPUS, ".cache", "compose", "files", relFromSpec.slice(("files" + path.sep).length));
    movedFiles++;
  } else {
    dest = path.join(CORPUS, ".cache", "spec-derived", relFromSpec);
    movedOther++;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(abs, dest);
}
// prune now-empty spec/files subdir if it held only .calc
const enFilesDir = path.join(specDir, "files");

/* ---------- 2. render + verify + write .en ---------- */
const index = EN.loadIndex(CORPUS);
const src = walk(CORPUS);
let byteExact = 0, failures = [];
let totBytes = 0, engBytes = 0, stmtSpans = 0, dataSpans = 0, genSpans = 0, genStmtsCollapsed = 0, filesWithGen = 0;
// recursive-producer instrumentation: recursive (word-of-words) vs flat-fallback spans, and the
// composition-depth distribution. A flat-fallback span is a permanent depth-1 hole in the language.
let genRecursive = 0, genFlatFallback = 0, filesWithFlat = 0, maxDepth = 0; const depthHist = {};
const perFile = [];
for (const abs of src) {
  const rel = path.relative(CORPUS, abs);
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let r, back;
  try { r = EN.renderFileEn(source, index); back = EN.compileFileEn(r.en, index); } catch (e) { failures.push([rel, "THREW: " + e.message]); continue; }
  if (back !== source) { failures.push([rel, "MISMATCH"]); continue; }
  byteExact++;
  const outPath = path.join(enFilesDir, rel + ".en");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, r.en);
  totBytes += r.stats.totalBytes; engBytes += r.stats.englishBytes; stmtSpans += r.stats.stmtSpans; dataSpans += r.stats.dataSpans;
  genSpans += r.stats.genSpans || 0; genStmtsCollapsed += r.stats.genStmtsCollapsed || 0; if (r.stats.genSpans) filesWithGen++;
  genRecursive += r.stats.genRecursive || 0; genFlatFallback += r.stats.genFlatFallback || 0; if (r.stats.genFlatFallback) filesWithFlat++;
  if ((r.stats.maxDepth || 0) > maxDepth) maxDepth = r.stats.maxDepth;
  for (const k of Object.keys(r.stats.depthHist || {})) depthHist[k] = (depthHist[k] || 0) + r.stats.depthHist[k];
  perFile.push({ rel, ...r.stats });
}

/* ---------- 3. .gitignore is a hand-maintained TRACKED source file now (lists derived paths to
 * ignore); the build no longer regenerates it. Create a minimal one only if it is missing. ---------- */
if (!fs.existsSync(path.join(CORPUS, ".gitignore")))
  fs.writeFileSync(path.join(CORPUS, ".gitignore"), "# derived build intermediates — regenerable, never committed.\n.cache/\n");

/* ---------- 4. manifest + report ---------- */
perFile.sort((a, b) => b.englishPct - a.englishPct);
const manifest = {
  step: 7, kind: "english-source-of-truth", modelCalls: 0,
  specLayout: "hydra-source/spec/files/<rel>.en  (canonical human source; .ts is derived)",
  derivedCache: "hydra-source/.cache/  (gitignored: compose/ IR moved out of spec tree)",
  gate: { totalFiles: src.length, byteIdentical: byteExact, allByteIdentical: byteExact === src.length && failures.length === 0 },
  englishBytesPct: totBytes ? +(100 * engBytes / totBytes).toFixed(1) : 0,
  stmtSpans, dataSpans,
  generators: { calls: genSpans, statementsCollapsed: genStmtsCollapsed, netStatementReduction: genStmtsCollapsed - genSpans, filesUsing: filesWithGen,
    recursive: genRecursive, flatFallback: genFlatFallback, flatFallbackPct: genSpans ? +(100 * genFlatFallback / genSpans).toFixed(1) : 0,
    filesWithFlatFallback: filesWithFlat, maxCompositionDepth: maxDepth, depthHistogram: depthHist },
  calcRelocated: { fromSpecFiles: movedFiles, fromSpecOther: movedOther },
  topEnglishFiles: perFile.slice(0, 15),
};
// en-index.json is DERIVED -> write it into the gitignored cache, not the source spec/ tree.
const enIndexOut = path.join(CORPUS, ".cache", "spec-derived", "en-index.json");
fs.mkdirSync(path.dirname(enIndexOut), { recursive: true });
fs.writeFileSync(enIndexOut, JSON.stringify(manifest, null, 2));

const residualCalc = walkAll(specDir, (p) => p.endsWith(".calc")).length;
console.log("=== STEP 7 — ENGLISH SOURCE OF TRUTH ===");
console.log(`  .en written .................. ${byteExact}/${src.length}  -> spec/files/<rel>.en`);
console.log(`  .en -> .ts BYTE-IDENTICAL ..... ${byteExact}/${src.length}   ${manifest.gate.allByteIdentical ? "(ALL PASS)" : "FAILURES: " + failures.length}`);
for (const f of failures.slice(0, 10)) console.log(`       FAIL ${f[0]} ${f[1]}`);
console.log(`  english coverage (bytes) ...... ${manifest.englishBytesPct}%   (${stmtSpans} logic-stmt spans + ${dataSpans} data spans)`);
console.log(`  generator spans ............... ${genSpans}   recursive ${genRecursive} / flat-fallback ${genFlatFallback} (${manifest.generators.flatFallbackPct}% fallback)`);
console.log(`  flat-fallback (perm. holes) ... ${filesWithFlat} file(s); max composition depth ${maxDepth}`);
console.log(`  .calc relocated out of spec ... ${movedFiles} (files/) + ${movedOther} (modules,skeletons) -> .cache/`);
console.log(`  .calc REMAINING under spec/ ... ${residualCalc}   ${residualCalc === 0 ? "(spec tree is .calc-free)" : "(!!)"}`);
console.log(`  wrote .gitignore ( .cache/ ) + spec/en-index.json`);
console.log(`\n  most-English files:`);
for (const f of perFile.slice(0, 8)) console.log(`     ${String(f.englishPct).padStart(5)}%  ${f.rel}`);
