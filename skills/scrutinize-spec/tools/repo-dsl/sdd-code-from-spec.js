#!/usr/bin/env node
"use strict";
/**
 * sdd-code-from-spec — the CODE-stage COMPOSITION EMITTER of the spec-driven-dev
 * harness. It is the sibling of tools/sdd-spec-from-intent.js (same CLI shape,
 * same verdict-line + exit-code conventions) one stage downstream:
 *
 *     intent.md  --(sdd-spec-from-intent)-->  spec.md
 *     spec.md    --(sdd-code-from-spec)  -->  composition.calc     <-- THIS TOOL
 *     .calc      --(expander)            -->  native code
 *
 * This is the "model emits DSL" step that closes the loop. It reads a module's
 * `spec/modules/<m>/spec.md` plus the mined generator library / auto-derived DSL
 * grammar, and has a generator emit `spec/modules/<m>/composition.calc` — the DSL
 * composition for that module.
 *
 * Backends (pluggable, mirroring sdd-generate):
 *   default            shell out to the `claude` CLI (real model emission)
 *   --stub <file>      emit the contents of <file> verbatim (zero-cost double)
 *
 * DETERMINISTIC GUARD (what makes this trustworthy, exactly like the fixtures
 * guard upstream): a model emitting free text could smuggle in prose or an
 * untyped param. So after emission the candidate is PARSED against the
 * auto-derived grammar and fully EXPANDED — which rejects an unknown composite,
 * an unknown marker, prose, or any untyped param — BEFORE anything is written.
 * On any violation the module FAILS and no composition.calc is written. The
 * stored artifact is the canonical `printTree` form (lossless round-trip), so
 * the committed .calc is deterministic even though a model chose its content.
 *
 * Usage:
 *   node sdd-code-from-spec.js <exampleDir> [--module m] [--lang ts]
 *        [--model <id>] [--stub <file>] [--verify]
 *
 * Prints one "code-from-spec: ..." verdict per module; exits non-zero if any
 * module did not emit a valid composition.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const sdd = require("../sdd-lib");
const dsl = require("./dsl");
const { expand } = require("./expander");
const { verifyExpand } = require("./verify-expand");

const EMITTER_SYSTEM_PROMPT = [
  "You are the CODE-stage composition emitter in a spec-driven-development pipeline.",
  "You are given a module spec and an auto-derived DSL grammar of composite generators.",
  "Output ONLY a DSL composition for the module — the .calc text, nothing else.",
  "No prose, no explanation, no markdown fences, no code — only composition lines in the given grammar.",
  "Use exactly one top-level composite (a keyword from the grammar) and fill its positional slots.",
  "Every value must be a bareword identifier or type name; never a sentence. Do not invent composites or markers.",
  "Do not write import lines unless a type is genuinely ambiguous; module specifiers are resolved automatically.",
].join(" ");

function parseArgs(argv) {
  const a = { exampleDir: null, module: null, lang: "ts", model: null, stub: null, verify: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--module") a.module = rest[++i];
    else if (t === "--lang") a.lang = rest[++i];
    else if (t === "--model") a.model = rest[++i];
    else if (t === "--stub") a.stub = rest[++i];
    else if (t === "--verify") a.verify = true;
    else if (!a.exampleDir) a.exampleDir = t;
    else throw new Error(`unexpected argument: ${t}`);
  }
  if (!a.exampleDir) throw new Error("usage: sdd-code-from-spec.js <exampleDir> [--module m] [--lang ts] [--stub f] [--verify]");
  a.exampleDir = path.resolve(process.cwd(), a.exampleDir);
  if (a.stub) a.stub = path.resolve(process.cwd(), a.stub);
  return a;
}

/** Compact vocabulary block: the available surface forms, one per composite. */
function vocabularyBlock() {
  const forms = dsl.grammar().map((c) => {
    const subject = c.roles.find((r) => r.kind === "subject");
    const types = c.roles.filter((r) => r.kind === "type").map((r) => `<${r.name}>`).join(" -> ");
    const marked = c.roles.filter((r) => r.kind === "const" || r.kind === "via" || r.kind === "field")
      .map((r) => `${r.marker} <${r.name}${r.prefix ? " minus " + r.prefix : ""}>`).join(" ");
    return `  ${c.keyword} <${subject ? subject.name : "?"}>\n    ${types}\n    ${marked}`.replace(/\n\s*\n/g, "\n");
  });
  return forms.join("\n\n");
}

function assembleEmitterPrompt(exampleDir, moduleName) {
  const modDir = path.join(exampleDir, "spec", "modules", moduleName);
  const parts = [];
  parts.push(`# Composition request\n\nEmit the DSL composition for module \`${moduleName}\`. Output only the .calc text.`);
  parts.push(`\n---\n# AUTO-DERIVED DSL GRAMMAR (positional; from generator signatures)\n\n${dsl.renderGrammar()}`);
  parts.push(`\n---\n# AVAILABLE SURFACE FORMS (fill the positional slots)\n\n${vocabularyBlock()}`);
  const specMd = path.join(modDir, "spec.md");
  parts.push(`\n---\n# MODULE SPEC: ${sdd.relTo(exampleDir, specMd)}\n\n${fs.readFileSync(specMd, "utf8")}`);
  const constMd = path.join(modDir, "constants.md");
  if (fs.existsSync(constMd)) parts.push(`\n---\n# CONSTANTS: ${sdd.relTo(exampleDir, constMd)}\n\n${fs.readFileSync(constMd, "utf8")}`);
  parts.push(`\n---\nNow output ONLY the DSL composition for \`${moduleName}\`. No fences, no commentary.`);
  return parts.join("\n");
}

/** Invoke the emitter backend -> { calcText, emitterId }. */
function runEmitter(cfg, prompt) {
  if (cfg.stub) {
    if (!fs.existsSync(cfg.stub)) throw new Error(`stub source not found: ${cfg.stub}`);
    return { calcText: fs.readFileSync(cfg.stub, "utf8"), emitterId: `stub:${path.basename(cfg.stub)}` };
  }
  const model = cfg.model || sdd.DEFAULT_MODEL;
  const res = spawnSync(
    "claude",
    ["-p", "--model", model, "--append-system-prompt", EMITTER_SYSTEM_PROMPT],
    { input: prompt, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 240000 }
  );
  if (res.status !== 0) throw new Error(`claude CLI failed (status ${res.status}): ${(res.stderr || "").slice(0, 500)}`);
  // The emitter may still wrap the .calc in a fence; strip it, keep only the text.
  return { calcText: sdd.stripCodeFences(res.stdout), emitterId: `claude-cli:${model}` };
}

function processModule(cfg, moduleName) {
  const modDir = path.join(cfg.exampleDir, "spec", "modules", moduleName);
  const specMd = path.join(modDir, "spec.md");
  if (!fs.existsSync(specMd)) {
    return { module: moduleName, ok: false, verdict: `FAIL module=${moduleName} missing ${sdd.relTo(cfg.exampleDir, specMd)}` };
  }

  let calcText, emitterId;
  try {
    ({ calcText, emitterId } = runEmitter(cfg, assembleEmitterPrompt(cfg.exampleDir, moduleName)));
  } catch (e) {
    return { module: moduleName, ok: false, verdict: `FAIL module=${moduleName} emitter error: ${e.message}` };
  }

  // DETERMINISTIC GUARD: parse against the auto-derived grammar, then fully
  // expand (rejects unknown composite / marker / prose / untyped param). Nothing
  // is written unless BOTH succeed.
  let tree, code;
  try {
    tree = dsl.parseText(calcText);
    code = expand(tree); // typed-param validation happens here
  } catch (e) {
    return { module: moduleName, ok: false, verdict: `FAIL module=${moduleName} composition rejected by grammar guard: ${e.message} (emitter ${emitterId})` };
  }

  // Store the CANONICAL printed form (lossless round-trip), not the raw reply.
  const canonical = dsl.printTree(tree);
  const calcPath = path.join(modDir, "composition.calc");
  fs.writeFileSync(calcPath, canonical);

  let verifyNote = "";
  if (cfg.verify) {
    const v = verifyExpand(calcPath, { min: 100 });
    if (v.error) verifyNote = ` verify=skipped(${v.error})`;
    else verifyNote = ` verify=${v.pass ? "pass" : "FAIL"} cov=${v.coveragePct}% byteIdentical=${v.byteIdentical}`;
  }

  const paramCount = Object.keys(tree.params).length;
  const entry = {
    module: moduleName,
    spec: { path: sdd.relTo(cfg.exampleDir, specMd), hash: sdd.hashFile(specMd) },
    composition: { path: sdd.relTo(cfg.exampleDir, calcPath), hash: sdd.hashFile(calcPath) },
    composite: tree.composite, paramCount, emitterId, codeLines: code.split("\n").length - 1,
  };
  const verdict = `OK module=${moduleName} composite=${tree.composite} params=${paramCount} -> ${sdd.relTo(cfg.exampleDir, calcPath)} (emitter ${emitterId})${verifyNote}`;
  return { module: moduleName, ok: true, verdict, entry };
}

function codeProvenancePath(exampleDir) { return path.join(exampleDir, ".sdd-code-provenance.json"); }

function main() {
  const cfg = parseArgs(process.argv);
  let modules;
  if (cfg.module) modules = [cfg.module];
  else {
    modules = sdd.listModules(cfg.exampleDir).filter((m) => fs.existsSync(path.join(cfg.exampleDir, "spec", "modules", m, "spec.md")));
    if (!modules.length) { console.log(`code-from-spec: FAIL no module under ${sdd.relTo(process.cwd(), cfg.exampleDir)}/spec/modules has a spec.md`); process.exit(1); }
  }
  const backendLabel = cfg.stub ? `stub:${path.basename(cfg.stub)}` : `claude-cli:${cfg.model || sdd.DEFAULT_MODEL}`;
  console.log(`sdd-code-from-spec — example=${sdd.relTo(process.cwd(), cfg.exampleDir)} backend=${backendLabel}`);

  const priorPath = codeProvenancePath(cfg.exampleDir);
  const prior = fs.existsSync(priorPath) ? JSON.parse(fs.readFileSync(priorPath, "utf8")) : null;
  const byModule = new Map((prior?.artifacts || []).map((a) => [a.module, a]));

  let allOk = true;
  for (const m of modules) {
    const res = processModule(cfg, m);
    console.log(`code-from-spec: ${res.verdict}`);
    if (!res.ok) { allOk = false; continue; }
    byModule.set(m, res.entry);
  }

  if (allOk) {
    const manifest = {
      schema: "sdd-code-provenance/1", stage: "spec->code(.calc)", generatedAt: null,
      artifacts: [...byModule.values()].sort((a, b) => a.module.localeCompare(b.module)),
    };
    fs.writeFileSync(priorPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`code-from-spec: wrote ${sdd.relTo(process.cwd(), priorPath)}`);
  }
  process.exit(allOk ? 0 : 1);
}

main();
