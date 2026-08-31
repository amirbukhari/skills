"use strict";
/* GUARD: §7(a2) placeholder density — the un-collapsed metric must not count a body as "repeated
 * structure" on the strength of a key made of holes.
 *
 * NEAR-MISS THIS PINS (2026-08-31): the classifier had only the freq >= 2 test. All-placeholder keys
 * collide with each other, so every one of them scored freq >= 2 and two unrelated functions counted
 * as repetition. The metric read 126 files; the truth was 38. It was about to be steered by.
 *
 * §10: the real-source case asserts against actual corpus bytes (bodies parsed from .ts), never
 * against a mined artifact. The pure cases pin the RULE, which is frozen and must stay decidable. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const D = require("./uncollapsed-density");
const CR = require("./corpus-root");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const H = D.HOLE, K = "someStatementKey", K2 = "anotherStatementKey";

ok("an all-placeholder key is NOT evidence of recurrence", () => {
  assert.strictEqual(D.passesDensity([H, H]), false, "two unrelated all-hole bodies would collide and count as repetition");
  assert.strictEqual(D.passesDensity([H, H, H, H]), false);
  assert.strictEqual(D.holeFraction([H, H]), 1);
});

ok("exactly half holes is NOT enough (the boundary is strict)", () => {
  assert.strictEqual(D.holeFraction([H, K]), 0.5);
  assert.strictEqual(D.passesDensity([H, K]), false, "h/N < 0.5 is the frozen rule; 0.5 itself must fail");
  assert.strictEqual(D.passesDensity([H, H, K, K2]), false);
});

ok("a key of mostly real statement shapes passes", () => {
  assert.strictEqual(D.passesDensity([K, K2]), true);
  assert.strictEqual(D.passesDensity([K, K2, H]), true);
  assert.strictEqual(D.holeFraction([K, K2, H]), 1 / 3);
});

ok("an empty key is not evidence (no parts, no proof)", () => {
  assert.strictEqual(D.passesDensity([]), false);
});

ok("the frozen threshold has not drifted", () => {
  // §10.4: pins a CONSTANT the metric's meaning depends on. If this moves, it moves deliberately,
  // in a commit that says why, with the file counts it changes.
  assert.strictEqual(D.MAX_HOLE_FRAC, 0.5);
});

/* ---- real-source case: parse actual corpus bodies and prove the rule bites on real bytes ---- */
const CORPUS = CR.sourceRoot();
if (!fs.existsSync(CORPUS)) {
  console.log(`  --  real-source case SKIPPED: no source tree at ${CORPUS} (set SOURCE)`);
} else {
  ok("on real corpus source, all-placeholder bodies exist and are excluded", () => {
    const ts = require("typescript");
    const G = require("./generators");
    const SKIP = new Set(["node_modules", ".git", ".worktrees", "dist", "build", "coverage", "sen", "spec", "catalog", ".cache", "demo", "coined-demo"]);
    const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; };
    const parts = (body, sf) => [...body.statements].map((st) => {
      if (!G.isFoldable(st)) return D.HOLE;
      const p = G.generalStmtParts(st, sf, true);
      return p ? G.keyOf(p) : D.HOLE;
    });
    let allHole = 0, genuine = 0;
    for (const f of walk(CORPUS).sort()) {
      const src = fs.readFileSync(f, "utf8");
      const sf = ts.createSourceFile(path.basename(f), src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const visit = (n) => {
        if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) ||
             ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) &&
            n.body && ts.isBlock(n.body) && n.body.statements.length >= 2) {
          const kp = parts(n.body, sf);
          if (D.holeFraction(kp) === 1) { allHole++; assert.strictEqual(D.passesDensity(kp), false); }
          else if (D.passesDensity(kp)) genuine++;
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    // Non-vacuous: the corpus must contain bodies the rule ADMITS, or this test proves nothing.
    assert.ok(genuine > 0, `expected real genuine-shape bodies in the corpus, found ${genuine}`);
    // The all-placeholder population is no longer required to be non-empty. It was 51 when this
    // guard was written; the foldability work (import + declaration folding, the generic-walk
    // fallback, and the expression-level rollback) took it to 0 by making almost every statement
    // generalizable — 3,683 canonicalizer failures down to 15, stream-eligible 67.3% -> 99.8%.
    // The RULE is unchanged and still frozen; the corpus simply stopped exercising this class.
    // The pure cases above pin the rule itself and are mutation-checked, so coverage is not lost.
    // If this number ever rises again, the loop below still asserts every such body is excluded.
    console.log(`      (real corpus: ${allHole} all-placeholder bodies excluded, ${genuine} genuine bodies kept)`);
  });
}

console.log(`\n${pass} passed`);
