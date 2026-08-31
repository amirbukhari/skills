#!/usr/bin/env node
"use strict";
/**
 * measure-uncollapsed.js — the PRD §7 FROZEN CLASSIFIER, plus the §5A admission diagnosis.
 *
 * §7 defines "un-collapsed repeated structure" as a function/method body that
 *   (a) has a WIDE-axis canonical key recurring across the corpus with freq >= minCount (2),
 *  (a2) has placeholder density BELOW 1/2 -- of the N per-statement parts of that key, the number
 *       equal to the hole symbol must satisfy holes/N < 0.5,
 *   (b) is NOT covered by a generator span in that file's .en, and
 *   (c) is NOT claimed by an archetype slot.
 * The metric is the COUNT OF FILES containing >= 1 such body; membership is a pure function of the
 * canonical keys and the .en, so two engineers get the same answer.
 *
 * WHY (a2) EXISTS -- near-miss, 2026-08-31. The classifier originally had only (a), (b), (c). A body
 * whose every statement generalizes to a hole keys as "·<GAP>·", so ALL such bodies collide with each
 * other and every one of them scores freq >= 2. Two unrelated functions were being counted as
 * "repeated structure" on the strength of sharing no content whatsoever. That inflated the metric
 * ~3x: 126 files reported, 38 real. The number was about to be steered by, and it would have sent
 * someone hunting 102 files of nothing. Placeholder density is the decidable discriminator: a key
 * that is at least half holes carries too little evidence to assert recurrence.
 *
 * This script also answers the question the metric alone cannot: WHY is each unclaimed body
 * unclaimed? §5A admits a site only when fillOf(template, boundHoles) equals its original bytes,
 * so exactly one of three things is the limiter:
 *   MINER       no word of length >= 2 was mined for that key at all
 *   GATE        a word exists, but no candidate refilled byte-exact at this site
 *   ARBITRATION a byte-exact candidate existed and lost weighted-interval scheduling
 *
 * Read-only: walks the corpus and writes nothing to it.
 *   node measure-uncollapsed.js [--json out.json]
 */
const fs = require("fs"), path = require("path"), ts = require("typescript");
const G = require("./engine/generators");
const EL = require("./engine/enlzw");
const W = require("./engine/wordlzw");

const CORPUS = process.env.HYDRA_CORPUS || "/home/amir/Documents/Rentsync/delonix/hydra-source";
const MIN_COUNT = 2;
const SKIP = new Set(["node_modules", ".git", ".worktrees", "dist", "build", "coverage", "spec", "catalog", ".cache", "demo", "coined-demo"]);
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; };

const cat = EL.loadLzw(path.join(__dirname, "catalog", "generators-lzw.json"));
const files = walk(CORPUS).sort();

/* ---- body extraction: the §7 unit of measurement is the function/method body ---- */
function bodies(sf) {
  const out = [];
  const visit = (n) => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) ||
         ts.isFunctionExpression(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) ||
         ts.isSetAccessor(n)) && n.body && ts.isBlock(n.body) && n.body.statements.length)
      out.push(n.body);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/* WIDE-axis canonical key PARTS for a whole body (per statement; non-foldable -> hole). */
const { HOLE, MAX_HOLE_FRAC, holeFraction, passesDensity } = require("./engine/uncollapsed-density");
function keyParts(body, sf) {
  return [...body.statements].map((st) => {
    if (!G.isFoldable(st)) return HOLE;
    const p = G.generalStmtParts(st, sf, true);
    return p ? G.keyOf(p) : HOLE;
  });
}
const wideKey = (body, sf) => keyParts(body, sf).join(W.GAP);

let excludedByDensity = 0, excludedAllHole = 0;

/* ---- pass 1: corpus-wide WIDE-key frequency ---- */
const freq = new Map();
const parsed = [];
for (const f of files) {
  let src; try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
  const sf = ts.createSourceFile(path.basename(f), src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bs = bodies(sf).map((b) => { const kp = keyParts(b, sf); return { b, kp, key: kp.join(W.GAP), start: b.getStart(sf), end: b.getEnd() }; });
  for (const x of bs) if (x.b.statements.length >= 2) freq.set(x.key, (freq.get(x.key) || 0) + 1);
  parsed.push({ f, src, sf, bs });
}

/* ---- pass 2 + 3: coverage and, where uncovered, the admission diagnosis ---- */
let filesWith = 0, bodiesUnclaimed = 0;
const bucket = { MINER: 0, GATE: 0, ARBITRATION: 0 };
const perFile = [];

for (const { f, src, sf, bs } of parsed) {
  let spans; try { spans = EL.genSpans(sf, src, cat); } catch { spans = []; }
  const covered = (s, e) => spans.some((g) => s < g.end && e > g.start);
  const hits = [];
  for (const x of bs) {
    if (x.b.statements.length < 2) continue;
    if ((freq.get(x.key) || 0) < MIN_COUNT) continue;   // not repeated -> not in scope
    if (covered(x.start, x.end)) continue;              // already collapsed
    if (!passesDensity(x.kp)) {                         // §7(a2): key too sparse to assert recurrence
      excludedByDensity++;                              // counted AFTER (b) so it is comparable to the metric
      if (holeFraction(x.kp) === 1) excludedAllHole++;
      continue;
    }
    // ---- why not? replay §5A admission over this body's runs ----
    let sawWord = false, sawByteExact = false;
    const stmts = [...x.b.statements];
    let i = 0;
    while (i < stmts.length) {
      if (!G.isFoldable(stmts[i])) { i++; continue; }
      let j = i; while (j < stmts.length && G.isFoldable(stmts[j])) j++;
      const run = stmts.slice(i, j);
      const nsym = run.map((st) => { const p = G.generalStmtParts(st, sf, false); return p ? G.keyOf(p) : null; });
      const wsym = run.map((st) => { const p = G.generalStmtParts(st, sf, true); return p ? G.keyOf(p) : null; });
      for (let p = 0; p < run.length; p++) {
        for (const [axis, syms, wide] of [[cat.narrow, nsym, false], [cat.wide, wsym, true]]) {
          if (syms[p] == null) continue;
          for (const w of EL.wordsAt(axis, syms, p)) {
            if (w.len < 2) continue;
            const win = run.slice(p, p + w.len);
            if (win.length < w.len) continue;
            if (win.filter(EL.isUnit).length >= 2) continue;
            sawWord = true;
            const s = win[0].getStart(sf), e = win[win.length - 1].getEnd();
            let wp; try { wp = G.windowParts(win, sf, wide); } catch { wp = null; }
            if (wp && wp.fill === src.slice(s, e)) sawByteExact = true;
          }
        }
      }
      i = j;
    }
    const why = !sawWord ? "MINER" : !sawByteExact ? "GATE" : "ARBITRATION";
    bucket[why]++; bodiesUnclaimed++;
    hits.push({ line: sf.getLineAndCharacterOfPosition(x.start).line + 1, stmts: x.b.statements.length, freq: freq.get(x.key), why });
  }
  if (hits.length) { filesWith++; perFile.push({ rel: path.relative(CORPUS, f), bodies: hits.length, hits }); }
}

const out = {
  schema: "sdd-repo-dsl/uncollapsed/2", corpus: CORPUS, measuredAt: new Date().toISOString(),
  minCount: MIN_COUNT, totalFiles: parsed.length,
  filesWithUncollapsedRepeatedStructure: filesWith, bodiesUnclaimed, buckets: bucket,
  maxHoleFraction: MAX_HOLE_FRAC,
  excludedByPlaceholderDensity: excludedByDensity, excludedAllPlaceholder: excludedAllHole,
  note: "archetype-claim exclusion (§7c) is a no-op: the live path loads no archetype catalog, so no body is archetype-claimed.",
  worstFiles: perFile.sort((a, b) => b.bodies - a.bodies).slice(0, 15).map((x) => ({ rel: x.rel, bodies: x.bodies })),
};
const ji = process.argv.indexOf("--json");
if (ji >= 0 && process.argv[ji + 1]) { fs.mkdirSync(path.dirname(process.argv[ji + 1]), { recursive: true }); fs.writeFileSync(process.argv[ji + 1], JSON.stringify({ ...out, perFile }, null, 2)); }
console.log(`corpus ${CORPUS}`);
console.log(`files ......................... ${out.totalFiles}`);
console.log(`FILES with un-collapsed repeated structure (§7 metric) ... ${filesWith}`);
console.log(`bodies unclaimed .............. ${bodiesUnclaimed}`);
console.log(`bodies excluded by §7(a2) density (holes/N >= ${MAX_HOLE_FRAC}) ... ${excludedByDensity}  (of which all-placeholder: ${excludedAllHole})`);
console.log(`  MINER       (no word mined, len>=2) ....... ${bucket.MINER}`);
console.log(`  GATE        (word exists, no byte-exact fill) ${bucket.GATE}`);
console.log(`  ARBITRATION (byte-exact lost scheduling) ... ${bucket.ARBITRATION}`);
console.log(`\nworst files:`); for (const w of out.worstFiles.slice(0, 8)) console.log(`  ${String(w.bodies).padStart(3)}  ${w.rel}`);
