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
/* NON-VACUITY, AND ITS DEFINITION CHANGED ON PURPOSE — this is the assertion the run-on fix turns
 * around, so it is worth stating why the old one is gone rather than quietly relaxing it.
 *
 * SUPERSEDED ASSERTION, kept per §9:
 *
 * >   for (const w of oneWords) ok(alphaHead.includes(w), "the folder heading carries the file's word")
 *
 * That demanded the heading CONTAIN each file's word verbatim, which is exactly the concatenation
 * Amir rejected: *"it should have been one word with the composition of the words that made up
 * that one word... shouldn't have been a hundred words it should have been like a couple dozen
 * words."* A heading that contains its children's words cannot be short, so the old assertion and
 * the requirement are not jointly satisfiable — one of them had to go, and it is the one that was
 * a proxy for non-vacuity rather than non-vacuity itself.
 *
 * WHAT REPLACES IT IS STRICTER, NOT LOOSER, because "short" is trivially satisfiable by saying
 * nothing. The heading must make a CLAIM that varies with the files: it counts them, and it
 * reports a category that is actually observable in them. A stub returning the bare name fails
 * every line below, and so does a heading that pads a fixed sentence — the count and the category
 * both have to be right. */
const oneWords = S.topWordsOf(EN.renderFileEn(FILES["src/alpha/one.ts"], index).en);
ok(oneWords.length > 0, "2. the file contributes at least one top-level word (non-vacuity of the FILE scale)");
ok(alphaHead !== "alpha" && alphaHead.startsWith("alpha:"),
  "2. the folder heading is not the bare name — it makes a claim");
ok(/\b2 files\b/.test(alphaHead),
  "2. the heading COUNTS its files, so it varies with what is in the folder: " + JSON.stringify(alphaHead));
ok(/\b(all|most|some)\b/.test(alphaHead),
  "2. the claim carries a quantifier derived from the count, so it cannot overstate");
/* the claim must be about THESE files: alpha holds two constant modules, so the observable
 * category is the one the engine actually renders for them, not a category picked at random. */
const alphaCats = S.categoriesOf(EN.renderFileEn(FILES["src/alpha/one.ts"], index).en);
ok(alphaCats.length > 0, "2. the file has at least one observable clause category");
ok(alphaCats.some((k) => alphaHead.includes(S.CATEGORIES.find((c) => c[0] === k)[1])),
  "2. the heading reports a category OBSERVED IN the folder's own files, not a guess");
/* AND IT IS SHORT — the requirement that the old assertion made impossible. */
ok(S.labelWords(alphaHead) <= 24,
  "2. the folder heading is inside Amir's couple-dozen-word budget (" + S.labelWords(alphaHead) + " words)");
/* R-LANG-19 one level up: the heading is ADDITIVE — the files' own words are still there, in the
 * body, verbatim. The heading summarises them; it does not stand in for them. */
for (const w of oneWords) ok(alpha.en.includes(w),
  "2. the file's own word survives VERBATIM in the body under the heading: " + JSON.stringify(w.slice(0, 40)));

/* ---- 3. NESTED: a program is a word made of its FOLDERS' words ----------------------------- */
console.log("\n  --- 3. the composition is recursive, not two special cases ---");
const progHead = headOf(prog.en).label;
eq(headOf(prog.en).name, "src", "3. the program entry carries its NAME as a separate field, taken from the paths");
console.log("    program heading: " + progHead.slice(0, 200) + (progHead.length > 200 ? " …" : ""));
ok(progHead.startsWith("root src:"), "3. the program heading names the root");
/* SUPERSEDED, per §9: `for (const g of ["alpha","beta","gamma"]) ok(progHead.includes(g + ":"))`
 * — the program heading no longer names every folder, for the same reason the folder heading no
 * longer quotes every file. 215 folder names would not fit in a couple of dozen words, and a
 * program heading listing them is a table of contents rather than a claim. What must hold instead
 * is that the program's claim is a ROLL-UP of the whole subtree: its file count is every
 * descendant file, not its immediate children, and its folder count is every descendant folder. */
ok(/\b6 files\b/.test(progHead),
  "3. the program counts every DESCENDANT file (6), not its immediate children (0): " + JSON.stringify(progHead));
ok(/\b3 folders\b/.test(progHead),
  "3. the program counts its descendant folders (3), so the tree's shape is in the one line");
ok(/\b(all|most|some)\b/.test(progHead), "3. the program claim carries a derived quantifier");
ok(S.labelWords(progHead) <= 24,
  "3. the program heading is inside the couple-dozen-word budget (" + S.labelWords(progHead) + " words)");
/* the roll-up is what makes this a RECURSION and not two special cases: the program's digest must
 * equal the sum of its folders' digests, which is only observable by comparing the two scales. */
{
  const alphaOnly = EN.renderFolderEn(
    { "one.ts": FILES["src/alpha/one.ts"], "two.ts": FILES["src/alpha/two.ts"] }, index, { name: "alpha" });
  ok(/\b2 files\b/.test(headOf(alphaOnly.en).label),
    "3. the same folder rendered ALONE claims the same 2 files — the scales agree");
}
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
     * ISOLATING THIS TOOK A CORRECTION WORTH KEEPING, and then the run-on fix REMOVED the thing it
     * corrected for. The original note read:
     *
     * >   renaming an inner folder also stales every ANCESTOR's label, the outer label mismatched
     * >   first, and depth-first order made that problems[0]. The guard was working; the test was
     * >   asserting the wrong one of two true refusals. So the rename here is made consistent at
     * >   BOTH levels — outer label, inner name and inner label.
     *
     * That was true while a parent's label CONTAINED its children's labels. It no longer does: a
     * parent composes from its children's OBSERVATIONS (their digest), and a digest holds counts
     * and categories, not names. So renaming an inner folder now stales exactly one label — its
     * own — and the refusal is localised to the folder actually edited. That is a real improvement
     * and not merely a simplification: the message Amir would get names the folder he touched,
     * instead of an ancestor he did not. The rename here is therefore consistent at ONE level, and
     * the FILE PATHS remain the only thing that disagrees. */
    const bad = f.en.replace(S.FOLDER + " sub " + S.SEP + " sub:",
                             S.FOLDER + " NOTSUB " + S.SEP + " NOTSUB:");           /* inner name + label */
    ok(bad !== f.en && !bad.includes(S.FOLDER + " sub " + S.SEP), "7. the inner rename landed at both levels");
    ok(headOf(bad).label === headOf(f.en).label,
      "7. and the OUTER label is untouched by it — a digest label does not cascade");
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


/* ---- 9. THE HONESTY RULE, EXECUTABLE --------------------------------------------------------
 * Amir, ruling these scales: *"If you can't make a true claim about a folder, emit the vacuous
 * label and COUNT it... I would take an honest 40% vacuous over a plausible 0%."* A rule that only
 * exists in a comment is a rule nobody can violate loudly, so it is asserted here in both
 * directions: the quantifier cannot overstate, and the vacuous case is counted rather than dressed
 * up. §16's whole subject is guards that cannot fire, so each of these is checked against a case
 * that WOULD fire if the implementation regressed. */
console.log("\n  --- 9. the label cannot overstate, and silence is counted ---");

/* 9a. THE QUANTIFIER IS A FUNCTION OF THE COUNT, so "all" is unreachable without every file. */
eq(S.quantify(3, 3), "all",  "9a. every file -> all");
eq(S.quantify(2, 3), "most", "9a. more than half -> most");
eq(S.quantify(1, 3), "some", "9a. at least one -> some");
eq(S.quantify(2, 4), "some", "9a. exactly half is SOME, not most — the boundary that would flatter");
eq(S.quantify(0, 3), null,   "9a. zero says nothing at all");
ok(S.quantify(1, 1) === "all", "9a. one of one is genuinely all");

/* 9b. THE MEASURED OVER-CLAIM, pinned by the exact prose that produced it. A bare /\bset\b/
 * matched 109 corpus files on sentences like these, every one of which would have been reported as
 * a folder that sets constants. This is the assertion that would have caught it. */
const PROSE_NOT_A_CONSTANT = [
  "«\u25b6 stop early when `generationType` is set and `x` is empty \u27ealzw1 n1\u27e8x\u27eb»",
  "«\u25b6 check whether `con.isConnected` is set \u27ealzw1 n1\u27e8y\u27eb»",
];
for (const en of PROSE_NOT_A_CONSTANT) {
  ok(!S.categoriesOf(en).includes("const"),
    "9b. prose that merely says \"is set\" is NOT a constant module: " + JSON.stringify(en.slice(3, 48)));
}
ok(S.categoriesOf("«\u25b6 set `JOB_TTL_SECONDS` to `259200` \u27ealzw1 n1\u27e8z\u27eb»").includes("const"),
  "9b. and the real idiom still matches — the tightening did not switch the category off");

/* 9c. A FILE THE ENGINE CANNOT CHARACTERISE MAKES THE LABEL VACUOUS, AND THE COUNT SAYS SO.
 * The label falls back to the bare folder name and `vacuousLabels` records it. The failure mode
 * being excluded is a plausible-sounding label over files nothing was observed in. */
{
  const opaque = { "x.ts": "\n", "y.ts": "\n" };
  const f = EN.renderFolderEn(opaque, index, { name: "quiet" });
  const head = headOf(f.en).label;
  console.log("    label over files with nothing observable: " + JSON.stringify(head));
  ok(!/\b(all|most|some)\b/.test(head), "9c. no quantifier is invented when nothing was observed");
  ok(f.stats.vacuousLabels >= 1, "9c. the vacuous label is COUNTED, not hidden (§16's denominator rule)");
  ok(EN.compileFolderEn(f.en, index)["x.ts"] === "\n", "9c. and a vacuous label still round-trips byte-exact");
}

/* 9d. WORDS PER LABEL IS REPORTED, because it is the number Amir judges this on and a metric that
 * lives only in a scratch script drifts from the thing it measures (R-MECH-8). */
{
  const f = EN.renderFolderEn({ "a.ts": "export const a = 1;\n" }, index, { name: "one" });
  ok(typeof f.stats.labelWordsMedian === "number" && typeof f.stats.labelWordsMax === "number",
    "9d. the renderer publishes words-per-label itself");
  ok(f.stats.labelWordsMax <= 24, "9d. and the label it just produced is inside the budget");
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\nThe folder and program scales are asserted in synth-composition.test.js §5; this file rules on\nwhat they do. A failure here is a regression in the scale composition, not an expected red.");
