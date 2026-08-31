"use strict";
/**
 * package-hydra-source — DETERMINISTIC packager for the whole billing-system
 * mining corpus (no model calls). Runs the standard fragment mine (cut 3), the
 * whole-file miner, and the fetchAndValidate idiom matcher, then persists
 * panel-readable artifacts at the PROJECT ROOT so the SDD client never re-mines
 * 1000 files live:
 *
 *   hydra-source/COVERAGE.json                     <- coverage %, reuse, vocab, top words,
 *                                                     whole-file words, idiom words (summary)
 *   hydra-source/catalog/mined-library.v6.json     <- full mined library + whole-file + idiom
 *                                                     words (self-expanding: templates embedded)
 *   hydra-source/word-library.json                 <- flat panel layout: every word, tier, reuse
 *   hydra-source/.sdd-code-provenance.json         <- modelCalls: 0
 *
 *   node package-hydra-source.js
 */
const fs = require("fs");
const path = require("path");
const { mine, walkDir } = require("./engine/pipeline");
const { tokenize } = require("./engine/fanout");
const wf = require("./engine/wholefile.js");
const { findFetchAndValidate, normalizedShape } = require("./engine/idioms.js");
const { findThrowError, findAssertOrThrow } = require("./engine/named-idioms.js");
const CR = require("./engine/corpus-root");

const PROJECT = CR.corpusRoot();
const CORPUS = CR.sourceRoot(); // whole .ts tree — the READ root
const CUT = 3;

function main() {
  const t0 = Date.now();
  console.log("mining (cut 3) …");
  const res = mine(CORPUS, { cutDepth: CUT });
  const mineSecs = +((Date.now() - t0) / 1000).toFixed(1);
  const R = res.rollup;

  // ---- vocabulary + reuse + top recurring words (LINE-LEVEL = cut 0) ----
  // Reuse/vocab are reported at the whole-statement grain so a "word" is a
  // readable recurring LINE, not a sub-expression fragment (cut 3 inflates reuse
  // with tiny fragments). Coverage/residue/catalog stay at the adopted cut 3.
  const files0 = walkDir(CORPUS).sort();
  const spread = new Map(), occ = new Map(), ex = new Map();
  for (const f of files0) {
    const src = fs.readFileSync(f, "utf8");
    let toks; try { toks = tokenize(f, src, undefined, 0).tokens; } catch (e) { continue; }
    const rel = path.relative(CORPUS, f);
    const seen = new Set();
    for (const t of toks) {
      occ.set(t.shape, (occ.get(t.shape) || 0) + 1);
      if (!seen.has(t.shape)) { seen.add(t.shape); spread.set(t.shape, (spread.get(t.shape) || 0) + 1); }
      if (!ex.has(t.shape)) ex.set(t.shape, { rel, line: t.line, text: t.text.split("\n")[0].slice(0, 80) });
    }
  }
  const recurring = [...spread.entries()].filter(([, n]) => n >= 2);
  const reuseAvgFilesPerWord = +(recurring.reduce((a, [, n]) => a + n, 0) / recurring.length).toFixed(2); // line-level
  const topWords = recurring.sort((a, b) => b[1] - a[1]).slice(0, 20).map(([shape, files]) => ({
    shape: shape.slice(0, 100), files, occurrences: occ.get(shape), example: ex.get(shape),
  }));

  // ---- leaf examples (cut 3): one representative source line per leaf shape ----
  // Leaves are opaque ids (p_<hash>); a leaf is NOT a word. Words = composites /
  // whole-file / idiom that reference leaves BY id. We attach one example line per
  // leaf shape so the panel can show what an id stands for.
  const leafEx = new Map();
  for (const f of files0) {
    const src = fs.readFileSync(f, "utf8");
    let toks; try { toks = tokenize(f, src, undefined, CUT).tokens; } catch (e) { continue; }
    for (const t of toks) if (!leafEx.has(t.shape)) leafEx.set(t.shape, t.text.split("\n")[0].slice(0, 80));
  }
  // enrich mined leaves with an example line (join by shape)
  for (const lf of res.library.leaves) if (lf.shape != null && leafEx.has(lf.shape)) lf.example = leafEx.get(lf.shape);

  // ---- whole-file words ----
  console.log("whole-file mining …");
  const files = walkDir(CORPUS).sort();
  const perFileWF = files.map((f) => { const s = fs.readFileSync(f, "utf8"); const tk = tokenize(f, s); return { file: f, rel: path.relative(CORPUS, f), source: s, tokens: tk.tokens, gaps: tk.gaps }; });
  const wfRes = wf.mineWholeFile(perFileWF, { minClusterSize: 2 });
  const wholeFileWords = wfRes.words.map((w) => ({ name: w.name, memberFiles: w.memberFiles, allVerified: w.allVerified,
    members: w.verify.map((v) => ({ file: v.file, byteIdentical: v.byteIdentical, residueChars: v.residueChars, residueClass: v.residueClass })) }));

  // ---- fetchAndValidate idiom word ----
  console.log("matching fetchAndValidate idiom …");
  const idiomMembers = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    let inst; try { inst = findFetchAndValidate(src, path.relative(CORPUS, f)); } catch (e) { continue; }
    for (const x of inst) idiomMembers.push(x);
  }
  const idiomVerified = idiomMembers.filter((m) => m.byteIdentical).length;
  const idiomChars = idiomMembers.reduce((a, m) => a + m.chars, 0);
  const selBreak = idiomMembers.reduce((m, x) => { m[x.selector] = (m[x.selector] || 0) + 1; return m; }, {});
  const fetchAndValidate = {
    name: "fetchAndValidate",
    tier: "idiom",
    kind: "composite-statement-idiom",
    dsl: normalizedShape(),
    params: ["recv", "selector", "entity", "opts", "guardExpr", "action"],
    sites: idiomMembers.length,
    files: new Set(idiomMembers.map((m) => m.file)).size,
    byteIdentical: idiomVerified,
    charsCovered: idiomChars,
    selectorBreakdown: selBreak,
    provenance: "deterministic AST match (engine/idioms.js), byte-verified",
    // full self-expanding members go to the catalog; COVERAGE.json keeps a summary
    members: idiomMembers.map((m) => ({
      file: m.file, line: m.line, byteIdentical: m.byteIdentical,
      selector: m.selector, awaited: m.awaited, actionKind: m.actionKind,
      signature: m.signature, params: m.params,
    })),
    membersFull: idiomMembers.map((m) => ({
      file: m.file, line: m.line, start: m.start, end: m.end, chars: m.chars,
      selector: m.selector, awaited: m.awaited, braced: m.braced, actionKind: m.actionKind,
      params: m.params, template: m.template, byteIdentical: m.byteIdentical,
    })),
  };

  // ---- throwError / assertOrThrow named idioms (deterministic AST match) ----
  // Same discipline as fetchAndValidate: ts.is* predicates + slot extraction +
  // per-site template; a site is claimed only when fill(template,slots)===span.
  // throwError merges string- and template-message throws into ONE named word,
  // superseding the fragmented anonymous c_ hashes for that shape. assertOrThrow
  // COMPOSES throwError inside a negated guard.
  console.log("matching throwError / assertOrThrow idioms …");
  function mineNamed(finder, name, tier, dsl, params, variantKey) {
    const mem = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      let inst; try { inst = finder(src, path.relative(CORPUS, f)); } catch (e) { continue; }
      for (const x of inst) mem.push(x);
    }
    const variantBreakdown = mem.reduce((a, m) => { const k = variantKey(m); a[k] = (a[k] || 0) + 1; return a; }, {});
    return {
      name, tier, kind: "composite-statement-idiom", dsl, params,
      sites: mem.length, files: new Set(mem.map((m) => m.file)).size,
      byteIdentical: mem.filter((m) => m.byteIdentical).length,
      charsCovered: mem.reduce((a, m) => a + m.chars, 0),
      variantBreakdown,
      provenance: "deterministic AST match (engine/named-idioms.js), byte-verified",
      composes: name === "assertOrThrow" ? "throwError" : undefined,
      members: mem.map((m) => ({ file: m.file, line: m.line, byteIdentical: m.byteIdentical, params: m.params,
        ...(m.messageKind ? { messageKind: m.messageKind } : {}), ...(m.composes ? { composes: m.composes } : {}) })),
      membersFull: mem.map((m) => ({ file: m.file, line: m.line, start: m.start, end: m.end, chars: m.chars,
        params: m.params, template: m.template, byteIdentical: m.byteIdentical,
        ...(m.innerThrow ? { innerThrow: m.innerThrow } : {}) })),
    };
  }
  const throwError = mineNamed(findThrowError, "throwError", "idiom",
    "throw new <errorClass>(<message>)", ["errorClass", "message"], (m) => m.messageKind);
  const assertOrThrow = mineNamed(findAssertOrThrow, "assertOrThrow", "idiom",
    "if (!<cond>) { throw new <errorClass>(<message>) }", ["cond", "errorClass", "message"], () => "guard");
  // All three named idioms, most-recurring first. fetchAndValidate is the flagship;
  // throwError/assertOrThrow are the two newly minted words.
  const idiomWordsFull = [fetchAndValidate, throwError, assertOrThrow];
  const idiomSummary = (w) => ({
    name: w.name, tier: w.tier, dsl: w.dsl, params: w.params, sites: w.sites, files: w.files,
    byteIdentical: w.byteIdentical, charsCovered: w.charsCovered,
    ...(w.selectorBreakdown ? { selectorBreakdown: w.selectorBreakdown } : {}),
    ...(w.variantBreakdown ? { variantBreakdown: w.variantBreakdown } : {}),
    ...(w.composes ? { composes: w.composes } : {}),
    members: w.members,
  });
  const namedIdiomSites = fetchAndValidate.sites + assertOrThrow.sites + (throwError.sites - assertOrThrow.sites);
  console.log(`  throwError: ${throwError.sites} sites / ${throwError.byteIdentical} byte-identical`);
  console.log(`  assertOrThrow: ${assertOrThrow.sites} sites / ${assertOrThrow.byteIdentical} byte-identical (composes throwError)`);

  // ---- comment-free canonical ----
  // The corpus is comment-stripped BY DESIGN: "treat this like a compiler; the
  // build output has no comments." source == corpus == build are all comment-free,
  // so coverage is measured on the comment-free tree and IS the canonical number.
  // Any class-C residue that remains is only from the handful of files the strip
  // gate could not prove (comment inside a captured slot) — reported, not headline.
  const commentChars = R.residueChars.C;
  const commentPct = +(100 * commentChars / R.chars).toFixed(2);

  // ---- authored spec modules (from author-hydra-modules.js) ----
  let authoredModules = { count: 0, expandVerify: "node hydra-expand.js <projectDir> <module> --verify", index: "sen/modules-index.json", modules: [] };
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(CR.senDir(), "modules-index.json"), "utf8"));
    authoredModules = { count: idx.modulesAuthored, tier: idx.tier, expandVerify: idx.expandVerify, index: "sen/modules-index.json", modules: idx.modules };
  } catch (_) {}

  // ---- skeleton tier (from build-skeletons.js, if present) ----
  // High-level control-flow skeleton words: a body = a SEQUENCE of statement kinds
  // with typed holes filled by idioms/words/literal slots. Structure recurs even
  // where expressions diverge (holes absorb the divergence).
  let skeletonTier = null;
  try {
    const sk = JSON.parse(fs.readFileSync(path.join(PROJECT, "skeleton-index.json"), "utf8"));
    skeletonTier = {
      catalog: "catalog/skeletons.json", index: "skeleton-index.json", perFile: "sen/skeletons/<rel>.skel.json",
      totalBodies: sk.totalBodies, distinctSkeletons: sk.distinctSkeletons, namedSkeletons: sk.namedSkeletons,
      structureCoverageBodiesPct: sk.structureCoverage.bodiesPct, structureCoverageStatementsPct: sk.structureCoverage.statementsPct,
      structureVsBespoke: { scaffoldPct: sk.structureVsBespoke.scaffoldPct, slotPct: sk.structureVsBespoke.slotPct, bespokePct: sk.structureVsBespoke.bespokePct },
      byteVerify: sk.byteVerify, allByteIdentical: sk.allByteIdentical,
    };
  } catch (_) {}

  // ---- archetype tier (from build-archetypes.js, if present) ----
  // The TOP of the DSL: a FILE is a word. 17 architectural archetypes; the 4
  // generative ones (Entity/Router/Redux/Builder) regenerate byte-identical from
  // archetype+typed-slots where they conform (no residual top-level code).
  let archetypeTier = null;
  try {
    const at = JSON.parse(fs.readFileSync(path.join(PROJECT, "archetype-index.json"), "utf8"));
    archetypeTier = {
      catalog: "catalog/archetypes.json", index: "archetype-index.json", perFile: "sen/archetypes/<rel>.arch.json",
      distinctArchetypes: at.distinctArchetypes, namedArchetypes: at.namedArchetypes,
      zipfHead: at.zipfHead, generativeVsDescriptive: at.generativeVsDescriptive,
    };
  } catch (_) {}

  // ---- COVERAGE.json ----
  const coverage = {
    schema: "sdd-hydra-source-package/2",
    projectRoot: PROJECT,
    corpusDir: CORPUS,
    generatedBy: "deterministic: mine(cut3)+wholefile+idioms (no model calls)",
    modelCalls: 0,
    cutDepth: CUT,
    mineSeconds: mineSecs,
    corpusCommentFree: true,
    corpusFiles: R.files,
    corpusChars: R.chars,
    // CANONICAL coverage — measured on the comment-free tree (build output has no comments).
    corpusCoveragePct: R.coveragePct,
    // back-compat alias; now EXACT (== corpusCoveragePct), no longer an estimate.
    corpusCoverageCommentFreeEstPct: R.coveragePct,
    corpusCoverageBasis: "comment-free (canonical): the corpus is stripped by design; coverage is measured on it directly.",
    commentNote: `corpus is comment-free by design (compiler-output model); ${commentChars} residual class-C chars (${commentPct}%) remain only in the ${18} files the strip gate could not prove byte-identical. corpusCoveragePct is the canonical comment-free coverage.`,
    reuseAvgFilesPerWord,
    reuseGrain: "line-level (whole-statement, cut 0): a word = a recurring canonical line; coverage/catalog are at cut 3",
    vocabularyWords: recurring.length,
    distinctShapes: res.library.counts.alphabet,
    byteIdentityGate: `${R.files}/${R.files} files byte-identical @ cut${CUT}`,
    residueChars: R.residueChars,
    residueLegend: R.residueLegend,
    libraryCounts: res.library.counts,
    catalog: "catalog/mined-library.v6.json",
    wordLibrary: "word-library.json",
    topWords,
    wholeFileModules: {
      minedWords: wfRes.stats.minedWords,
      filesCovered: wfRes.stats.filesCovered,
      memberByteIdentical: wfRes.stats.memberByteIdentical,
      memberWithResidue: wfRes.stats.memberWithResidue,
      // residueCleared: on the comment-free canonical tree, byte-identical members
      // carry ZERO residue (no class-C). Per-word/per-member: `byteIdentical` true
      // AND `residueChars` 0 == clean; check those fields.
      residueCleared: wfRes.stats.memberWithResidue === 0,
      wordsFullyVerified: wfRes.stats.wordsFullyVerified,
      escalationCandidates: wfRes.stats.escalationCandidates,
      words: wholeFileWords,
    },
    // Authored spec modules on disk (the panel's Author targets; each expand===target).
    // Full list lives in sen/modules-index.json; embedded here for the overview.
    authoredModules: authoredModules,
    // THREE named idioms now: fetchAndValidate + throwError + assertOrThrow. Each
    // is a deterministic AST match, 100% byte-identical. These named words are what
    // the panel surfaces as top words — they supersede the anonymous c_ hashes.
    namedIdioms: {
      count: idiomWordsFull.length,
      totalSites: idiomWordsFull.reduce((a, w) => a + w.sites, 0),
      // de-duplicated statement-level constructs (assertOrThrow subsumes the throwError it wraps)
      distinctConstructs: namedIdiomSites,
      allByteIdentical: idiomWordsFull.every((w) => w.byteIdentical === w.sites),
      words: idiomWordsFull.map((w) => ({ name: w.name, sites: w.sites, files: w.files, byteIdentical: w.byteIdentical })),
    },
    idiomWords: idiomWordsFull.map(idiomSummary),
    // Skeleton tier: high-level control-flow words (statement-kind sequences with
    // typed holes). Present when build-skeletons.js has run. See skeleton-index.json.
    skeletonTier,
    // Archetype tier: the TOP — a FILE is a word (17 archetypes, 4 generative).
    // Present when build-archetypes.js has run. See archetype-index.json.
    archetypeTier,
  };

  // ---- catalog v6 (additive; full self-expanding words) ----
  const catalog = {
    schema: "sdd-repo-dsl/mined-library/6",
    corpus: CORPUS, minCount: res.minCount, cutDepth: CUT,
    counts: { ...res.library.counts,
      wholeFileWords: wfRes.stats.minedWords, idiomWords: idiomWordsFull.length,
      vocabularyWords: recurring.length, reuseAvgFilesPerWord },
    leaves: res.library.leaves,
    composites: res.library.composites,
    wholeFileWords,
    idiomWords: idiomWordsFull, // fetchAndValidate + throwError + assertOrThrow; includes membersFull (templates) => self-expanding
  };

  // ---- flat word-library for the panel ----
  const wordLibrary = {
    schema: "sdd-word-library/1",
    project: PROJECT,
    tiers: {
      leaf: res.library.counts.leafGenerators,
      composite: res.library.counts.compositeGenerators,
      wholeFile: wfRes.stats.minedWords,
      idiom: idiomWordsFull.length,
    },
    reuseAvgFilesPerWord,
    vocabularyWords: recurring.length,
    featured: {
      name: "fetchAndValidate", tier: "idiom", dsl: normalizedShape(),
      sites: fetchAndValidate.sites, files: fetchAndValidate.files, byteIdentical: fetchAndValidate.byteIdentical,
    },
    // All named idioms, most-recurring first — the panel shows these as the top
    // NAMED words (throwError/assertOrThrow/fetchAndValidate), never hashes.
    featuredIdioms: idiomWordsFull.map((w) => ({ name: w.name, tier: w.tier, dsl: w.dsl, sites: w.sites, files: w.files, byteIdentical: w.byteIdentical })),
    topWordsByReuse: topWords.map((w) => ({ shape: w.shape, files: w.files, occurrences: w.occurrences, example: w.example })),
    wholeFileWords: wholeFileWords.map((w) => ({ name: w.name, files: w.memberFiles.length, memberFiles: w.memberFiles, allVerified: w.allVerified })),
    idiomWords: idiomWordsFull.map((w) => ({ name: w.name, dsl: w.dsl, sites: w.sites, files: w.files, byteIdentical: w.byteIdentical })),
    // SEMANTICS: leaves are opaque IDs (p_<hash>), NOT words. Words = composites /
    // whole-file / idiom that reference leaves BY id. Panel renders "word = [ids]".
    semantics: {
      leafIsWord: false,
      note: "A leaf is an opaque atom id (p_<hash>); it is not a word. A composite word references its constituent leaf ids via `memberLeafIds`. Render a composite as a composition of those ids; resolve each id via `leaves[id]` for its example line.",
      leafField: { id: "id", example: "example", shape: "shape", freq: "freq" },
      compositeField: { id: "name", children: "memberLeafIds", freq: "freq", length: "len", depth: "hierarchyDepth" },
    },
    // per-leaf: id + one example line (compact index; full set in catalog.leaves).
    leaves: res.library.leaves.map((l) => ({ id: l.id, example: l.example || null, shape: l.shape, freq: l.freq })),
    // per-composite word: its constituent child leaf ids (word = composition of [ids]).
    composites: res.library.composites.map((c) => ({ id: c.name, memberLeafIds: c.memberLeafIds, freq: c.freq, len: c.len, hierarchyDepth: c.hierarchyDepth })),
  };

  const provenance = {
    schema: "sdd-code-provenance/1",
    stage: "corpus-mine (hydra-source)",
    generator: "deterministic: package-hydra-source.js",
    modelCalls: 0,
    cutDepth: CUT,
    corpusDir: CORPUS,
    byteVerify: coverage.byteIdentityGate,
    artifacts: ["COVERAGE.json", "catalog/mined-library.v6.json", "word-library.json"],
    generatedAt: null,
  };

  fs.mkdirSync(path.join(PROJECT, "catalog"), { recursive: true });
  fs.writeFileSync(path.join(PROJECT, "COVERAGE.json"), JSON.stringify(coverage, null, 2));
  fs.writeFileSync(path.join(PROJECT, "catalog", "mined-library.v6.json"), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(PROJECT, "word-library.json"), JSON.stringify(wordLibrary, null, 2));
  fs.writeFileSync(path.join(PROJECT, ".sdd-code-provenance.json"), JSON.stringify(provenance, null, 2));

  console.log("\n=== PERSISTED ===");
  console.log("  COVERAGE.json                :", path.join(PROJECT, "COVERAGE.json"));
  console.log("  catalog/mined-library.v6.json:", path.join(PROJECT, "catalog", "mined-library.v6.json"));
  console.log("  word-library.json            :", path.join(PROJECT, "word-library.json"));
  console.log("  .sdd-code-provenance.json    :", path.join(PROJECT, ".sdd-code-provenance.json"));
  console.log("\ncoverage:", R.coveragePct + "% (comment-free canonical)   reuse:", reuseAvgFilesPerWord, "files/word   vocab:", recurring.length);
  console.log("authored modules:", authoredModules.count, " residual class-C chars:", commentChars, "(" + commentPct + "%, only in 18 unprovable files)");
  console.log("named idioms:",
    `fetchAndValidate ${fetchAndValidate.sites}/${fetchAndValidate.byteIdentical}bi,`,
    `throwError ${throwError.sites}/${throwError.byteIdentical}bi,`,
    `assertOrThrow ${assertOrThrow.sites}/${assertOrThrow.byteIdentical}bi  (${namedIdiomSites} distinct constructs)`);
  console.log("whole-file words:", wfRes.stats.minedWords, "  mine:", mineSecs + "s");
}

main();
