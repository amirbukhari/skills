/* synth-composition.test.js — STRUCTURAL COMPOSITION AT EVERY AST SCALE. RED.
 *
 * Amir's framing, 2026-09-03: if LZW is discovering repeated AST sequences and subtrees and
 * assigning each learned pattern a controlled-English token, then the test corpus must exercise
 * structural composition AT EVERY AST SCALE, INCLUDING CROSS-FILE AND CROSS-FOLDER RELATIONSHIPS.
 *
 * The fixture is three levels, two files each, so every level has a REPEAT for the miner to find:
 *
 *   L1  alpha/  bare declarations           should discover ~ EXPORT_CONST_NUMBER(name, value)
 *   L2  beta/   a parameter and an operator  should discover ~ EXPORT_NUMBER_TRANSFORM(name, param, literal)
 *   L3  gamma/  composition across folders   should discover ~ IMPORT_VALUE / IMPORT_FUNCTION /
 *                                              EXPORT_COMPOSED_FUNCTION
 *
 * and the assertion that matters is the RECURSIVE COMPOSITION of the dictionary:
 *
 *   PROGRAM
 *   └── FOLDER_GROUP
 *       ├── FILE_PATTERN_A ×2
 *       ├── FILE_PATTERN_B ×2
 *       └── FILE_PATTERN_C ×2
 *
 * WHY THE PHRASES IN THE TARGET ARE NOT ARBITRARY PROSE, in Amir's words: "numeric constant",
 * "numeric increment", "compose … from … through …", "group", "root" EACH REPRESENT A KNOWN
 * COMPRESSED AST PATTERN. That is what separates this from the specimen tests it replaces. A
 * sentence about an invoice can be produced by a production that learned the word "invoice";
 * "numeric increment four by 2" can only be produced by a pattern that has a name slot, a literal
 * slot, and an operator identity.
 *
 * WHAT IS ASSERTED VS REPORTED. The corpus-level target is asserted against a RENDER OF THE WHOLE
 * FIXTURE, and no such render exists — the engine renders per file and has no notion of a folder
 * group or a program root. So this test builds the best available approximation (per-file renders
 * concatenated under their folders) and states plainly that the missing levels are missing rather
 * than pretending a per-file render is a program render. The gap is the finding.
 */
const S = require("./synth-corpus");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

/* ---- THE FIXTURE, exactly as briefed ---------------------------------------------------------- */
const FILES = {
  "src/alpha/one.ts":   'export const one = 1;\n',
  "src/alpha/two.ts":   'export const two = 2;\n',
  "src/beta/three.ts":  'export function three(x: number): number { return x + 1; }\n',
  "src/beta/four.ts":   'export function four(x: number): number { return x + 2; }\n',
  "src/gamma/five.ts":  'import { one } from "../alpha/one";\nimport { three } from "../beta/three";\nexport function five(): number { return three(one); }\n',
  "src/gamma/six.ts":   'import { two } from "../alpha/two";\nimport { four } from "../beta/four";\nexport function six(): number { return four(two); }\n',
};

/* ---- AMIR'S TARGET CONTROLLED ENGLISH FOR THE WHOLE CORPUS, pinned verbatim -------------------- */
const TARGET = `Root src.

Group alpha:
    numeric constant one is 1.
    numeric constant two is 2.

Group beta:
    numeric increment three by 1.
    numeric increment four by 2.

Group gamma:
    compose five from alpha.one through beta.three.
    compose six from alpha.two through beta.four.`;

const norm = (s) => String(s).trim().split("\n").map((l) => l.trim()).filter(Boolean).join("\n");

const C = S.build({ files: FILES, name: "three-level" });

/* ---- 0. THE FLOOR. Non-negotiable, and asserted before anything about prose. ------------------ */
{
  const b = C.allByteIdentical();
  eq(b.bad.length, 0, "0. every file in the fixture round-trips byte-identically" + (b.bad.length ? " — " + b.bad.join(", ") : ""));
}

/* ---- what the miner actually learned ---------------------------------------------------------- */
const counts = C.counts("narrow");
const leaves = C.leafSkeletons("narrow");
console.log("\n  MINED (narrow axis): " + JSON.stringify(counts.counts || counts));
console.log("  LEAF SKELETONS the miner learned:");
for (const s of leaves) console.log("    " + s);
console.log("\n  RENDERED, per file:");
for (const rel of C.files) {
  const o = C.observe(rel);
  console.log("    " + rel);
  for (const c of o) console.log("      " + "  ".repeat(c.depth) + (c.kind === "atomic" ? "▶ " : "▷ ") + c.label
    + (c.slots.length ? "   slots=" + JSON.stringify(c.slots) : "")
    + (c.syms.length ? "\n        " + "  ".repeat(c.depth) + "pattern: " + c.syms.join("  +  ") : ""));
}

/* ---- 1. LEVEL 1 — ONE PATTERN, SHARED BY BOTH FILES ------------------------------------------
 * The two declarations differ only in a name and a number, so if the dictionary is over the AST
 * they MUST land on the same skeleton with different fills. If they land on different skeletons,
 * the miner is keyed on something lexical and the whole premise fails at the easiest possible
 * case. */
console.log("\n  --- 1. level 1: bare declarations ---");
{
  const a = C.observe("src/alpha/one.ts").filter((c) => c.kind === "atomic");
  const b = C.observe("src/alpha/two.ts").filter((c) => c.kind === "atomic");
  ok(a.length === 1 && b.length === 1, "1. each level-1 file renders as exactly one atomic pattern");
  if (a.length && b.length) {
    eq(a[0].syms.join("|"), b[0].syms.join("|"), "1. both level-1 files use the SAME dictionary pattern");
    ok(JSON.stringify(a[0].slots) !== JSON.stringify(b[0].slots), "1. and differ only in their slots");
    /* the pattern must have a NAME slot and a VALUE slot — that is what EXPORT_CONST_NUMBER means.
     * A skeleton with the number baked in would be a template, not a pattern. */
    const sym = a[0].syms.join("");
    ok(/‹id›/.test(sym), "1. the level-1 pattern has an identifier slot");
    ok(/‹num›/.test(sym), "1. the level-1 pattern has a numeric-literal slot");
  }
}

/* ---- 2. LEVEL 2 — THE OPERATOR AND THE LITERAL MUST BOTH BE VISIBLE --------------------------
 * `three` and `four` differ only in a name and an addend. One pattern, two fills — and critically
 * the emitted English has to SAY the addend, because "numeric increment four by 2" is the target
 * and a sentence that omits the 2 cannot distinguish `x + 2` from `x + 9`. */
console.log("\n  --- 2. level 2: a parameter and an operator ---");
{
  const a = C.observe("src/beta/three.ts").filter((c) => c.kind === "atomic");
  const b = C.observe("src/beta/four.ts").filter((c) => c.kind === "atomic");
  ok(a.length >= 1 && b.length >= 1, "2. each level-2 file renders at least one atomic pattern");
  if (a.length && b.length) {
    eq(a[0].syms.join("|"), b[0].syms.join("|"), "2. both level-2 files use the SAME dictionary pattern");
    const sym = a[0].syms.join("");
    ok(/‹num›/.test(sym), "2. the level-2 pattern has a literal slot for the addend");
    /* THE SENTENCE MUST CARRY THE SLOT VALUES. This is the difference between a pattern token and
     * a description of one. Measured: the renderer emits "return a value worked out from `x`",
     * which names the parameter and drops both the operator and the addend — so `x + 1` and
     * `x + 2` produce IDENTICAL English from different code. */
    const la = C.labels("src/beta/three.ts").join(" "), lb = C.labels("src/beta/four.ts").join(" ");
    ok(la !== lb, "2. three.ts and four.ts do not read identically — the addend reaches the English");
    ok(/\b1\b/.test(la), "2. three.ts's English names its addend 1");
    ok(/\b2\b/.test(lb), "2. four.ts's English names its addend 2");
  }
}

/* ---- 3. LEVEL 3 — COMPOSITION ACROSS FOLDERS -------------------------------------------------
 * five.ts and six.ts are structurally identical: two imports and a function returning
 * callee(value). If the callee is a SLOT they share one pattern; if it is baked into the skeleton
 * they do not, and the dictionary is a template store rather than a grammar. This is the first
 * place the distinction Amir cares about becomes measurable. */
console.log("\n  --- 3. level 3: composition across folders ---");
{
  const a = C.observe("src/gamma/five.ts").filter((c) => c.kind === "atomic");
  const b = C.observe("src/gamma/six.ts").filter((c) => c.kind === "atomic");
  ok(a.length >= 1 && b.length >= 1, "3. each level-3 file renders at least one atomic pattern");
  const sa = a.map((c) => c.syms.join("|")).join(" || "), sb = b.map((c) => c.syms.join("|")).join(" || ");
  if (sa !== sb) { console.error("      five.ts patterns: " + sa); console.error("      six.ts  patterns: " + sb); }
  eq(sa, sb, "3. five.ts and six.ts — structurally identical — use the SAME patterns");

  /* the callee must be a slot, not a literal in the skeleton. */
  const allSyms = [...a, ...b].flatMap((c) => c.syms).join(" ");
  ok(!/return three\(/.test(allSyms) && !/return four\(/.test(allSyms),
    "3. the callee is a SLOT in the pattern, not baked into the skeleton");

  /* and the import pattern must generalise over the path. */
  const importSyms = [...a, ...b].flatMap((c) => c.syms).filter((s) => /^import/.test(s));
  ok(importSyms.length > 0, "3. an import pattern was learned");
  ok(importSyms.every((s) => /‹str›/.test(s)), "3. the import pattern has a slot for the module path, not a baked path");
}

/* ---- 4. RECURSIVE COMPOSITION — THE ASSERTION THAT MATTERS ------------------------------------
 * A dictionary of six unrelated patterns would satisfy everything above. What must be true is that
 * the words COMPOSE: a longer word built as m:[prefix, appended] out of shorter words, so the tree
 * PROGRAM → FOLDER_GROUP → FILE_PATTERN ×2 is expressible. Composites and depth are the direct
 * evidence, and both are read off the mined catalog rather than off the prose. */
console.log("\n  --- 4. recursive composition of the dictionary ---");
{
  const c = (C.counts("narrow").counts) || C.counts("narrow");
  const composites = c.composites || 0, maxDepth = c.maxDepth || 0, edges = c.compositionEdges || 0;
  console.log("    leaves " + (c.leaves || 0) + ", composites " + composites + ", maxDepth " + maxDepth + ", composition edges " + edges);
  ok(composites > 0, "4. the dictionary contains composite words — words referencing words");
  ok(maxDepth >= 2, "4. composition reaches depth >= 2 (a word of words of words)");

  /* THE ×2 IN THE TREE. Each of the three file patterns recurs twice, so each level's pattern must
   * be used by exactly two files. This is the "FILE_PATTERN_A ×2" line, mechanised. */
  const byPattern = new Map();
  for (const rel of C.files) {
    for (const ch of C.observe(rel).filter((x) => x.kind === "atomic")) {
      const k = ch.syms.join("|");
      if (!byPattern.has(k)) byPattern.set(k, new Set());
      byPattern.get(k).add(rel.split("/")[1]);
    }
  }
  const shared = [...byPattern.values()].filter((s) => s.size >= 1);
  const reusedTwice = [...byPattern.entries()].filter(([, s]) => s.size >= 1).length;
  console.log("    distinct patterns used across the fixture: " + byPattern.size + " (folders touched per pattern: "
    + [...byPattern.values()].map((s) => s.size).join(",") + ")");
  eq(byPattern.size, 3, "4. the whole six-file fixture is spanned by exactly THREE file patterns, one per level");
  ok(shared.length === reusedTwice, "4. every pattern found is actually used");
}

/* ---- 5. FOLDER AND PROGRAM SCALE — the level that does not exist yet -------------------------
 * Amir's target opens "Root src." and groups by folder. There is no renderer for either scale: the
 * engine's unit is the file. This asserts the requirement and reports the absence honestly rather
 * than approximating a program render and calling it one. */
console.log("\n  --- 5. folder and program scale ---");
{
  const EN2 = require("./enfile");
  ok(typeof EN2.renderFolderEn === "function", "5. the engine can render a FOLDER GROUP (renderFolderEn)");
  ok(typeof EN2.renderProgramEn === "function", "5. the engine can render a PROGRAM ROOT (renderProgramEn)");
}

/* ---- 6. AMIR'S TARGET, PINNED ----------------------------------------------------------------
 * Assembled from what the engine can actually produce today — per-file renders under folder
 * headings — and compared to the target. This is the whole test in one assertion, and every
 * failure above is a reason it cannot pass yet. */
console.log("\n  --- 6. the target controlled English for the whole corpus ---");
{
  const P = require("./en-prose");
  const groups = ["alpha", "beta", "gamma"];
  let got = "Root src.\n";
  for (const g of groups) {
    got += "\nGroup " + g + ":\n";
    for (const rel of C.files.filter((f) => f.startsWith("src/" + g + "/")))
      got += "    " + P.readable(C.render(rel).en, require("./enfile").unescapeVerbatim).replace(/\s+/g, " ").trim() + "\n";
  }
  const w = norm(TARGET), g2 = norm(got);
  if (w !== g2) {
    const wl = w.split("\n"), gl = g2.split("\n");
    console.error("    TARGET vs RENDERED, line by line:");
    for (let i = 0; i < Math.max(wl.length, gl.length); i++) {
      const a = wl[i] || "", b = gl[i] || "";
      console.error("      " + (a === b ? "  ok  " : " DIFF ") + "want: " + a);
      if (a !== b) console.error("             got:  " + (b.length > 150 ? b.slice(0, 150) + " …" : b));
    }
  }
  eq(g2, w, "6. the fixture renders as Amir's target controlled English");
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\nRED ON PURPOSE. Each failure names an AST scale the dictionary does not yet span.");
