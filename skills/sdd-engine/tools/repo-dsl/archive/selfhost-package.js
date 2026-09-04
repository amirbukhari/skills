#!/usr/bin/env node
"use strict";
/**
 * selfhost-package — DETERMINISTIC (zero-LLM) self-hosting package.
 *
 * One tree plays three roles at once:
 *   - SOURCE : the calculator files (a byte-exact copy of the real billing tree)
 *   - CORPUS : the dir we mine for coverage      (corpusDir)
 *   - BUILD  : where expanding a module's .calc lands, reproducing the same file
 *
 * Self-hosting proof: expand(spec/modules/<m>/composition.calc) reproduces
 * <corpusDir>/<targetPath> byte-for-byte. For a byte-identical module we write
 * the expansion back into the tree in place (idempotent — the file is literally
 * its own build output). For a module with residue we DO NOT overwrite (that
 * would corrupt the canonical file by dropping trivia); we report the gap.
 *
 * No model is called anywhere: mine -> decompose -> .calc -> expand -> verify.
 *
 *   node selfhost-package.js <corpusDir> <projectRoot>
 *   e.g. node selfhost-package.js .../hydra-calculators/calculators .../hydra-calculators
 */

const fs = require("fs");
const AC = require("./engine/artifact-contract");
const CR = require("./engine/corpus-root");
const path = require("path");
const crypto = require("crypto");
const dsl = require("./dsl");
const { expand } = require("./expander");
const { decompose } = require("./decompose");
const { walkDir } = require("./engine/pipeline");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function residueOf(out, src) {
  if (out === src) return { identical: true, chars: 0, byClass: {}, lines: [] };
  const ao = out.split("\n"), bo = src.split("\n");
  const lines = []; let chars = 0; const byClass = { A: 0, B: 0, C: 0, D: 0 };
  for (let i = 0; i < Math.max(ao.length, bo.length); i++) {
    if (ao[i] === bo[i]) continue;
    const o = ao[i] ?? "", s = bo[i] ?? "";
    const cls = (/\/\/[^\n]*$/.test(s) && s.replace(/\s*\/\/[^\n]*$/, "").trim() === o.trim()) ? "C" : "A";
    byClass[cls] += Math.abs(s.length - o.length) || s.length;
    chars += Math.abs(s.length - o.length) || Math.max(s.length, o.length);
    lines.push({ line: i + 1, out: o, src: s, cls });
  }
  return { identical: false, chars, byClass, lines };
}

function specMd(mod, word, params, targetRel) {
  const rl = [
    `- element type: \`${params.elemType}\``,
    `- cost type: \`${params.costType}\``,
    `- billing type constant: \`${params.billingTypeConst}\``,
  ];
  if (params.delegateFn) rl.push(`- delegates to: \`${params.delegateFn}\``);
  if (params.sharedFn) rl.push(`- costing via: \`${params.sharedFn}\``);
  return `# ${mod}

Cost calculator, expressed by the DSL domain word **\`${word}\`**.

## Intent

Self-hosting module. Expanding \`composition.calc\` reproduces the canonical
file at \`calculators/${targetRel}\` — the same tree we mine and the same tree we
build into (source == corpus == build). Authored deterministically (anchored
structural match); no model in the path.

## Shape

${rl.join("\n")}

## Build / verify

Expand \`composition.calc\` and it lands at \`calculators/${targetRel}\`,
byte-identical to what is already there.
`;
}

function main() {
  const [corpusDir, projectRoot] = process.argv.slice(2);
  if (!corpusDir || !projectRoot) { console.error("usage: selfhost-package.js <corpusDir> <projectRoot>"); process.exit(1); }
  const files = walkDir(corpusDir).sort();

  const modulesDir = path.join(projectRoot, "spec", "modules");
  const catDir = path.join(projectRoot, "catalog");
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.mkdirSync(catDir, { recursive: true });

  const produced = [], skipped = [];

  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    let d; try { d = decompose(src); } catch { d = null; }
    if (!d) { skipped.push(path.relative(corpusDir, abs)); continue; }

    const mod = d.tree.params.exportName;
    const targetRel = path.relative(corpusDir, abs);
    const out = expand(d.tree);
    const res = residueOf(out, src);

    // self-host: byte-identical -> write back in place (idempotent); else keep
    // the canonical file untouched and record the residue.
    if (res.identical) fs.writeFileSync(abs, out);

    const mdir = path.join(modulesDir, mod);
    fs.mkdirSync(mdir, { recursive: true });
    fs.writeFileSync(path.join(mdir, "composition.calc"), d.calc);
    fs.writeFileSync(path.join(mdir, "spec.md"), specMd(mod, d.word, d.tree.params, targetRel));

    produced.push({
      module: mod, word: d.word, composite: d.tree.composite, targetPath: `calculators/${targetRel}`,
      selfHosted: res.identical, byteIdentical: res.identical, residueChars: res.chars,
      residueClass: res.identical ? null : (Object.entries(res.byClass).filter(([, n]) => n).map(([c]) => c).join("") || "A"),
      residueLines: res.lines.map((l) => ({ line: l.line, cls: l.cls, missing: l.src })),
      compositionHash: sha(d.calc),
    });
  }

  for (const f of ["mined-library.v4.json", "mined-library.v3.json", "mined-library.v2.json"]) {
    const s = path.join(CR.senDir(), "catalog", f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(catDir, f));
  }
  const cov = JSON.parse(fs.readFileSync(AC.pathFor("corpus-coverage"), "utf8"));

  const coverage = {
    schema: "sdd-selfhost-package/1",
    projectRoot, corpusDir,
    generatedBy: "deterministic:selfhost-package (no model calls)", modelCalls: 0,
    selfHosting: "source == corpus == build (one tree)",
    corpusFiles: files.length,
    corpusCoveragePct: cov.rollup.coveragePct,
    modulesProduced: produced.length,
    selfHostedByteIdentical: produced.filter((p) => p.selfHosted).length,
    withResidue: produced.filter((p) => !p.selfHosted).length,
    modules: produced,
    notExpressibleAsWholeFile: skipped.length,
  };
  fs.writeFileSync(path.join(projectRoot, "COVERAGE.json"), JSON.stringify(coverage, null, 2) + "\n");

  fs.writeFileSync(path.join(projectRoot, ".sdd-code-provenance.json"), JSON.stringify({
    schema: "sdd-code-provenance/1", stage: "spec->code(.calc)",
    emitterId: "deterministic:decompose@repo-dsl", modelCalls: 0, selfHosting: true, generatedAt: null,
    artifacts: produced.map((p) => ({
      module: p.module, word: p.word, composite: p.composite, targetPath: p.targetPath,
      composition: { path: `spec/modules/${p.module}/composition.calc`, hash: p.compositionHash },
      selfHosted: p.selfHosted, byteIdentical: p.byteIdentical, residueChars: p.residueChars, residueClass: p.residueClass,
    })),
  }, null, 2) + "\n");

  console.log(`corpus (== source == build tree): ${corpusDir}`);
  console.log(`corpus files scanned: ${files.length}`);
  console.log(`modules produced: ${produced.length}`);
  for (const p of produced) {
    console.log(`  ${p.module}  [${p.word}] -> ${p.targetPath}  ${p.selfHosted ? "SELF-HOSTED byte-identical" : `residue ${p.residueChars}b class-${p.residueClass} (canonical file left intact)`}`);
    for (const l of p.residueLines) console.log(`      L${l.line} (${l.cls}) missing: ${JSON.stringify(l.missing)}`);
  }
  console.log(`self-hosted byte-identical: ${coverage.selfHostedByteIdentical}/${produced.length}   with-residue: ${coverage.withResidue}`);
  console.log(`corpus coverage (fragment mine): ${coverage.corpusCoveragePct}%`);
  console.log(`model calls: 0`);
}

if (require.main === module) main();
