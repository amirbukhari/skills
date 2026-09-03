"use strict";
/* en-scales.test.js — THE FOLDER AND PROGRAM SCALES, RULED (§5C, R-ARCH-15, Amir 2026-09-03).
 *
 * `synth-composition.test.js` §5 asserts only that these two functions EXIST. That is the right
 * assertion for a red test naming a missing scale and the wrong one to leave behind once they do —
 * `typeof x === "function"` is satisfied by a stub that returns nothing. This file rules on what
 * they must actually DO, on Amir's own fixture:
 *
 *   1. a folder round-trips to every file's exact bytes (a MAP, not a byte stream)
 *   2. the folder heading is composed FROM the files' words — non-vacuously
 *   3. a program is a word made of its folders' words, nested, at depth
 *   4. R-REND-6 reaches these scales: a hand-edited heading is a LOUD REFUSAL, and the edit stays
 *      expressible one level down
 *   5. the container cannot be made ambiguous by a filename
 */
const EN = require("./enfile");
const S = require("./en-scales");
const CR = require("./corpus-root");

let pass = 0, fail = 0;
function threw(fn, re) {
  try { fn(); } catch (e) { return re.test(e.message); }
  return false;
}

const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

const index = EN.loadIndex(CR.corpusRoot());

/* read a container entry's NAME and LABEL as separate fields — `«▤ name ▸ label ⟨…⟩»`. Written as
 * a helper rather than inline slicing because the first version of this test sliced from a fixed
 * offset to ⟨, which silently swallowed the name field the moment one was added. A test that
 * hardcodes the layout it is observing measures its own argument (§16). */
function headOf(en) {
  const bo = en.indexOf(S.BODY_OPEN), sep = en.indexOf(S.SEP);
  return { name: en.slice(2, sep).trim(), label: en.slice(sep + S.SEP.length, bo).trim() };
}

/* Amir's fixture from synth-composition.test.js, verbatim — three levels, two files each, so every
 * level has a repeat for the miner to find. Reused rather than re-invented so the two suites cannot
 * drift about what the corpus IS. */
const FILES = {
  "src/alpha/one.ts":   'export const one = 1;\n',
  "src/alpha/two.ts":   'export const two = 2;\n',
  "src/beta/three.ts":  'export function three(x: number): number { return x + 1; }\n',
  "src/beta/four.ts":   'export function four(x: number): number { return x + 2; }\n',
  "src/gamma/five.ts":  'import { one } from "../alpha/one";\nimport { three } from "../beta/three";\nexport function five(): number { return three(one); }\n',
  "src/gamma/six.ts":   'import { two } from "../alpha/two";\nimport { four } from "../beta/four";\nexport function six(): number { return four(two); }\n',
};

/* ---- 1. THE ROUND TRIP, PER FILE ------------------------------------------------------------ */
console.log("\n  --- 1. a program round-trips to every file's exact bytes ---");
const prog = EN.renderProgramEn(FILES, index, { name: "src" });
const back = EN.compileProgramEn(prog.en, index);
eq(Object.keys(back).length, Object.keys(FILES).length, "1. every file comes back");
let identical = 0;
for (const rel of Object.keys(FILES)) {
  if (back[rel] === FILES[rel]) identical++;
  else console.error("    BYTES DIFFER: " + rel + "\n      want " + JSON.stringify(FILES[rel]) + "\n      got  " + JSON.stringify(back[rel]));
}
eq(identical, Object.keys(FILES).length, "1. every file is BYTE-IDENTICAL through the program scale");
console.log("    files " + prog.stats.files + ", folders " + prog.stats.folders
  + ", maxDepth " + prog.stats.maxDepth + ", one-word files " + prog.stats.filesOneWord);

/* ---- 2. THE HEADING IS COMPOSED FROM THE CHILDREN, NON-VACUOUSLY --------------------------- */
console.log("\n  --- 2. a folder is a word made of its files' words ---");
const alpha = EN.renderFolderEn(
  { "one.ts": FILES["src/alpha/one.ts"], "two.ts": FILES["src/alpha/two.ts"] }, index, { name: "alpha" });
const alphaHead = headOf(alpha.en).label;
eq(headOf(alpha.en).name, "alpha", "2. the folder entry carries its NAME as a separate field");
console.log("    alpha heading: " + alphaHead);
ok(alphaHead.startsWith("alpha:"), "2. the folder heading names the folder");
/* NON-VACUITY: the heading must contain the files' OWN words, not just the folder name. Without
 * this, a heading of "alpha:" alone would satisfy every other assertion in this file. */
const oneWords = S.topWordsOf(EN.renderFileEn(FILES["src/alpha/one.ts"], index).en);
ok(oneWords.length > 0, "2. the file contributes at least one top-level word (non-vacuity)");
for (const w of oneWords) ok(alphaHead.includes(w), "2. the folder heading carries the file's word: " + JSON.stringify(w));
/* and R-LANG-19 one level up: the heading is ADDITIVE — it did not replace what the files say */
ok(alphaHead.length > "alpha:".length + 2, "2. the heading is a heading OVER the words, not a replacement for them");

/* ---- 3. NESTED: a program is a word made of its FOLDERS' words ----------------------------- */
console.log("\n  --- 3. the composition is recursive, not two special cases ---");
const progHead = headOf(prog.en).label;
eq(headOf(prog.en).name, "src", "3. the program entry carries its NAME as a separate field, taken from the paths");
console.log("    program heading: " + progHead.slice(0, 200) + (progHead.length > 200 ? " …" : ""));
ok(progHead.startsWith("root src:"), "3. the program heading names the root");
for (const g of ["alpha", "beta", "gamma"]) ok(progHead.includes(g + ":"), "3. the program heading carries folder " + g + "'s word");
ok(prog.stats.maxDepth >= 2, "3. the tree reaches depth >= 2 (program of folders of files)");
eq(prog.stats.folders, 4, "3. four folder nodes: src + alpha/beta/gamma");

/* ---- 4. R-REND-6 REACHES THESE SCALES ------------------------------------------------------ */
console.log("\n  --- 4. a hand-edited heading is a loud refusal at folder scale too ---");
{
  const edited = prog.en.replace("root src:", "root src FIDDLED:");
  ok(edited !== prog.en, "4. the heading edit actually changed the container text");
  let out;
  try { out = { compiled: EN.compileProgramEn(edited, index) }; }
  catch (e) { out = { threw: e.message }; }
  console.log("    edited program heading -> " + (out.threw ? "REFUSED: " + out.threw.split("\n")[0] : "compiled"));
  ok(!!out.threw && /HEADING AND CHILDREN DISAGREE/.test(out.threw),
    "4. editing a program heading alone is refused, naming the disagreement");
  ok(!!out.threw && out.threw.includes("FIDDLED"), "4. the refusal quotes the edited heading");
}
{
  /* and the escape hatch behaves as it does everywhere else — the bytes were always recoverable */
  const edited = prog.en.replace("root src:", "root src FIDDLED:");
  const outs = EN.compileProgramEn(edited, index, { deriveCheck: false });
  let same = 0;
  for (const rel of Object.keys(FILES)) if (outs[rel] === FILES[rel]) same++;
  eq(same, Object.keys(FILES).length, "4. with deriveCheck:false the heading is inert and the bytes still round-trip");
}

/* ---- 5. THE CONTAINER CANNOT BE MADE AMBIGUOUS BY A FILENAME ------------------------------- */
console.log("\n  --- 5. a path carrying a scale marker is refused, not escaped ---");
{
  let threw = null;
  try { EN.renderProgramEn({ "src/we⟨ird.ts": "export const x = 1;\n" }, index, { name: "src" }); }
  catch (e) { threw = e.message; }
  ok(!!threw && /refusing a path containing the scale marker/.test(threw),
    "5. a path containing ⟨ is refused by name");
}

/* ---- 6. THE CHECK MUST NOT BE SELF-FULFILLING ------------------------------------------------
 * This section exists because the first working version of this module FAILED it invisibly. The
 * folder name was recovered on compile by slicing the written heading up to its first ":", so
 * editing the name inside the heading rebuilt the "derived" heading from the edited name — it
 * agreed with itself, and the guard could not fire for any name edit. §16's class exactly, and it
 * looked correct in review.
 *
 * The name is now its own field, cross-checked against the FILE PATHS, which no heading edit can
 * reach. Both halves are pinned: a label edit is caught (§4 above), and a NAME edit is caught here
 * against the paths. A future refactor that folds the name back into the heading fails this row. */
console.log("\n  --- 6. the name field is cross-checked against the paths, not against itself ---");
{
  const edited = prog.en.replace(S.PROGRAM + " src " + S.SEP, S.PROGRAM + " NOTSRC " + S.SEP)
                        .replace("root src:", "root NOTSRC:");
  ok(edited !== prog.en, "6. the name edit actually changed the container text");
  let out;
  try { out = { compiled: EN.compileProgramEn(edited, index) }; }
  catch (e) { out = { threw: e.message }; }
  console.log("    renamed program root -> " + (out.threw ? "REFUSED: " + out.threw.split("\n")[0] : "compiled — THE GUARD DID NOT FIRE"));
  ok(!!out.threw && /FOLDER NAME AND FILE PATHS DISAGREE/.test(out.threw),
    "6. a name edit consistent with its own heading is STILL refused, because the paths disagree");
  ok(!!out.threw && out.threw.includes("NOTSRC"), "6. the refusal names the edited name");
}

/* and the skipped-check denominator is reported rather than assumed away */
{
  const flat = EN.renderFolderEn({ "a.ts": "export const a = 1;\n" }, index, { name: "solo" });
  const backFlat = EN.compileFolderEn(flat.en, index);
  eq(backFlat["a.ts"], "export const a = 1;\n", "6. a flat folder map round-trips byte-exact");
  ok(backFlat._uncheckedNames >= 1,
    "6. a name with no path segment to check against is COUNTED as unchecked, not silently passed");
}

/* ---- 7. A NESTED RELATIVE FOLDER — the case that exposed pathDepth --------------------------
 * `renderFolderEn` keys are RELATIVE to the folder; `renderProgramEn` keys are ROOTED. When the
 * name cross-check used nesting depth for both, a nested relative folder checked its name against
 * parts[1] of a path whose parts[0] WAS the name — a confident mismatch on a correct container,
 * i.e. the mirror of the self-fulfilling bug in §6: a guard that fires when it should not. Both
 * directions are now pinned, because a guard has two ways to be wrong. */
console.log("\n  --- 7. a nested RELATIVE folder is not mistaken for a rooted one ---");
{
  const nested = { "sub/a.ts": "export const a = 1;\n", "sub/b.ts": "export const b = 2;\n",
                   "top.ts": "export const t = 3;\n" };
  const f = EN.renderFolderEn(nested, index, { name: "outer" });
  let out;
  try { out = { files: EN.compileFolderEn(f.en, index) }; }
  catch (e) { out = { threw: e.message }; }
  ok(!out.threw, "7. a nested relative folder compiles without a spurious name refusal"
    + (out.threw ? " — got: " + out.threw.split("\n")[0] : ""));
  if (!out.threw) {
    let same = 0;
    for (const rel of Object.keys(nested)) if (out.files[rel] === nested[rel]) same++;
    eq(same, 3, "7. all three files round-trip byte-exact through a nested relative folder");
    /* AND THE INNER FOLDER'S NAME IS STILL CHECKED — parts[0] of "sub/a.ts" — so §7 is not green
     * merely because the check was switched off for relative containers.
     *
     * ISOLATING THIS TOOK A CORRECTION WORTH KEEPING. The first attempt renamed the inner folder
     * and its own label and asserted the NAME message; the guard fired with the LABEL message
     * instead, and the assertion read as "not checked". It was: renaming an inner folder also
     * stales every ANCESTOR's label, the outer label mismatched first, and depth-first order made
     * that problems[0]. The guard was working; the test was asserting the wrong one of two true
     * refusals. So the rename here is made consistent at BOTH levels — outer label, inner name and
     * inner label — leaving the FILE PATHS as the only thing that still disagrees. */
    let bad = f.en.replace("sub: ", "NOTSUB: ");                                   /* outer label */
    bad = bad.replace(S.FOLDER + " sub " + S.SEP + " sub: ",
                      S.FOLDER + " NOTSUB " + S.SEP + " NOTSUB: ");                /* inner name + label */
    ok(bad !== f.en && !bad.includes(S.FOLDER + " sub " + S.SEP), "7. the inner rename landed at both levels");
    ok(bad.includes("◈ sub/a.ts"), "7. the file paths were deliberately left saying sub/");
    let o2; try { o2 = { ok: EN.compileFolderEn(bad, index) }; } catch (e) { o2 = { threw: e.message }; }
    console.log("    consistently renamed inner folder -> " + (o2.threw ? "REFUSED: " + o2.threw.split("\n")[0] : "compiled — GUARD DID NOT FIRE"));
    ok(!!o2.threw && /FOLDER NAME AND FILE PATHS DISAGREE/.test(o2.threw),
      "7. the INNER folder's name is cross-checked against parts[0] of its relative paths");
  }
}


/* ---- 8. A WRONG-SHAPED `files` IS REFUSED, NOT RENDERED EMPTY ------------------------------- */
console.log("\n  --- 8. zero files / a Map / a non-object are refusals, not a confident zero ---");
/* This section exists because the defect it pins actually happened, to me, in my own verification
 * harness: I passed a Map (and dropped the `index` argument), and got a 24-byte program, files 0,
 * and 0/1038 round-trip — a complete failure that LOOKED like a measurement. §16's whole subject. */
ok(threw(() => EN.renderProgramEn(new Map(Object.entries(FILES)), index, { name: "src" }),
        /PLAIN OBJECT of rel -> source, not a Map/),
   "8. a Map is refused by name, with the fix in the message (it would drop every file silently)");
ok(threw(() => EN.renderProgramEn({}, index, { name: "src" }), /ZERO files/),
   "8. zero files is a refusal, not an empty program");
ok(threw(() => EN.renderFolderEn(null, index), /got null/),
   "8. a non-object is refused, naming what it got");
ok(threw(() => EN.renderFolderEn(new Map(), index), /not a Map/),
   "8. the folder scale carries the same guard as the program scale");

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\nThe folder and program scales are asserted in synth-composition.test.js §5; this file rules on\nwhat they do. A failure here is a regression in the scale composition, not an expected red.");
