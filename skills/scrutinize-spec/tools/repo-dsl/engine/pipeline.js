"use strict";
/**
 * STAGE 3 (generators from patterns) + STAGE 5/6 (coverage + verify + gate).
 *
 * Ties the stages together over a whole directory:
 *   fan-out every file  ->  LZW-mine the shape streams  ->  promote dictionary
 *   entries into a generator library (opaque-id leaves + readable composites,
 *   composites referencing smaller entries)  ->  measure honest per-file coverage
 *   and classify residue  ->  roll up + gate.
 *
 * COVERAGE is "reproduced by pure composition": a token counts as reproduced iff
 * its shape RECURS (mined ≥ minCount), all its slots are TYPED (small ident/type/
 * number/short-string — never prose/SQL), and the shape's canonical (plurality)
 * template refills to this token's exact source bytes. Everything else is residue,
 * classified so nothing is papered over:
 *   A non-recurring shape · B free-text slot · C comment/trivia · D formatting variance
 */

const fs = require("fs");
const path = require("path");
const { tokenize, fill } = require("./fanout");
const { build, segment } = require("./lzw");
const { idFor, slotsAreTyped } = require("../lib/skeleton");
const crypto = require("crypto");

function walkDir(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, out);
    else if (e.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function mine(dir, opts = {}) {
  const minCount = opts.minCount || 2;
  const files = walkDir(dir).sort();

  // Stage 1: fan-out.
  const perFile = files.map((f) => {
    const source = fs.readFileSync(f, "utf8");
    const { tokens, gaps } = tokenize(f, source);
    return { file: f, rel: path.relative(dir, f), source, tokens, gaps };
  });

  // Stage 2: LZW over all shape streams.
  const streams = perFile.map((pf) => pf.tokens.map((t) => t.shape));
  const model = build(streams);
  const { dict, shapeOfId, shapeCounts } = model;

  // Canonical (plurality) template per shape, from the actual occurrences.
  const tmplVotes = new Map(); // shape -> Map(json -> {parts,count})
  for (const pf of perFile) for (const t of pf.tokens) {
    if (!tmplVotes.has(t.shape)) tmplVotes.set(t.shape, new Map());
    const m = tmplVotes.get(t.shape);
    const key = JSON.stringify(t.templateParts);
    if (!m.has(key)) m.set(key, { parts: t.templateParts, count: 0 });
    m.get(key).count++;
  }
  const canonical = new Map();
  for (const [shape, m] of tmplVotes) {
    let best = null;
    for (const v of m.values()) if (!best || v.count > best.count) best = v;
    canonical.set(shape, best.parts);
  }

  // Stage 3: promote entries into a generator library.
  const leaves = [];
  const leafByShape = new Map();
  for (let s = 0; s < shapeOfId.length; s++) {
    const shape = shapeOfId[s];
    const count = shapeCounts.get(shape) || 0;
    if (count < minCount) continue; // rare shape stays residue, not a generator
    const paramKinds = shape.split(" ").filter((x) => x === "ID" || x === "NUM" || x === "STR");
    const id = idFor(shape);
    const leaf = { id, shape, paramKinds, freq: count, tier: "leaf" };
    leaves.push(leaf); leafByShape.set(shape, leaf);
  }

  const composites = [];
  const promotedEntry = new Set();
  for (const e of dict) if (e.len >= 2 && e.freq >= minCount) promotedEntry.add(e.id);
  for (const e of dict) {
    if (!promotedEntry.has(e.id)) continue;
    const memberShapes = e.symbols.map((sid) => shapeOfId[sid]);
    const childCompositePrefix = e.prefixId != null && promotedEntry.has(e.prefixId);
    // hierarchy depth = length of the chain of promoted-composite prefixes
    let depth = 1, p = e.prefixId;
    while (p != null && promotedEntry.has(p)) { depth++; p = dict[p].prefixId; }
    composites.push({
      name: "g_" + e.len + "_" + crypto.createHash("sha256").update(e.key).digest("hex").slice(0, 6),
      entryId: e.id, len: e.len, freq: e.freq,
      memberLeafIds: memberShapes.map(idFor),
      prefixEntryId: e.prefixId, builtFromComposite: childCompositePrefix, hierarchyDepth: depth,
    });
  }

  // Stages 5/6: per-file coverage + residue + segmentation (composite spans).
  const RES = { A: "non-recurring shape", B: "free-text slot", C: "comment/trivia", D: "formatting variance" };
  const fileReports = [];
  let corp = { chars: 0, repro: 0, res: { A: 0, B: 0, C: 0, D: 0 }, tokens: 0, reproTokens: 0 };
  const residueSamples = { A: [], B: [], C: [], D: [] };

  for (const pf of perFile) {
    const src = pf.source;
    const residueChar = new Uint8Array(src.length);
    let repro = 0;
    const fileRes = { A: 0, B: 0, C: 0, D: 0 };
    for (const t of pf.tokens) {
      const recurs = (shapeCounts.get(t.shape) || 0) >= minCount;
      const typed = slotsAreTyped(t.slots);
      const matches = recurs && typed && fill(canonical.get(t.shape), t.slots) === t.text;
      if (matches) { repro += t.text.length; corp.reproTokens++; continue; }
      const cls = !recurs ? "A" : !typed ? "B" : "D";
      fileRes[cls] += t.text.length;
      for (let k = t.start; k < t.end; k++) residueChar[k] = 1;
      if (residueSamples[cls].length < 8) residueSamples[cls].push({ rel: pf.rel, line: t.line, text: t.text.split("\n")[0].slice(0, 90) });
    }
    for (const g of pf.gaps) {
      if (g.text.trim() === "") continue; // pure whitespace is neutral, not residue
      fileRes.C += g.text.length;
      for (let k = g.start; k < g.end; k++) residueChar[k] = 1;
      if (residueSamples.C.length < 8) residueSamples.C.push({ rel: pf.rel, text: g.text.trim().split("\n")[0].slice(0, 90) });
    }
    // line coverage: a line is covered iff it contains no residue char
    const lines = src.split("\n");
    let off = 0, covLines = 0;
    for (const ln of lines) {
      let res = false;
      for (let k = off; k < off + ln.length; k++) if (residueChar[k]) { res = true; break; }
      if (!res) covLines++;
      off += ln.length + 1;
    }
    const segs = segment(pf.tokens.map((t) => t.shape), model)
      .map((s) => ({ len: s.tokenIndices.length, entryId: s.entryId }));
    const maxSpan = segs.reduce((a, s) => Math.max(a, s.len), 0);

    const covPct = src.length ? +(100 * repro / src.length).toFixed(1) : 100;
    fileReports.push({
      rel: pf.rel, chars: src.length, reproChars: repro, coveragePct: covPct,
      lines: lines.length, coveredLines: covLines, lineCoveragePct: +(100 * covLines / lines.length).toFixed(1),
      tokens: pf.tokens.length, residue: fileRes, maxCompositeSpan: maxSpan,
    });
    corp.chars += src.length; corp.repro += repro; corp.tokens += pf.tokens.length;
    for (const c of "ABCD") corp.res[c] += fileRes[c];
  }

  fileReports.sort((a, b) => a.coveragePct - b.coveragePct);
  const rollup = {
    files: files.length, tokens: corp.tokens, chars: corp.chars,
    coveragePct: +(100 * corp.repro / corp.chars).toFixed(1),
    reproducedTokens: corp.reproTokens,
    residueChars: corp.res, residueLegend: RES,
  };
  const library = {
    schema: "sdd-repo-dsl/mined-library/1", corpus: dir, minCount,
    counts: {
      alphabet: shapeOfId.length, dictEntries: dict.length,
      leafGenerators: leaves.length, compositeGenerators: composites.length,
      compositesBuiltFromComposites: composites.filter((c) => c.builtFromComposite).length,
      maxHierarchyDepth: composites.reduce((a, c) => Math.max(a, c.hierarchyDepth), 0),
    },
    leaves: leaves.sort((a, b) => b.freq - a.freq),
    composites: composites.sort((a, b) => b.freq - a.freq),
  };

  return { minCount, library, rollup, fileReports, residueSamples, residueLegend: RES };
}

module.exports = { mine, walkDir };
