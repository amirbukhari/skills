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
const RC = require("./engine/rule-coverage");
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
  const sources = [];
  let parsed = 0, skipped = 0;
  for (const abs of files) {
    let source;
    try { source = fs.readFileSync(abs, "utf8"); } catch (_) { skipped++; continue; }
    sources.push({ rel: path.relative(SRC, abs), source });
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
  return { cat, entries, sources, files: files.length, parsed, skipped };
}

function cmdPlan(args) {
  const toIx = args.indexOf("--to");
  const to = toIx >= 0 ? parseInt(args[toIx + 1], 10) : NP.DEFAULT_TO;
  const t0 = Date.now();
  const { cat, entries, sources, files, parsed, skipped } = sweep();
  const used = NP.usedWordsFromSpans(entries);
  const tiers = NP.tiersOf(cat, used, { to });

  /* RULE COVERAGE (§5D.3F §2d, §5D.3G). The 80-leaf pilot named leaves a node-kind rule already
   * rendered and cost the corpus 72% of its concrete identifiers. So the plan no longer asks the
   * model about a leaf without first MEASURING whether a rule reaches it. Leaves only: a composite's
   * name is a whole-chunk name (R-LANG-19), which outranks per-statement rules by design and is not
   * in competition with them. */
  const leafKeys = new Set(tiers[0].rows.map((r) => r.key));
  const scan = RC.scanClauses(EN, sources);
  const cov = RC.summarize(scan, EN, leafKeys);
  for (const row of tiers[0].rows) {
    const c = cov.perKey.get(row.key) || RC.classify([], EN.SAYS_NOTHING);
    const seen = scan.get(row.key);
    row.rule = { klass: c.klass, namable: c.name, reason: c.reason, distinctClauses: c.distinct, instances: c.instances,
      sampleClause: seen && seen.clauses.find(Boolean) ? String(seen.clauses.find(Boolean)).slice(0, 120) : null };
  }
  /* Namable first, then by sites — the order the model is spent in. Rule-covered rows STAY IN THE
   * PLAN (R-LANG-21: d=0 is in scope; they are accounted for by code rather than by a name). */
  tiers[0].rows.sort((a, b) => (Number(b.rule.namable) - Number(a.rule.namable)) || (b.sites - a.sites)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

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
    ruleCoverage: {
      measuredOver: "every foldable statement in the corpus, clause by clause, through enfile.spanActions",
      criterion: "a clause that VARIES across instances is one no single name can reproduce (§5D.3F §2d)",
      byKlass: cov.byKlass,
      leafSkeletons: cov.total,
      namable: cov.namable,
      ruleCovered: cov.total - cov.namable,
    },
  };
  const out = AC.stamp("naming-plan", body, { corpus: CORPUS });
  const dest = AC.pathFor("naming-plan", CORPUS);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 1) + "\n");

  console.log(`plan: swept ${parsed}/${files} files (${skipped} skipped), ${entries.length} spans, ${used.size} distinct used words   [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
  for (const t of summary.perTier) console.log(`  d=${t.depth}  ${String(t.names).padStart(5)} names`);
  console.log(`  ---------------------`);
  console.log(`  LEAF RULE COVERAGE (d=0), measured over ${cov.total} skeletons:`);
  for (const [k, v] of Object.entries(cov.byKlass).sort((a, b) => b[1].skeletons - a[1].skeletons)) {
    console.log(`    ${k.padEnd(24)} ${String(v.skeletons).padStart(5)} skeletons  ${String(v.sites).padStart(6)} sites   ${k.startsWith("unreached") ? "-> NAME" : "-> skip (a rule already renders it)"}`);
  }
  console.log(`    ${"".padEnd(24)} ${String(cov.namable).padStart(5)} namable, ${cov.total - cov.namable} left to the rules`);
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
    /* AMENDED for §5D.3G: the test is whether every leaf is ACCOUNTED FOR, not whether every leaf
     * carries a NAME. The rule-coverage filter decides *who* accounts for a leaf — a node-kind rule
     * or a name — and 1,394 of 1,414 are the rule's. Demanding names for those would refuse every
     * composite tier forever, and would be demanding exactly the 72%-identifier-loss pilot as a
     * precondition. R-LANG-20/21 is unweakened: what it requires is that a composite's parts are
     * SAID by something, so the model is never asked to name a chain it cannot read. */
    const leafRows = (plan.tiers.find((t) => t.depth === 0) || { rows: [] }).rows;
    const unaccounted = leafRows.filter((r) => !existing.names[r.key] && !(r.rule && !r.rule.namable));
    if (unaccounted.length) {
      console.error(`name-words: REFUSING d=${tierN} — ${unaccounted.length} of ${leafRows.length} leaf skeletons are neither named nor rule-covered (R-LANG-20/21).`);
      console.error("  every composite is a prefix plus ONE leaf, so a name here could not be grounded. Account for d=0 first.");
      console.error("  (a leaf a node-kind rule already renders IS accounted for — §5D.3G; run `plan` if these annotations are stale.)");
      process.exit(1);
    }
    const named = leafRows.filter((r) => existing.names[r.key]).length;
    console.log(`d=0 is accounted for: ${named} named + ${leafRows.length - named} rule-covered = ${leafRows.length} leaf skeletons (R-LANG-21).`);
  }

  /* THE FILTER (§5D.3F §2d). A leaf a node-kind rule already renders is NOT asked about: the pilot
   * measured that naming those costs 72% of the corpus's concrete identifiers. `--include-rule-covered`
   * exists to re-measure that claim, not to be used in a production run. */
  const includeCovered = args.includes("--include-rule-covered");
  const notYetNamed = tier.rows.filter((r) => !(r.depth === 0 ? existing.names[r.key] : existing.chunks[r.key]));
  const ruleCovered = notYetNamed.filter((r) => r.rule && !r.rule.namable);
  const todo = (includeCovered ? notYetNamed : notYetNamed.filter((r) => !r.rule || r.rule.namable)).slice(0, limit);
  if (tierN === 0 && ruleCovered.length && !includeCovered) {
    console.log(`d=0: ${ruleCovered.length} of ${notYetNamed.length} unnamed leaves are already rendered by a node-kind rule — NOT asking about them (§5D.3F §2d).`);
  }
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
  console.log(`gate: ${gate.passed ? "PASSED" : "FAILED"} — byte-identity + payload identity + coverage invariance + detail retention + fold invariance over ${gate.checked} affected file(s); ${gate.proseChanged} of them read differently`);
  /* The pilot gated clean on the first three checks and still cost the corpus 20,029 identifiers,
   * so this figure is printed on every run, pass or fail — it is the one a reader must see. */
  console.log(`      concrete identifiers in the prose: ${gate.detailBefore} -> ${gate.detailAfter}` +
    (gate.detailAfter < gate.detailBefore ? `  (LOST ${gate.detailBefore - gate.detailAfter})` : "  (none lost)"));
  console.log(`      clauses the labels emitted:        ${gate.clausesBefore} -> ${gate.clausesAfter}` +
    (gate.clausesAfter > gate.clausesBefore ? `  (a name SPLIT a fold)` : gate.clausesAfter < gate.clausesBefore ? "  (adjacent identicals collapsed — cardinality, R-LANG-16)" : "  (structure unchanged)"));
  if (gate.passed && accepted.length && gate.proseChanged === 0) console.log("  WARNING: not one file reads differently — the names did not reach any label. Accepting them would be vacuous.");
  for (const f of gate.failures.slice(0, 5)) console.log(`  FAIL ${f.rel}: ${f.why}`);

  if (!apply) {
    /* A dry run whose proposals are never shown is not a review, it is a slower --apply. */
    console.log("\nproposed names:");
    for (const a of accepted) {
      const row = todo.find((r) => r.key === a.key) || {};
      const was = (row.rule && row.rule.sampleClause) || "";
      console.log(`  ${String(row.sites || a.sites || 0).padStart(5)}  ${a.name}`);
      if (was) console.log(`         was: ${was}`);
    }
    console.log("\ndry run — word-names.json NOT written. Re-run with --apply to write these names.");
    return;
  }
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

/**
 * retire [--apply] — DROP NAMES A RULE HAS OVERTAKEN. The counterpart of the rule-coverage filter
 * (§5D.3G), and the filter's own logic run in the other direction.
 *
 * The filter decides, BEFORE a call is made, that a leaf a node-kind rule already renders is not
 * worth naming. But rules are written continuously, and a name authored when no rule reached its
 * skeleton becomes a DOWNGRADE the moment one does — it is hole-free, and the rule that overtook it
 * is hole-filled. Measured the first time this happened: R-LANG-24 (naming a call's receiver) took
 * 14 of the 20 authored leaf names from "the best available clause" to "1,768 identifiers worse
 * than doing nothing". Nothing in the gate catches that, because the gate scores a BATCH being
 * applied; these names were already on disk and were correct when they were written.
 *
 * So a name is not a permanent asset. It is a claim that no rule says this better, and this command
 * re-tests the claim against today's rules and retires the names that no longer hold it. It never
 * touches a name whose skeleton is still unreached, and it is measured, not assumed: every retirement
 * is expected to GAIN identifiers, and the command reports the corpus figure either way.
 */
function cmdRetire(args) {
  const apply = args.includes("--apply");
  const planRes = AC.load("naming-plan", AC.pathFor("naming-plan", CORPUS), { optional: true });
  if (!planRes.ok) { console.error("name-words: " + planRes.reason + "\n  run `node name-words.js plan` first."); process.exit(2); }
  const rowByKey = new Map();
  for (const t of planRes.value.tiers) for (const r of t.rows) rowByKey.set(r.key, r);

  const wnPath = AC.pathFor("word-names", CORPUS);
  const existing = require("./engine/word-names").load(wnPath);
  const covered = [], kept = [], unknown = [];
  for (const key of Object.keys(existing.names)) {
    const row = rowByKey.get(key);
    if (!row || !row.rule) { unknown.push(key); continue; }   // not in today's plan: leave it alone
    (row.rule.namable ? kept : covered).push({ key, en: existing.names[key].en, sym: existing.names[key].sym, rule: row.rule });
  }
  console.log(`word-names holds ${Object.keys(existing.names).length} leaf names: ${covered.length} now rule-covered, ${kept.length} still unreached, ${unknown.length} not in the plan.`);
  if (!covered.length) { console.log("nothing to retire — every authored name still says more than the rules do."); return; }

  /* the measurement that decides it: what does the corpus say with these names, and without them */
  const index = EN.loadIndex(CORPUS);
  const files = walk(SRC);
  const detail = () => { let d = 0; for (const f of files) { try { d += GATE.detailOf(EN.renderFileEn(fs.readFileSync(f, "utf8"), index).en); } catch (_) {} } return d; };
  const live = EN.NAMES.names;
  const saved = Object.assign({}, live);
  const before = detail();
  for (const c of covered) delete live[c.key];
  const after = detail();
  Object.assign(live, saved);

  console.log("\nretiring:");
  for (const c of covered.slice(0, 25)) console.log(`  ${JSON.stringify(c.en)}\n     rule now says: ${JSON.stringify(c.rule.sampleClause || "")}`);
  if (covered.length > 25) console.log(`  … and ${covered.length - 25} more`);
  console.log(`\nconcrete identifiers across ${files.length} files: ${before} -> ${after}` +
    (after > before ? `  (GAIN ${after - before} — the rules say more than these names did)`
     : after === before ? "  (no change — these names were saying exactly what the rules say)"
     : `  (LOSS ${before - after} — REFUSING)`));
  if (after < before) { console.error("\nREFUSING: retiring these names would cost the corpus detail. That contradicts the classification; re-run `plan`."); process.exit(1); }
  if (!apply) { console.log("\ndry run — word-names.json NOT written. Re-run with --apply to retire these."); return; }

  const names = {};
  for (const k of Object.keys(existing.names)) if (!covered.some((c) => c.key === k)) names[k] = existing.names[k];
  const prior = existing;
  const body = AC.stamp("word-names", {
    note: prior.note, chunkKey: prior.chunkKey, nameKey: prior.nameKey,
    names, orphans: prior.orphans, chunks: prior.chunks,
    modelCalls: prior.modelCalls || 0,
    namedBy: prior.namedBy,
    retiredBy: { count: covered.length, reason: "a node-kind rule now renders these skeletons (§5D.3G)", detail: `${before} -> ${after}`, at: new Date().toISOString().slice(0, 10) },
  }, { corpus: CORPUS });
  fs.writeFileSync(wnPath, JSON.stringify(body, null, 1) + "\n");
  console.log(`\nretired ${covered.length} -> ${wnPath}   (names ${Object.keys(names).length}, chunks ${Object.keys(prior.chunks).length})`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "plan") cmdPlan(rest);
else if (cmd === "name") cmdName(rest);
else if (cmd === "retire") cmdRetire(rest);
else {
  console.error("usage: name-words.js plan [--to N]\n       name-words.js name --tier N [--batch 40] [--limit N] [--stub f] [--apply]\n       name-words.js retire [--apply]");
  process.exit(2);
}
