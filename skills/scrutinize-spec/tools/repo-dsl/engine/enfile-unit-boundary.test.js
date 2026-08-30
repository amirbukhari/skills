"use strict";
// Meaning-aware span boundary: a composed generator span must never straddle >=2 named-unit
// definitions (function/class, or a `const` whose initializer is one). The constraint lives on
// BOTH candidate paths — the recursive dictionary (enlzw.genSpans) and the flat fallback
// (enfile.generatorSpans). This test's REASON FOR EXISTING is the flat path: a merge rejected on
// the recursive path silently reappears as a flat-fallback merge unless the flat path is
// constrained too, and then the fix only LOOKS complete. Case A below is red if the flat path is
// left unconstrained; the control (Case B) proves the constraint did not simply disable flat
// composition; Case C pins the recursive path on real corpus data.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const G = require("./generators");
const EL = require("./enlzw");
const EN = require("./enfile");

let passed = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } passed++; console.log("  ok:", m); };

/* Build a flat generator catalog that EXACTLY matches the first 2-statement window of `source`, so
 * an unconstrained flat path WOULD collapse those two statements into one span. Both byKey (render)
 * and byId (compile) are populated. */
function gensForFirstPair(source) {
  const sf = ts.createSourceFile("t.ts", source, ts.ScriptTarget.Latest, true);
  const run = sf.statements.slice(0, 2);
  const wp = G.windowParts(run, sf, false);
  const g = { id: "g1", key: wp.key, gloss: "first, then second", level: "opn", k: 2 };
  return { gens: { byKey: new Map([[wp.key, g]]), byId: new Map([["g1", g]]) }, key: wp.key, refillOk: G.refill(wp.key, wp.holes) === source.slice(run[0].getStart(sf), run[1].getEnd()) };
}

/* ---- Case A: two adjacent UNIT definitions with a matching flat generator on offer ----
 * The merge is available (byKey.has === true, refill gate would pass), so the ONLY thing that can
 * stop the flat path collapsing two unrelated units into one span is the unit-boundary constraint.
 * If the flat path were unconstrained, genFlatFallback would be 1 and this assertion would FAIL. */
const srcUnits = ["const foo = () => 1;", "const bar = () => 2;", ""].join("\n");
const bU = gensForFirstPair(srcUnits);
ok(bU.gens.byKey.has(bU.key) && bU.refillOk, "flat generator matching the 2-unit window IS available (merge is on offer)");
const idxU = { _generators: bU.gens, _lzw: null }; // _lzw null: force the FLAT path, isolate it
const rU = EN.renderFileEn(srcUnits, idxU);
ok(rU.stats.genFlatFallback === 0, "flat path REFUSES to collapse 2 unit definitions (RED if flat left unconstrained)");
ok(EN.compileFileEn(rU.en, idxU) === srcUnits, "unit source still round-trips byte-identical");

/* ---- Case B (control): two adjacent NON-unit statements with a matching flat generator ----
 * The constraint must not disable flat composition wholesale — an ordinary run still composes. */
const srcExpr = ["doThing(1);", "doOther(2);", ""].join("\n");
const bE = gensForFirstPair(srcExpr);
const idxE = { _generators: bE.gens, _lzw: null };
const rE = EN.renderFileEn(srcExpr, idxE);
ok(rE.stats.genFlatFallback === 1, "flat path STILL collapses an ordinary (non-unit) 2-statement run");
ok(EN.compileFileEn(rE.en, idxE) === srcExpr, "control source round-trips byte-identical");

/* ---- Case C: recursive path on real corpus data ----
 * EL.genSpans returns {start,end} byte ranges; re-derive the covered statements via AST and assert
 * no chosen span straddles >=2 units. Guarded: skips cleanly if the corpus is not present. */
const CORPUS = process.env.HYDRA_CORPUS || "/home/amir/Documents/Rentsync/delonix/hydra-source";
const catPath = path.join(__dirname, "..", "catalog", "generators-lzw.json"); // same path loadIndex uses
const dth = path.join(CORPUS, "packages", "hydra-internal", "src", "dateTimeHelpers.ts");
if (fs.existsSync(catPath) && fs.existsSync(dth)) {
  const cat = EL.loadLzw(catPath);
  const check = (abs) => {
    const src = fs.readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true);
    const spans = EL.genSpans(sf, src, cat);
    for (const s of spans) {
      let units = 0;
      const visit = (n) => { if ((ts.isBlock(n) || ts.isSourceFile(n)) && n.statements.length) for (const st of n.statements) { if (st.getStart(sf) >= s.start && st.getEnd() <= s.end && EL.isUnit(st)) units++; } ts.forEachChild(n, visit); };
      visit(sf);
      if (units >= 2) return { abs, units };
    }
    return null;
  };
  const bad = check(dth);
  ok(!bad, "recursive path: no chosen span in dateTimeHelpers.ts straddles >=2 units");
} else {
  console.log("  skip: corpus/catalog absent — Case C (recursive real-data) not exercised");
}

console.log(`\nPASS ${passed} assertions — unit-boundary constraint holds on BOTH the recursive and flat paths.`);
