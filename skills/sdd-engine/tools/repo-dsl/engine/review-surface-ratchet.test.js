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
const TOP_CEILING = 1582;
const TREE_CEILING = 20999;

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

/* THE FLOOR FIRST — a surface reduction bought by dropping a byte is not a reduction. */
eq(byteExact, files.length, "byte-identity holds for every file while this is measured");

console.log("");
console.log("  files                 " + files.length);
console.log("  chunks (all depths)   " + chunks);
console.log("  residual statements   " + residual);
console.log("  REVIEW SURFACE top    " + top + "   (ceiling " + TOP_CEILING + ")");
console.log("  REVIEW SURFACE tree   " + tree + "   (ceiling " + TREE_CEILING + ")");
worst.sort((a, b) => b.top - a.top);
console.log("\n  HEAVIEST FILES (top-level surface)");
for (const w of worst.slice(0, 10)) console.log("    " + String(w.top).padStart(4) + " top / " + String(w.tree).padStart(5) + " tree   " + w.rel);
console.log("");

le(top, TOP_CEILING, "top-level review surface never rises above its 2026-09-03 baseline");
le(tree, TREE_CEILING, "whole-tree review surface never rises above its 2026-09-03 baseline");

/* AND THE RATCHET IS AUDITED. If the real number has fallen well below a ceiling, the ceiling has
 * gone slack and stopped guarding anything — so say so loudly rather than reporting a pass. This is
 * a warning, not a failure: the fix is a one-line baseline edit in the commit that earned it. */
if (top < TOP_CEILING) console.error("  NOTE: top ceiling is slack by " + (TOP_CEILING - top) + " — lower TOP_CEILING to " + top + ".");
if (tree < TREE_CEILING) console.error("  NOTE: tree ceiling is slack by " + (TREE_CEILING - tree) + " — lower TREE_CEILING to " + tree + ".");

console.log("\n" + pass + " passed, " + fail + " failed");
