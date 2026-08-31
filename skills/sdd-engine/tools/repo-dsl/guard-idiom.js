"use strict";
// READ-ONLY: analyze the fetch(G1) / assert(G2) / G1->G2 guard idiom canonicalization.
const fs = require("fs"), path = require("path");
const { tokenize } = require("./engine/fanout");
const corpus = "/home/amir/Documents/Rentsync/delonix/hydra-calculators/calculators";
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
const files = walk(corpus).sort();
const perFile = files.map((f) => ({ rel: path.relative(corpus, f), tokens: tokenize(f, fs.readFileSync(f, "utf8")).tokens }));

// global shape frequency (grain 0)
const freq = new Map();
for (const pf of perFile) for (const t of pf.tokens) freq.set(t.shape, (freq.get(t.shape) || 0) + 1);

function collect(pred) {
  const byShape = new Map();
  for (const pf of perFile) for (let i = 0; i < pf.tokens.length; i++) {
    const t = pf.tokens[i];
    if (!pred(t)) continue;
    if (!byShape.has(t.shape)) byShape.set(t.shape, []);
    byShape.get(t.shape).push({ rel: pf.rel, line: t.line, text: t.text.split("\n")[0].slice(0, 88) });
  }
  return [...byShape.entries()].map(([shape, sites]) => ({ shape, sites, freq: freq.get(shape) })).sort((a, b) => b.sites.length - a.sites.length);
}

const G2 = collect((t) => /^IfKeyword OpenParenToken ExclamationToken/.test(t.shape));
const G1 = collect((t) => /^ConstKeyword ID (ColonToken .*)?EqualsToken/.test(t.shape) && /(filter|find|where)/i.test(t.text) && /DotToken ID OpenParenToken/.test(t.shape));

console.log("=== G2  assert-exists  `if (!…) …`  — grouped by canonical shape ===");
console.log(`distinct shapes: ${G2.length}, total sites: ${G2.reduce((a, g) => a + g.sites.length, 0)}`);
for (const g of G2) {
  console.log(`\n[${g.sites.length} sites, global-freq ${g.freq}, MINED=${g.freq >= 2}]`);
  console.log(`  shape: ${g.shape.slice(0, 120)}`);
  for (const s of g.sites.slice(0, 3)) console.log(`   ${s.rel}:${s.line}  | ${s.text}`);
}

console.log("\n\n=== G1  fetch  `const x = …(filter|find|where)(…)`  — grouped by canonical shape ===");
console.log(`distinct shapes: ${G1.length}, total sites: ${G1.reduce((a, g) => a + g.sites.length, 0)}`);
for (const g of G1.slice(0, 8)) {
  console.log(`\n[${g.sites.length} sites, global-freq ${g.freq}, MINED=${g.freq >= 2}]`);
  console.log(`  shape: ${g.shape.slice(0, 130)}`);
  for (const s of g.sites.slice(0, 3)) console.log(`   ${s.rel}:${s.line}  | ${s.text}`);
}

// G1 -> G2 composite: a G1 statement immediately followed (next non-gap token) by a G2 head
console.log("\n\n=== G1 -> G2 composed (fetch immediately followed by assert) ===");
let composed = 0; const comps = [];
for (const pf of perFile) for (let i = 0; i < pf.tokens.length - 1; i++) {
  const a = pf.tokens[i], b = pf.tokens[i + 1];
  const isG1 = /^ConstKeyword ID (ColonToken .*)?EqualsToken/.test(a.shape) && /(filter|find|where)/i.test(a.text);
  const isG2 = /^IfKeyword OpenParenToken ExclamationToken/.test(b.shape);
  if (isG1 && isG2) { composed++; comps.push({ rel: pf.rel, line: a.line, pairShape: a.shape + " ⟿ " + b.shape, a: a.text.split("\n")[0].slice(0, 70), b: b.text.split("\n")[0].slice(0, 60) }); }
}
console.log(`composed sites: ${composed}`);
const pairFreq = new Map();
for (const c of comps) pairFreq.set(c.pairShape, (pairFreq.get(c.pairShape) || 0) + 1);
for (const c of comps.slice(0, 10)) console.log(`  ${c.rel}:${c.line}  pairFreq=${pairFreq.get(c.pairShape)}  MINED=${pairFreq.get(c.pairShape) >= 2}\n     G1| ${c.a}\n     G2| ${c.b}`);
