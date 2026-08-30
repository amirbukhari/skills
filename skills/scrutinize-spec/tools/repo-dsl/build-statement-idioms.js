"use strict";
/**
 * build-statement-idioms — run the statement-idiom miner over the whole
 * hydra-source corpus and persist the discovered idiom catalog + the honest
 * coverage/ceiling math. Deterministic, zero model calls. Read-only on source;
 * writes ONLY catalog/statement-idioms.json under the project.
 *
 *   node build-statement-idioms.js [--min-sites 5]
 */
const fs = require("fs");
const path = require("path");
const { tokenize, fill } = require("./engine/fanout.js");
const { slotsAreTyped } = require("./lib/skeleton.js");
const { mineStatementIdioms, coverageByIdioms } = require("./engine/mine-statement-idioms.js");

const PROJECT = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const minSites = (() => { const i = process.argv.indexOf("--min-sites"); return i >= 0 ? parseInt(process.argv[i + 1], 10) : 5; })();

function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
const files = walk(PROJECT).sort().map((f) => ({ rel: path.relative(PROJECT, f), source: fs.readFileSync(f, "utf8") }));
const totalChars = files.reduce((a, f) => a + f.source.length, 0);

console.log(`corpus: ${files.length} files, ${totalChars} chars`);

/* ---- 1. discover the idiom vocabulary (cut0 whole statements) ---- */
const { idioms, census, perFile, stat } = mineStatementIdioms(files, { minSites, minFiles: 2 });
const cov0 = coverageByIdioms(perFile, stat, totalChars, 2);
console.log(`\nIDIOM VOCABULARY (cut0, sites>=${minSites}, files>=2, meaningful):`);
console.log(`  ${idioms.length} idioms | ${census.promotedSites} sites | ${(100*census.promotedSites/census.totalStatementTokens).toFixed(1)}% of statements | ${(100*census.promotedChars/totalChars).toFixed(1)}% of corpus chars`);
console.log(`  byte-verify: ${census.byteVerified}/${census.byteChecked} promoted sites refill exactly`);

/* ---- 2. honest CUT3 coverage lift (the headline grain, comparable to 46.1%) ---- */
function cut3Coverage() {
  const shapeCount = new Map(); const per = [];
  for (const f of files) { let t; try { t = tokenize(f.rel, f.source, undefined, 3).tokens; } catch (e) { per.push([]); continue; } per.push(t); for (const x of t) shapeCount.set(x.shape, (shapeCount.get(x.shape) || 0) + 1); }
  const votes = new Map();
  for (const toks of per) for (const t of toks) { if (!votes.has(t.shape)) votes.set(t.shape, new Map()); const m = votes.get(t.shape); const k = JSON.stringify(t.templateParts); m.set(k, (m.get(k) || { p: t.templateParts, c: 0 })); m.get(k).c++; }
  const canon = new Map(); for (const [sh, m] of votes) { let b = null; for (const v of m.values()) if (!b || v.c > b.c) b = v; canon.set(sh, b.p); }
  let strict = 0, persite = 0, named = 0;
  for (const toks of per) for (const t of toks) { if ((shapeCount.get(t.shape) || 0) < 2) continue; named += t.text.length; if (slotsAreTyped(t.slots)) { persite += t.text.length; if (fill(canon.get(t.shape), t.slots) === t.text) strict += t.text.length; } }
  const pct = (n) => +(100 * n / totalChars).toFixed(1);
  return { strictPct: pct(strict), persitePct: pct(persite), namedPct: pct(named), distinctShapes: shapeCount.size };
}
const c3 = cut3Coverage();
console.log(`\nCUT3 COVERAGE (byte-exact policies):`);
console.log(`  strict (recurs+typed+canonical, the old 46.1 rule): ${c3.strictPct}%`);
console.log(`  +per-site template (recover class D):               ${c3.persitePct}%`);
console.log(`  +named free-text-slot idioms (recover class B):     ${c3.namedPct}%   <- idiom-inclusive headline`);

/* ---- 3. ceiling evidence: recurrence saturates with depth ---- */
function recurringShare(cutDepth) {
  const sc = new Map(); const chars = new Map(); let tc = 0;
  for (const f of files) { let t; try { t = tokenize(f.rel, f.source, undefined, cutDepth).tokens; } catch (e) { continue; } for (const x of t) { tc += x.text.length; sc.set(x.shape, (sc.get(x.shape) || 0) + 1); chars.set(x.shape, (chars.get(x.shape) || 0) + x.text.length); } }
  let rec = 0; for (const [sh, c] of sc) if (c >= 2) rec += chars.get(sh);
  return { cutDepth, shapes: sc.size, recurringPctOfTokens: +(100 * rec / tc).toFixed(1) };
}
const curve = [0, 3, 4, 5, 6].map(recurringShare);
console.log(`\nCEILING CURVE (recurring-shape char share vs cut depth):`);
for (const p of curve) console.log(`  cut${p.cutDepth}: ${p.shapes} shapes, recurring ${p.recurringPctOfTokens}% of token-chars`);

/* ---- 4. persist the catalog ---- */
const byCategory = {};
for (const i of idioms) byCategory[i.category] = (byCategory[i.category] || 0) + 1;
const catalog = {
  schema: "sdd-repo-dsl/statement-idioms/1",
  corpus: PROJECT, generatedBy: "deterministic: mineStatementIdioms (no model calls)", modelCalls: 0,
  minSites, minFiles: 2, grain: "cut0 (whole statement)",
  byteIdentityGate: `${census.byteVerified}/${census.byteChecked} promoted idiom sites refill fill(template,slots)===source`,
  census: { ...census },
  categoryCounts: byCategory,
  coverage: {
    corpusChars: totalChars,
    idiomVocabularyGrain: "cut0",
    idiomStatementsPct: +(100 * census.promotedSites / census.totalStatementTokens).toFixed(1),
    idiomCharsPct: +(100 * census.promotedChars / totalChars).toFixed(1),
    cut3: c3,
    ceilingCurve: curve,
    ceilingPct: Math.max(...curve.map((c) => c.recurringPctOfTokens)),
    ceilingNote: "Absolute upper bound for pattern coverage = the recurring-shape char share; the rest are freq-1 unique statements (bespoke business logic) that no threshold can catch. The curve shows recurrence saturates by cut3 (+~0.2 pts through cut6), so deeper cutting does not approach 90%.",
  },
  // idioms keep names later (LLM naming pass writes them back); discovery carries structural id.
  idioms: idioms.map((i, ix) => ({
    id: `si_${String(ix).padStart(3, "0")}`, name: null, category: i.category,
    shape: i.shape, sites: i.sites, files: i.files, chars: i.chars,
    allByteIdentical: i.allByteIdentical, slotKinds: i.slotKinds, example: i.example,
    // keep a compact member index (rel:line) + full templates for self-expansion
    members: i.members.map((m) => ({ rel: m.rel, line: m.line, chars: m.chars })),
    membersFull: i.members,
  })),
};
const outDir = path.join(PROJECT, "catalog");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "statement-idioms.json");
fs.writeFileSync(outPath, JSON.stringify(catalog, null, 1));
console.log(`\ncategories: ${JSON.stringify(byCategory)}`);
console.log(`wrote ${outPath} (${(fs.statSync(outPath).size/1024).toFixed(0)} KB)`);
