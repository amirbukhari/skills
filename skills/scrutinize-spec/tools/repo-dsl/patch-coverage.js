"use strict";
/* Additive patch of COVERAGE.json: fold in the DISCOVERED statement-idiom tier
 * and the honest coverage/ceiling result. Does not alter existing deterministic
 * fields; adds `discoveredIdiomTier` and `honestCeiling`, and refreshes the
 * `namedIdioms` narrative to point at the discovered tier. Zero model calls. */
const fs = require("fs");
const path = require("path");
const PROJECT = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const cov = JSON.parse(fs.readFileSync(path.join(PROJECT, "COVERAGE.json"), "utf8"));
const cat = JSON.parse(fs.readFileSync(path.join(PROJECT, "catalog", "statement-idioms.json"), "utf8"));

const top = cat.idioms.slice(0, 25).map((i) => ({ name: i.name, sites: i.sites, files: i.files, chars: i.chars, category: i.category, example: i.example, gloss: i.gloss || null }));

cov.discoveredIdiomTier = {
  catalog: "catalog/statement-idioms.json",
  provenance: "deterministic frequency mining of statement shapes (engine/mine-statement-idioms.js); byte-exact per-site templates. Naming overlay: top 40 by LLM, rest deterministic. Mining modelCalls: 0.",
  grain: "cut0 (whole statement) — a discovered idiom is a statement SHAPE (ids/nums/strings lifted to typed slots) recurring >= minSites across >= minFiles.",
  minSites: cat.minSites, minFiles: cat.minFiles,
  idiomCount: cat.idioms.length,
  priorHandAuthored: 3,
  sites: cat.census.promotedSites,
  byteIdentityGate: cat.byteIdentityGate,
  statementsCoveredPct: cat.coverage.idiomStatementsPct,
  corpusCharsCoveredPct: cat.coverage.idiomCharsPct,
  categoryCounts: cat.categoryCounts,
  namingModelCalls: cat.naming.namingModelCalls,
  topIdioms: top,
  note: "Discovery independently re-found the hand-authored throwError (throwErrorLiteral, 385 sites) and assertOrThrow families — a cross-check that the frequency method surfaces the same idioms a human picked, plus ~600 more.",
};

cov.honestCeiling = {
  question: "Can deterministic mining cover ~90% of the corpus?",
  answer: "No. The ceiling is ~53% char coverage. It is a structural property of the corpus, not a mining-effort limit.",
  headlineStrictPct: cat.coverage.cut3.strictPct,          // 46.1 — the old rule (recurs+typed+canonical)
  headlineIdiomInclusivePct: cat.coverage.cut3.namedPct,   // 52.9 — recurs + per-site template + free-text-slot idioms, all byte-exact
  policyLadder: {
    strict_recurs_typed_canonical: cat.coverage.cut3.strictPct,
    plus_persite_template_recoverD: cat.coverage.cut3.persitePct,
    plus_named_freetextslot_recoverB: cat.coverage.cut3.namedPct,
  },
  ceilingPct: cat.coverage.ceilingPct,
  ceilingCurve: cat.coverage.ceilingCurve,
  why: "~44% of statement-chars are freq-1 shapes: statements whose canonical structure appears exactly ONCE in 1044 files. No frequency threshold can promote a pattern that occurs once. Deeper AST cutting (cut3->cut6) adds +0.3 pts then saturates, confirming the recurrence is exhausted, not under-mined.",
  interpretation: "Repetition in this codebase lives in the SCAFFOLDING (imports, guards, returns, framework/test boilerplate, ORM access) — captured: idioms cover 48.8% of STATEMENTS. Divergence lives in the BUSINESS EXPRESSIONS, which are long and unique — so those same idioms cover only ~30% of CHARS. The gap between 48.8% of statements and 30% of chars IS the finding: the language is real for structure, bespoke for logic.",
  gate: "byte-exact held throughout: 20163/20163 promoted idiom sites and 1044/1044 files rebuild fill(template,slots)===source. Coverage was raised only by counting bytes a byte-exact template reproduces, never by loosening the gate.",
};

// refresh the namedIdioms narrative (keep the 3 hand-authored word records intact)
cov.namedIdioms.discoveredIdiomCount = cat.idioms.length;
cov.namedIdioms.narrative = `3 hand-authored named idioms remain the flagship byte-verified words; the discovered tier adds ${cat.idioms.length} statement idioms by frequency mining (see discoveredIdiomTier). Total idiom vocabulary: ${cat.idioms.length} (was 3).`;

fs.writeFileSync(path.join(PROJECT, "COVERAGE.json"), JSON.stringify(cov, null, 2));
console.log("patched COVERAGE.json:");
console.log("  discoveredIdiomTier.idiomCount =", cov.discoveredIdiomTier.idiomCount, "(was 3)");
console.log("  honestCeiling.headlineStrictPct =", cov.honestCeiling.headlineStrictPct);
console.log("  honestCeiling.headlineIdiomInclusivePct =", cov.honestCeiling.headlineIdiomInclusivePct);
console.log("  honestCeiling.ceilingPct =", cov.honestCeiling.ceilingPct);
