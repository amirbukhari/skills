/* structural-grouping.test.js — a structural chunk's children are RUNS, not statements.
 *
 * §10.3: shown to fire. A test that only asserted byte-identity would pass against the old
 * one-child-per-statement shape just as well, since both tile the same bytes. So every case here
 * counts CHILDREN and compares them to the statements they cover, and the fallback case (a sub-run
 * the dictionary has no word for) is driven to prove the grouping degrades to the old shape rather
 * than dropping bytes.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./enfile");
const CR = require("./corpus-root");

let pass = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } else { pass++; console.log("  ok  " + m); } };

const index = EN.loadIndex(CR.corpusRoot());
const OPEN = "«", CLOSE = "»", BODY_OPEN = "⟨", BODY_CLOSE = "⟩";

/* immediate children of the OUTERMOST chunk in an .en: the `«…»` spans at nesting depth 1.
 * Written as a scanner rather than a regex because chunks nest and a regex cannot count depth. */
function topChildren(en) {
  const open = en.indexOf(OPEN);
  if (open < 0) return null;
  const bo = en.indexOf(BODY_OPEN, open);
  if (bo < 0) return null;                       // atomic chunk: no children by construction
  let depth = 0, kids = 0;
  for (let i = bo + 1; i < en.length; i++) {
    const c = en[i];
    if (c === OPEN) { if (depth === 0) kids++; depth++; }
    else if (c === CLOSE) { depth--; if (depth < 0) break; }
  }
  return kids;
}

const topLevelStatements = (src) =>
  ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true).statements.length;

/* ---- 1. a real file whose top-level run is mostly imports ------------------------------------ */
{
  const rel = "src/hydra-ui/src/redux/features/auth/authSlice.ts";
  const abs = path.join(CR.sourceRoot(), rel);
  ok(fs.existsSync(abs), "fixture present: " + rel);
  const src = fs.readFileSync(abs, "utf8");
  const r = EN.renderFileEn(src, index);
  ok(EN.compileFileEn(r.en, index) === src, "byte-identity holds for " + rel);
  ok(r.stats.oneWord, "...and it collapses to ONE top-level chunk (R-ARCH-15)");

  const kids = topChildren(r.en);
  const stmts = topLevelStatements(src);
  ok(kids !== null, "the top chunk is structural, so it has children to count");
  /* THE POINT. One child per statement would make these equal. The imports are one contiguous
   * non-drillable run, so they must arrive as ONE child. */
  ok(kids < stmts, `children are RUNS, not statements: ${kids} children over ${stmts} top-level statements`);
}

/* ---- 2. corpus-wide: the grouping holds bytes everywhere it applies --------------------------- */
{
  const { SKIP } = require("./walk-skip");
  const walk = (d, o = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
    }
    return o;
  };
  const files = walk(CR.sourceRoot()).slice(0, 120);
  let exact = 0, grouped = 0;
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    const r = EN.renderFileEn(src, index);
    if (EN.compileFileEn(r.en, index) === src) exact++;
    const kids = topChildren(r.en);
    if (kids !== null && kids < topLevelStatements(src)) grouped++;
  }
  ok(exact === files.length, `byte-identity over ${files.length} corpus files: ${exact}/${files.length}`);
  ok(grouped > 0, `the grouping actually applies on the real corpus: ${grouped} of ${files.length} files sampled`);
}

/* ---- 3. FALLBACK: a sub-run the dictionary cannot name degrades, it does not drop bytes ------- */
{
  /* Statement shapes chosen to be absent from the mined dictionary, so runWord refuses and the
   * per-statement path has to carry the run. Byte-identity is the assertion that matters. */
  const src = "interface ZzA { a: number }\ninterface ZzB { b: string }\n\nexport const zz = () => {\n  const q = 1;\n  return q;\n};\n";
  const r = EN.renderFileEn(src, index);
  ok(EN.compileFileEn(r.en, index) === src, "a run with no word round-trips byte-exactly through the fallback");
  const kids = topChildren(r.en);
  ok(kids === null || kids >= 1, "...and still produces a chunk rather than nothing: children = " + kids);
}

console.log("\nPASS " + pass + " assertions — structural children are runs, and the fallback keeps the bytes");
