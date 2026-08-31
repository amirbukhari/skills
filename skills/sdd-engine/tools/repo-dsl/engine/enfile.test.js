"use strict";
/* Tests for STEP 7 whole-file English source (engine/enfile). The gate: a .en compiles to
 * BYTE-IDENTICAL .ts. Unit cases prove render/compile round-trips and that English actually
 * engages; the corpus property test reads the PERSISTED spec/files/**.en artifacts off disk
 * and asserts each recompiles to its exact source file. Deterministic; exits non-zero on
 * failure. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { renderFileEn, compileFileEn, loadIndex } = require("./enfile");

const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";
let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };
const rt = (src, index) => compileFileEn(renderFileEn(src, index).en, index);
const idx = loadIndex(CORPUS);

/* 1. a data-leaf decorator arg renders English and recompiles byte-exact */
ok("decorator object arg -> «an object with …», byte-identical", () => {
  const src = "@Column({ name: 'account_id', type: 'int', nullable: true })\naccountId: number;\n";
  const { en } = renderFileEn(src, idx);
  assert.ok(en.includes("«an object with name = `'account_id'`"), en);
  assert.equal(compileFileEn(en, idx), src);
});

/* 2. a logic statement with no data leaf renders via the cnl grammar */
ok("pure-logic statement -> «Let `x` be …», byte-identical", () => {
  const src = "const total = count === 0 ? 'none' : 'some';\n";
  const { en } = renderFileEn(src, idx);
  assert.ok(/«[^»]/.test(en), "expected an English span: " + en);
  assert.equal(compileFileEn(en, idx), src);
});

/* 3. mixed file: imports (verbatim) + data (English) + logic (English) all round-trip */
ok("mixed file round-trips byte-exact and keeps imports verbatim", () => {
  const src = [
    "import { X } from './x';",
    "",
    "export const cfg = { retries: 3, tags: ['a', 'b'] };",
    "export const msg = `hi ${name}`;",
    "",
  ].join("\n");
  const { en, stats } = renderFileEn(src, idx);
  assert.ok(en.startsWith("import { X } from './x';"), "imports stay verbatim");
  assert.ok(stats.dataSpans >= 2, "object + array + template should be English");
  assert.equal(compileFileEn(en, idx), src);
});

/* 4. a file with nothing renderable stays fully verbatim and still round-trips */
ok("non-renderable file is identity", () => {
  const src = "export type T = { a: number };\nexport interface I extends T {}\n";
  const { en } = renderFileEn(src, idx);
  assert.equal(compileFileEn(en, idx), src);
});

/* 5. « / » never leak into the compiled output */
ok("compiled .ts contains no guillemets", () => {
  const src = "const o = { a: 1, b: [2, 3] };\n";
  assert.ok(!/[«»]/.test(rt(src, idx)));
});

/* 6. CORPUS GATE — every persisted .en on disk recompiles to its exact source */
ok("corpus: all persisted spec/files/**.en compile BYTE-IDENTICAL to their .ts", () => {
  const enDir = path.join(CORPUS, "spec", "files");
  if (!fs.existsSync(enDir)) { console.log("      (no .en yet — run write-en-files.js)"); return; }
  const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".en")) o.push(p); } return o; };
  const ens = walk(enDir);
  assert.ok(ens.length > 500, `expected the full mirror, found ${ens.length} .en`);
  let checked = 0, bad = [];
  for (const enPath of ens) {
    const rel = path.relative(enDir, enPath).replace(/\.en$/, "");
    const srcPath = path.join(CORPUS, rel);
    let source; try { source = fs.readFileSync(srcPath, "utf8"); } catch (_) { continue; }
    const en = fs.readFileSync(enPath, "utf8");
    if (compileFileEn(en, idx) !== source) bad.push(rel);
    checked++;
  }
  assert.equal(bad.length, 0, `NOT byte-identical: ${bad.slice(0, 5).join(", ")} (${bad.length} total)`);
  console.log(`      (corpus: ${checked} persisted .en all compile byte-identical)`);
});

console.log(`\nenfile.test: ${pass} passed`);
