#!/usr/bin/env node
"use strict";
/**
 * package-delonix — DETERMINISTIC packaging of the calculator corpus into a
 * panel-readable SDD project (zero model calls).
 *
 * Flow (all deterministic — no sdd-code-from-spec / LLM emitter anywhere):
 *   1. walk the read-only calculator corpus
 *   2. decompose(source) -> composition.calc   (anchored structural match)
 *   3. parseText(.calc) -> expand -> byte-verify against the real source
 *   4. write spec/modules/<m>/{composition.calc, source.ts (real mirror),
 *      spec.md} + generated/<m>.ts (the deterministic expansion) for every
 *      calculator a domain word expresses; classify any residue.
 *   5. copy the current catalog (v4) + emit COVERAGE.json + a deterministic
 *      provenance record.
 *
 * Nothing outside delonix/sdd-output/ is written; the billing corpus is read
 * only. Usage: node package-delonix.js <corpusDir> <outDir>
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

/** char-level residue classification of expansion vs source (line-aligned). */
function residueOf(out, src) {
  if (out === src) return { identical: true, chars: 0, byClass: {}, lines: [] };
  const ao = out.split("\n"), bo = src.split("\n");
  const lines = [];
  let chars = 0;
  const byClass = { A: 0, B: 0, C: 0, D: 0 };
  for (let i = 0; i < Math.max(ao.length, bo.length); i++) {
    if (ao[i] === bo[i]) continue;
    const o = ao[i] ?? "", s = bo[i] ?? "";
    // classify the differing SRC content the expansion couldn't reproduce
    const extra = s.length >= o.length && s.startsWith(o.trimEnd()) ? s.slice(o.length) : s;
    const cls = /^\s*\/\//.test(s.trim()) || /\/\/[^\n]*$/.test(s) && s.replace(/\/\/[^\n]*$/, "").trim() === o.trim()
      ? "C" : "A";
    byClass[cls] += Math.abs(s.length - o.length) || s.length;
    chars += Math.abs(s.length - o.length) || Math.max(s.length, o.length);
    lines.push({ line: i + 1, out: o, src: s, cls });
  }
  return { identical: false, chars, byClass, lines };
}

function specMd(mod, word, params) {
  const roleLines = [];
  roleLines.push(`- element type: \`${params.elemType}\``);
  roleLines.push(`- cost type: \`${params.costType}\``);
  roleLines.push(`- billing type constant: \`${params.billingTypeConst}\``);
  if (params.delegateFn) roleLines.push(`- delegates to: \`${params.delegateFn}\``);
  if (params.sharedFn) roleLines.push(`- costing via: \`${params.sharedFn}\``);
  return `# ${mod}

Cost calculator, expressed by the DSL domain word **\`${word}\`**.

## Intent

Reproduce the Hydra billing cost-calculator \`${mod}\` from a single composition
word — no free-text body. The composition below is authored **deterministically**
from the real source (anchored structural match), then expanded back to native
TypeScript and byte-verified against the original.

## Shape

${roleLines.join("\n")}

## Verify

\`repo-dsl verify-expand\` (or expand \`composition.calc\` and diff against
\`source.ts\`, the byte-exact mirror of the real calculator).
`;
}

function main() {
  const [corpusDir, outDir] = process.argv.slice(2);
  if (!corpusDir || !outDir) { console.error("usage: package-delonix.js <corpusDir> <outDir>"); process.exit(1); }
  const files = walkDir(corpusDir).filter((f) => f.endsWith(".ts")).sort();

  const modulesDir = path.join(outDir, "spec", "modules");
  const genDir = path.join(outDir, "generated");
  const catDir = path.join(outDir, "catalog");
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.mkdirSync(genDir, { recursive: true });
  fs.mkdirSync(catDir, { recursive: true });

  const produced = [];
  const skipped = [];

  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    let d;
    try { d = decompose(src); } catch (e) { d = null; }
    if (!d) { skipped.push({ rel: path.relative(corpusDir, abs) }); continue; }

    const mod = d.tree.params.exportName;
    const out = expand(d.tree);
    const res = residueOf(out, src);

    const mdir = path.join(modulesDir, mod);
    fs.mkdirSync(mdir, { recursive: true });
    fs.writeFileSync(path.join(mdir, "composition.calc"), d.calc);
    fs.writeFileSync(path.join(mdir, "source.ts"), src);              // real mirror
    fs.writeFileSync(path.join(mdir, "spec.md"), specMd(mod, d.word, d.tree.params));
    fs.writeFileSync(path.join(genDir, mod + ".ts"), out);            // expansion

    produced.push({
      module: mod, word: d.word, composite: d.tree.composite,
      rel: path.relative(corpusDir, abs),
      byteIdentical: res.identical,
      residueChars: res.chars,
      residueClass: res.identical ? null : (Object.entries(res.byClass).filter(([, n]) => n).map(([c]) => c).join("") || "A"),
      residueLines: res.lines.map((l) => ({ line: l.line, cls: l.cls, missing: l.src })),
      specHash: sha(specMd(mod, d.word, d.tree.params)),
      compositionHash: sha(d.calc),
    });
  }

  // copy the current catalog (v4 authoritative) + its lineage for revertability
  for (const f of ["mined-library.v4.json", "mined-library.v3.json", "mined-library.v2.json"]) {
    const s = path.join(CR.senDir(), "catalog", f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(catDir, f));
  }
  // coverage rollup (from the deterministic mine)
  const cov = JSON.parse(fs.readFileSync(AC.pathFor("corpus-coverage"), "utf8"));

  const coverage = {
    schema: "sdd-delonix-package/1",
    corpus: corpusDir,
    generatedBy: "deterministic:package-delonix (no model calls)",
    corpusFiles: files.length,
    corpusCoveragePct: cov.rollup.coveragePct,
    modulesProduced: produced.length,
    byteIdentical: produced.filter((p) => p.byteIdentical).length,
    withResidue: produced.filter((p) => !p.byteIdentical).length,
    modules: produced,
    notExpressibleAsWholeFile: skipped.length,
  };
  fs.writeFileSync(path.join(outDir, "COVERAGE.json"), JSON.stringify(coverage, null, 2) + "\n");

  const provenance = {
    schema: "sdd-code-provenance/1",
    stage: "spec->code(.calc)",
    emitterId: "deterministic:decompose@repo-dsl",   // NOT the LLM emitter
    modelCalls: 0,
    generatedAt: null,
    artifacts: produced.map((p) => ({
      module: p.module, word: p.word, composite: p.composite,
      spec: { path: `spec/modules/${p.module}/spec.md`, hash: p.specHash },
      composition: { path: `spec/modules/${p.module}/composition.calc`, hash: p.compositionHash },
      byteIdentical: p.byteIdentical, residueChars: p.residueChars, residueClass: p.residueClass,
    })),
  };
  fs.writeFileSync(path.join(outDir, ".sdd-code-provenance.json"), JSON.stringify(provenance, null, 2) + "\n");

  // console summary
  console.log(`corpus files scanned: ${files.length}`);
  console.log(`modules produced (domain-word expressible): ${produced.length}`);
  for (const p of produced) {
    const v = p.byteIdentical ? "BYTE-IDENTICAL" : `residue ${p.residueChars}b class-${p.residueClass}`;
    console.log(`  ${p.module}  [${p.word}]  ${v}`);
    for (const l of p.residueLines) console.log(`      L${l.line} (${l.cls}) missing: ${JSON.stringify(l.missing)}`);
  }
  console.log(`byte-identical: ${coverage.byteIdentical}/${produced.length}   with-residue: ${coverage.withResidue}`);
  console.log(`corpus coverage (fragment mine): ${coverage.corpusCoveragePct}%`);
  console.log(`model calls: 0`);
  console.log(`wrote: ${outDir}/spec/modules, /generated, /catalog, /COVERAGE.json, /.sdd-code-provenance.json`);
}

if (require.main === module) main();
