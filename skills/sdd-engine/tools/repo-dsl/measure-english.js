"use strict";
/**
 * measure-english.js — THE SCOREBOARD. Two frozen metrics over the emitted .en, plus the byte
 * accounting they are read against. One command, every number computed, none judged by eye.
 *
 *   (i)  VACUOUS CLAUSES  — count of emitted clauses in the frozen contentless set. Target ZERO.
 *   (ii) ENGLISH-COMPLETE — share of clauses with no TypeScript left after removing `identifiers`
 *        and “literals”, which are deliberately verbatim (PRD §3).
 *
 * THE TWO CEILINGS this reports against (measured, not projected):
 *   sentence level ~100%  — every in-span statement can carry a site-specific clause
 *   byte level      33.8% — skeleton 8.4% + gap 4.5% + word-like holes 20.9%; 40.2% optimistic
 *                           if long-but-structureless holes count as readable.
 * 39.7% of the corpus is code-bearing hole interiors. That is NOT a gap to close: a hole holding a
 * 40-line arrow function with its own guards and returns is a program, not connective tissue with
 * a noun missing. Reporting it as a shortfall would be dishonest.
 *
 * Label-region only. compileChunk never reads a label, so nothing here can move a byte.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./engine/enfile");
const EL = require("./engine/enlzw");
const Q = require("./engine/clause-quality");
const ARCH = require("./engine/archetypes");
const CR = require("./engine/corpus-root");

const CORPUS = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root: the .ts tree
const SKIP = new Set(["node_modules", ".git", ".worktrees", "dist", "build", "coverage", "sen", "spec", "catalog", ".cache", "demo", "coined-demo"]);
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; };
const B = (s) => Buffer.byteLength(s);
const LABEL = /«▶ ([\s\S]*?) ⟪/g;
/* word-like: one line and short enough to read as a noun inside a sentence. Per-SITE, not
 * per-hole-type — the same type is a comma list at one site and an inline arrow function at the
 * next, so a per-type policy would be wrong (measured: `args` is 2.8% word-like, 13.0% code). */
const wordLike = (v) => !/\n/.test(v) && B(v) <= 40;
const codeBearing = (v) => /=>|\bfunction\b|\breturn\b|\bif\b|\bawait\b/.test(v) || (/\n/.test(v) && /[{[]/.test(v));

/* Per-ARCHETYPE reading, because the direct comparison is against a hand-authored entity grammar.
 * "panel-quality" is decidable, not a judgement: the file's bytes sit inside a span whose label is
 * English-complete and carries no vacuous clause. */
const archB = {}, archPanel = {}, archN = {};
const idx = EN.loadIndex(CORPUS);
const cat = idx._lzw;
let ok = 0, bad = 0;
let corpus = 0, span = 0, skel = 0, gap = 0, word = 0, longSimple = 0, code = 0;
let clauses = 0, vacuous = 0, complete = 0;
const vacBy = {}, incompleteEx = [];

for (const f of walk(SRC).sort()) {
  const src = fs.readFileSync(f, "utf8"); corpus += B(src);
  let en; try { en = EN.renderFileEn(src, idx).en; } catch (_) { bad++; continue; }
  let back; try { back = EN.compileFileEn(en, idx); } catch (_) { bad++; continue; }
  if (back === src) ok++; else bad++;

  let m; LABEL.lastIndex = 0;
  while ((m = LABEL.exec(en))) {
    for (const c of Q.clausesOf(m[1])) {
      clauses++;
      if (Q.isVacuous(c)) { vacuous++; vacBy[c] = (vacBy[c] || 0) + 1; }
      if (Q.isEnglishComplete(c)) complete++;
      else if (incompleteEx.length < 5) incompleteEx.push(c.slice(0, 100));
    }
  }

  let akind = "(unclassified)";
  try { akind = ARCH.classifyFile(ARCH.analyzeFile(path.relative(SRC, f), src)); } catch (_) { /* keep default */ }
  archB[akind] = (archB[akind] || 0) + B(src);
  archN[akind] = (archN[akind] || 0) + 1;

  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let spans = []; try { spans = EL.genSpans(sf, src, cat); } catch (_) { /* none */ }
  {
    let m2; const RX = /«▶ ([\s\S]*?) ⟪/g; const labels = [];
    while ((m2 = RX.exec(en))) labels.push(m2[1]);
    let good = 0, li = 0;
    for (const s of spans) {
      const lab = labels[li++];
      if (lab == null) continue;
      const cs = Q.clausesOf(lab);
      if (cs.length && cs.every((c) => Q.isEnglishComplete(c) && !Q.isVacuous(c))) good += B(src.slice(s.start, s.end));
    }
    archPanel[akind] = (archPanel[akind] || 0) + good;
  }
  for (const s of spans) {
    span += B(src.slice(s.start, s.end));
    const axis = s.payload.a === "n" ? cat.narrow : cat.wide;
    let key; try { key = EL.expandKey(axis, s.payload.w); } catch (_) { continue; }
    skel += B(key.replace(/‹\w+›/g, ""));
    const marks = key.match(/‹\w+›/g) || [], h = s.payload.h || [];
    marks.forEach((mk, i) => {
      const t = mk.slice(1, -1), v = h[i] == null ? "" : h[i];
      if (t === "gap") { gap += B(v); return; }
      if (wordLike(v)) { word += B(v); return; }
      if (codeBearing(v)) code += B(v); else longSimple += B(v);
    });
  }
}

const pc = (x, y) => (100 * x / (y || corpus)).toFixed(1) + "%";
console.log("byte-identity ................ " + ok + "/" + (ok + bad) + (bad ? "   *** FLOOR BREACHED ***" : ""));
console.log("\n(i)  VACUOUS CLAUSES (frozen set, target 0)");
console.log("     " + vacuous + " of " + clauses + " emitted clauses   " + pc(vacuous, clauses));
Object.entries(vacBy).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log("       " + String(v).padStart(5) + "  " + k));
console.log("\n(ii) ENGLISH-COMPLETE (no TypeScript left outside `ids` and “literals”)");
console.log("     " + complete + " of " + clauses + " clauses   " + pc(complete, clauses));
if (incompleteEx.length) { console.log("     not complete, e.g.:"); incompleteEx.forEach((e) => console.log("       " + e)); }
console.log("\nBYTE ACCOUNTING against the ceiling (corpus " + corpus + ")");
console.log("  residue, no span ........... " + pc(corpus - span));
console.log("  skeleton -> English ........ " + pc(skel));
console.log("  gap (whitespace/comments) .. " + pc(gap));
console.log("  word-like holes (verbatim) . " + pc(word));
console.log("  long but structureless ..... " + pc(longSimple));
console.log("  CODE-BEARING (code by nature)" + pc(code));
console.log("\nPANEL-QUALITY READING by archetype (bytes inside spans whose every clause is");
console.log("English-complete and non-vacuous). GENERATIVE archetypes marked * have a hand-authored");
console.log("grammar in engine/archetypes.js that this path deliberately does NOT consume.");
Object.keys(archB).sort((a, b) => archB[b] - archB[a]).forEach((k) => {
  const star = ARCH.GENERATIVE.includes(k) ? " *" : "  ";
  console.log("  " + star + " " + k.padEnd(20) + String(archN[k]).padStart(4) + " files  "
    + (100 * archB[k] / corpus).toFixed(1).padStart(5) + "% of corpus  "
    + (100 * (archPanel[k] || 0) / archB[k]).toFixed(1).padStart(5) + "% of their bytes read as English");
});
console.log("\n  --> reads as English ....... " + pc(skel + gap + word) + "   ceiling 33.8%  (optimistic " + pc(skel + gap + word + longSimple) + " / 40.2%)");
