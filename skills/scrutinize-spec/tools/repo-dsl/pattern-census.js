"use strict";
/**
 * READ-ONLY missed-pattern / line-level investigation over the (comment-free)
 * delonix corpus. Emits: recurring-line distribution, captured-vs-missed with
 * exact reasons, char share of recurring lines, near-miss alignment families,
 * and the binding/de-Bruijn check. No writes.
 */
const fs = require("fs");
const path = require("path");
const { tokenize, fill } = require("./engine/fanout");
const { slotsAreTyped } = require("./lib/skeleton");

const corpus = "/home/amir/Documents/Rentsync/delonix/hydra-calculators/calculators";
const MIN = 2;
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
const files = walk(corpus).sort();
const perFile = files.map((f) => ({ rel: path.relative(corpus, f), source: fs.readFileSync(f, "utf8"), tokens: tokenize(f, fs.readFileSync(f, "utf8")).tokens }));

// ---- per-shape stats at grain 0 (whole statement = "line") ----
const stat = new Map(); // shape -> {count, files:Set, chars, ex:{rel,line,text}}
let totalChars = 0;
for (const pf of perFile) {
  totalChars += pf.source.length;
  for (const t of pf.tokens) {
    if (!stat.has(t.shape)) stat.set(t.shape, { count: 0, files: new Set(), chars: 0, ex: { rel: pf.rel, line: t.line, text: t.text.split("\n")[0].slice(0, 100) } });
    const s = stat.get(t.shape);
    s.count++; s.files.add(pf.rel); s.chars += t.text.length;
  }
}
const shapes = [...stat.entries()].map(([shape, s]) => ({ shape, ...s, fileSpread: s.files.size }));

// ---- (1) recurring lines: distinct shapes in >=2 files ----
const recurringByFile = shapes.filter((s) => s.fileSpread >= 2).sort((a, b) => b.fileSpread - a.fileSpread || b.count - a.count);
console.log(`corpus: ${files.length} files, ${totalChars} chars, ${shapes.length} distinct statement-shapes`);
console.log(`\n(1) DISTINCT CANONICAL LINES RECURRING IN >=2 FILES: ${recurringByFile.length}`);
console.log(`    (recurring in >=2 OCCURRENCES anywhere: ${shapes.filter((s) => s.count >= MIN).length})`);
console.log("\nTOP 20 most-repeated lines (fileSpread = #files, cnt = #occurrences):");
console.log("files  cnt  chars   example (file:line)  ->  line");
for (const s of recurringByFile.slice(0, 20)) {
  console.log(`${String(s.fileSpread).padStart(4)}  ${String(s.count).padStart(4)}  ${String(s.chars).padStart(5)}   ${s.ex.rel}:${s.ex.line}  ->  ${s.ex.text}`);
}

// ---- (2)/(3) captured vs missed + char share ----
// A shape with count>=MIN is a MINED WORD (leaf). Each token instance is COVERED iff
// recurs && slotsAreTyped && canonical-template refills exactly. Canonical = plurality template.
const tmplVote = new Map();
for (const pf of perFile) for (const t of pf.tokens) {
  if (!tmplVote.has(t.shape)) tmplVote.set(t.shape, new Map());
  const m = tmplVote.get(t.shape); const k = JSON.stringify(t.templateParts);
  m.set(k, (m.get(k) || { parts: t.templateParts, c: 0 })); m.get(k).c++;
}
const canonical = new Map();
for (const [sh, m] of tmplVote) { let best = null; for (const v of m.values()) if (!best || v.c > best.c) best = v; canonical.set(sh, best.parts); }

let charsRecurringLines = 0, charsCoveredOfThose = 0, charsBuriedTypedUncoverable = 0, charsUnique = 0;
let instRecurring = 0, instCoveredInst = 0, instTypedFail = 0, instTmplFail = 0;
for (const pf of perFile) for (const t of pf.tokens) {
  const s = stat.get(t.shape);
  const recurs = s.count >= MIN;
  if (!recurs) { charsUnique += t.text.length; continue; }
  charsRecurringLines += t.text.length; instRecurring++;
  const typed = slotsAreTyped(t.slots);
  const tmplOk = fill(canonical.get(t.shape), t.slots) === t.text;
  if (typed && tmplOk) { charsCoveredOfThose += t.text.length; instCoveredInst++; }
  else { charsBuriedTypedUncoverable += t.text.length; if (!typed) instTypedFail++; else instTmplFail++; }
}
const pct = (n) => (100 * n / totalChars).toFixed(1) + "%";
console.log(`\n(2)/(3) CHAR SHARE of recurring-line shapes (count>=${MIN}) vs unique:`);
console.log(`  recurring-line shapes (MINED as words):  ${charsRecurringLines} chars = ${pct(charsRecurringLines)} of corpus`);
console.log(`     ...of which REPRODUCED (covered):     ${charsCoveredOfThose} chars = ${pct(charsCoveredOfThose)}`);
console.log(`     ...recurs but instance not covered:  ${charsBuriedTypedUncoverable} chars = ${pct(charsBuriedTypedUncoverable)}  (typed-fail ${instTypedFail} inst, tmpl-variance ${instTmplFail} inst)`);
console.log(`  UNIQUE (freq-1) shapes = NOT mined:      ${charsUnique} chars = ${pct(charsUnique)}  <- the bespoke-body seam`);
console.log(`  instances: ${instRecurring} in recurring shapes, ${instCoveredInst} reproduced`);

// ---- (4) verbatim top recurring lines with capture status ----
console.log(`\n(4) TOP RECURRING LINES VERBATIM (all are count>=2 => MINED words):`);
for (const s of recurringByFile.slice(0, 8)) {
  const anyTyped = (() => { for (const pf of perFile) for (const t of pf.tokens) if (t.shape === s.shape) return slotsAreTyped(t.slots); })();
  console.log(`\n  [${s.fileSpread} files, ${s.count}x]  MINED-WORD=yes  typed-slots=${anyTyped}`);
  console.log(`    ${s.ex.rel}:${s.ex.line}`);
  console.log(`    | ${s.ex.text}`);
}

// ---- near-miss alignment families (mode b): freq-1 shapes that share a coarse signature ----
// coarse signature = shape with consecutive ID/NUM/STR collapsed and arg-list length ignored
const coarse = (sh) => sh.replace(/\b(ID|NUM|STR|BOOL|TYPE|NULLC)\b/g, "V").replace(/(V )+V/g, "V+").replace(/(CommaToken V\+?)+/g, "ARGS");
const byCoarse = new Map();
for (const s of shapes) { const c = coarse(s.shape); if (!byCoarse.has(c)) byCoarse.set(c, []); byCoarse.get(c).push(s); }
const nearMiss = [...byCoarse.values()].filter((g) => g.length >= 2 && g.every((s) => s.count < 4) && g.reduce((a, s) => a + s.fileSpread, 0) >= 3)
  .sort((a, b) => b.reduce((x, s) => x + s.chars, 0) - a.reduce((x, s) => x + s.chars, 0));
console.log(`\n(b) NEAR-MISS ALIGNMENT FAMILIES: ${nearMiss.length} coarse-signature groups where structurally-similar statements split into distinct low-freq shapes`);
for (const g of nearMiss.slice(0, 4)) {
  console.log(`\n  family (coarse sig shared by ${g.length} variant shapes, combined ${g.reduce((a, s) => a + s.chars, 0)} chars):`);
  for (const s of g.slice(0, 3)) console.log(`    [${s.count}x, ${s.fileSpread}f] ${s.ex.rel}:${s.ex.line}  | ${s.ex.text}`);
}
