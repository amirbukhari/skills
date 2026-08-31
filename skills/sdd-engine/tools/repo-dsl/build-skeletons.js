#!/usr/bin/env node
"use strict";
/**
 * build-skeletons — the SKELETON TIER over the whole hydra-source corpus.
 * Deterministic, no model. Every function/method body becomes a control-flow
 * skeleton (statement-kind sequence) whose per-statement HOLES are filled by:
 *   - a named idiom  (fetchAndValidate / assertOrThrow / throwError), else
 *   - a statement-tier compose word (c_<hash>), else
 *   - a LITERAL slot (bespoke bytes).
 * Slots absorb all divergence, so the tiling is byte-exact for EVERY body; the
 * interesting numbers are the STRUCTURE-vs-BESPOKE split and how few named
 * skeletons cover how much of the corpus.
 *
 * Writes ONLY under hydra-source:
 *   catalog/skeletons.json           <- named skeleton dictionary (Zipf head, templates, examples)
 *   sen/skeletons/<rel>.skel.json   <- per-file re-expression (compact, structure only)
 *   skeleton-index.json              <- corpus rollup (the framing numbers)
 *
 *   node build-skeletons.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { walkDir } = require("./engine/pipeline");
const { tokenize } = require("./engine/fanout");
const { extractBodies, nameSkeleton } = require("./engine/skeleton.js");
const { findThrowError, findAssertOrThrow } = require("./engine/named-idioms.js");
const { findFetchAndValidate } = require("./engine/idioms.js");
const CR = require("./engine/corpus-root");

const PROJECT = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root
const MIN_BODIES = 5;            // a skeleton is NAMED when it recurs in >= this many bodies
const shapeId = (s) => "c_" + crypto.createHash("sha256").update(s).digest("hex").slice(0, 10);
const litLen = (parts) => parts.reduce((a, p) => a + (p.lit !== undefined ? p.lit.length : 0), 0);

function main() {
  const t0 = Date.now();
  const composeDict = JSON.parse(fs.readFileSync(path.join(PROJECT, "catalog", "compose-words.json"), "utf8")).words;
  const isWord = new Set(Object.keys(composeDict));
  const files = walkDir(SRC).sort();

  // ---- pass 1: extract every body, attribute fills, byte-verify tiling ----
  const perFile = [];               // { rel, byteIdentical, bodies:[...] }
  const sigStat = new Map();        // sig -> { bodies, files:Set, stmtTotal, example:{rel,line,snippet}, fills:{...} }
  let totalBodies = 0, totalStatements = 0, fileBI = 0, fillVerified = 0, fillTotal = 0;

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const rel = path.relative(SRC, f);
    let ex; try { ex = extractBodies(src, rel); } catch (e) { perFile.push({ rel, byteIdentical: true, skipped: true, bodies: [] }); continue; }
    const bodies = ex.bodies;

    // per-file idiom + compose-token indices (span -> descriptor)
    let te = [], ao = [], fv = [], toks = [], gaps = [];
    try { te = findThrowError(src, rel); } catch (_) {}
    try { ao = findAssertOrThrow(src, rel); } catch (_) {}
    try { fv = findFetchAndValidate(src, rel); } catch (_) {}
    try { const tk = tokenize(f, src, undefined, 0); toks = tk.tokens; gaps = tk.gaps; } catch (_) {}
    // fine-grained char split of an arbitrary [a,b) span via compose tokens+gaps:
    // scaffold = fixed grammar (worded-token literals + all gap glue), slot = bespoke
    // expr bytes INSIDE a recognized word, bespoke = bytes in tokens that recur nowhere.
    const splitSpan = (a, b) => {
      let scaffold = 0, slot = 0, bespoke = 0;
      for (const t of toks) {
        if (t.start < a || t.end > b) continue;
        const slotLen = (t.slots || []).reduce((x, s) => x + (s.text ? s.text.length : 0), 0);
        if (isWord.has(shapeId(t.shape))) { scaffold += (t.end - t.start) - slotLen; slot += slotLen; }
        else bespoke += (t.end - t.start);
      }
      for (const g of gaps) { if (g.start >= a && g.end <= b) scaffold += (g.end - g.start); }
      return { scaffold, slot, bespoke };
    };
    const idiomAt = new Map();       // `${start}:${end}` -> {name, template, params:[texts], scaffold, slot}
    const idxIdiom = (name, list, order) => { for (const m of list) idiomAt.set(`${m.start}:${m.end}`, {
      name, template: m.template, paramTexts: order.map((k) => m.params[k]),
      scaffold: litLen(m.template), slot: order.reduce((a, k) => a + (m.params[k] ? m.params[k].length : 0), 0) }); };
    idxIdiom("throwError", te, ["errorClass", "message"]);
    idxIdiom("assertOrThrow", ao, ["cond", "errorClass", "message"]);
    for (const m of fv) idiomAt.set(`${m.start}:${m.end}`, { name: "fetchAndValidate", template: m.template,
      paramTexts: null, scaffold: litLen(m.template), slot: m.chars - litLen(m.template) }); // fv covers the pair span
    const tokAt = new Map();         // `${start}:${end}` -> token (single compose word)
    for (const t of toks) tokAt.set(`${t.start}:${t.end}`, t);

    // outermost bodies (for the file byte-rebuild tiling)
    const sorted = bodies.slice().sort((a, b) => a.bodyStart - b.bodyStart || b.bodyEnd - a.bodyEnd);
    const outer = []; let lastEnd = -1;
    for (const b of sorted) { if (b.bodyStart >= lastEnd) { outer.push(b); lastEnd = b.bodyEnd; } }

    // ---- byte-verify: reconstruct the whole file from outer bodies + literal glue ----
    let rebuilt = "", cur = 0;
    for (const b of outer) {
      rebuilt += src.slice(cur, b.bodyStart);                 // signature + leading glue (verbatim)
      let bcur = b.bodyStart;
      for (const s of b.stmts) { rebuilt += src.slice(bcur, s.start) + src.slice(s.start, s.end); bcur = s.end; }
      rebuilt += src.slice(bcur, b.bodyEnd);
      cur = b.bodyEnd;
    }
    rebuilt += src.slice(cur);
    const byteIdentical = rebuilt === src;
    if (byteIdentical) fileBI++;

    // ---- classify + fill-attribute every body (all bodies, incl. nested) ----
    const fileBodies = [];
    for (const b of bodies) {
      totalBodies++; totalStatements += b.stmts.length;
      const favEnd = new Map();     // guard-stmt index -> fetch-stmt index (pair handled at fetch stmt)
      const favSkip = new Set();
      for (const [i, j] of b.favPairs) { favEnd.set(i, j); favSkip.add(j); }
      const fills = [];
      let scaffoldChars = 0, slotChars = 0, bespokeChars = 0;
      for (let i = 0; i < b.stmts.length; i++) {
        if (favSkip.has(i)) continue;                          // consumed by the fetchAndValidate pair below
        const s = b.stmts[i];
        let fill = null; fillTotal++;
        if (favEnd.has(i)) {                                   // FETCH + GUARD -> fetchAndValidate (pair span)
          const j = favEnd.get(i);
          const d = idiomAt.get(`${s.start}:${b.stmts[j].end}`);
          if (d && d.name === "fetchAndValidate") { fill = { kind: "FETCH+GUARD", fill: "fetchAndValidate" }; scaffoldChars += d.scaffold; slotChars += d.slot; fillVerified++; }
          else { const sp = splitSpan(s.start, b.stmts[j].end); scaffoldChars += sp.scaffold; slotChars += sp.slot; bespokeChars += sp.bespoke; fill = { kind: "FETCH+GUARD", fill: "mixed" }; }
        } else if (s.idiom && idiomAt.has(`${s.start}:${s.end}`)) {   // throwError / assertOrThrow (whole statement)
          const d = idiomAt.get(`${s.start}:${s.end}`);
          fill = { kind: s.kind, fill: d.name }; scaffoldChars += d.scaffold; slotChars += d.slot; fillVerified++;
        } else if (tokAt.has(`${s.start}:${s.end}`) && isWord.has(tokAtId(tokAt, s))) {  // single compose word
          const id = tokAtId(tokAt, s); const dictTpl = composeDict[id].template;
          scaffoldChars += litLen(dictTpl); slotChars += (s.end - s.start) - litLen(dictTpl);
          fill = { kind: s.kind, fill: id }; fillVerified++;
        } else {                                                // decompose interior via compose tokens+gaps
          const sp = splitSpan(s.start, s.end); scaffoldChars += sp.scaffold; slotChars += sp.slot; bespokeChars += sp.bespoke;
          fill = { kind: s.kind, fill: sp.bespoke === 0 ? "worded" : (sp.scaffold + sp.slot === 0 ? "literal" : "mixed") };
        }
        fills.push(fill);
      }
      // record sig stats
      const st = sigStat.get(b.sig) || { bodies: 0, files: new Set(), stmtTotal: 0, example: null,
        fills: { fetchAndValidate: 0, throwError: 0, assertOrThrow: 0, composeWord: 0, worded: 0, mixed: 0, literal: 0 } };
      st.bodies++; st.files.add(rel); st.stmtTotal += b.stmts.length;
      for (const fl of fills) { const k = fl.fill; if (k && k.startsWith("c_")) st.fills.composeWord++; else if (k in st.fills) st.fills[k]++; }
      if (!st.example) st.example = { rel, line: ex.sourceFile.getLineAndCharacterOfPosition(b.bodyStart).line + 1,
        snippet: src.slice(b.bodyStart, Math.min(b.bodyEnd, b.bodyStart + 180)).replace(/\s+/g, " ").trim().slice(0, 140) };
      sigStat.set(b.sig, st);

      fileBodies.push({ owner: b.owner, ownerKind: b.ownerKind,
        line: ex.sourceFile.getLineAndCharacterOfPosition(b.bodyStart).line + 1,
        sig: b.sig, stmtCount: b.stmts.length, fills, scaffoldChars, slotChars, bespokeChars });
    }
    perFile.push({ rel, byteIdentical, bodies: fileBodies });
  }

  // ---- name the recurring skeletons (deterministic, dedup collisions) ----
  const sigs = [...sigStat.entries()].map(([sig, st]) => ({ sig, ...st,
    files: st.files.size, avgStmts: +(st.stmtTotal / st.bodies).toFixed(2),
    sizeScore: st.bodies * (st.stmtTotal / st.bodies) }));  // freq x size
  sigs.sort((a, b) => b.bodies - a.bodies || (a.sig < b.sig ? -1 : 1));
  const named = new Map(); const usedNames = new Set();
  for (const s of sigs) {
    if (s.bodies < MIN_BODIES) continue;
    let nm = nameSkeleton(s.sig); let n = nm, k = 2;
    while (usedNames.has(n)) n = nm + "_" + (k++);
    usedNames.add(n); named.set(s.sig, n);
  }

  // ---- framing numbers ----
  let bodiesNamed = 0, stmtsNamed = 0;
  let scaffoldAll = 0, slotAll = 0, bespokeAll = 0, scaffoldNamed = 0, slotNamed = 0, bespokeNamed = 0;
  for (const pf of perFile) for (const b of pf.bodies) {
    scaffoldAll += b.scaffoldChars; slotAll += b.slotChars; bespokeAll += b.bespokeChars;
    if (named.has(b.sig)) { bodiesNamed++; stmtsNamed += b.stmtCount; scaffoldNamed += b.scaffoldChars; slotNamed += b.slotChars; bespokeNamed += b.bespokeChars; }
  }
  const pct = (n, d) => d ? +(100 * n / d).toFixed(2) : 0;

  // Zipf head: cumulative body coverage by the top-N named skeletons
  const namedSorted = sigs.filter((s) => named.has(s.sig)).sort((a, b) => b.bodies - a.bodies);
  let cum = 0; const zipf = [];
  for (let i = 0; i < namedSorted.length; i++) { cum += namedSorted[i].bodies;
    if ([1, 3, 5, 10, 20, 30, namedSorted.length].includes(i + 1)) zipf.push({ topN: i + 1, cumulativeBodies: cum, cumulativePctOfAllBodies: pct(cum, totalBodies) }); }

  const kindTemplate = (sig) => sig.split(" ").map((k) => `<${k}>`).join(" ");
  const topSkeletons = namedSorted.slice(0, 30).map((s) => ({
    name: named.get(s.sig), sig: s.sig, kinds: s.sig.split(" "), template: kindTemplate(s.sig),
    bodies: s.bodies, files: s.files, avgStmts: s.avgStmts, sizeScore: +s.sizeScore.toFixed(1),
    pctOfAllBodies: pct(s.bodies, totalBodies), fillProfile: s.fills, example: s.example,
  }));

  // ---- persist ----
  const rollup = {
    schema: "sdd-skeleton-index/1", project: PROJECT, generatedBy: "deterministic (engine/skeleton.js), no model", modelCalls: 0,
    corpusCommentFree: true, minBodiesToName: MIN_BODIES,
    corpusFiles: files.length, byteIdenticalFiles: fileBI, allByteIdentical: fileBI === files.length,
    totalBodies, totalStatements, distinctSkeletons: sigStat.size, namedSkeletons: named.size,
    // STRUCTURE COVERAGE (the new headline): bodies/statements under a NAMED skeleton
    structureCoverage: {
      bodiesUnderNamed: bodiesNamed, bodiesPct: pct(bodiesNamed, totalBodies),
      statementsUnderNamed: stmtsNamed, statementsPct: pct(stmtsNamed, totalStatements),
      note: `${named.size} named skeletons (each recurs in >= ${MIN_BODIES} bodies) cover ${pct(bodiesNamed, totalBodies)}% of all ${totalBodies} bodies.`,
    },
    // STRUCTURE vs BESPOKE char split (holes filled by idioms/words are known structure+slot; bespoke statements are pure slot)
    structureVsBespoke: {
      basis: "chars inside function/method bodies; scaffold = fixed grammar of matched idioms/words, slot = bespoke expr inside a matched word, bespoke = whole statements with no word",
      scaffoldChars: scaffoldAll, slotChars: slotAll, bespokeChars: bespokeAll,
      scaffoldPct: pct(scaffoldAll, scaffoldAll + slotAll + bespokeAll),
      slotPct: pct(slotAll, scaffoldAll + slotAll + bespokeAll),
      bespokePct: pct(bespokeAll, scaffoldAll + slotAll + bespokeAll),
      knownStructurePct: pct(scaffoldAll, scaffoldAll + slotAll + bespokeAll),
      withinNamedSkeletons: { scaffoldChars: scaffoldNamed, slotChars: slotNamed, bespokeChars: bespokeNamed,
        scaffoldPct: pct(scaffoldNamed, scaffoldNamed + slotNamed + bespokeNamed) },
    },
    zipfHead: zipf,
    byteVerify: `${fileBI}/${files.length} files rebuild byte-identical from the skeleton tiling; ${fillVerified}/${fillTotal} statement holes filled by a named idiom or compose word (rest are bespoke literal slots).`,
    fillVerified, fillTotal, fillPct: pct(fillVerified, fillTotal),
    perFile: perFile.map((pf) => ({ rel: pf.rel, byteIdentical: pf.byteIdentical, bodies: pf.bodies.length,
      named: pf.bodies.filter((b) => named.has(b.sig)).length })),
  };
  const skeletons = {
    schema: "sdd-skeletons/1", project: PROJECT, generatedBy: "deterministic (engine/skeleton.js), no model", modelCalls: 0,
    corpusCommentFree: true, minBodiesToName: MIN_BODIES,
    counts: { distinct: sigStat.size, named: named.size, totalBodies, totalStatements },
    topSkeletons,
    all: namedSorted.map((s) => ({ name: named.get(s.sig), sig: s.sig, bodies: s.bodies, files: s.files, avgStmts: s.avgStmts })),
  };

  fs.mkdirSync(path.join(PROJECT, "catalog"), { recursive: true });
  fs.writeFileSync(path.join(PROJECT, "catalog", "skeletons.json"), JSON.stringify(skeletons, null, 1));
  fs.writeFileSync(path.join(PROJECT, "skeleton-index.json"), JSON.stringify(rollup, null, 1));
  // per-file re-expression (compact: structure + names, no raw bytes)
  const skelDir = path.join(CR.senDir(), "skeletons");
  for (const pf of perFile) {
    const outPath = path.join(skelDir, pf.rel + ".skel.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
      rel: pf.rel, byteIdentical: pf.byteIdentical,
      bodies: pf.bodies.map((b) => ({ owner: b.owner, ownerKind: b.ownerKind, line: b.line, sig: b.sig,
        skeleton: named.get(b.sig) || null, named: named.has(b.sig), stmtCount: b.stmtCount,
        fills: b.fills, scaffoldChars: b.scaffoldChars, slotChars: b.slotChars, bespokeChars: b.bespokeChars })),
    }, null, 1));
  }

  console.log("=== SKELETON TIER ===");
  console.log(`files: ${files.length}  byte-identical rebuild: ${fileBI}/${files.length}`);
  console.log(`bodies: ${totalBodies}  statements: ${totalStatements}`);
  console.log(`distinct skeletons: ${sigStat.size}  named (>=${MIN_BODIES} bodies): ${named.size}`);
  console.log(`STRUCTURE COVERAGE: ${rollup.structureCoverage.bodiesPct}% of bodies, ${rollup.structureCoverage.statementsPct}% of statements under a named skeleton`);
  console.log(`STRUCTURE vs BESPOKE (body chars): scaffold ${rollup.structureVsBespoke.scaffoldPct}% | slot ${rollup.structureVsBespoke.slotPct}% | bespoke ${rollup.structureVsBespoke.bespokePct}%`);
  console.log(`holes filled by idiom/word: ${fillVerified}/${fillTotal} (${rollup.fillPct}%)`);
  console.log("\nZipf head (cumulative body coverage):");
  for (const z of zipf) console.log(`  top ${z.topN} skeletons -> ${z.cumulativePctOfAllBodies}% of bodies`);
  console.log("\nTop 12 named skeletons:");
  for (const s of topSkeletons.slice(0, 12)) console.log(`  ${s.name.padEnd(28)} ${String(s.bodies).padStart(4)} bodies / ${String(s.files).padStart(3)} files  [${s.template}]`);
  console.log(`\nmine: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log("persisted: catalog/skeletons.json, skeleton-index.json, sen/skeletons/<rel>.skel.json");
}

// helper: id of the single-token compose word at a statement span (or "" )
function tokAtId(tokAt, s) { const t = tokAt.get(`${s.start}:${s.end}`); return t ? shapeId(t.shape) : ""; }

main();
