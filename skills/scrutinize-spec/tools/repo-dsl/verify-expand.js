#!/usr/bin/env node
"use strict";
/**
 * verify-expand — the PER-MODULE gate (the corpus-wide verify/gate look at the
 * whole directory; this looks at one module).
 *
 * Expand a single `.calc` (or composition `.json`) and byte-diff its output
 * against the module's target file — either an explicit `--against <file>` or,
 * by default, the module's generated file (`generated/<module>.ts`) next to the
 * spec. Returns machine JSON the panel renders as a true per-module verdict:
 *
 *   { schema, pass, module, target, byteIdentical, coveragePct,
 *     residueClasses: { A, B, C, D }, min, residue: [ {class, line, text} ] }
 *
 * COVERAGE here is line-exact reproduction of the target: a target line counts
 * as reproduced iff the expansion emits that exact line (multiset match). Every
 * unreproduced target line is classified with the SAME residue legend the
 * corpus engine uses, so a per-module verdict reads the same way as the rollup:
 *   A non-recurring/bespoke · B free-text (backtick/SQL) · C comment/trivia · D formatting
 * The `// 15;` editorial annotation on the real Hydra source is class C.
 *
 * `pass` = coveragePct >= min (default 100 — exact). byteIdentical is reported
 * independently, so the panel can show "exact" vs "exact-modulo-trivia" honestly.
 */

const fs = require("fs");
const path = require("path");
const { expand } = require("./expander");

const RES_LEGEND = { A: "non-recurring/bespoke", B: "free-text slot", C: "comment/trivia", D: "formatting variance" };

/** Strip a trailing line comment (`… // x`) not inside a string; returns rstripped code part. */
function stripTrailingComment(line) {
  let inStr = null;
  for (let i = 0; i < line.length - 1; i++) {
    const ch = line[i];
    if (inStr) { if (ch === "\\") i++; else if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "/" && line[i + 1] === "/") return line.slice(0, i).replace(/\s+$/, "");
  }
  return line;
}

function classifyResidueLine(line, producedCounts) {
  const t = line.trim();
  if (t === "") return null; // blank line: neutral, not residue
  // C: a whole-line comment, or a produced line with an editorial trailing comment.
  if (/^(\/\/|\/\*|\*|\*\/)/.test(t)) return "C";
  const stripped = stripTrailingComment(line);
  if (stripped !== line && (producedCounts.get(stripped) || 0) > 0) return "C";
  // B: free text — a backtick template or embedded SQL (TypeORM andWhere, etc.).
  if (line.includes("`") || /\bandWhere\(/.test(line)) return "B";
  // D: matches a produced line modulo all whitespace.
  const squash = (s) => s.replace(/\s+/g, "");
  for (const p of producedCounts.keys()) if (squash(p) === squash(line)) return "D";
  return "A";
}

/** Diff expansion vs target by lines; return coverage + residue classes. */
function diff(produced, target) {
  const pLines = produced.split("\n");
  const tLines = target.split("\n");
  const producedCounts = new Map();
  for (const l of pLines) producedCounts.set(l, (producedCounts.get(l) || 0) + 1);

  let reproChars = 0, totalChars = 0;
  const residueClasses = { A: 0, B: 0, C: 0, D: 0 };
  const residue = [];
  tLines.forEach((line, i) => {
    totalChars += line.length;
    if ((producedCounts.get(line) || 0) > 0) { producedCounts.set(line, producedCounts.get(line) - 1); reproChars += line.length; return; }
    const cls = classifyResidueLine(line, producedCounts);
    if (cls == null) return; // neutral blank
    residueClasses[cls] += line.length;
    if (residue.length < 40) residue.push({ class: cls, line: i + 1, text: line.slice(0, 120) });
  });
  const coveragePct = totalChars ? +(100 * reproChars / totalChars).toFixed(1) : 100;
  return { coveragePct, residueClasses, residue };
}

/** The module name for a calc: its basename, or — for a `composition.calc` under
 *  spec/modules/<m>/ — the enclosing module directory name. */
function moduleOf(calcPath) {
  const base = path.basename(calcPath).replace(/\.(calc|json)$/, "");
  if (base === "composition") {
    const dir = path.dirname(path.resolve(calcPath));
    if (/\/spec\/modules\/[^/]+$/.test(dir)) return path.basename(dir);
  }
  return base;
}

/** Resolve the target file for a calc: explicit --against, else generated/<module>.ts. */
function resolveTarget(calcPath, against) {
  if (against) return path.resolve(process.cwd(), against);
  const module = moduleOf(calcPath);
  // spec/modules/<m>/composition.calc -> <root>/generated/<m>.ts
  const dir = path.dirname(path.resolve(calcPath));
  const candidates = [];
  const m = /(.*)\/spec\/modules\/[^/]+$/.exec(dir);
  if (m) candidates.push(path.join(m[1], "generated", `${module}.ts`));
  candidates.push(path.join(dir, "generated", `${module}.ts`));
  candidates.push(path.join(dir, `${module}.ts`));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function verifyExpand(calcPath, opts = {}) {
  const min = opts.min == null ? 100 : +opts.min;
  const module = moduleOf(calcPath);
  const target = resolveTarget(calcPath, opts.against);
  if (!target || !fs.existsSync(target)) {
    return { schema: "sdd-repo-dsl/verify-expand/1", pass: false, module, target: target || null,
      error: "no target file (pass --against <file> or add generated/<module>.ts)", byteIdentical: false,
      coveragePct: 0, residueClasses: { A: 0, B: 0, C: 0, D: 0 }, min, residue: [] };
  }
  let tree;
  if (calcPath.endsWith(".json")) tree = JSON.parse(fs.readFileSync(calcPath, "utf8"));
  else tree = require("./dsl").parseText(fs.readFileSync(calcPath, "utf8"));
  const produced = expand(tree);
  const targetText = fs.readFileSync(target, "utf8");
  const byteIdentical = produced === targetText;
  const { coveragePct, residueClasses, residue } = diff(produced, targetText);
  const pass = coveragePct >= min;
  return {
    schema: "sdd-repo-dsl/verify-expand/1", pass, module,
    target: path.relative(process.cwd(), target), byteIdentical, coveragePct,
    residueClasses, residueLegend: RES_LEGEND, min, residue,
  };
}

function main() {
  const args = process.argv.slice(2);
  const calc = args.find((a) => !a.startsWith("--"));
  const gi = args.indexOf("--against");
  const mi = args.indexOf("--min");
  if (!calc) { console.error("usage: verify-expand.js <file.calc> [--against <file>] [--min <pct>]"); process.exit(1); }
  const out = verifyExpand(calc, { against: gi >= 0 ? args[gi + 1] : null, min: mi >= 0 ? args[mi + 1] : 100 });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.pass ? 0 : 1);
}

if (require.main === module) main();
module.exports = { verifyExpand, RES_LEGEND };
