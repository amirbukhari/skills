"use strict";
/* Tests for STEP 7 whole-file English source (engine/enfile). The gate: a .en compiles to
 * BYTE-IDENTICAL .ts. Unit cases prove render/compile round-trips and that English actually
 * engages; the corpus property test reads the PERSISTED sen/files/**.en artifacts off disk
 * and asserts each recompiles to its exact source file. Deterministic; exits non-zero on
 * failure. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { renderFileEn, compileFileEn, loadIndex } = require("./enfile");
const CR = require("./corpus-root");

const CORPUS = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root: the .ts tree
let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };
/* deriveCheck ON everywhere in this file. R-REND-6 makes the sentence authoritative, so a gloss
 * that has drifted from its payload must not slip through the round-trip test — this is the place
 * it would slip. The check has no false positives by construction (the renderer wrote the gloss with
 * the same functions the check re-derives it with), so turning it on here costs a parse per span
 * and buys the guarantee. */
const CHK = { deriveCheck: true };
const rt = (src, index) => compileFileEn(renderFileEn(src, index).en, index, CHK);
const idx = loadIndex(CORPUS);

/* 1. a data-leaf decorator arg renders English and recompiles byte-exact */
ok("decorator object arg -> «an object with …», byte-identical", () => {
  const src = "@Column({ name: 'account_id', type: 'int', nullable: true })\naccountId: number;\n";
  const { en } = renderFileEn(src, idx);
  assert.ok(en.includes("«an object with name = `'account_id'`"), en);
  assert.equal(compileFileEn(en, idx, CHK), src);
});

/* 2. a logic statement with no data leaf renders via the cnl grammar */
ok("pure-logic statement -> «Let `x` be …», byte-identical", () => {
  const src = "const total = count === 0 ? 'none' : 'some';\n";
  const { en } = renderFileEn(src, idx);
  assert.ok(/«[^»]/.test(en), "expected an English span: " + en);
  assert.equal(compileFileEn(en, idx, CHK), src);
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
  assert.equal(compileFileEn(en, idx, CHK), src);
});

/* 4. a file with nothing renderable stays fully verbatim and still round-trips */
ok("non-renderable file is identity", () => {
  const src = "export type T = { a: number };\nexport interface I extends T {}\n";
  const { en } = renderFileEn(src, idx);
  assert.equal(compileFileEn(en, idx, CHK), src);
});

/* 5. « / » never leak into the compiled output */
ok("compiled .ts contains no guillemets", () => {
  const src = "const o = { a: 1, b: [2, 3] };\n";
  assert.ok(!/[«»]/.test(rt(src, idx)));
});

/* 6. CORPUS GATE — every persisted .en on disk recompiles to its exact source */
ok("corpus: all persisted sen/files/**.en compile BYTE-IDENTICAL to their .ts", () => {
  const enDir = path.join(CR.senDir(), "files");
  if (!fs.existsSync(enDir)) { console.log("      (no .en yet — run write-en-files.js)"); return; }
  const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".en")) o.push(p); } return o; };
  const ens = walk(enDir);
  assert.ok(ens.length > 500, `expected the full mirror, found ${ens.length} .en`);
  let checked = 0, bad = [];
  for (const enPath of ens) {
    const rel = path.relative(enDir, enPath).replace(/\.en$/, "");
    const srcPath = path.join(SRC, rel);
    let source; try { source = fs.readFileSync(srcPath, "utf8"); } catch (_) { continue; }
    const en = fs.readFileSync(enPath, "utf8");
    if (compileFileEn(en, idx, CHK) !== source) bad.push(rel);
    checked++;
  }
  assert.equal(bad.length, 0, `NOT byte-identical: ${bad.slice(0, 5).join(", ")} (${bad.length} total)`);
  console.log(`      (corpus: ${checked} persisted .en all compile byte-identical)`);
});

console.log(`\nenfile.test: ${pass} passed`);

/* ---------------------------------------------------------------------------
 * R-REND-6 — the sentence is authoritative. MUTATION-CHECKED (§10.3): a guard that
 * cannot be shown to FIRE is not a guard.
 *
 * Scope note, and it is a real finding: the PER-STATEMENT CNL path already reads its
 * own prose — editing `x` in «Let `x` be …» changes the compiled output today. The
 * silent-no-op defect was specific to GENERATOR spans («▶ gloss ⟪payload⟫»), where
 * compileChunk located the payload with lastIndexOf and ignored every other byte. So
 * the edit below is made INSIDE a generator gloss, not just anywhere in the .en.
 *
 *   1. a clean .en compiles byte-identical with the check on (no false positive);
 *   2. with the check OFF, the edit is SILENTLY IGNORED and the compiler emits the
 *      un-edited code — the defect, pinned so it cannot be quietly reintroduced;
 *   3. with the check ON, that same edit is HONOURED — the compiled TypeScript carries
 *      the renamed identifier.
 *
 * >>> POINT 3 USED TO READ "that same edit THROWS and names both sides", and it was
 * >>> correct until R-REND-6 cut 2 landed. Quoted rather than overwritten, per §9.
 * The edit this fixture makes is a pure HOLE RENAME (`foo` -> `fooRenamed` inside a
 * generator gloss), which is exactly the class `repairFromSentence` can prove it
 * understood: it refills the hole, re-derives the gloss, and the re-derived gloss equals
 * what was written. So the refusal became an honoured edit — §5C rule 2 working, not a
 * regression. The assertion below is now the stronger one: the bytes CHANGE and carry
 * the rename. A clause the repair cannot verify still refuses, and that boundary is
 * pinned in `hand-authored-en.test.js`.
 * -------------------------------------------------------------------------*/
{
  const idx = loadIndex();
  const enDir = path.join(CR.senDir(), "files");
  const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".en")) o.push(p); } return o; };
  const ens = fs.existsSync(enDir) ? walk(enDir) : [];
  let done = false;
  for (const enPath of ens) {
    const rel = path.relative(enDir, enPath).replace(/\.en$/, "");
    let source; try { source = fs.readFileSync(path.join(SRC, rel), "utf8"); } catch (_) { continue; }
    const en = fs.readFileSync(enPath, "utf8");
    const span = en.match(/\u00ab\u25b6([\s\S]*?)\u27ea/);        // « ▶ gloss ⟪
    if (!span) continue;
    const tok = span[1].match(/`([A-Za-z_$][\w$]*)`/);
    if (!tok) continue;

    assert.equal(compileFileEn(en, idx, CHK), source, "clean .en round-trips with deriveCheck on");

    const editedGloss = span[0].replace("`" + tok[1] + "`", "`" + tok[1] + "Renamed`");
    const edited = en.replace(span[0], editedGloss);
    assert.notEqual(edited, en, "the hand-edit applied inside the generator gloss");

    assert.equal(compileFileEn(edited, idx, { deriveCheck: false }), source,
      "WITHOUT the check a hand-edit to a generator gloss is silently ignored (this is the defect)");

    /* WITH the check on, the edit REACHES THE TYPESCRIPT. Asserted as the disjunction that
     * holds on both sides of the flip, plus the specific outcome we now expect — so this
     * still fails if the edit is ever silently swallowed again, which is the defect the
     * whole block exists to guard. */
    const withCheck = compileFileEn(edited, idx, CHK);
    assert.notEqual(withCheck, source,
      "WITH the check the hand-edit must not compile to the pre-edit bytes (that is the defect)");
    assert.ok(withCheck.includes(tok[1] + "Renamed"),
      "WITH the check the compiled TypeScript must carry the renamed identifier (R-REND-6 cut 2)");

    console.log("  ok  R-REND-6: a hand-edit to a generator gloss REACHES the compiled TypeScript");
    done = true;
    break;
  }
  if (!done) console.log("  --  R-REND-6 check skipped: no rendered corpus with a quoted generator gloss");
}
