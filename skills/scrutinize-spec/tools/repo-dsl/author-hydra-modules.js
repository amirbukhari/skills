"use strict";
/**
 * author-hydra-modules — DETERMINISTIC first-batch authoring of hydra-source
 * spec modules (no model). Mines the WHOLE-FILE words on the (comment-stripped)
 * corpus, persists their self-expanding definitions, and writes one authored
 * module per byte-verifying member file:
 *
 *   hydra-source/spec/modules/<slug>/composition.calc   <- the whole-file WORD CALL
 *   hydra-source/spec/modules/<slug>/spec.md            <- intent + build/verify note
 *   hydra-source/catalog/dsl-words.json                 <- word defs (self-expanding)
 *
 * The composition.calc for a module is a single whole-file word call. Expanding
 * it against dsl-words.json reproduces the target .ts BYTE-FOR-BYTE. Every module
 * we write is re-expanded and byte-compared here; a module is only emitted when
 * expand === source. This is the panel's Author target — spec/modules existing is
 * what clears the "mined but no authored spec modules — read-only" dead-end.
 *
 *   node author-hydra-modules.js
 */
const fs = require("fs");
const path = require("path");
const { tokenize } = require("./engine/fanout");
const wf = require("./engine/wholefile.js");
const { printCalc, parseCalc } = require("./engine/hydra-dsl.js");

const PROJECT = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const CORPUS = PROJECT;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".worktrees", "dist", "build", "coverage", "spec", "catalog"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Expand a word def by name + params map (self-contained, mirrors hydra-dsl). */
function expandDef(def, paramsMap) {
  // reuse wholefile.expandWord (def carries items/tokenPlans/bakedGaps/params)
  return wf.expandWord(def, paramsMap);
}

function main() {
  const files = walk(CORPUS).sort();
  const perFile = files.map((f) => {
    const s = fs.readFileSync(f, "utf8");
    const tk = tokenize(f, s);
    return { file: f, rel: path.relative(CORPUS, f), source: s, tokens: tk.tokens, gaps: tk.gaps };
  });

  const { words, stats } = wf.mineWholeFile(perFile, { minClusterSize: 2 });

  // ---- persist word defs (self-expanding) ----
  const wordDefs = {};
  for (const w of words) {
    wordDefs[w.name] = {
      name: w.name, tier: w.tier, memberFiles: w.memberFiles,
      params: w.params, items: w.items, tokenPlans: w.tokenPlans, bakedGaps: w.bakedGaps,
      allVerified: w.allVerified, production: w.production,
    };
  }
  fs.mkdirSync(path.join(PROJECT, "catalog"), { recursive: true });
  fs.writeFileSync(path.join(PROJECT, "catalog", "dsl-words.json"),
    JSON.stringify({ schema: "sdd-hydra-dsl-words/1", project: PROJECT, generatedBy: "author-hydra-modules.js (deterministic)", modelCalls: 0, words: wordDefs }, null, 2));

  // ---- slugging (basename if unique, else rel-path slug) ----
  const memberRels = [];
  for (const w of words) for (const v of w.verify) if (v.byteIdentical) memberRels.push(v.file);
  const baseCount = {};
  for (const rel of memberRels) { const b = path.basename(rel, ".ts"); baseCount[b] = (baseCount[b] || 0) + 1; }
  const slugFor = (rel) => {
    const b = path.basename(rel, ".ts");
    if (baseCount[b] === 1) return b;
    return rel.replace(/\.ts$/, "").replace(/[\/\\]/g, "__");
  };

  // ---- author one module per byte-verifying member ----
  const modulesDir = path.join(PROJECT, "spec", "modules");
  fs.mkdirSync(modulesDir, { recursive: true });
  const authored = [];
  const failed = [];
  for (const w of words) {
    for (const v of w.verify) {
      if (!v.byteIdentical) continue;
      const slug = slugFor(v.file);
      const calc = printCalc(w.name, v.params);
      // SELF-VERIFY: parse our own .calc and expand against the persisted def
      const { word, params } = parseCalc(calc);
      const def = wordDefs[word];
      const expanded = expandDef(def, params);
      const real = fs.readFileSync(path.join(CORPUS, v.file), "utf8");
      if (expanded !== real) { failed.push({ rel: v.file, slug, reason: "round-trip mismatch" }); continue; }

      const dir = path.join(modulesDir, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "composition.calc"), calc);
      fs.writeFileSync(path.join(dir, "spec.md"), specMd(slug, v.file, w));
      authored.push({ module: slug, word: w.name, targetPath: v.file, byteIdentical: true, residueChars: 0, residueClass: null });
    }
  }

  // ---- persist a modules index the panel can list without scanning dirs ----
  fs.writeFileSync(path.join(PROJECT, "spec", "modules-index.json"), JSON.stringify({
    schema: "sdd-hydra-modules-index/1", project: PROJECT, generatedBy: "author-hydra-modules.js", modelCalls: 0,
    tier: "whole-file-word", wordsMined: stats.minedWords, wordsFullyVerified: stats.wordsFullyVerified,
    modulesAuthored: authored.length, expandVerify: "node hydra-expand.js <projectDir> <module> --verify",
    modules: authored,
  }, null, 2));

  console.log("=== AUTHORED FIRST BATCH (whole-file words) ===");
  console.log("  whole-file words mined      :", stats.minedWords);
  console.log("  words fully verified        :", stats.wordsFullyVerified);
  console.log("  member files byte-identical :", stats.memberByteIdentical, "/", stats.memberByteIdentical + stats.memberWithResidue);
  console.log("  MODULES AUTHORED            :", authored.length, "(each expand===source, re-verified)");
  if (failed.length) { console.log("  FAILED round-trip           :", failed.length); for (const f of failed) console.log("    ", f.slug, f.reason); }
  console.log("\n  wrote:", path.join(PROJECT, "spec", "modules") + "/<slug>/{composition.calc,spec.md}");
  console.log("  index:", path.join(PROJECT, "spec", "modules-index.json"));
  console.log("  words:", path.join(PROJECT, "catalog", "dsl-words.json"));
  console.log("\n  sample modules:");
  for (const a of authored.slice(0, 5)) console.log("    -", a.module, " <-", a.targetPath);
}

function specMd(slug, targetPath, word) {
  return `# ${slug}

Self-hosting module, expressed by the mined whole-file DSL word **\`${word.name}\`**
(a cluster of ${word.memberFiles.length} structurally-identical files; this module is one member).

## Intent

Expanding \`composition.calc\` reproduces the canonical file at
\`${targetPath}\` — the same tree we mine and the same tree we build into
(source == corpus == build). Authored deterministically (whole-file structural
match); no model in the path.

## Shape

- word: \`${word.name}\`  (${word.production})
- params (${word.params.length}): ${word.params.map((p) => `\`${p.name}:${p.type}\``).join(", ")}

## Build / verify

\`\`\`
node hydra-expand.js <projectDir> ${slug} --verify
\`\`\`

Expand \`composition.calc\` against \`catalog/dsl-words.json\` and it lands at
\`${targetPath}\`, byte-identical to what is already there.
`;
}

main();
