/* round-trip-fixpoint.test.js — BOTH DIRECTIONS ARE FIXPOINTS. GREEN, AND THE POINT IS WHICH HALF.
 *
 * The corpus has exactly one round-trip guarantee today and it runs one way:
 *
 *   (A)  ts -> en -> ts   is the identity on TypeScript.     1037/1037, the engine's floor.
 *   (B)  en -> ts -> en   is the identity on English.        asserted here, for the first time.
 *
 * WHY (B) IS WORTH ASSERTING WHEN IT FOLLOWS FROM (A), and why this file is not padding. (B) is a
 * COROLLARY of (A) plus determinism of the renderer, so it passes today and it will keep passing
 * for as long as the composition holds. That is precisely what makes it a useful tripwire: the day
 * someone starts making the compiler read the sentence instead of `lastIndexOf`-ing the payload —
 * the §Q-3 work that `sentence-authority.test.js` is red against — the composition stops being
 * automatic, and (B) becomes the assertion that catches a compiler which honours an edit but lands
 * on a file that renders back differently. A test whose value is realised on a future change is
 * still worth writing BEFORE the change, because afterwards nobody knows what it used to prove.
 *
 * WHAT THIS DOES NOT DUPLICATE. `en-idempotence.test.js` already checks that RE-RENDERING reproduces
 * the persisted .en on disk — render determinism against a stored artifact. This checks the other
 * composition: that a COMPILE followed by a render returns to the same English. The two share a leg
 * and neither implies the other.
 *
 * AND WHAT IT DELIBERATELY DOES NOT ASSERT. Mine-idempotence — re-mining the corpus reproducing the
 * same catalog — is FALSE by construction and is not a defect: word ids are array indices allocated
 * positionally (R-PAY-6), so any re-mine renumbers. It is settled statically in
 * `en-idempotence.test.js` rather than executed, and a "round-trip" test that quietly included it
 * would be red forever for a reason nobody intends to fix.
 */
const fs = require("fs");
const path = require("path");
const EN = require("./enfile");
const CR = require("./corpus-root");
const { SKIP } = require("./walk-skip");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

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

let tsFix = 0, enFix = 0, threw = 0;
const badTs = [], badEn = [];

for (const abs of files) {
  const rel = path.relative(SRC, abs);
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let en1, ts1, en2;
  try {
    en1 = EN.renderFileEn(source, index).en;      /* ts -> en  */
    ts1 = EN.compileFileEn(en1, index);           /* en -> ts  */
    en2 = EN.renderFileEn(ts1, index).en;         /* ts -> en  again, closing the second loop */
  } catch (e) { threw++; badTs.push(rel + "  THREW: " + e.message); continue; }

  if (ts1 === source) tsFix++; else badTs.push(rel);
  if (en2 === en1) enFix++; else badEn.push(rel);
}

console.log("");
console.log("  files                              " + files.length);
console.log("  (A) ts -> en -> ts  byte-identical " + tsFix);
console.log("  (B) en -> ts -> en  byte-identical " + enFix);
if (threw) console.log("  threw                              " + threw);
for (const b of badTs.slice(0, 10)) console.log("    A fails: " + b);
for (const b of badEn.slice(0, 10)) console.log("    B fails: " + b);
console.log("");

eq(tsFix, files.length, "A. ts -> en -> ts is the identity on every file in the corpus");
eq(enFix, files.length, "B. en -> ts -> en is the identity on every file in the corpus");

/* BOTH LEGS ARE SHOWN TO BE LOAD-BEARING (§10.3). Two identity assertions over a corpus would both
 * pass just as happily if the pipeline had quietly become a no-op that returned its input — so the
 * transformations are shown to actually transform, and B is shown to be capable of failing. */
{
  const sample = files.find((f) => fs.readFileSync(f, "utf8").includes("import"));
  const src = fs.readFileSync(sample, "utf8");
  const en = EN.renderFileEn(src, index).en;
  ok(en !== src, "the render is not a no-op — the .en differs from the .ts");
  ok(/[«»]/.test(en), "the .en carries chunk markers, so English was actually emitted");

  /* leg B, perturbed: a .en with one clause reworded must NOT return to itself. If it does, B is
   * comparing something that does not depend on the English and proves nothing. */
  const i = en.indexOf("«▶ ");
  if (i >= 0) {
    const perturbed = en.slice(0, i + 3) + "PERTURBED " + en.slice(i + 3);
    let en2 = null; try { en2 = EN.renderFileEn(EN.compileFileEn(perturbed, index), index).en; } catch (_) { en2 = null; }
    ok(en2 === null || en2 !== perturbed, "B can fail: a reworded .en does not come back unchanged");
  }
}

console.log("\n" + pass + " passed, " + fail + " failed");
