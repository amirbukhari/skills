"use strict";
/**
 * rule-coverage.js — WHICH LEAF SKELETONS A NODE-KIND RULE ALREADY RENDERS (PRD §5D.3C, §5D.3F §2d).
 *
 * THE MEASUREMENT THIS EXISTS TO PREVENT REPEATING. The 80-leaf pilot (§5D.3F §2d) named 80 leaf
 * skeletons, passed every gate, and stripped **72% of the concrete identifiers** out of the corpus's
 * labels — 27,673 -> 7,644 across 982 files, 975 of which lost information and none of which gained
 * any. The cause is structural, not a prompt defect:
 *
 *     A node-kind RULE is HOLE-FILLED.  It renders THIS import:  import `ITokenData` from `./hydra-ui/...`
 *     A leaf NAME is HOLE-FREE.         It renders ANY import:   import one named export from a module
 *
 * So for a skeleton whose rule reads the holes, a name can only DISCARD what the rule was saying.
 * Naming it is a regression, not a lower priority. This module decides, per skeleton, which case it
 * is — and it decides it by MEASUREMENT against real instances, not by listing node kinds by hand.
 *
 * THE CRITERION IS VARIANCE, AND THAT IS THE WHOLE ARGUMENT. The question is not "does this clause
 * look specific" — a clause can carry a backticked identifier that is part of the skeleton itself and
 * therefore identical at every site, which a name reproduces perfectly well. The question is whether
 * the clause CHANGES FROM SITE TO SITE. If it does, the rule is reading hole fills, and no single
 * name can stand in for all of them — that is precisely and only what a name cannot do. If it does
 * not, the rule is saying one fixed thing, and a name can say the same thing or a better one.
 *
 *   any clause SAYS NOTHING          -> UNREACHED. `SAYS_NOTHING` is enfile's own list ("run a step",
 *                                      "call a step", ...), reused rather than re-invented, so this
 *                                      module cannot drift from the renderer's own idea of empty.
 *   clauses VARY across instances    -> RULE-COVERED. Naming would regress. This is the pilot's 72%.
 *   one constant clause, with detail -> RULE-COVERED. Already good prose; a name adds nothing.
 *   one constant clause, generic     -> UNREACHED. The rule ignores the specifics; a name is an
 *                                      improvement, and this is where the model should be spent.
 *
 * WHAT THIS IS NOT. It is not a retreat from R-LANG-21: d=0 stays inside the naming SCOPE. Every
 * chain still bottoms out at a leaf and a d>=9 word's tail is still bare leaves. A rule-covered leaf
 * is still ACCOUNTED FOR — by code, which is the cheaper and better of the two ways. The filter
 * changes who accounts for it, not whether it is accounted for.
 */
const ts = require("typescript");
const G = require("./generators");
const WN = require("./word-names");

/* enfile's own says-nothing set, re-exported through the renderer so there is exactly one list.
 * A second copy here would be a second definition of "carries no information", and those drift. */
function saysNothingOf(EN) {
  return EN.SAYS_NOTHING || /^(run a step|call a step|await a step|compute a value|branch on a condition|switch on a value|run a try\/catch|compose \d+ statements)$/;
}

/* Detail = anything the clause quotes out of the code: `identifiers` or “messages”. Used only to
 * separate "constant and rich" from "constant and generic"; variance is the primary test. */
const DETAIL = /[`“]/;

/**
 * Classify ONE skeleton from the clauses its real instances rendered as.
 * @param clauses  the clause string (or null) each observed instance produced, in site order
 * @returns {klass, name, reason, distinct, instances}
 *   klass "unreached-*" -> WORTH A NAME.  klass "rule-covered-*" -> naming would regress.
 */
function classify(clauses, saysNothing) {
  const sn = saysNothing || saysNothingOf({});
  const instances = clauses.length;
  if (!instances) return { klass: "unknown", name: false, reason: "no instance observed in the corpus", distinct: 0, instances: 0 };

  if (clauses.some((c) => !c || sn.test(c))) {
    return { klass: "unreached-says-nothing", name: true, distinct: new Set(clauses).size, instances,
      reason: "at least one instance renders as a clause that carries no information — no rule reaches this shape" };
  }
  const distinctSet = new Set(clauses);
  if (distinctSet.size > 1) {
    return { klass: "rule-covered-varying", name: false, distinct: distinctSet.size, instances,
      reason: `the rule renders ${distinctSet.size} different clauses across ${instances} instances — it is reading the holes, and one name cannot stand in for all of them` };
  }
  const only = clauses[0];
  if (DETAIL.test(only)) {
    return { klass: "rule-covered-constant", name: false, distinct: 1, instances,
      reason: "one constant clause that already quotes the code — a name would replace good prose with weaker prose" };
  }
  return { klass: "unreached-generic", name: true, distinct: 1, instances,
    reason: "one constant, generic clause — the rule ignores this shape's specifics, so a name can only improve it" };
}

/** True when a classification says the model should be spent on this skeleton. */
const isNamable = (c) => !!(c && c.name);

/**
 * Scan the corpus and render ONE clause per statement instance, bucketed by leaf-skeleton key.
 * The statement -> skeleton mapping is the MINER'S OWN (`generalStmtParts` + `keyOf`), so a bucket
 * here is the same word the dictionary holds — not a re-derivation that could disagree with it.
 *
 * @param EN     the enfile module (spanActions is the rule path; injected so a test can drive it)
 * @param files  [{rel, source}] — already read, so the caller owns the walk
 * @param opts   {maxInstances}  how many clauses to keep per skeleton (variance needs >= 2)
 * @returns Map(nameKey -> { axis, sym, clauses[], sites })
 */
function scanClauses(EN, files, opts = {}) {
  const maxInstances = opts.maxInstances || 8;
  const out = new Map();
  for (const { rel, source } of files) {
    let sf;
    try { sf = ts.createSourceFile(rel || "t.ts", source, ts.ScriptTarget.Latest, true); } catch (_) { continue; }
    const visit = (node) => {
      const list = (ts.isSourceFile(node) || ts.isBlock(node)) ? node.statements : null;
      if (list) for (const st of list) record(EN, st, sf, out, maxInstances);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

function record(EN, st, sf, out, maxInstances) {
  if (!G.isFoldable(st)) return;
  /* A GUARD IS A RENDERED CLAUSE TOO — this was a real false positive, caught by reading the first
   * measurement's output. `spanActions` files a guard throw under `guards`, not `actions`, so taking
   * actions[0] alone reported nine `if (!x) { throw new E(...) }` shapes as "no rule reaches this"
   * when the rule renders them richly, quoting the throw message: failing when "x is required".
   * Naming those would have been the pilot's regression a second time. */
  let clause = null;
  try {
    const r = EN.spanActions([st], sf);
    const act = (r.raw && r.raw[0] !== undefined) ? r.raw[0] : r.actions[0];
    clause = act || (r.guards && r.guards.length ? "failing when " + r.guards[0] : null);
  } catch (_) { clause = null; }
  for (const [axisName, wide] of [["wide", true], ["narrow", false]]) {
    let sym;
    try { const p = G.generalStmtParts(st, sf, wide); if (!p) continue; sym = G.keyOf(p); } catch (_) { continue; }
    const key = WN.hashOf(axisName, sym);
    let row = out.get(key);
    if (!row) { row = { key, axis: axisName[0], sym, clauses: [], sites: 0 }; out.set(key, row); }
    row.sites++;
    if (row.clauses.length < maxInstances) row.clauses.push(clause);
  }
}

/** Classify a whole scan, and roll it up so the split can be reported rather than asserted. */
function summarize(scan, EN, keysOfInterest) {
  const sn = saysNothingOf(EN || {});
  const byKlass = new Map();
  const perKey = new Map();
  for (const [key, row] of scan) {
    if (keysOfInterest && !keysOfInterest.has(key)) continue;
    const c = classify(row.clauses, sn);
    perKey.set(key, c);
    const b = byKlass.get(c.klass) || { skeletons: 0, sites: 0 };
    b.skeletons++; b.sites += row.sites;
    byKlass.set(c.klass, b);
  }
  const namable = [...perKey.values()].filter(isNamable).length;
  return { perKey, byKlass: Object.fromEntries(byKlass), namable, total: perKey.size };
}

module.exports = { classify, isNamable, scanClauses, summarize, DETAIL, saysNothingOf };
