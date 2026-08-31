#!/usr/bin/env node
"use strict";
/**
 * build-archetypes — the TOP (archetype) tier over hydra-source. Deterministic, no
 * model. Classifies every file into one of 17 architectural archetypes, and for the
 * 4 GENERATIVE ones (Entity, RouterModule, ReduxModule, DtoBuilder) extracts the
 * template + typed slots and BYTE-VERIFIES that archetype+slots === source. Reports
 * regenerability honestly: byte-identical reconstruct AND conformance (no residual
 * top-level code), with the reason for every non-conformer.
 *
 * Writes ONLY under hydra-source:
 *   catalog/archetypes.json          <- 17 archetypes (features, files) + 4 generative templates/schemas
 *   archetype-index.json             <- rollup (Zipf head, generative vs descriptive, byte-verify counts)
 *   sen/archetypes/<rel>.arch.json  <- per-file archetype + extracted slots (generative files)
 *
 *   node build-archetypes.js
 */
const fs = require("fs");
const path = require("path");
const { walkDir } = require("./engine/pipeline");
const { analyzeFile, classifyFile, EXTRACTORS, GENERATIVE } = require("./engine/archetypes.js");
const CR = require("./engine/corpus-root");

const PROJECT = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root
const NAMED_MIN = 3;

const FEATURES = {
  Entity: "class + @Entity + @Column/@PrimaryGeneratedColumn + relation decorators (typeorm)",
  RouterModule: "new Router({prefix}) + >=2 route registrations (koa-router)",
  ReduxModule: "createSlice / createAction / createAsyncThunk (redux)",
  DtoBuilder: "single class with chainable (return this) methods + build()",
  ServiceClass: "class with >=1 async method (IO orchestration)",
  DataAccessModule: "function-module doing DB IO (getRepository/createQueryBuilder/query) — not the repository pattern per se",
  AsyncFunctionModule: "exported functions/arrows using await IO, no class",
  PureModule: "exported functions, no IO import, zero await (calculators/helpers)",
  FunctionModule: "exported functions, no IO, no await, non-arithmetic",
  TestSuite: "describe()/it() or *.test/*.spec or a test-lib import",
  TypeDefs: "only interfaces/types/enums; no runtime code",
  ClientWrapper: "wraps a freshbooks/xero/http client",
  ReduxModuleAlt: "", Worker: "cluster.fork/process.send/MESSAGE_TYPE worker orchestration",
  Migration: "under /migrations/ or implements MigrationInterface",
  PlainClass: "a class with no async methods", IndexBarrel: "only export … from re-exports",
  ConstMapConfig: "top-level const object maps / config", Other: "enum-only or genuinely mixed files",
};
const TEMPLATES = {
  Entity: "imports + <preambleType>* + @Entity(<table>) [export] class <Name>[ extends <Base>] { <column>*  <relation>*  <otherMember>* }",
  RouterModule: "imports + <preambleType>* + const <r> = new Router({ prefix: <prefix> }) + <route(method, path, <handlerBody>)>* + exports",
  ReduxModule: "createSlice({ name: <name>, initialState: <state>, reducers: { <caseReducer>* }, extraReducers?: <extra> })",
  DtoBuilder: "class <Name>Builder { <field>*  <chainMethod: returns this>*  <buildMethod> }",
};
const SLOT_SCHEMA = {
  Entity: { table: "string", className: "string", base: "string|null", preambleTypes: "[{kind, name}]", columns: "[{prop, decorator, parsed:{name,type,nullable,enum,default,...}}]", relations: "[{prop, decorator, args}]", otherMembers: "[{prop, kind}]" },
  RouterModule: { prefix: "string|null", routerVars: "[string]", preambleTypes: "[{kind, name}]", routes: "[{method, path, hasHandler, handlerSpan}]" },
  ReduxModule: { name: "string", reducers: "[caseReducerName]", hasInitialState: "bool", hasExtraReducers: "bool", createActions: "int" },
  DtoBuilder: { className: "string", fields: "[string]", chainMethods: "[string]", buildMethods: "[string]" },
};

function main() {
  const t0 = Date.now();
  const files = walkDir(SRC).sort();
  const infos = [];
  for (const abs of files) {
    const rel = path.relative(SRC, abs);
    let src; try { src = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
    let f; try { f = analyzeFile(rel, src); } catch (_) { continue; }
    const archetype = classifyFile(f);
    let gen = null;
    if (EXTRACTORS[archetype]) { try { gen = EXTRACTORS[archetype](src, rel); } catch (e) { gen = { archetype, conforms: false, byteIdentical: false, reason: "extractor error: " + e.message, slots: {}, counts: {} }; } }
    infos.push({ rel, archetype, gen });
  }
  const total = infos.length;

  // ---- cluster ----
  const byArche = new Map();
  for (const i of infos) { const a = byArche.get(i.archetype) || { count: 0, files: [] }; a.count++; a.files.push(i.rel); byArche.set(i.archetype, a); }
  const ranked = [...byArche.entries()].map(([name, a]) => ({ name, count: a.count, files: a.files })).sort((x, y) => y.count - x.count);
  const named = ranked.filter((r) => r.count >= NAMED_MIN);
  const namedFiles = named.reduce((s, r) => s + r.count, 0);
  let cum = 0, head50 = null, head80 = null;
  for (let k = 0; k < ranked.length; k++) { cum += ranked[k].count; if (!head50 && cum >= total * 0.5) head50 = k + 1; if (!head80 && cum >= total * 0.8) head80 = k + 1; }

  // ---- generative byte-verify + conformance ----
  const genStats = {};
  for (const a of GENERATIVE) {
    const set = infos.filter((i) => i.archetype === a && i.gen);
    const byteId = set.filter((i) => i.gen.byteIdentical).length;
    const conform = set.filter((i) => i.gen.conforms).length;
    const nonConform = set.filter((i) => !i.gen.conforms).map((i) => ({ rel: i.rel, reason: i.gen.reason }));
    const slotTotals = set.reduce((acc, i) => { for (const k in (i.gen.counts || {})) acc[k] = (acc[k] || 0) + i.gen.counts[k]; return acc; }, {});
    genStats[a] = { files: set.length, byteIdentical: byteId, conforms: conform,
      byteIdenticalPct: set.length ? +(100 * byteId / set.length).toFixed(1) : 0,
      conformsPct: set.length ? +(100 * conform / set.length).toFixed(1) : 0,
      slotTotals, nonConformers: nonConform, template: TEMPLATES[a], slotSchema: SLOT_SCHEMA[a] };
  }
  const genFiles = GENERATIVE.reduce((s, a) => s + genStats[a].files, 0);
  const genByteId = GENERATIVE.reduce((s, a) => s + genStats[a].byteIdentical, 0);
  const genConform = GENERATIVE.reduce((s, a) => s + genStats[a].conforms, 0);

  // ---- persist: catalog/archetypes.json ----
  const catalog = {
    schema: "sdd-archetypes/1", project: PROJECT, generatedBy: "deterministic (engine/archetypes.js), no model", modelCalls: 0,
    corpusCommentFree: true, totalFiles: total, distinctArchetypes: ranked.length, namedArchetypes: named.length,
    archetypes: ranked.map((r) => ({
      name: r.name, count: r.count, pctOfFiles: +(100 * r.count / total).toFixed(1),
      features: FEATURES[r.name] || "", generative: GENERATIVE.includes(r.name),
      examples: r.files.slice(0, 4), files: r.files,
      ...(GENERATIVE.includes(r.name) ? { template: TEMPLATES[r.name], slotSchema: SLOT_SCHEMA[r.name], byteVerify: { byteIdentical: genStats[r.name].byteIdentical, conforms: genStats[r.name].conforms, of: genStats[r.name].files } } : {}),
    })),
  };
  fs.writeFileSync(path.join(PROJECT, "catalog", "archetypes.json"), JSON.stringify(catalog, null, 1));

  // ---- persist: archetype-index.json ----
  const rollup = {
    schema: "sdd-archetype-index/1", project: PROJECT, generatedBy: "deterministic (engine/archetypes.js), no model", modelCalls: 0,
    corpusCommentFree: true, totalFiles: total,
    distinctArchetypes: ranked.length, namedArchetypes: named.length,
    namedCoveragePct: +(100 * namedFiles / total).toFixed(1),
    zipfHead: { top4Pct: +(100 * ranked.slice(0, 4).reduce((s, r) => s + r.count, 0) / total).toFixed(1),
      top8Pct: +(100 * ranked.slice(0, 8).reduce((s, r) => s + r.count, 0) / total).toFixed(1),
      archetypesTo50Pct: head50, archetypesTo80Pct: head80 },
    generativeVsDescriptive: {
      generativeArchetypes: GENERATIVE, generativeFiles: genFiles,
      descriptiveFiles: total - genFiles, descriptiveNote: "the remaining archetypes are valid CLASSIFICATIONS for navigation/coverage, not regeneration templates; their content is delivered by the skeleton+idiom tiers.",
      generativeByteIdentical: genByteId, generativeConforms: genConform,
      headline: `repo is ${named.length} kinds of file; ${genConform}/${genFiles} generative files regenerate byte-identical AND conform to archetype+slots (${genByteId}/${genFiles} tile byte-identical incl. non-conformers).`,
    },
    perArchetype: ranked.map((r) => ({ name: r.name, count: r.count, generative: GENERATIVE.includes(r.name),
      ...(GENERATIVE.includes(r.name) ? { byteIdentical: genStats[r.name].byteIdentical, conforms: genStats[r.name].conforms, conformsPct: genStats[r.name].conformsPct, slotTotals: genStats[r.name].slotTotals } : {}) })),
    generativeDetail: genStats,
  };
  fs.writeFileSync(path.join(PROJECT, "archetype-index.json"), JSON.stringify(rollup, null, 1));

  // ---- persist: per-file .arch.json for generative files ----
  const archDir = path.join(CR.senDir(), "archetypes");
  for (const i of infos) if (i.gen) {
    const outPath = path.join(archDir, i.rel + ".arch.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ rel: i.rel, archetype: i.archetype, conforms: i.gen.conforms,
      byteIdentical: i.gen.byteIdentical, reason: i.gen.reason || null, template: TEMPLATES[i.archetype],
      counts: i.gen.counts, slots: i.gen.slots }, null, 1));
  }

  // ---- report ----
  console.log("=== ARCHETYPE TIER ===");
  console.log(`files: ${total}   distinct archetypes: ${ranked.length}   named (>=${NAMED_MIN}): ${named.length}  covering ${(100*namedFiles/total).toFixed(1)}%`);
  console.log(`Zipf head: top 4 = ${rollup.zipfHead.top4Pct}% of files, top 8 = ${rollup.zipfHead.top8Pct}%  (to 50%: ${head50} archetypes; to 80%: ${head80})`);
  console.log("\narchetype".padEnd(22), "files", "  %", " generative");
  for (const r of ranked) console.log(r.name.padEnd(22), String(r.count).padStart(4), String((100*r.count/total).toFixed(1)).padStart(5), GENERATIVE.includes(r.name) ? "  ★" : "");
  console.log("\n=== GENERATIVE regenerability (byte-verify + conformance) ===");
  for (const a of GENERATIVE) { const g = genStats[a];
    console.log(`  ${a.padEnd(14)} ${g.conforms}/${g.files} conform & byte-identical (${g.conformsPct}%)  |  byte-identical tiling ${g.byteIdentical}/${g.files}  |  slots ${JSON.stringify(g.slotTotals)}`);
    for (const nc of g.nonConformers.slice(0, 4)) console.log(`      ✗ ${nc.rel} — ${nc.reason}`);
    if (g.nonConformers.length > 4) console.log(`      … +${g.nonConformers.length - 4} more non-conformers`);
  }
  console.log(`\nHEADLINE: repo is ${named.length} kinds of file; ${genConform}/${genFiles} generative files regenerate byte-identical AND conform to archetype+slots.`);
  console.log(`(${genByteId}/${genFiles} tile byte-identical including non-conformers — losslessness holds; conformance is the honest regenerability gate.)`);
  console.log(`\nmine: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log("persisted: catalog/archetypes.json, archetype-index.json, sen/archetypes/<rel>.arch.json");
}
main();
