/* synth-novel-composition.test.js — THE BENCHMARK. RED.
 *
 * Amir, 2026-09-03, on why this is the load-bearing test:
 *
 *     "known patterns + known composition rules + new arrangement = previously unseen AST"
 *
 *     "If it cannot do that, you have built a code-template compressor. If it can, you are getting
 *      much closer to an actual language over a compressed TypeScript AST grammar."
 *
 * Every other test in the synthetic suite can be passed by a sufficiently large lookup table. This
 * one cannot, and that is its entire reason for existing. The dictionary is shown two families of
 * program and never their combination; the combination is then put in front of it, and the question
 * is whether the controlled language SPEAKS it out of pieces it already has, or MEMORISES it as one
 * new entry. A memoriser answers correctly and learns nothing — which is why the assertions below
 * are about the SHAPE of what was learned and not about whether the output is right.
 *
 * THE EXPERIMENT, and why it is two mines rather than one. The training corpus is mined ALONE, and
 * then again WITH the novel program added. The difference between the two dictionaries is exactly
 * what the novel program forced the miner to invent. If the language composes, that difference
 * contains no new LEAF — only new composites, which are by definition arrangements of leaves that
 * already existed. If the language memorises, the difference contains a leaf skeleton spanning the
 * whole novel function. Nothing about this inference depends on reading the English, so a
 * well-written sentence cannot disguise a lookup.
 *
 * WHY THE FAMILIES ARE `foo(x) { return x + 1 }` AND `if (x > 0) { return x }`. They share a
 * variable and a shape, so the composition is the smallest possible step — no new operator, no new
 * type, no new declaration form. If the engine cannot compose THESE, the failure is not about
 * coverage of some exotic corner of TypeScript.
 */
const S = require("./synth-corpus");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

/* ---- what the dictionary is allowed to have seen ---------------------------------------------
 * Two of each family, because MIN_COUNT gates promotion on recurrence: a pattern shown once may
 * never become a word, and then "it did not compose" would be an artifact of the fixture rather
 * than a finding about the engine. */
const TRAINING = {
  "src/known/inc1.ts":  'export function foo(x: number): number { return x + 1; }\n',
  "src/known/inc2.ts":  'export function bar(y: number): number { return y + 3; }\n',
  "src/known/gate1.ts": 'export function gate(x: number): number { if (x > 0) { return x; } return 0; }\n',
  "src/known/gate2.ts": 'export function keep(y: number): number { if (y > 0) { return y; } return 0; }\n',
};

/* ---- the arrangement the dictionary has never seen -------------------------------------------- */
const NOVEL_REL = "src/novel/mix.ts";
const NOVEL = 'export function foo(x: number): number {\n  if (x > 0) { return x + 1; }\n  return 0;\n}\n';

const before = S.build({ files: TRAINING, name: "novel-before" });
const after = S.build({ files: { ...TRAINING, [NOVEL_REL]: NOVEL }, name: "novel-after" });

const leavesBefore = new Set(before.leafSkeletons("narrow"));
const leavesAfter = new Set(after.leafSkeletons("narrow"));
const invented = [...leavesAfter].filter((s) => !leavesBefore.has(s));

console.log("\n  TRAINING CORPUS — leaf skeletons learned from the two known families:");
for (const s of leavesBefore) console.log("    " + s);

const nov = after.render(NOVEL_REL);
const obs = after.observe(NOVEL_REL);
console.log("\n  THE NOVEL PROGRAM: " + JSON.stringify(NOVEL));
console.log("  renders as:");
for (const c of obs) console.log("    " + "  ".repeat(c.depth) + (c.kind === "atomic" ? "▶ " : "▷ ") + c.label
  + (c.slots.length ? "   slots=" + JSON.stringify(c.slots) : "")
  + (c.syms.length ? "\n      " + "  ".repeat(c.depth) + "pattern: " + c.syms.join("  +  ") : ""));

console.log("\n  LEAF SKELETONS THE NOVEL PROGRAM FORCED THE MINER TO INVENT: " + invented.length);
for (const s of invented) console.log("    + " + s);

/* ---- 0. THE FLOOR ----------------------------------------------------------------------------- */
ok(nov.byteIdentical, "0. the novel program round-trips byte-identically"
  + (nov.compileError ? " (" + nov.compileError + ")" : ""));

/* ---- 1. NO NEW MONOLITHIC ENTRY — the benchmark, stated exactly -------------------------------
 * Amir's words: the language must produce the third program "WITHOUT INVENTING A NEW MONOLITHIC
 * DICTIONARY ENTRY". A leaf skeleton that spans the whole novel function IS that invention. The
 * check is deliberately narrow — a new leaf for some incidental sub-form would be a lesser problem
 * — so it asks specifically whether anything invented covers the entire function. */
console.log("\n  --- 1. did it invent a monolithic entry? ---");
{
  const monolithic = invented.filter((s) => /function/.test(s) && /if/.test(s));
  if (monolithic.length) for (const s of monolithic) console.error("      MONOLITHIC: " + s);
  eq(monolithic.length, 0, "1. no single new dictionary leaf spans the whole novel function");
}

/* ---- 2. NOTHING NEW AT ALL AT THE LEAF LEVEL --------------------------------------------------
 * The stronger reading of the same sentence, asserted separately so the report can distinguish
 * "invented one monolith" from "invented several fragments". Composition means the NEW ARRANGEMENT
 * is new and the PIECES are not, so a language that composes adds composites and no leaves. */
console.log("\n  --- 2. are the pieces all pieces it already had? ---");
eq(invented.length, 0, "2. the novel program introduced NO new leaf skeleton — only new arrangements");

/* ---- 3. THE PIECES IT USED WERE ALREADY KNOWN -------------------------------------------------
 * Read from the other end: every pattern the novel program's render actually cites must be one the
 * training corpus already taught. This is the assertion that survives even if the miner learns
 * unrelated extra leaves for its own reasons. */
console.log("\n  --- 3. every pattern the novel render cites was already known ---");
{
  const used = [...new Set(obs.filter((c) => c.kind === "atomic").flatMap((c) => c.syms))];
  const unknown = used.filter((s) => !leavesBefore.has(s));
  for (const s of unknown) console.error("      UNKNOWN TO THE TRAINING CORPUS: " + s);
  console.log("    patterns cited: " + used.length + ", of which unknown before: " + unknown.length);
  eq(unknown.length, 0, "3. every pattern the novel program renders through was learned from the known families");
}

/* ---- 4. THE COMPOSITION IS VISIBLE IN THE RENDER ----------------------------------------------
 * A dictionary could satisfy 1-3 by declining to say anything at all — rendering the novel file as
 * raw TypeScript cites no new pattern because it cites no pattern. So the render must actually
 * decompose: both families must be recognisable in it. */
console.log("\n  --- 4. is the composition visible in what it says? ---");
{
  const incPat = [...leavesBefore].filter((s) => /return ‹id› \+ ‹num›/.test(s));
  const gatePat = [...leavesBefore].filter((s) => /if/.test(s) && !/function/.test(s));
  const used = new Set(obs.filter((c) => c.kind === "atomic").flatMap((c) => c.syms));
  ok(incPat.length > 0, "4. the training corpus taught an increment pattern");
  ok(incPat.some((s) => used.has(s)), "4. the novel render REUSES the increment pattern");
  ok(gatePat.length > 0, "4. the training corpus taught a guard pattern"
    + (gatePat.length ? "" : " — the `if` never became a leaf of its own, so there is nothing to compose with"));
  ok(gatePat.some((s) => used.has(s)), "4. the novel render REUSES the guard pattern");

  /* and the English has to carry both, or the composition happened in the dictionary and was lost
   * on the way to the page. */
  const prose = after.labels(NOVEL_REL).join(" ");
  console.log("    English: " + JSON.stringify(after.labels(NOVEL_REL)));
  ok(/\bif\b|when|unless|greater|positive|above/i.test(prose), "4. the English says something about the guard");
  ok(/\+|plus|increment|add/i.test(prose) || /\b1\b/.test(prose), "4. the English says something about the increment");
}

/* ---- 5. AND THE VERDICT, IN AMIR'S TERMS ------------------------------------------------------ */
{
  const composed = invented.length === 0;
  console.log("\n  ================================================================");
  console.log("  VERDICT: " + (composed
    ? "known patterns + known composition rules + new arrangement = previously unseen AST."
    : "the novel program was MEMORISED, not composed — " + invented.length + " new leaf skeleton(s)."));
  console.log("           " + (composed ? "This is a language over a compressed AST grammar."
                                        : "This is a code-template compressor."));
  console.log("  ================================================================");
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\nRED ON PURPOSE. This is the sharpest test in the suite and the one that decides the question.");
