/* the-goal.test.js — THE ONLY TEST THAT MEASURES WHAT AMIR ACTUALLY ASKED FOR. RED ON PURPOSE.
 *
 * WHY THIS FILE EXISTS, stated plainly because the reason is a failure and not a design.
 * On 2026-09-03 a night's work was reported as goal-achieved on the strength of three metrics:
 * review surface 1,086/20,214, MUTE 2,362, byte-identity 1037/1037 in both senses. Every one of
 * those numbers was true. Amir then opened `sen/files/src/routers/links.ts.en`, read it, and said:
 *
 *     "You lied to me."
 *
 * He was right. The file is TypeScript with narration wrapped around it. `linksRouter.get(`,
 * `async (ctx) => {`, `if (await isValidJwt(`, a raw-source payload dump, and a ~200-word import
 * list as its opening sentence. THE METRICS WERE TRUE AND THE PICTURE WAS FALSE, which is the
 * §16 defect class one final time: a number whose SUBJECT is not the thing anyone cared about.
 * `reviewSurface` counts collapse. `MUTE` counts clause quality. NEITHER OF THEM LOOKS AT THE PAGE.
 *
 * So this test does not measure a proxy. It reads the rendered page and asks the literal question:
 *
 *     Strip what is verbatim BY DESIGN. Is there any TypeScript left?
 *
 * IT OUTRANKS EVERY OTHER NUMBER IN THE SUITE. When it disagrees with review surface or MUTE,
 * it wins, and the other number is the one that needs explaining.
 *
 * ---------------------------------------------------------------------------------------------
 * THE STRIP LIST IS FROZEN AND CLOSED. THIS IS THE ANTI-CHEAT AND IT IS THE WHOLE TEST.
 *
 * Every construct below is stripped before the check, because it is verbatim BY DESIGN — a hole
 * that names a real identifier, or an inline value span. Nothing else is stripped, ever.
 *
 * WIDENING THIS LIST TO MAKE THE NUMBER FALL IS THE CHEAT. It is available at every moment, it
 * always works, and it is exactly the move that produced tonight's false report — not by anyone
 * lying, but by a definition quietly growing to fit the result being hoped for. If a construct
 * genuinely belongs here, that is a PROPOSAL to Amir with an argument attached, in its own commit,
 * never a quiet edit alongside a drop in the number. A commit that both lowers this count and
 * touches STRIP is wrong on its face.
 *
 * The same rule the productions obey (§5C honesty): if the renderer cannot say something true
 * about a construct, it emits the vacuous clause and the construct STAYS COUNTED here. An honest
 * 400 dirty files beats a cooked 40.
 * ---------------------------------------------------------------------------------------------
 */
"use strict";
const fs = require("fs");
const path = require("path");
const CR = require("./corpus-root");
const { SKIP } = require("./walk-skip");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };

/* ---- THE FROZEN STRIP LIST — verbatim by design, and nothing else ------------------------------
 * Amir, 2026-09-03: "Strip every region that is verbatim by design — the backtick-quoted word-like
 * holes and the «text: "…"» / «an object with …» inline forms." Three entries. That is the list. */
/* WORD-LIKE, AND THE WORD IS LOAD-BEARING. Amir said "the backtick-quoted WORD-LIKE holes", and
 * the first version of this file stripped ANY backtick region — which is looser than the spec I
 * was handed, and the looseness was worth 14,941 constructs.
 *
 * MEASURED WITHIN THE HOUR OF WRITING THIS TEST, and it is a hole in the test itself, not in the
 * renderer: `` `${inv.id}` `` and `` `{ a: 1 }` `` are backtick regions containing a template
 * interpolation and an object literal. They are TypeScript, they are on the page, and the first
 * strip made them invisible — 8,509 braces, 4,118 `${`, 987 call-parens hidden in total.
 *
 * A hole is word-like when it names something: identifiers, dotted paths, routes, module
 * specifiers. It is NOT word-like the moment it carries block, call, index or interpolation
 * syntax, and at that point it is smuggling code through the one gap the strip list opens.
 *
 * THIS TIGHTENING RAISES THE NUMBER, which is the direction that tells you it is honest. The
 * frozen-list rule forbids WIDENING to make the count fall; closing an evasion that makes it rise
 * is the opposite move and is always allowed. */
const WORD_LIKE = /^[^{}()[\];`]*$/;
const STRIP = [
  { name: "backtick hole (word-like only)", re: /`[^`]*`/g,
    guard: (m) => WORD_LIKE.test(m.slice(1, -1)) && !m.includes("${") && !m.includes("=>") },
  { name: "«text: …» inline span", re: /«text:[^»]*»/g },
  { name: "«an object with …» inline span", re: /«an object with[^»]*»/g },
];
/* A fingerprint of the list itself, printed with the result. If the number falls and this moves in
 * the same commit, the drop is not a real one. It is cheaper to make this visible than to rely on
 * anyone remembering the rule. */
const STRIP_FINGERPRINT = require("crypto").createHash("sha256")
  .update(STRIP.map((s) => s.name + "|" + s.re.source + "|" + (s.guard ? String(s.guard) : "")).join("||"))
  .digest("hex").slice(0, 12);

/* ---- WHAT COUNTS AS SURVIVING TYPESCRIPT -------------------------------------------------------
 * DETECTED BY PUNCTUATION, NEVER BY KEYWORD, and the reason matters. The English dialect legitimately
 * contains the WORDS `import`, `return`, `if`, `await` — "import `intVal` from `../jwt`" is a
 * sentence, not a statement. A keyword detector would fire on correct prose and would then be
 * "fixed" by narrowing it, which is the strip-list cheat wearing a different hat.
 *
 * TypeScript is distinguishable from this dialect by its PUNCTUATION: the dialect writes identifiers
 * in backticks, strings in curly quotes, and structure in guillemets and angle brackets. It never
 * needs a brace, a semicolon, an arrow, or a straight quote. So those are the tells, and each one is
 * a construct a reader would have to read as code. */
const CONSTRUCTS = [
  { kind: "payload-spill", re: /⟪lzw/g,
    why: "the machine index is on the reading surface" },
  { kind: "brace-block", re: /[{}]/g,
    why: "an object literal or a block body" },
  { kind: "arrow-fn", re: /=>/g,
    why: "an arrow function" },
  { kind: "call-paren", re: /[A-Za-z0-9_$]\(/g,
    why: "call scaffolding — `linksRouter.get(`" },
  { kind: "semicolon", re: /;/g,
    why: "a statement terminator" },
  { kind: "bracket", re: /[[\]]/g,
    why: "an array literal or an index" },
  { kind: "straight-quote-string", re: /'[^']*'|"[^"]*"/g,
    why: "a raw string literal (the dialect quotes with “ ”)" },
  { kind: "template-interp", re: /\$\{/g,
    why: "a template-literal interpolation" },
];

const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (p.endsWith(".en")) o.push(p);
  }
  return o;
};

const EN_DIR = path.join(CR.senDir(), "files");
if (!fs.existsSync(EN_DIR)) {
  console.error("REFUSING: no rendered .en at\n  " + EN_DIR + "\n  Run `npm run render` first.");
  process.exit(3);
}
const files = walk(EN_DIR);

/** strip(text) -> the reading surface, with the by-design-verbatim regions removed. */
function strip(text) {
  let out = text;
  for (const s of STRIP) out = out.replace(s.re, (m) => (s.guard && !s.guard(m) ? m : ""));
  return out;
}

/* ---- ASSERTION 1: NO TYPESCRIPT SURVIVES THE STRIP --------------------------------------------- */
const perFile = [];
const byKind = new Map();
let totalConstructs = 0, dirty = 0;

for (const abs of files) {
  const rel = path.relative(EN_DIR, abs);
  const surface = strip(fs.readFileSync(abs, "utf8"));
  let n = 0;
  const kinds = new Map();
  for (const c of CONSTRUCTS) {
    const hits = (surface.match(c.re) || []).length;
    if (!hits) continue;
    n += hits;
    kinds.set(c.kind, hits);
    byKind.set(c.kind, (byKind.get(c.kind) || 0) + hits);
  }
  totalConstructs += n;
  if (n > 0) { dirty++; perFile.push({ rel, n, kinds }); }
}
perFile.sort((a, b) => b.n - a.n);
const clean = files.length - dirty;

console.log("\n  THE GOAL — surviving TypeScript on the reading surface");
console.log("    strip list fingerprint ...... " + STRIP_FINGERPRINT + "   (frozen; a drop in the count"
  + " alongside a change here is not a real drop)");
console.log("    .en files read .............. " + files.length);
console.log("    FULLY CLEAN ................. " + clean);
console.log("    with residue ................ " + dirty);
console.log("    SURVIVING CONSTRUCTS ........ " + totalConstructs);
console.log("\n    by kind:");
for (const c of CONSTRUCTS) {
  const v = byKind.get(c.kind) || 0;
  console.log("      " + String(v).padStart(8) + "  " + c.kind.padEnd(24) + c.why);
}
console.log("\n    worst offenders:");
for (const f of perFile.slice(0, 10)) {
  console.log("      " + String(f.n).padStart(6) + "  " + f.rel);
  console.log("              " + [...f.kinds].map(([k, v]) => k + "=" + v).join("  "));
}

ok(totalConstructs === 0,
  "no TypeScript survives the frozen strip on any .en"
  + "  (got " + totalConstructs + " constructs across " + dirty + " of " + files.length + " files)");

/* THE NAMED FILE. Amir read this one and rejected the result on it, so it is asserted BY NAME and
 * not merely as one row in a corpus total. A corpus number can improve while the file a human
 * actually opened stays unreadable — that is precisely how tonight's report went wrong. */
const NAMED = "src/routers/links.ts.en";
const named = perFile.find((f) => f.rel === NAMED);
ok(!named, "the file Amir read is free of TypeScript: " + NAMED
  + (named ? "  (got " + named.n + " constructs: " + [...named.kinds].map(([k, v]) => k + "=" + v).join(" ") + ")" : ""));

/* ---- ASSERTION 2: THE FILE-LEVEL LABEL IS A CLAIM ABOUT THE FILE -------------------------------
 * Amir: it must be "a couple dozen words", a claim about the file, and NOT a concatenation of its
 * children. The concatenation defect is the same one already fixed at folder and program scale in
 * the other lane tonight; this is that fix one level down, and the check is the same shape. */
const MAX_LABEL_WORDS = 30;   /* "a couple dozen", with room — a bound, not a target */

const labels = [];
for (const abs of files) {
  const rel = path.relative(EN_DIR, abs);
  const text = fs.readFileSync(abs, "utf8");
  const m = text.match(/^«[▶▷]\s([\s\S]*?)\s[⟨⟪]/);
  if (!m) continue;                                  /* no top-level chunk: nothing to judge */
  const gloss = m[1];
  const words = gloss.split(/\s+/).filter(Boolean).length;
  /* concatenation: does the file label literally contain its first child's label? */
  const child = text.match(/[⟨⟪][\s\S]*?«[▶▷]\s([\s\S]*?)\s[⟨⟪]/);
  const childGloss = child ? child[1] : null;
  const concatenated = !!(childGloss && childGloss.length > 40 && gloss.includes(childGloss));
  labels.push({ rel, words, concatenated, gloss });
}
const tooLong = labels.filter((l) => l.words > MAX_LABEL_WORDS).sort((a, b) => b.words - a.words);
const concat = labels.filter((l) => l.concatenated);

console.log("\n  THE FILE-LEVEL LABEL (a claim about the file, <= " + MAX_LABEL_WORDS + " words, not a concatenation)");
console.log("    files with a top-level chunk  " + labels.length);
console.log("    label too long ............... " + tooLong.length);
console.log("    label is a concatenation ..... " + concat.length + "  <- contains its first child's label verbatim");
console.log("\n    longest labels:");
for (const l of tooLong.slice(0, 6)) {
  console.log("      " + String(l.words).padStart(5) + " words  " + l.rel);
  console.log("               " + l.gloss.slice(0, 110).replace(/\s+/g, " ") + " …");
}

ok(tooLong.length === 0, "every file-level label is a bounded claim about the file"
  + "  (got " + tooLong.length + " over " + MAX_LABEL_WORDS + " words, worst "
  + (tooLong[0] ? tooLong[0].words : 0) + ")");
ok(concat.length === 0, "no file-level label is a concatenation of its children"
  + "  (got " + concat.length + ")");

console.log("\n" + pass + " passed, " + fail + " failed");
