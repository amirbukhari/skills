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

const SHOW_EXAMPLES = process.argv.includes("--examples");
const SHOW_CLAUSES = process.argv.includes("--clauses");

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
    ts.forEachChild(n, (c) => blockersOf(c, sf, P, acc, depth + 1));
    return;
  }
  if (!isStructural(n)) return;
  acc.missing.set(kind, (acc.missing.get(kind) || 0) + 1);
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

const SRC = CR.sourceRoot();
const files = walk(SRC);

const occurring = new Set();          // every structural kind present in the corpus
const missing = new Map();            // unruled kind -> residual generic sites it blocks
const declined = new Map();           // ruled kind that refused -> sites
const eg = new Map();
const byStmt = new Map();          // unruled kind -> statement kind -> sites
const clauses = new Map();         // unruled kind -> clause text -> sites
const perStatement = new Map();       // statement kind -> residual generic count
let genericTotal = 0, noHead = 0;

for (const abs of files) {
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let sf; try { sf = ts.createSourceFile("f.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); } catch (_) { continue; }

  /* the denominator: every structural kind that occurs anywhere in the corpus */
  const census = (n) => { if (isStructural(n)) occurring.add(ts.SyntaxKind[n.kind]); ts.forEachChild(n, census); };
  census(sf);

  /* THE SAME UNIVERSE THE RENDERER FOLDS OVER — direct children of a Block or the SourceFile. */
  const visit = (n) => {
    if ((ts.isBlock(n) || ts.isSourceFile(n)) && n.statements.length) {
      for (const st of n.statements) {
        let r = null;
        try { r = EN.spanActions([st], sf); } catch (_) { r = null; }
        /* BOTH CHANNELS. A guard-shaped `if` reports through `guards`; reading `actions` alone
         * counted a whole clause channel as silence and once sent the work order to IfStatement. */
        const clause = r && r.actions && r.actions.length ? String(r.actions[0])
          : (r && r.guards && r.guards.length ? String(r.guards[0]) : null);
        if (!clause) continue;
        if (Q.isVacuous(clause) || EN.SAYS_NOTHING.test(clause)) continue;
        if (isSiteSpecific(clause, st.getText(sf))) continue;
        genericTotal++;
        const sk = ts.SyntaxKind[st.kind];
        perStatement.set(sk, (perStatement.get(sk) || 0) + 1);
        const head = headOf(st);
        if (!head) { noHead++; continue; }
        blockersOf(head, sf, EN.NKRP, { missing, declined, eg, byStmt, stmtKind: sk, clauses, clause }, 0);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const ruled = NKR.KINDS.filter((k) => occurring.has(k));
const pc = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "—");

console.log("");
console.log("PHRASEBOOK COVERAGE (§5D.3C) — completion is enumerable, which is the point of keying to kinds");
console.log("  structural kinds occurring in corpus ... " + occurring.size);
console.log("  kinds with a rule ...................... " + ruled.length + "   " + pc(ruled.length, occurring.size));
console.log("  rules: " + NKR.KINDS.join(", "));
console.log("");
console.log("RESIDUAL GENERIC SITES ................... " + genericTotal + "   (statement sites whose clause quotes nothing from the site)");
[...perStatement.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
  console.log("    " + String(n).padStart(5) + "  " + k));
console.log("    " + String(noHead).padStart(5) + "  (of those, no single head expression to attribute)");
console.log("");
console.log("WORKLIST — UNRULED kinds, by residual generic sites they BLOCK  <-- write the next rule here");
const rank = [...missing.entries()].sort((a, b) => b[1] - a[1]);
if (!rank.length) console.log("    (none — every blocking kind already has a rule)");
rank.slice(0, 20).forEach(([k, n], i) => {
  console.log("  " + String(i + 1).padStart(3) + ". " + String(n).padStart(5) + "  " + k);
  if (SHOW_EXAMPLES && eg.has(k)) console.log("            e.g.  " + eg.get(k));
  const bs = byStmt.get(k);
  if (bs) console.log("            in:   " + [...bs.entries()].sort((x, y) => y[1] - x[1])
    .map(([sk, c]) => sk + " " + c).join(",  "));
  const cm = clauses.get(k);
  if (cm) [...cm.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4)
    .forEach(([c, n2]) => console.log("            says: " + String(n2).padStart(4) + "  " + c));
});
console.log("");
console.log("RULED BUT DECLINING — needs VOCABULARY or a nameable child, NOT a second rule (R-LANG-16)");
[...declined.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) =>
  console.log("    " + String(n).padStart(5) + "  " + k));
console.log("");
