/* review-surface-ratchet.test.js — THE ONE-WAY VALVE. GREEN TODAY, ON PURPOSE.
 *
 * Every other file in this suite is red and states a destination. This one states a FLOOR: whatever
 * the review surface is today, it may never be worse tomorrow. It is the only member of the suite
 * that passes on the day it is written, and that is its function — the red tests can be satisfied
 * by making the .en read beautifully while quietly handing the reader more to read, and this is the
 * assertion that forbids paying for prose with surface.
 *
 * §7.3's frozen definition, at two scales, because they can move in opposite directions:
 *
 *   TOP-LEVEL   top-level chunks + statements under no chunk at all. What a reader sees on opening
 *               the file. Falls when a file collapses further.
 *   WHOLE-TREE  every chunk at every depth + the same residual. What a reader sees after expanding
 *               everything. RISES when a file is split into more nested chunks — which is exactly
 *               what THE LIFT (§4B) asks for. Ratcheting only the top-level number would let the
 *               tree balloon unmeasured; ratcheting only the whole-tree number would penalise the
 *               lift itself. Both are pinned, and a change that trades one for the other has to
 *               come and argue for the new baseline rather than slide past a single figure.
 *
 * WHY THE BASELINE IS A LITERAL AND NOT "whatever we measure now": a ratchet that recomputes its own
 * bound is not a ratchet (§10.3 — a guard that cannot be shown to fire is not a guard). These two
 * numbers were measured on 2026-09-03 and are edited only deliberately, downward, in a commit that
 * says why.
 */
const fs = require("fs");
const ts = require("typescript");
const path = require("path");
const EN = require("./enfile");
const CR = require("./corpus-root");
const { SKIP } = require("./walk-skip");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
const le = (a, b, m) => ok(a <= b, m + "  (got " + a + ", ceiling " + b + ")");

/* BASELINE — measured 2026-09-03 over the whole corpus. Lower these when the work earns it.
 *
 * THE TREE CEILING IS 20,999 AND NOT THE PUBLISHED 19,776, and the 1,223 between them is a finding,
 * not a rounding. `write-en-files.js` reports the whole-tree read as `stats.chunks + residual`, and
 * `stats.chunks` is `atomic + structural` — the three counters in `renderRun`/`renderStatement`.
 * But `renderVerbatim` (enfile.js:1315) emits a FOURTH kind of chunk: leaf spans, `«…»` in the file
 * exactly like any other, which it counts into `stmtSpans`/`dataSpans` and never into `chunks`.
 * Corpus-wide those are 95 + 1,128 = 1,223, which closes the gap to the byte. The reader expands
 * them like every other chunk, so they are review surface and the published figure understates the
 * exhaustive read by 6.4%.
 *
 * SO THIS TEST COUNTS OFF THE EMITTED BYTES rather than off the counters. A scoreboard fed by a
 * producer that does not see every emission is the §8B drift shape — the same shape STEP 2 is
 * removing between `genSpans` and `runWord`, one level down, in the metric rather than the render.
 * Counting what the file actually contains is the one definition that cannot drift from it. */
const TOP_CEILING = 1086;
/* Tightened 20214 -> 20152 on 2026-09-03, off the test's own printed NOTE, after the interior-label
 * work moved a heading into a child chunk. A ratchet left slack is a ratchet that permits a
 * regression it was written to catch: at 20214 the tree could have grown 62 statements of review
 * surface and still read green. The NOTE exists so this never has to be noticed by accident. */
const TREE_CEILING = 20152;

/* ---- THE SECOND METRIC: MUTE STATEMENTS -------------------------------------------------------
 * Amir, 2026-09-03, ruling: "Do NOT redefine reviewSurface. It stays exactly as it is, unedited.
 * Add a SECOND metric alongside it, never replacing it." Published together, always, surface first.
 *
 * WHY TWO NUMBERS AND NOT ONE. reviewSurface = genSpans + (bodyStatements - collapsed): it counts
 * COLLAPSE INTO WORDS. It is structurally blind to what a clause SAYS -- a statement rendered
 * "expect `result.success` to be true" counts exactly 1, the same as one rendered "call to be". So
 * productions, which are §5C's larger half, cannot move it on any corpus. The brief was "statements
 * a reader must still read as CODE", and nobody reads that first clause as code: the PROXY and the
 * DEFINITION had come apart. The fix is to measure both, not to swap one for the other -- replacing
 * it loses the only number that cannot be talked up by better prose.
 *
 * MUTE = generic + vacuous, by the EXISTING frozen definitions, adversarially applied:
 *   vacuous  the clause is in clause-quality.js's frozen VACUOUS set.
 *   generic  the clause quotes nothing (`...` or “...”) that appears in the statement's own text.
 * Both are read from the existing producers. Neither is redefined here, and NARROWING EITHER TO
 * MAKE THIS NUMBER FALL IS FORBIDDEN -- same §5C honesty rule the productions obey, where an
 * unknown matcher stays "call to weird custom thing" and stays counted. If a commit ever lowers
 * mutes AND touches the definition of mute, that commit is wrong.
 *
 * BASELINE, COMPUTED RETROACTIVELY rather than published at its own best moment. Measured by
 * checking out historical renderers into a scratch copy and running today's harness against them:
 *   4,646   2d83452 (2026-09-02) through 3a3fc7f -- stable across every commit in between
 *   3,245   8240298  after the spec-dialect productions
 *   2,746   after the return-call production
 * HONEST LIMIT: it cannot be carried back past 2d83452. Older renderers predate spanActions in its
 * current shape and today's harness reads 0 clauses for all 33,918 statements against them -- that
 * is a harness incompatibility, NOT a reading of 33,918 mutes, and publishing it as an origin would
 * flatter this metric enormously. So the series starts where it can honestly be measured. */
const MUTE_CEILING = 2362;

/* KNOWN OVER-COUNT IN THIS METRIC, MEASURED AND DELIBERATELY NOT CORRECTED.
 * `generic` asks whether a clause quotes a token that appears LITERALLY in the statement's text.
 * Two truthful clause shapes fail that test and are scored mute anyway. Of the 2,293 generic
 * (this breakdown was measured at the 2,410 ceiling and is carried forward with the counts it was
 * measured with -- the SHAPES did not change when b571e4d moved the ceiling to 2,362, only the
 * remainder did; the fractions are marked approximate rather than silently rescaled):
 *
 *   934  the clause carries an ellipsis and its LITERAL FRAGMENTS do appear in the source --
 *        `throw “Invalid data: … must be a number, numeric string, or null”` against
 *        `throw new Error(`Invalid data: ${v} must be a number, numeric string, or null`)`.
 *        The clause is fully informative; the substring test cannot match across the hole.
 *   325  a complete literal return with no identifier available to quote -- "return false",
 *        "return an empty list", "return". These are maximal descriptions of their statements.
 *  1,071  the remainder, which genuinely says nothing.
 *
 * SO THE TRUE MUTE COUNT IS NEARER ~1,100 THAN 2,362, AND THE CEILING STAYS 2,362 ANYWAY. Amir, 2026-09-03: "If you ever find yourself editing the definition of mute in the
 * same commit as a drop in mutes, stop and tell me." That is exactly the situation -- the template
 * production landed and the metric could not see it -- so the definition is untouched, the
 * discrepancy is measured and written down, and the ruling is his. Adjusting the rule that scores a
 * number in the same breath as improving the number is how a metric stops meaning anything, even
 * when every individual figure in it is true. */

const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
  }
  return o;
};

const SRC = CR.sourceRoot(), CORPUS = CR.corpusRoot();
const index = EN.loadIndex(CORPUS);
const files = walk(SRC);

let byteExact = 0, top = 0, tree = 0, residual = 0, chunks = 0;
const worst = [];

for (const abs of files) {
  const rel = path.relative(SRC, abs);
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let r; try { r = EN.renderFileEn(source, index); } catch (_) { continue; }
  if (EN.compileFileEn(r.en, index) === source) byteExact++;

  /* chunks at EVERY depth, counted off the emitted bytes rather than off a span list, so this
   * measures what the reader receives and not what a producer intended to emit. */
  let n = 0;
  for (const ch of r.en) if (ch === "«") n++;
  chunks += n;
  residual += r.stats.residualStatements;
  top += r.stats.reviewSurface;
  tree += n + r.stats.residualStatements;
  worst.push({ rel, top: r.stats.reviewSurface, tree: n + r.stats.residualStatements });
}

/* MUTE STATEMENTS, over the same walk. Uses the SAME producers and the SAME frozen list as
 * statement-kind-coverage.test.js, which reports the per-kind breakdown; this reports only the
 * total, so the two can never drift into two different definitions of the same word.
 * Reads BOTH of spanActions' output channels — `actions` AND `guards` — because reading one is how
 * 775 guard-shaped ifs were counted as silent (§8B.9.1). */
const mute = (() => {
  const Q = require("./clause-quality");
  let sites = 0, generic = 0, vacuous = 0;
  const quotesTheSite = (clause, text) => {
    const qs = clause.match(/`[^`]+`|“[^”]+”/g) || [];
    for (const qq of qs) { const b = qq.slice(1, -1).trim(); if (b.length >= 2 && text.includes(b)) return true; }
    return false;
  };
  for (const abs of files) {
    let src2; try { src2 = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
    const sf = ts.createSourceFile(abs, src2, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (n) => {
      if ((ts.isBlock(n) || ts.isSourceFile(n)) && n.statements.length) for (const st of n.statements) {
        sites++;
        let r2 = null; try { r2 = EN.spanActions([st], sf); } catch (_) { r2 = null; }
        const clause = r2 && r2.actions && r2.actions.length ? String(r2.actions[0])
          : (r2 && r2.guards && r2.guards.length ? String(r2.guards[0]) : null);
        if (!clause) { vacuous++; continue; }      // no clause at all is at least as mute as a vacuous one
        if (Q.isVacuous(clause)) { vacuous++; continue; }
        if (!quotesTheSite(clause, st.getText(sf))) generic++;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { sites, generic, vacuous, total: generic + vacuous };
})();

/* THE FLOOR FIRST — a surface reduction bought by dropping a byte is not a reduction. */
eq(byteExact, files.length, "byte-identity holds for every file while this is measured");

console.log("");
console.log("  files                 " + files.length);
console.log("  chunks (all depths)   " + chunks);
console.log("  residual statements   " + residual);
console.log("  REVIEW SURFACE top    " + top + "   (ceiling " + TOP_CEILING + ")");
console.log("  REVIEW SURFACE tree   " + tree + "   (ceiling " + TREE_CEILING + ")");
console.log("  MUTE statements       " + mute.total + "   (ceiling " + MUTE_CEILING + ")"
  + "   [" + mute.generic + " generic + " + mute.vacuous + " vacuous of " + mute.sites + " statements]");
worst.sort((a, b) => b.top - a.top);
console.log("\n  HEAVIEST FILES (top-level surface)");
for (const w of worst.slice(0, 10)) console.log("    " + String(w.top).padStart(4) + " top / " + String(w.tree).padStart(5) + " tree   " + w.rel);
console.log("");

le(top, TOP_CEILING, "top-level review surface never rises above its 2026-09-03 baseline");
le(tree, TREE_CEILING, "whole-tree review surface never rises above its 2026-09-03 baseline");
le(mute.total, MUTE_CEILING, "mute statements never rise above their baseline (§5C productions ratchet)");

/* AND THE RATCHET IS AUDITED. If the real number has fallen well below a ceiling, the ceiling has
 * gone slack and stopped guarding anything — so say so loudly rather than reporting a pass. This is
 * a warning, not a failure: the fix is a one-line baseline edit in the commit that earned it. */
if (top < TOP_CEILING) console.error("  NOTE: top ceiling is slack by " + (TOP_CEILING - top) + " — lower TOP_CEILING to " + top + ".");
if (tree < TREE_CEILING) console.error("  NOTE: tree ceiling is slack by " + (TREE_CEILING - tree) + " — lower TREE_CEILING to " + tree + ".");
if (mute.total < MUTE_CEILING) console.error("  NOTE: mute ceiling is slack by " + (MUTE_CEILING - mute.total) + " — lower MUTE_CEILING to " + mute.total + ".");

console.log("\n" + pass + " passed, " + fail + " failed");
