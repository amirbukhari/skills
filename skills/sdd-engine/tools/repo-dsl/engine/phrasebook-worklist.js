"use strict";
/**
 * phrasebook-worklist.js — WHICH NODE KIND TO RULE NEXT (PRD §5D.3C, R-LANG-16/17).
 *
 * THE MEASUREMENT THIS EXISTS TO REPLACE. §5D.3C's 8/19/28/37/53 table ranks node kinds by RAW
 * INSTANCE COUNT, and it was measured before any rule shipped. Rules 1-8 moved the corpus generic
 * count 2,284 -> 1,839, so instance rank is no longer value rank: `PropertyAccessExpression` is
 * rank 1 by instances and now has a rule, while `TemplateExpression` is far down that table and was
 * worth writing eighth because four ruled parents were declining on it.
 *
 * SO THIS RANKS BY RESIDUAL GENERIC SITES, and it attributes each one to the kind that is actually
 * BLOCKING it — which is not always the kind at the top of the statement:
 *
 *   - a node with NO rule that the engine cannot already name  -> it is a blocker, counted
 *   - a node WITH a rule that RENDERS                          -> not a blocker, stop
 *   - a node WITH a rule that DECLINES                         -> descend; its children are the
 *                                                                 blockers, and the kind itself is
 *                                                                 recorded separately as
 *                                                                 "ruled-but-declining"
 *
 * That third case is the lesson of rules 4 and 8, made mechanical. Rule 3 predicted -257 and
 * delivered -14 because its base was an `ElementAccessExpression` with no rule; nothing in the
 * instance table could have said so, and a person had to render one site by hand to find it. This
 * driver answers that question directly, which is the difference between a work order and a guess.
 *
 * RULED-BUT-DECLINING IS DIFFERENT WORK, and is reported apart on purpose. A kind that has a rule
 * and still refuses does not need a NEW rule — it needs vocabulary (a `VERBS` entry, a
 * `BINARY_OPS` entry) or a nameable child. Ranking the two together would send the next session to
 * write a second rule for a kind that already has one, which R-LANG-16 forbids outright.
 *
 * IT RE-IMPLEMENTS NOTHING. The generic predicate is `statement-kind-coverage.test.js`'s, the
 * vacuous set is `clause-quality.js`'s, the says-nothing set is `enfile.js`'s own export, and the
 * primitives handed to the phrasebook are `enfile.NKRP` — the very object the renderer passes. A
 * driver that asked the phrasebook a slightly different question would rank the work by it.
 *
 *   node engine/phrasebook-worklist.js            ranked worklist + coverage
 *   node engine/phrasebook-worklist.js --examples show a sample site per blocking kind
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./enfile");
const NKR = require("./node-kind-rules");
const CR = require("./corpus-root");
const Q = require("./clause-quality");
const { SKIP } = require("./walk-skip");
const EC = require("./elision-credit");   /* the SECOND figure — see engine/elision-credit.js */

let SHOW_EXAMPLES = false;   /* set by computeWorklist(opts) — never read from argv here */
let SHOW_CLAUSES = false;

const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
  }
  return o;
};

/* VERBATIM from statement-kind-coverage.test.js. A clause is SITE-SPECIFIC iff it quotes something
 * really in this statement; anything else that produced a clause and is not vacuous is GENERIC. */
function isSiteSpecific(clause, stmtText) {
  const quoted = clause.match(/`[^`]+`|“[^”]+”/g) || [];
  for (const q of quoted) {
    const bare = q.slice(1, -1).trim();
    if (bare.length >= 2 && stmtText.includes(bare)) return true;
  }
  return false;
}

/* THE HEAD EXPRESSION: the node the phrasebook would be asked to render for this statement. Written
 * out per statement kind rather than inferred, because "the expression this clause is about" is a
 * judgement and a wrong one would misattribute the whole work order. Statement kinds with no single
 * head (blocks, loops with bodies) report under NO-HEAD and are counted, not hidden. */
function headOf(st) {
  if (ts.isReturnStatement(st) || ts.isThrowStatement(st) || ts.isExpressionStatement(st)) return st.expression || null;
  if (ts.isIfStatement(st) || ts.isSwitchStatement(st) || ts.isWhileStatement(st)) return st.expression || null;
  if (ts.isForOfStatement(st) || ts.isForInStatement(st)) return st.expression || null;
  if (ts.isVariableStatement(st)) {
    const d = st.declarationList && st.declarationList.declarations && st.declarationList.declarations[0];
    return (d && d.initializer) || null;
  }
  return null;
}

const unwrap = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)
    || ts.isTypeAssertionExpression(n) || ts.isAwaitExpression(n))) n = n.expression;
  return n;
};

/* Which kinds are STRUCTURAL — the ones a rule could be written for. Tokens and keywords carry no
 * structure to render, and counting them would inflate the denominator of a coverage figure that
 * exists to say how finishable this is. */
const isStructural = (n) => n && n.kind > ts.SyntaxKind.LastToken;

/* Walk down from a node collecting the kinds that BLOCK it from rendering. See the header. */
function blockersOf(node, sf, P, acc, depth) {
  if (!node || depth > 14) return;
  const n = unwrap(node);
  if (!n) return;
  const kind = ts.SyntaxKind[n.kind];
  /* already nameable by the engine's own primitives -> not blocking anything */
  let named = null;
  try { named = P.dotted(n, sf) || P.literal(n, sf); } catch (_) { named = null; }
  if (named) return;
  if (NKR.RULES[kind]) {
    let out = null;
    try { out = NKR.render(n, sf, P); } catch (_) { out = null; }
    if (out) return;                                  /* renders -> not a blocker */
    acc.declined.set(kind, (acc.declined.get(kind) || 0) + 1);
    if (acc.credited) acc.declinedCredited.set(kind, (acc.declinedCredited.get(kind) || 0) + 1);
    ts.forEachChild(n, (c) => blockersOf(c, sf, P, acc, depth + 1));
    return;
  }
  if (!isStructural(n)) return;
  acc.missing.set(kind, (acc.missing.get(kind) || 0) + 1);
  /* BESIDE, never instead of. `missing` stays the frozen-count blocker tally; this records how many
   * of those blocked sites already say the site's own words through the renderer's “…”. The ranking
   * subtracts one from the other and neither number is edited into the other. */
  if (acc.credited) acc.missingCredited.set(kind, (acc.missingCredited.get(kind) || 0) + 1);
  /* WHICH STATEMENT KIND the blocked site belongs to. Without this the worklist can send a session
   * to write a rule for a kind whose sites are ALREADY correct English -- `throw new Error(\`...\`)`
   * is 337 sites that read perfectly and are scored generic only by the “…” elision artifact. A
   * blocker count that cannot be split by statement kind is a work order that cannot be sanity
   * checked against the thing it claims to improve. */
  /* THE CLAUSES THESE SITES ACTUALLY EMIT TODAY. A blocker count says a rule COULD speak here; it
   * does not say the site is silent. Two of the top three kinds in this worklist are dominated by
   * sites whose clause is already correct English that the site-specific predicate cannot match —
   * `throw “Invalid data: …”` (the “…” elision) and `` `a.b.c` `` against a source that reads
   * `a?.b?.c`. Ranking without reading them sends a session to overwrite good prose. */
  if (SHOW_CLAUSES && acc.clause) {
    let cm = acc.clauses.get(kind);
    if (!cm) { cm = new Map(); acc.clauses.set(kind, cm); }
    const short = acc.clause.slice(0, 64);
    cm.set(short, (cm.get(short) || 0) + 1);
  }
  if (acc.stmtKind) {
    let m = acc.byStmt.get(kind);
    if (!m) { m = new Map(); acc.byStmt.set(kind, m); }
    m.set(acc.stmtKind, (m.get(acc.stmtKind) || 0) + 1);
  }
  if (SHOW_EXAMPLES && !acc.eg.has(kind)) acc.eg.set(kind, n.getText(sf).replace(/\s+/g, " ").slice(0, 96));
}

/**
 * Compute the whole worklist and RETURN it. This is the machine-readable form: the ranking used to
 * be written to stdout and nowhere else, so nothing downstream could consume the order without
 * re-deriving it. `require()`ing this module now runs nothing — the corpus walk happens only when
 * this is called, or when the file is run directly.
 *
 * @returns {{coverage, residual, worklist, declining, perStatement}}
 */
function computeWorklist(opts) {
  opts = opts || {};
  SHOW_EXAMPLES = !!opts.examples;
  SHOW_CLAUSES = !!opts.clauses;

  const SRC = CR.sourceRoot();
  const files = walk(SRC);

  const occurring = new Set();       // every structural kind present in the corpus
  const missing = new Map();         // unruled kind -> generic sites it blocks       (FROZEN count)
  const missingCredited = new Map(); // unruled kind -> how many of those are “…”-credited
  const declined = new Map();        // ruled kind that refused -> sites
  const declinedCredited = new Map(); // ...and how many of those are “…”-credited
  const eg = new Map();
  const byStmt = new Map();          // unruled kind -> statement kind -> sites
  const clauses = new Map();         // unruled kind -> clause text -> sites
  const perStatement = new Map();    // statement kind -> { generic, credited }
  let genericTotal = 0, creditedTotal = 0, noHead = 0;

  for (const abs of files) {
    let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
    let sf; try { sf = ts.createSourceFile("f.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); } catch (_) { continue; }

    const census = (n) => { if (isStructural(n)) occurring.add(ts.SyntaxKind[n.kind]); ts.forEachChild(n, census); };
    census(sf);

    /* THE SAME UNIVERSE THE RENDERER FOLDS OVER — direct children of a Block or the SourceFile. */
    const visit = (n) => {
      if ((ts.isBlock(n) || ts.isSourceFile(n)) && n.statements.length) {
        for (const st of n.statements) {
          let r = null;
          try { r = EN.spanActions([st], sf); } catch (_) { r = null; }
          /* BOTH CHANNELS. A guard-shaped `if` reports through `guards`; reading `actions` alone
           * counted a whole clause channel as silence and once sent the work order to IfStatement.
           * It is also where 313 of the 921 credited sites live, so the net figure depends on it. */
          const clause = r && r.actions && r.actions.length ? String(r.actions[0])
            : (r && r.guards && r.guards.length ? String(r.guards[0]) : null);
          if (!clause) continue;
          if (Q.isVacuous(clause) || EN.SAYS_NOTHING.test(clause)) continue;
          const text = st.getText(sf);
          if (isSiteSpecific(clause, text)) continue;
          genericTotal++;
          const credited = EC.creditsElision(clause, text);
          if (credited) creditedTotal++;
          const sk = ts.SyntaxKind[st.kind];
          let ps = perStatement.get(sk);
          if (!ps) { ps = { generic: 0, credited: 0 }; perStatement.set(sk, ps); }
          ps.generic++; if (credited) ps.credited++;
          const head = headOf(st);
          if (!head) { noHead++; continue; }
          blockersOf(head, sf, EN.NKRP, { missing, missingCredited, declined, declinedCredited, eg, byStmt, clauses, stmtKind: sk, clause, credited }, 0);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  const ruled = NKR.KINDS.filter((k) => occurring.has(k));

  /* THE RANKING IS ON NET, NOT FROZEN — this is the whole point of the rebuild. Ranking on the
   * frozen count put `NewExpression` (361 blocked) and `PrefixUnaryExpression` (322) at the top,
   * and 346 and 302 of those respectively are sites whose prose is already the author's own words,
   * reachable only through the renderer's “…”. A rule written for either would have overwritten
   * good English to move a number that cannot move. Both counts are carried on every row so the
   * frozen order stays inspectable beside the net one; nothing is edited into anything. */
  const worklist = [...missing.entries()].map(([kind, blocked]) => {
    const credited = missingCredited.get(kind) || 0;
    return {
      kind, blocked, credited, net: blocked - credited,
      inStatements: Object.fromEntries([...(byStmt.get(kind) || new Map()).entries()].sort((a, b) => b[1] - a[1])),
      says: [...(clauses.get(kind) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => ({ clause: c, sites: n })),
      example: eg.get(kind) || null,
    };
  }).sort((a, b) => b.net - a.net || b.blocked - a.blocked);

  return {
    coverage: { kindsOccurring: occurring.size, kindsRuled: ruled.length, rules: NKR.KINDS.slice() },
    residual: { frozen: genericTotal, credited: creditedTotal, net: genericTotal - creditedTotal, noHead },
    perStatement: [...perStatement.entries()]
      .map(([kind, v]) => ({ kind, generic: v.generic, credited: v.credited, net: v.generic - v.credited }))
      .sort((a, b) => b.net - a.net || b.generic - a.generic),
    worklist,
    /* net-aware for the same reason the worklist is: a ruled kind that declines on sites whose
     * prose is already correct is not a vocabulary gap worth funding. */
    declining: [...declined.entries()].map(([kind, sites]) => {
      const credited = declinedCredited.get(kind) || 0;
      return { kind, sites, credited, net: sites - credited };
    }).sort((a, b) => b.net - a.net || b.sites - a.sites),
  };
}

function report(w) {
  const pc = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "—");
  console.log("");
  console.log("PHRASEBOOK COVERAGE (§5D.3C) — completion is enumerable, which is the point of keying to kinds");
  console.log("  structural kinds occurring in corpus ... " + w.coverage.kindsOccurring);
  console.log("  kinds with a rule ...................... " + w.coverage.kindsRuled + "   " + pc(w.coverage.kindsRuled, w.coverage.kindsOccurring));
  console.log("  rules: " + w.coverage.rules.join(", "));
  console.log("");
  /* OLD NUMBER FIRST, ALWAYS (R-ARCH-16B's pattern). The frozen count is the published series. */
  console.log("RESIDUAL GENERIC SITES (frozen) .......... " + w.residual.frozen);
  console.log("  of those, quoting the site through “…” . " + w.residual.credited + "   " + pc(w.residual.credited, w.residual.frozen) + " of frozen");
  console.log("  RESIDUAL, NET OF ELISION ............... " + w.residual.net + "   <-- the work that can actually be done");
  console.log("");
  console.log("  STATEMENT KIND            frozen   credited      net");
  for (const r of w.perStatement) {
    console.log("    " + r.kind.padEnd(22) + String(r.generic).padStart(6) + "   " + String(r.credited).padStart(8) + "   " + String(r.net).padStart(6));
  }
  console.log("    " + "(no single head expr)".padEnd(22) + String(w.residual.noHead).padStart(6));
  console.log("");
  console.log("WORKLIST — UNRULED kinds, RANKED BY NET (frozen rank shown for contrast)  <-- next rule here");
  const byFrozen = w.worklist.slice().sort((a, b) => b.blocked - a.blocked);
  w.worklist.slice(0, 12).forEach((r, i) => {
    const fr = byFrozen.findIndex((x) => x.kind === r.kind) + 1;
    console.log("  " + String(i + 1).padStart(3) + ". net " + String(r.net).padStart(5)
      + "   (frozen " + String(r.blocked).padStart(4) + ", credited " + String(r.credited).padStart(4)
      + ", was rank #" + fr + ")  " + r.kind);
    const ins = Object.entries(r.inStatements);
    if (ins.length) console.log("            in:   " + ins.map(([k, c]) => k + " " + c).join(",  "));
    if (SHOW_CLAUSES) r.says.forEach((c) => console.log("            says: " + String(c.sites).padStart(4) + "  " + c.clause));
    if (SHOW_EXAMPLES && r.example) console.log("            e.g.  " + r.example);
  });
  console.log("");
  console.log("RULED BUT DECLINING — needs VOCABULARY or a nameable child, NOT a second rule (R-LANG-16)");
  console.log("    net   (frozen, credited)  kind");
  w.declining.forEach((r) => console.log("    " + String(r.net).padStart(5) + "   (" + String(r.sites).padStart(4) + ", " + String(r.credited).padStart(4) + ")  " + r.kind));
  console.log("");
}

module.exports = { computeWorklist };

/* Run directly for the report; `require` it for the data. */
if (require.main === module) {
  const w = computeWorklist({ examples: process.argv.includes("--examples"), clauses: process.argv.includes("--clauses") });
  if (process.argv.includes("--json")) console.log(JSON.stringify(w, null, 2));
  else report(w);
}
