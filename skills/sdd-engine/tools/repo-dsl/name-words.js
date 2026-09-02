#!/usr/bin/env node
"use strict";
/**
 * name-words.js — STAGE 2, the naming pass (PRD §5D.2, §5D.3A, §5D.3E).
 *
 * Stage 1 (`npm run mine`) is deterministic and produces a correct, unreadable dictionary. This is
 * the other stage: the one that is ALLOWED a model, and is allowed it for exactly one thing.
 *
 *   THE SPLIT (§5D.3A, R-LANG-11/15). Code owns the grammar, the slot boundaries, the connectives,
 *   which alternative applies, and every hole fill. The model supplies THE SPELLING OF A
 *   NONTERMINAL and nothing else. There is no channel here through which a sentence, a connective
 *   or a slot boundary could arrive: the model is handed `#index` + evidence and may return only
 *   [{index, name, rationale}]. `refine-language.js` is the working precedent and this follows it.
 *
 *   THE ORDER (§5D.3E, R-LANG-20/21). Bottom-up, ascending depth, LEAVES FIRST. Every composite is
 *   prefix + exactly one leaf, so the dependency relation is a total order along each chain: a name
 *   at d=k that is not grounded in named parts at d=k-1 is not a name, it is a guess. `count`
 *   orders rows within a tier and decides nothing else. The plan is built by engine/naming-plan.js
 *   and CHECKED (`orderViolations`) before a single call is made.
 *
 *   THE TARGET (§5D.3E §6, R-LANG-22). leaves + used shallow words = 2,619 + 2,789 = 5,408, against
 *   3,237 for every word a render emits today. It is MORE names, not fewer, and every report this
 *   script prints states both figures so the cost is never read as a saving.
 *
 * COMMANDS
 *   plan [--to N]                  sweep the corpus, build the ordered work order, write
 *                                  <corpus>/.cache/spec-derived/naming-plan.json. ZERO model calls.
 *   name --tier N [--apply]        name one tier. Without --apply it is a dry run: proposals are
 *                                  reported and word-names.json is not touched (Q-9's worksheet,
 *                                  surviving as a mode rather than as a separate script).
 *
 * The corpus is READ-ONLY to `plan`. `name --apply` writes exactly one file: word-names.json.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./engine/enfile");
const EL = require("./engine/enlzw");
const CR = require("./engine/corpus-root");
const AC = require("./engine/artifact-contract");
const NP = require("./engine/naming-plan");
const NM = require("./engine/namer");
const GATE = require("./engine/naming-gate");
const { SKIP } = require("./engine/walk-skip");

const CORPUS = CR.corpusRoot();
const SRC = CR.sourceRoot();

const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
  }
  return o;
};

/**
 * THE SWEEP — which words the render actually uses. This is the same call the renderer makes, with
 * the same `wholeRunOk` gate (enfile.js:1026), because a plan built from a DIFFERENT span set would
 * name words the corpus never shows and miss words it does. §5D.3E's provenance table pins this.
 */
function sweep() {
  const index = EN.loadIndex(CORPUS);
  const cat = index._lzw;
  if (!cat) {
    console.error("name-words: no recursive catalog (index._lzw missing) — run `npm run mine` first.");
    process.exit(2);
  }
  const files = walk(SRC);
  const entries = [];
  let parsed = 0, skipped = 0;
  for (const abs of files) {
    let source;
    try { source = fs.readFileSync(abs, "utf8"); } catch (_) { skipped++; continue; }
    const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true);
    let spans;
    try { spans = EL.genSpans(sf, source, cat, { wholeRunOk: (run, rsf) => !!EN.chunkGloss(run, rsf) }); }
    catch (_) { skipped++; continue; }
    parsed++;
    for (const s of spans) {
      entries.push({
        axis: s.payload.a, id: s.payload.w, depth: s.depth, stmts: s.stmts,
        file: path.relative(SRC, abs),
        snippet: source.slice(s.start, s.end).replace(/\s+/g, " ").trim().slice(0, 160),
      });
    }
  }
  return { cat, entries, files: files.length, parsed, skipped };
}

function cmdPlan(args) {
  const toIx = args.indexOf("--to");
  const to = toIx >= 0 ? parseInt(args[toIx + 1], 10) : NP.DEFAULT_TO;
  const t0 = Date.now();
  const { cat, entries, files, parsed, skipped } = sweep();
  const used = NP.usedWordsFromSpans(entries);
  const tiers = NP.tiersOf(cat, used, { to });

  /* R-LANG-20 IS CHECKED, NOT ASSUMED. A plan that cannot be shown to be groundable is refused
   * here, before any model call — the cheapest possible place to find out. */
  const violations = NP.orderViolations(cat, tiers);
  if (violations.length) {
    console.error(`name-words: REFUSING the plan — ${violations.length} words would be named before their leaves (R-LANG-20).`);
    console.error("  first: " + JSON.stringify(violations[0]));
    process.exit(1);
  }

  const summary = NP.summarize(tiers, used.size);
  const body = {
    tiers: tiers.map((t) => ({ depth: t.depth, count: t.rows.length, rows: t.rows })),
    summary,
    order: {
      rule: "ascending depth, leaves (d=0) first; `count` orders rows WITHIN a tier only",
      requirement: "R-LANG-20, R-LANG-21 (PRD §5D.3E)",
      violations: 0,
      checkedBy: "engine/naming-plan.js orderViolations",
    },
    sweep: { files, parsed, skipped, spans: entries.length, distinctUsedWords: used.size, to },
  };
  const out = AC.stamp("naming-plan", body, { corpus: CORPUS });
  const dest = AC.pathFor("naming-plan", CORPUS);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 1) + "\n");

  console.log(`plan: swept ${parsed}/${files} files (${skipped} skipped), ${entries.length} spans, ${used.size} distinct used words   [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
  for (const t of summary.perTier) console.log(`  d=${t.depth}  ${String(t.names).padStart(5)} names`);
  console.log(`  ---------------------`);
  console.log(`  TARGET ${summary.namingTarget} names (R-LANG-22)`);
  console.log(`  ${summary.statedAsCost}`);
  console.log(`  -> ${dest}`);
}

/* ------------------------------------------------------------------ name a tier */

function cmdName(args) {
  const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
  const tierN = parseInt(arg("--tier", "0"), 10);
  const batchSize = parseInt(arg("--batch", "40"), 10);
  const limit = arg("--limit", null) ? parseInt(arg("--limit"), 10) : Infinity;
  const apply = args.includes("--apply");
  const opts = { stub: arg("--stub", null), retryStub: arg("--retry-stub", null), model: arg("--model", null), retries: parseInt(arg("--retries", "1"), 10) };

  const planPath = AC.pathFor("naming-plan", CORPUS);
  const planRes = AC.load("naming-plan", planPath, { optional: true });
  if (!planRes.ok) { console.error("name-words: " + planRes.reason + "\n  run `node name-words.js plan` first."); process.exit(2); }
  const plan = planRes.value;

  const tier = plan.tiers.find((t) => t.depth === tierN);
  if (!tier) { console.error(`name-words: the plan has no tier d=${tierN} (it holds ${plan.tiers.map((t) => t.depth).join(", ")})`); process.exit(2); }

  const wnPath = AC.pathFor("word-names", CORPUS);
  const existing = require("./engine/word-names").load(wnPath);

  /* R-LANG-20/21 AT RUN TIME, not only at plan time: a tier above 0 may not be named until the
   * leaves it stands on are. The plan's own leaf tier is the yardstick, so this cannot be satisfied
   * by an unrelated name that happens to be in the file. */
  if (tierN > 0) {
    const leafKeys = (plan.tiers.find((t) => t.depth === 0) || { rows: [] }).rows.map((r) => r.key);
    const missing = leafKeys.filter((k) => !existing.names[k]);
    if (missing.length) {
      console.error(`name-words: REFUSING d=${tierN} — ${missing.length} of ${leafKeys.length} leaf skeletons are still unnamed (R-LANG-20/21).`);
      console.error("  every composite is a named prefix plus ONE leaf, so a name here could not be grounded. Name d=0 first.");
      process.exit(1);
    }
  }

  const todo = tier.rows.filter((r) => !(r.depth === 0 ? existing.names[r.key] : existing.chunks[r.key])).slice(0, limit);
  if (!todo.length) { console.log(`d=${tierN}: nothing to name — all ${tier.rows.length} rows already have names.`); return; }

  /* Leaf names already on disk, so a chunk ask can show the model what its parts are called. This
   * is R-LANG-20's whole payoff, and it only exists because the order is bottom-up. */
  const namesBySym = {};
  for (const rec of Object.values(existing.names)) if (rec && rec.sym && rec.en) namesBySym[rec.sym] = rec.en;

  const ledger = NM.makeInjectivityLedger(Object.assign({}, existing.names, existing.chunks));
  const batches = NP.batches(todo, batchSize);
  const accepted = [], rejected = [], unnamed = [];
  let calls = 0;
  for (let i = 0; i < batches.length; i++) {
    const r = NM.nameBatch(batches[i], ledger, Object.assign({ namesBySym }, opts));
    accepted.push(...r.accepted); rejected.push(...r.rejected); unnamed.push(...r.unnamed); calls += r.calls;
    process.stdout.write(`  batch ${i + 1}/${batches.length}: +${r.accepted.length} named, ${r.rejected.length} rejected, ${r.calls} call(s)\n`);
  }

  const index = EN.loadIndex(CORPUS);
  const affected = [...new Set(accepted.flatMap((a) => {
    const row = todo.find((r) => r.key === a.key);
    return (row && row.files) || [];
  }))];
  const gate = GATE.gateNames(EN, index, SRC, affected, accepted);

  console.log(`\nd=${tierN}: ${todo.length} asked, ${accepted.length} accepted, ${rejected.length} rejected, ${unnamed.length} left unnamed, ${calls} model call(s)`);
  console.log(`gate: ${gate.passed ? "PASSED" : "FAILED"} — byte-identity + payload identity + coverage invariance over ${gate.checked} affected file(s); ${gate.proseChanged} of them read differently`);
  if (gate.passed && accepted.length && gate.proseChanged === 0) console.log("  WARNING: not one file reads differently — the names did not reach any label. Accepting them would be vacuous.");
  for (const f of gate.failures.slice(0, 5)) console.log(`  FAIL ${f.rel}: ${f.why}`);

  if (!apply) { console.log("\ndry run — word-names.json NOT written. Re-run with --apply to write these names."); return; }
  if (!gate.passed) { console.error("\nREFUSING to write: the gate failed. No name is applied when the batch does not gate."); process.exit(1); }

  const names = Object.assign({}, existing.names), chunks = Object.assign({}, existing.chunks);
  /* GATE.recordFor is the ONE definition of what a name looks like on disk, so the thing that was
   * measured above is byte-for-byte the thing written here. */
  const maps = { names, chunks };
  for (const a of accepted) { const { map, rec } = GATE.recordFor(a); maps[map][a.key] = rec; }
  const prior = JSON.parse(fs.readFileSync(wnPath, "utf8"));
  const body = AC.stamp("word-names", {
    note: prior.note, chunkKey: prior.chunkKey, nameKey: prior.nameKey,
    names, orphans: existing.orphans, chunks,
    modelCalls: (prior.modelCalls || 0) + calls,
    namedBy: { tier: tierN, accepted: accepted.length, rejected: rejected.length, gate: gate.checked, at: new Date().toISOString().slice(0, 10) },
  });
  fs.writeFileSync(wnPath, JSON.stringify(body, null, 1) + "\n");
  console.log(`applied -> ${wnPath}   (names ${Object.keys(names).length}, chunks ${Object.keys(chunks).length})`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "plan") cmdPlan(rest);
else if (cmd === "name") cmdName(rest);
else {
  console.error("usage: name-words.js plan [--to N]\n       name-words.js name --tier N [--batch 40] [--limit N] [--stub f] [--apply]");
  process.exit(2);
}
