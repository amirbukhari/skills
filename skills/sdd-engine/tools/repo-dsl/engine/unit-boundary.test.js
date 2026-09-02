"use strict";
/* MEANING-AWARE SPAN BOUNDARY on the RECURSIVE path (engine/enlzw.js).
 *
 * Invariant, AS NARROWED 2026-09-01 (Amir's call, R-MINE-8-amended, PRD §5D.4D): a composed
 * PROPER SUB-SPAN must never straddle >= 2 named units (a function/class definition, or a `const`
 * whose initializer is one). Collapsing two unrelated definitions into one miner-chosen window is
 * byte-exact but meaningless to a reader, so the byte gate alone cannot catch it.
 *
 * A WHOLE-RUN span is exempt: its edges are the enclosing file's or function body's, not the
 * miner's, so it denotes one syntactic container and R-ARCH-15 can have its whole-file word.
 * That exemption is itself gated on `wholeRunOk` (the run must still be sayable).
 *
 * NOTE ON VACUITY (§10.3): case 2 below passes trivially if genSpans is called WITHOUT a
 * `wholeRunOk` predicate, because the default refuses every whole-run word anyway. Case 2 is
 * therefore run WITH the real predicate, so it constrains the live path; case 5 pins the exemption
 * in the same call, so neither can pass by the other's mechanism.
 *
 * This replaces engine/enfile-unit-boundary.test.js, which asserted the same invariant on the FLAT
 * fallback path. That path is deleted, so its test was removed rather than left to rot — but the
 * invariant is real and now belongs to the recursive dictionary, which is the only path left.
 *
 * §10 compliance: the oracle is real source through a round-trip, never a mined artifact. The
 * catalog is an INPUT (§10.2), not the expected value. */
const assert = require("assert");
const AC = require("./artifact-contract");
const path = require("path");
const ts = require("typescript");
const G = require("./generators");
const EL = require("./enlzw");
const EN = require("./enfile");
const CR = require("./corpus-root");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const lzw = EL.loadLzw(AC.pathFor("generators-lzw"));
const sfOf = (src) => ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/* Two adjacent named units with identical shape — the most merge-tempting case there is. */
const srcUnits = [
  "export function alpha(a: number): number {",
  "  return a + 1;",
  "}",
  "export function beta(b: number): number {",
  "  return b + 1;",
  "}",
  "",
].join("\n");

/* 1. isUnit actually recognises the definitions, or the invariant below is vacuous. */
ok("isUnit recognises both function declarations", () => {
  const sf = sfOf(srcUnits);
  const units = sf.statements.filter(EL.isUnit);
  assert.strictEqual(units.length, 2, `expected 2 units, saw ${units.length}`);
});

/* The live predicate, so these cases constrain the path the renderer actually takes. */
const OPTS = { wholeRunOk: (run, rsf) => !!EN.chunkGloss(run, rsf) };

/* REAL-SOURCE ORACLE (§10.1, §10.3). The synthetic fixture above cannot carry cases 2 and 5: its
 * statement symbols are not in the mined dictionary at all (`cat.narrow.leaf[key]` is undefined for
 * both), so genSpans returns ZERO spans for it and any "for each span ..." assertion passes by
 * iterating nothing. That is how the pre-narrowing version of case 2 passed, and it is the vacuity
 * §10.3 forbids. So the invariant is checked over the CORPUS, where the spans are real, and both
 * cases publish their own population count so neither can go quiet. */
const CORPUS = CR.corpusRoot();
const fsx = require("fs");
const walk = (d, out = []) => {
  for (const e of fsx.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, e.name);
    if (e.isDirectory()) { if (!/^(node_modules|\.git|sen|\.cache)$/.test(e.name)) walk(q, out); }
    else if (e.name.endsWith(".ts")) out.push(q);
  }
  return out;
};
/* the maximal foldable runs of every block — the exact set of ranges a whole-run span may cover */
function runRanges(sf) {
  const out = new Set();
  const visit = (n) => {
    if ((ts.isBlock(n) || ts.isSourceFile(n)) && n.statements.length) {
      const st = [...n.statements];
      let i = 0;
      while (i < st.length) {
        if (!G.isFoldable(st[i])) { i++; continue; }
        let j = i; while (j < st.length && G.isFoldable(st[j])) j++;
        out.add(st[i].getStart(sf) + ":" + st[j - 1].getEnd());
        i = j;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const survey = (() => {
  let exempt = 0, violations = [], constrained = 0;
  for (const f of walk(CORPUS)) {
    const src = fsx.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (!sf.statements.length) continue;
    let spans; try { spans = EL.genSpans(sf, src, lzw, OPTS); } catch (_) { continue; }
    const runs = runRanges(sf);
    const units = sf.statements.filter(EL.isUnit);
    for (const sp of spans) {
      const n = units.filter((u) => u.getStart(sf) >= sp.start && u.getEnd() <= sp.end).length;
      if (n < 2) { constrained++; continue; }
      if (runs.has(sp.start + ":" + sp.end)) exempt++;
      else violations.push(`${path.relative(CORPUS, f)} [${sp.start},${sp.end}) straddles ${n} units`);
    }
  }
  return { exempt, violations, constrained };
})();

/* 2. THE INVARIANT: no emitted PROPER SUB-SPAN may straddle >= 2 named units. */
ok("no proper sub-span straddles >= 2 named units (corpus)", () => {
  assert.strictEqual(survey.violations.length, 0,
    `${survey.violations.length} violating spans, e.g.\n      ${survey.violations.slice(0, 5).join("\n      ")}`);
  assert.ok(survey.constrained > 0,
    "no span was subject to the rule at all -- the assertion above is vacuous");
  console.log(`      ${survey.constrained} spans straddle < 2 units and are bound by the rule`);
});

/* 3. THE EXEMPTION, measured in the same survey so case 2 cannot pass by refusing everything. */
ok("whole-run spans ARE admitted across >= 2 units (R-MINE-8-amended)", () => {
  assert.ok(survey.exempt > 0,
    "not one whole-run span straddles >= 2 units -- the narrowing is inert and case 2 is passing for the old reason");
  console.log(`      ${survey.exempt} whole-run spans straddle >= 2 units; before the narrowing every one was refused`);
});

/* 4. REAL-SOURCE ORACLE (§10.1): the constraint, narrowed, must not break byte-identity. */
ok("unit source round-trips byte-identical", () => {
  const idx = EN.loadIndex(CR.corpusRoot());
  assert.strictEqual(EN.compileFileEn(EN.renderFileEn(srcUnits, idx).en, idx), srcUnits);
});

/* 5. THE EXEMPTION IS NOT A DELETION: it rides on `wholeRunOk`, not on isUnit being ignored. With
 *    no predicate (the default refusal), a whole-run word must still be refused, so a caller that
 *    cannot gloss never starts emitting cross-unit words behind the renderer's back. */
ok("control: without wholeRunOk, whole-run words are still refused", () => {
  let admitted = 0, checked = 0;
  for (const f of walk(CORPUS).slice(0, 120)) {
    const src = fsx.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (!sf.statements.length) continue;
    let spans; try { spans = EL.genSpans(sf, src, lzw); } catch (_) { continue; }
    const runs = runRanges(sf);
    const units = sf.statements.filter(EL.isUnit);
    for (const sp of spans) {
      checked++;
      const n = units.filter((u) => u.getStart(sf) >= sp.start && u.getEnd() <= sp.end).length;
      if (n >= 2 && runs.has(sp.start + ":" + sp.end)) admitted++;
    }
  }
  assert.ok(checked > 0, "no spans examined -- this control is vacuous");
  assert.strictEqual(admitted, 0,
    `${admitted} cross-unit whole-run spans admitted with NO wholeRunOk predicate; the exemption must ride on the gloss gate`);
  console.log(`      ${checked} spans over 120 files, 0 cross-unit whole-run spans without the predicate`);
});

console.log(`\nPASS ${pass} assertions — sub-spans respect the unit boundary, whole-run spans are exempt, byte-identity held.`);
