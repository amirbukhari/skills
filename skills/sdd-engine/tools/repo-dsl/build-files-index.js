#!/usr/bin/env node
"use strict";
/**
 * build-files-index — the whole-repo FILE BROWSE index, at the path the panel reads.
 *
 * Writes ONE artifact:
 *   <CORPUS>/files-index.json    <- per-file browse rows + corpus rollup
 *
 * WHY THIS FILE EXISTS. The only producer of `files-index.json` was
 * `archive/build-compositions.js`, a compose-tier tool that is archived AND carries
 * `PROJECT = "/home/amir/Documents/Rentsync/delonix/hydra-source"` hard-coded at line 21 — a path
 * this project is forbidden to touch and which is not the corpus. So the artifact had no live
 * producer at all, and the panel surface that reads it could never have been satisfied by anything
 * in this tree. This is that producer, rebuilt over the live tier.
 *
 * SOURCE OF TRUTH: the §8B-stamped `en-index` (`.cache/spec-derived/en-index.json`), which already
 * holds one row per rendered file. Nothing here re-measures the corpus — a second measurement of
 * the same thing is a second answer to drift away from. If `en-index` is missing this refuses and
 * names `npm run render`; it never writes a partial index.
 *
 * NOT IN THE §8B REGISTRY, deliberately, and this is the same argument recorded for
 * `archetype-index.json`: every registered kind resolves into `AC.HOMES` (`sen/catalog` or
 * `.cache/spec-derived`), so registering this kind would MOVE the file off the corpus root and
 * break the consumer that just reported it missing there. It therefore carries the full §8B header
 * — all five keys, with a real `AC.fingerprintOf` seal — without claiming a registry entry.
 * A hand-written header with no fingerprint is what §8B exists to prevent; a real seal at an
 * unregistered path is the honest half-measure until the path question is decided.
 *
 *   node build-files-index.js [--help]
 */
const fs = require("fs");
const path = require("path");
const AC = require("./engine/artifact-contract");
const CR = require("./engine/corpus-root");

/* Compose-era fields the archived producer published that the live tier does NOT measure. Named
 * rather than zero-filled: a dashboard reading a fabricated 0 cannot tell it from a real one. */
const UNAVAILABLE = {
  wordCoveragePct: "compose-tier word/meaningful char ratio — the live tier measures englishPct over bytes instead",
  bespokeSlots: "compose-tier literal token count — no live equivalent",
  bespokeSlotRatioPct: "derived from bespokeSlots",
  structuralSharePct: "compose-tier punctuation/whitespace share — no live equivalent",
  distinctWords: "compose dictionary size — the live dictionary is generators-lzw, counted per corpus not per file",
  topWords: "compose dictionary head — see sen/catalog/generators-lzw.json",
  wordDictionary: "catalog/compose-words.json is a compose-tier artifact with no live producer",
  perFileModuleTemplate: ".cache/compose/files/<rel>.calc — the compose IR is gone; the per-file artifact is sen/files/<rel>.en",
};

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node build-files-index.js\n\n" +
      "  Writes <CORPUS>/files-index.json from the stamped en-index. Reads SOURCE not at all.\n" +
      "  Refuses if en-index is absent, naming the producer that writes it.");
    return 0;
  }
  const unknown = argv.filter((a) => a.startsWith("-"));
  if (unknown.length) { console.error(`unknown flag: ${unknown[0]}  (see --help)`); return 2; }

  const CORPUS = CR.corpusRoot();
  const enIndexPath = AC.pathFor("en-index");
  if (!fs.existsSync(enIndexPath)) {
    console.error(`REFUSING to write files-index.json: no en-index at\n  ${enIndexPath}\n` +
      "  It is written by the render step. Run `npm run render` first.\n" +
      "  Nothing was written — a browse index built from a guess is worse than a missing one.");
    return 3;
  }
  const en = AC.load("en-index", enIndexPath);          // validated read: schema + fingerprint + corpus pin
  const rows = en.perFile || [];
  if (!rows.length) { console.error("REFUSING: en-index carries no perFile rows."); return 3; }

  /* Per-file byte-identity is not an en-index per-file field; it is a corpus-wide gate. Deriving
   * per-file `true` is sound ONLY when the gate says every file passed and the counts agree.
   * Otherwise the field is omitted, never guessed. */
  const gate = en.gate || {};
  const perFileByteIdentity = !!gate.allByteIdentical &&
    gate.totalFiles === rows.length && gate.byteIdentical === rows.length;

  const senRel = path.join(CR.LAYOUT.sen, "files");
  let enPresent = 0;
  const files = rows.map((r) => {
    const enRel = path.join(senRel, r.rel + ".en");
    const exists = fs.existsSync(path.join(CORPUS, enRel));
    if (exists) enPresent++;
    const dir = path.dirname(r.rel) === "." ? "" : path.dirname(r.rel);
    return {
      rel: r.rel, dir, base: path.basename(r.rel),
      en: enRel, enExists: exists,
      bytes: r.totalBytes, englishBytes: r.englishBytes, englishPct: r.englishPct,
      oneWord: r.oneWord,
      bodyStatements: r.bodyStatements, collapsedStatements: r.collapsedStatements,
      residualStatements: r.residualStatements,
      reviewSurfaceTop: r.reviewSurfaceTop, reviewSurfaceWhole: r.reviewSurfaceWhole,
      chunks: r.chunks, nestMaxDepth: r.nestMaxDepth,
      ...(perFileByteIdentity ? { byteIdentical: true } : {}),
    };
  });

  const rs = en.reviewSurface || {};
  const body = {
    kind: "whole-repo file browse index",
    step: "post-render rollup",
    modelCalls: 0,
    producedBy: "build-files-index.js (deterministic, no model)",
    derivedFrom: { artifact: "en-index", path: path.relative(CORPUS, enIndexPath), fingerprint: en.fingerprint },
    regenerate: "npm run render && npm run files-index",
    perFileArtifact: path.join(senRel, "<rel>.en"),
    registryStatus: "NOT a §8B registry kind — registering it would move this file off the corpus root, " +
      "which is the path its consumer reads. Header + fingerprint are real; the registry entry is not claimed.",
    totalFiles: files.length,
    rollup: {
      totalFiles: files.length,
      enFilesPresent: enPresent,
      byteIdenticalFiles: gate.byteIdentical ?? null,
      allByteIdentical: gate.allByteIdentical ?? null,
      perFileByteIdentityDerivable: perFileByteIdentity,
      englishBytesPct: en.englishBytesPct,
      oneWordFiles: rs.oneWordFiles, oneWordPct: rs.oneWordPct,
      reviewSurfaceTop: rs.reviewSurfaceTop, reviewSurfaceWhole: rs.reviewSurface,
      chunks: rs.chunks, chunksAtomic: rs.chunksAtomic, chunksStructural: rs.chunksStructural,
      nestMaxDepth: rs.nestMaxDepth,
      collapseRatioPct: rs.collapseRatioPct,
    },
    topEnglishFiles: (en.topEnglishFiles || []).map((f) => ({ rel: f.rel, englishPct: f.englishPct })),
    worstReviewSurface: (rs.worstFiles || []).slice(0, 10),
    unavailable: UNAVAILABLE,
    files,
  };

  const out = { schema: "sdd-repo-dsl/files-index/1", artifactVersion: 1, corpus: CORPUS,
    generated: new Date().toISOString().slice(0, 10) };
  out.fingerprint = AC.fingerprintOf({ ...out, ...body });
  Object.assign(out, body);

  const dest = path.join(CORPUS, "files-index.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 1));

  console.log("=== WHOLE-REPO FILE INDEX ===");
  console.log(`  rows ......................... ${files.length}   (from en-index ${en.fingerprint})`);
  console.log(`  .en present on disk .......... ${enPresent}/${files.length}`);
  console.log(`  byte-identical ............... ${gate.byteIdentical}/${gate.totalFiles}   per-file field ${perFileByteIdentity ? "derived" : "OMITTED (gate not all-pass)"}`);
  console.log(`  one word per file ............ ${rs.oneWordFiles}/${files.length} (${rs.oneWordPct}%)`);
  console.log(`  english coverage (bytes) ..... ${en.englishBytesPct}%`);
  console.log(`  compose-era fields unavailable ${Object.keys(UNAVAILABLE).length} (named in .unavailable, not zero-filled)`);
  console.log(`  wrote ........................ ${dest}  (${fs.statSync(dest).size} bytes, fingerprint ${out.fingerprint})`);
  return 0;
}
if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main };
