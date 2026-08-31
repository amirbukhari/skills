#!/usr/bin/env node
"use strict";
/**
 * sdd — one CLI over the spec-driven-dev tiers (archetype -> skeleton -> idiom -> leaf).
 *
 *   sdd generate <spec-file> [--out <file>] [--typecheck]   author slots -> emit TypeScript
 *   sdd render   <projectDir> <relpath>                     plain-language prose of a file
 *   sdd check    <projectDir> [relpath]                     conformance / drift governance
 *   sdd mine     <projectDir> [--run]                       rebuild catalogs (dry-run by default)
 *
 * Deterministic. No model calls. Command functions RETURN structured results
 * (thin main() prints), so they are directly testable.
 */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const G = require("./generate.js");
const P = require("./prose.js");
const A = require("./archetypes.js");
/* Only for LAYOUT.sen -- the folder name, spelled once (R-CFG-6). This module takes projectDir as
 * a parameter and resolves no root; requiring the resolver costs nothing at import time. */
const CR = require("./corpus-root");
const Au = require("./author.js");

/* ----------------------------------------------------------------- generate */
function detectKind(specText) {
  const first = specText.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("//")) || "";
  if (/^entity\b/.test(first)) return "entity";
  if (/^router\b/.test(first)) return "router";
  if (/^slice\b/.test(first)) return "redux";
  throw new Error("cannot detect spec kind (expected a line starting with 'entity', 'router', or 'slice')");
}
function generate({ specText, out, typecheck, tmpRoot } = {}) {
  const kind = detectKind(specText);
  let code, name;
  if (kind === "entity") { const m = G.parseEntityDSL(specText); code = G.emitEntityCanonical(m); name = m.className; }
  else if (kind === "router") { const m = G.parseRouterDSL(specText); code = G.emitRouterCanonical(m); name = m.varName; }
  else { const m = G.parseReduxDSL(specText); code = G.emitReduxCanonical(m); name = `${m.name}Slice`; }
  const res = { kind, name, code, outPath: null, typecheck: null, valid: G.parseValidity(code).ok };
  if (out) { fs.writeFileSync(out, code); res.outPath = out; }
  if (typecheck) {
    if (kind === "entity") res.typecheck = G.typecheckEntitySource(code, tmpRoot || __dirname);
    else res.typecheck = { ok: res.valid, errors: res.valid ? [] : ["syntax errors"], note: `syntactic-only for ${kind} (needs framework types for full tsc)` };
  }
  return res;
}

/* ------------------------------------------------------------------- author */
/** author (controlled English -> TypeScript). Same slots->TS path as generate. */
function author({ englishText, out, typecheck, tmpRoot } = {}) {
  const model = Au.parseEntityCNL(englishText);
  const code = G.emitEntityCanonical(model);
  const res = { kind: "entity", name: model.className, model, code, outPath: null, typecheck: null, valid: G.parseValidity(code).ok };
  if (out) { fs.writeFileSync(out, code); res.outPath = out; }
  if (typecheck) res.typecheck = G.typecheckEntitySource(code, tmpRoot || __dirname);
  return res;
}

/* ------------------------------------------------------------------- render */
function render({ projectDir, rel } = {}) {
  const archPath = path.join(projectDir, CR.LAYOUT.sen, "archetypes", rel + ".arch.json");
  if (!fs.existsSync(archPath)) throw new Error(`no archetype record at ${archPath} — run \`sdd mine ${projectDir}\` first`);
  const arch = JSON.parse(fs.readFileSync(archPath, "utf8"));
  let bodies = [];
  const skelPath = path.join(projectDir, CR.LAYOUT.sen, "skeletons", rel + ".skel.json");
  if (fs.existsSync(skelPath)) bodies = JSON.parse(fs.readFileSync(skelPath, "utf8")).bodies || [];
  const src = fs.readFileSync(path.join(projectDir, rel), "utf8");
  return { rel, archetype: arch.archetype, prose: P.renderProse(arch, { bodies, src }) };
}

/* -------------------------------------------------------------------- check */
function checkFile({ projectDir, rel, src }) {
  src = src != null ? src : fs.readFileSync(path.join(projectDir, rel), "utf8");
  const archetype = A.classifyFile(A.analyzeFile(rel, src));
  const generative = A.GENERATIVE.includes(archetype);
  if (!generative) return { rel, archetype, generative: false, conforms: null, reason: "descriptive archetype (classification only — no conformance gate; content is delivered by the skeleton + idiom tiers)" };
  const r = A.EXTRACTORS[archetype](src, path.basename(rel));
  return { rel, archetype, generative: true, byteIdentical: r.byteIdentical, conforms: r.conforms, reason: r.reason || null, counts: r.counts || null };
}
function walkTs(dir) { let out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walkTs(p)); else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p); } return out; }
function check({ projectDir, rel } = {}) {
  if (rel) return checkFile({ projectDir, rel });
  const srcRoot = fs.existsSync(path.join(projectDir, "src")) ? path.join(projectDir, "src") : projectDir;
  const files = walkTs(srcRoot);
  let generative = 0, conforming = 0; const nonConformers = [];
  for (const abs of files) {
    const r = path.relative(projectDir, abs);
    let f; try { f = checkFile({ projectDir, rel: r }); } catch (_) { continue; }
    if (!f.generative) continue;
    generative++;
    if (f.conforms) conforming++;
    else nonConformers.push({ rel: r, archetype: f.archetype, reason: f.reason });
  }
  return { scanned: files.length, generative, conforming, nonConforming: nonConformers.length, nonConformers };
}

/* --------------------------------------------------------------------- mine */
function mine({ projectDir, run } = {}) {
  const engineDir = __dirname, toolDir = path.dirname(engineDir);
  const steps = [
    { name: "archetypes", cmd: ["node", path.join(toolDir, "build-archetypes.js"), projectDir] },
    { name: "skeletons", cmd: ["node", path.join(toolDir, "build-skeletons.js"), projectDir] },
    { name: "package", cmd: ["node", path.join(toolDir, "package-hydra-source.js"), projectDir] },
  ];
  if (!run) return { executed: false, plan: steps.map((s) => `${s.name}: ${s.cmd.join(" ")}`), note: "dry-run — pass --run to execute (rebuilds catalogs; writes into the project's sen/ + catalog/)" };
  const results = [];
  for (const s of steps) { const rc = cp.spawnSync(s.cmd[0], s.cmd.slice(1), { stdio: "inherit" }).status; results.push({ name: s.name, rc }); if (rc !== 0) break; }
  return { executed: true, results };
}

/* --------------------------------------------------------------------- main */
function main(argv) {
  const [cmd, ...rest] = argv;
  const VALUE_FLAGS = new Set(["--out"]);
  const flag = (n) => rest.includes(n);
  const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  const pos = []; for (let i = 0; i < rest.length; i++) { const a = rest[i]; if (a.startsWith("--")) { if (VALUE_FLAGS.has(a)) i++; continue; } pos.push(a); }
  try {
    if (cmd === "generate") {
      const specFile = pos[0]; if (!specFile) throw new Error("usage: sdd generate <spec-file> [--out <file>] [--typecheck]");
      const r = generate({ specText: fs.readFileSync(specFile, "utf8"), out: opt("--out"), typecheck: flag("--typecheck") });
      if (r.outPath) console.error(`# ${r.kind} ${r.name} -> ${r.outPath}`); else console.log(r.code);
      if (r.outPath) console.log(r.code);
      if (r.typecheck) console.error(`# typecheck: ${r.typecheck.ok ? "CLEAN — 0 errors" : "ERRORS:\n" + r.typecheck.errors.join("\n")}${r.typecheck.note ? "  (" + r.typecheck.note + ")" : ""}`);
    } else if (cmd === "author") {
      const engFile = pos[0]; if (!engFile) throw new Error("usage: sdd author <english-file> [--out <file>] [--typecheck]");
      const r = author({ englishText: fs.readFileSync(engFile, "utf8"), out: opt("--out"), typecheck: flag("--typecheck") });
      if (r.outPath) console.error(`# entity ${r.name} -> ${r.outPath}`);
      console.log(r.code);
      if (r.typecheck) console.error(`# typecheck: ${r.typecheck.ok ? "CLEAN — 0 errors" : "ERRORS:\n" + r.typecheck.errors.join("\n")}`);
    } else if (cmd === "render") {
      const r = render({ projectDir: pos[0], rel: pos[1] });
      console.log(`# ${r.rel}  [${r.archetype}]\n`); console.log(r.prose);
    } else if (cmd === "check") {
      const r = check({ projectDir: pos[0], rel: pos[1] });
      if (r.scanned === undefined) {
        console.log(`${r.rel}  [${r.archetype}]  ${r.generative ? (r.conforms ? "CONFORMS" : "NON-CONFORMING") : "descriptive"}`);
        if (r.reason) console.log(`  reason: ${r.reason}`);
        if (r.counts) console.log(`  slots: ${JSON.stringify(r.counts)}`);
      } else {
        console.log(`scanned ${r.scanned} files; ${r.generative} generative; ${r.conforming} conform; ${r.nonConforming} NON-conforming`);
        for (const n of r.nonConformers) console.log(`  NON-CONFORMING ${n.rel} [${n.archetype}] — ${n.reason}`);
      }
    } else if (cmd === "mine") {
      const r = mine({ projectDir: pos[0], run: flag("--run") });
      if (!r.executed) { console.log("# dry-run (no --run). Would execute:"); for (const p of r.plan) console.log("  " + p); console.log("# " + r.note); }
      else for (const s of r.results) console.log(`${s.name}: rc=${s.rc}`);
    } else {
      console.log("usage: sdd <generate|author|render|check|mine> ... (see engine/SDD.md)"); return cmd ? 1 : 0;
    }
    return 0;
  } catch (e) { console.error("error: " + e.message); return 1; }
}

module.exports = { generate, author, render, check, checkFile, mine, detectKind, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
