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
 * DEDUPE — TWO COUNTS, AND ONLY ONE OF THEM IS COMPARABLE. Both tallies below count NODE
 * OCCURRENCES: `blockersOf` descends THROUGH a declining node into its children, so one generic
 * statement can tally `CallExpression` four times, and can tally several kinds at once. The unruled
 * worklist has the SAME property one level down — a declining parent with three unruled children
 * tallies three — so the two tables were never like-for-like, in EITHER direction. Every row now
 * carries a DISTINCT-SITE count as well, each kind at most once per generic statement, reported
 * BESIDE the raw one and never instead of it. Measured 2026-09-04: the collapse is uneven and it
 * REORDERS the declining table — `PropertyAccessExpression` 133 -> 54 (2.5x) drops below
 * `ArrowFunction` 99 -> 90 — which is exactly why the ranking cannot be taken from the raw column.
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
const OC = require("./one-char-credit");  /* the THIRD figure — see engine/one-char-credit.js */
const ES = require("./escape-credit");   /* the FOURTH figure — see engine/escape-credit.js */

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

/* The method name the CallExpression rule refused on, or a "…" marker for a refusal that is not
 * about a method at all. Mirrors the rule's own control flow (node-kind-rules.js) rather than
 * guessing: an unknown link anywhere in the chain refuses the WHOLE chain, and it is the first such
 * link that decides. */
function declinedMethod(n) {
  let cur = unwrap(n);
  while (cur && ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    const name = cur.expression.name && cur.expression.name.text;
    if (!name || !NKR.VERBS[name]) return name || "(unnamed)";
    cur = unwrap(cur.expression.expression);
  }
  const e = cur && ts.isCallExpression(cur) ? unwrap(cur.expression) : null;
  if (e && ts.isIdentifier(e)) return "(bare function)";
  return "(not a method chain)";
}

/* THE FAMILIES, written out rather than inferred. A family is a claim about what KIND OF WORK a set
 * of methods needs, and it earns its place only by having been measured — `routes` is here because
 * it was ranked as a vocabulary gap and turned out to need nothing at all. An unlisted method falls
 * under "(unclassified)" and is counted, never hidden. */
const FAMILIES = {
  promise: ["then", "catch", "finally"],
  queryBuilder: ["save", "andWhere", "orWhere", "where", "getMany", "getOne", "insert", "update", "createQueryBuilder", "leftJoinAndSelect", "innerJoin", "delete", "softDelete"],
  routes: ["get", "post", "put", "patch", "del", "all", "head", "options"],
  matcher: ["toBe", "toEqual", "toHaveBeenNthCalledWith", "mockResolvedValue", "mockReturnValue", "mockImplementation", "toBeCalledTimes"],
  arrayMutation: ["forEach", "push", "includes", "indexOf", "splice", "some", "every", "shift", "unshift"],
  date: ["getTime", "toISOString", "format", "startOf", "endOf", "diff"],
  log: ["error", "info", "warn", "debug", "log", "emit"],
  string: ["split", "trim", "replace", "toUpperCase", "toLowerCase", "padStart", "substring"],
};
const FAMILY_OF = (() => {
  const m = new Map();
  for (const [fam, names] of Object.entries(FAMILIES)) for (const n of names) if (!m.has(n)) m.set(n, fam);
  return m;
})();

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
    /* WHICH METHOD the CallExpression rule refused on, for the FIRST refusal in this statement.
     * `CallExpression` is 217 of the declines and a single kind row cannot rank it: the families
     * inside it need completely different work, and one of them (the routes) needed none at all. */
    if (kind === "CallExpression" && acc.method === null) acc.method = declinedMethod(n);
    acc.declined.set(kind, (acc.declined.get(kind) || 0) + 1);
    if (acc.credited) acc.declinedCredited.set(kind, (acc.declinedCredited.get(kind) || 0) + 1);
    /* PER DISTINCT SITE, BESIDE the occurrence count -- see DEDUPE in the header. */
    if (acc.siteDeclined) acc.siteDeclined.add(kind);
    ts.forEachChild(n, (c) => blockersOf(c, sf, P, acc, depth + 1));
    return;
  }
  if (!isStructural(n)) return;
  acc.missing.set(kind, (acc.missing.get(kind) || 0) + 1);
  if (acc.siteMissing) acc.siteMissing.add(kind);
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
  const declined = new Map();        // ruled kind that refused -> NODE OCCURRENCES (not sites)
  const declinedCredited = new Map(); // ...and how many of those are “…”-credited
  /* DEDUPED, per DISTINCT SITE. `declined`/`missing` above count node occurrences: blockersOf
   * descends THROUGH a declining node into its children, so one generic statement can tally the
   * same kind several times, and can tally several kinds. That is the right number for "where does
   * the renderer refuse", and the WRONG number to rank against the unruled worklist -- which has
   * exactly the same property, one level down, since a declining parent with three unruled children
   * tallies three. These four maps count each kind at most ONCE per generic statement. Reported
   * BESIDE the raw counts, never instead of them. */
  const declinedSites = new Map();
  const declinedSitesCredited = new Map();
  const missingSites = new Map();
  const missingSitesCredited = new Map();
  /* THE THIRD COLUMN, added exactly as `credited` was: beside the frozen count, never inside it.
   * Sites generic ONLY because the run they quote is ONE character, which `isSiteSpecific` will not
   * accept. The route family was 17 of these and was funded as a vocabulary gap. */
  const declinedSitesOneChar = new Map();
  const missingSitesOneChar = new Map();
  /* THE FOURTH COLUMN. A clause that quotes a string literal correctly is compared against the RAW
   * source, so an escaped apostrophe fails a verbatim match. 11 of `Block`'s 18 ungated sites were
   * this, and rule 10 was ranked on them. */
  const declinedSitesEscaped = new Map();
  const missingSitesEscaped = new Map();
  /* THE METHOD CENSUS, and the reason it lives here rather than in a scratch script: the route
   * finding came out of one, so nothing downstream could consume it and nothing re-ran it. A kind
   * is too coarse to rank `CallExpression` — 217 of its declines are ONE cause, an unknown method,
   * and the families inside it behave completely differently. */
  const byMethod = new Map();       // method name -> { sites, credited, oneChar }
  const eg = new Map();
  const byStmt = new Map();          // unruled kind -> statement kind -> sites
  const clauses = new Map();         // unruled kind -> clause text -> sites
  const perStatement = new Map();    // statement kind -> { generic, credited }
  let genericTotal = 0, creditedTotal = 0, noHead = 0, oneCharTotal = 0, bothTotal = 0, escapedTotal = 0;

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
          const oneChar = OC.creditsOneChar(clause, text);
          if (oneChar) oneCharTotal++;
          const escaped = ES.creditsEscape(clause, text);
          if (escaped) escapedTotal++;
          if (credited && oneChar) bothTotal++;
          const sk = ts.SyntaxKind[st.kind];
          let ps = perStatement.get(sk);
          if (!ps) { ps = { generic: 0, credited: 0, oneChar: 0, escaped: 0 }; perStatement.set(sk, ps); }
          ps.generic++; if (credited) ps.credited++; if (oneChar) ps.oneChar++; if (escaped) ps.escaped++;
          const head = headOf(st);
          if (!head) { noHead++; continue; }
          const siteMissing = new Set(), siteDeclined = new Set();
          const acc0 = { missing, missingCredited, declined, declinedCredited, eg, byStmt, clauses, stmtKind: sk, clause, credited, siteMissing, siteDeclined, method: null };
          blockersOf(head, sf, EN.NKRP, acc0, 0);
          for (const k of siteMissing) {
            missingSites.set(k, (missingSites.get(k) || 0) + 1);
            if (credited) missingSitesCredited.set(k, (missingSitesCredited.get(k) || 0) + 1);
            if (oneChar) missingSitesOneChar.set(k, (missingSitesOneChar.get(k) || 0) + 1);
            if (escaped) missingSitesEscaped.set(k, (missingSitesEscaped.get(k) || 0) + 1);
          }
          for (const k of siteDeclined) {
            declinedSites.set(k, (declinedSites.get(k) || 0) + 1);
            if (credited) declinedSitesCredited.set(k, (declinedSitesCredited.get(k) || 0) + 1);
            if (oneChar) declinedSitesOneChar.set(k, (declinedSitesOneChar.get(k) || 0) + 1);
            if (escaped) declinedSitesEscaped.set(k, (declinedSitesEscaped.get(k) || 0) + 1);
          }
          if (acc0.method) {
            let mm = byMethod.get(acc0.method);
            if (!mm) { mm = { sites: 0, credited: 0, oneChar: 0, escaped: 0 }; byMethod.set(acc0.method, mm); }
            mm.sites++; if (credited) mm.credited++; if (oneChar) mm.oneChar++; if (escaped) mm.escaped++;
          }
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
      sites: missingSites.get(kind) || 0,
      sitesCredited: missingSitesCredited.get(kind) || 0,
      sitesOneChar: missingSitesOneChar.get(kind) || 0,
      sitesEscaped: missingSitesEscaped.get(kind) || 0,
      sitesNet: (missingSites.get(kind) || 0) - (missingSitesCredited.get(kind) || 0),
      sitesReal: (missingSites.get(kind) || 0) - (missingSitesCredited.get(kind) || 0) - (missingSitesOneChar.get(kind) || 0) - (missingSitesEscaped.get(kind) || 0),
      inStatements: Object.fromEntries([...(byStmt.get(kind) || new Map()).entries()].sort((a, b) => b[1] - a[1])),
      says: [...(clauses.get(kind) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => ({ clause: c, sites: n })),
      example: eg.get(kind) || null,
    };
  /* RANKED ON `sitesReal` — distinct sites with BOTH artifacts removed. Ranking on the frozen count
   * sent the work order to `NewExpression`; ranking on net-of-elision alone still counts 17 route
   * sites that needed nothing. Every earlier column is carried on the row, so the previous orders
   * stay inspectable and no published number changes meaning. */
  }).sort((a, b) => b.sitesReal - a.sitesReal || b.net - a.net || b.blocked - a.blocked);

  return {
    coverage: { kindsOccurring: occurring.size, kindsRuled: ruled.length, rules: NKR.KINDS.slice() },
    /* `frozen` and `net` KEEP THEIR PUBLISHED MEANINGS (2,284 -> 1,729 -> 1,695, and net = frozen
     * minus elision credit). `oneChar` is added BESIDE them and `netOfBoth` is a separate name, so
     * no consumer of the existing series silently changes value. */
    residual: {
      frozen: genericTotal, credited: creditedTotal, net: genericTotal - creditedTotal, noHead,
      oneChar: oneCharTotal, creditedAndOneChar: bothTotal,
      netOfBoth: genericTotal - creditedTotal - oneCharTotal + bothTotal,
      escaped: escapedTotal,
      real: genericTotal - creditedTotal - oneCharTotal + bothTotal - escapedTotal,
    },
    perStatement: [...perStatement.entries()]
      .map(([kind, v]) => ({ kind, generic: v.generic, credited: v.credited, oneChar: v.oneChar, escaped: v.escaped, net: v.generic - v.credited }))
      .map((r) => ({ ...r, real: r.generic - r.credited - r.oneChar - r.escaped }))
      .sort((a, b) => b.real - a.real || b.net - a.net),
    worklist,
    /* net-aware for the same reason the worklist is: a ruled kind that declines on sites whose
     * prose is already correct is not a vocabulary gap worth funding. */
    declining: [...declined.entries()].map(([kind, sites]) => {
      const credited = declinedCredited.get(kind) || 0;
      const st = declinedSites.get(kind) || 0, stc = declinedSitesCredited.get(kind) || 0;
      const so = declinedSitesOneChar.get(kind) || 0, se = declinedSitesEscaped.get(kind) || 0;
      return { kind, sites, credited, net: sites - credited, distinctSites: st, distinctCredited: stc, distinctOneChar: so, distinctEscaped: se, distinctNet: st - stc, distinctReal: st - stc - so - se };
    }).sort((a, b) => b.distinctReal - a.distinctReal || b.distinctNet - a.distinctNet),
    /* PER FAMILY, for the kind a single row cannot rank. `real` is what is left once BOTH artifacts
     * are taken out — it is the only column that has ever predicted the work correctly. */
    families: (() => {
      const f = new Map();
      for (const [meth, v] of byMethod) {
        const fam = FAMILY_OF.get(meth) || "(unclassified)";
        let r = f.get(fam);
        if (!r) { r = { family: fam, sites: 0, credited: 0, oneChar: 0, escaped: 0, methods: [] }; f.set(fam, r); }
        r.sites += v.sites; r.credited += v.credited; r.oneChar += v.oneChar; r.escaped += v.escaped;
        r.methods.push({ method: meth, sites: v.sites, credited: v.credited, oneChar: v.oneChar, escaped: v.escaped });
      }
      return [...f.values()].map((r) => ({ ...r, real: r.sites - r.credited - r.oneChar - r.escaped, methods: r.methods.sort((a, b) => b.sites - a.sites) }))
        .sort((a, b) => b.real - a.real || b.sites - a.sites);
    })(),
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
  console.log("  RESIDUAL, NET OF ELISION ............... " + w.residual.net + "   (the published series)");
  /* THE THIRD COLUMN. Added because the metric measured the wrong thing TWICE: the elision first,
   * and then the routes — 17 sites ranked as a vocabulary gap that already read `serve GET “/”`
   * and were generic only because “/” is one character. `isSiteSpecific` is untouched. */
  console.log("  of the frozen, quoting ONE character ... " + w.residual.oneChar + "   " + pc(w.residual.oneChar, w.residual.frozen) + " of frozen   (overlap with elision: " + w.residual.creditedAndOneChar + ")");
  console.log("  RESIDUAL, NET OF BOTH ARTIFACTS ........ " + w.residual.netOfBoth);
  /* THE FOURTH COLUMN. The clause quotes a literal's DECODED value; `isSiteSpecific` compares
   * against the RAW source, so an escaped apostrophe fails a match the prose deserves. */
  console.log("  of the frozen, an ESCAPED literal ...... " + w.residual.escaped + "   " + pc(w.residual.escaped, w.residual.frozen) + " of frozen");
  console.log("  RESIDUAL, REAL (net of all three) ...... " + w.residual.real + "   <-- the work that can actually be done");
  console.log("");
  console.log("  STATEMENT KIND            frozen   credited   1-char   escape      net   REAL");
  for (const r of w.perStatement) {
    console.log("    " + r.kind.padEnd(22) + String(r.generic).padStart(6) + "   " + String(r.credited).padStart(8)
      + "   " + String(r.oneChar).padStart(6) + "   " + String(r.escaped).padStart(6) + "   " + String(r.net).padStart(6) + "   " + String(r.real).padStart(4));
  }
  console.log("    " + "(no single head expr)".padEnd(22) + String(w.residual.noHead).padStart(6));
  console.log("");
  console.log("WORKLIST — UNRULED kinds, RANKED BY REAL = distinct sites − elision − one-char − escape  <-- next rule here");
  const byFrozen = w.worklist.slice().sort((a, b) => b.blocked - a.blocked);
  w.worklist.slice(0, 12).forEach((r, i) => {
    const fr = byFrozen.findIndex((x) => x.kind === r.kind) + 1;
    console.log("  " + String(i + 1).padStart(3) + ". REAL " + String(r.sitesReal).padStart(4) + "   net " + String(r.net).padStart(5)
      + "   (frozen " + String(r.blocked).padStart(4) + ", credited " + String(r.credited).padStart(4)
      + ", was rank #" + fr + ")   sites " + String(r.sitesNet).padStart(4)
      + " (" + String(r.sites).padStart(4) + ", " + String(r.sitesCredited).padStart(4) + ", 1ch " + String(r.sitesOneChar).padStart(3) + ", esc " + String(r.sitesEscaped).padStart(2) + ")   " + r.kind);
    const ins = Object.entries(r.inStatements);
    if (ins.length) console.log("            in:   " + ins.map(([k, c]) => k + " " + c).join(",  "));
    if (SHOW_CLAUSES) r.says.forEach((c) => console.log("            says: " + String(c.sites).padStart(4) + "  " + c.clause));
    if (SHOW_EXAMPLES && r.example) console.log("            e.g.  " + r.example);
  });
  console.log("");
  console.log("RULED BUT DECLINING — needs VOCABULARY or a nameable child, NOT a second rule (R-LANG-16)");
  /* TWO COLUMNS BECAUSE THEY ANSWER TWO QUESTIONS, and only the right-hand one is comparable to
   * the worklist above. OCCURRENCES counts every node the renderer refused at; a single statement
   * can refuse at four nested calls. DISTINCT SITES counts the generic statements themselves. */
  console.log("    occurrences (raw, credited)      DISTINCT SITES (raw, credited, 1-char, esc)   REAL   kind");
  w.declining.forEach((r) => console.log(
    "    " + String(r.net).padStart(11) + " (" + String(r.sites).padStart(4) + ", " + String(r.credited).padStart(4) + ")"
    + String(r.distinctNet).padStart(21) + " (" + String(r.distinctSites).padStart(4) + ", " + String(r.distinctCredited).padStart(4) + ", " + String(r.distinctOneChar).padStart(4) + ", " + String(r.distinctEscaped).padStart(3) + ")"
    + String(r.distinctReal).padStart(7) + "   " + r.kind));
  console.log("");
  console.log("CallExpression BY FAMILY — PROVISIONAL: a site whose PARENT refuses attributes to the CHILD kind here,");
  console.log("  so these overlap Block/Parameter above. Ceilings, not totals, until the attribution model is fixed.");
  console.log("    sites  credited   1-char   escape    REAL   family");
  /* PROVISIONAL, and it says so in the output. A site whose PARENT refuses the chain is attributed
   * here to the child kind it stopped at, not to the parent's vocabulary — so `Block`/`Parameter`
   * and the promise/arrayMutation families are partly the SAME sites counted twice, under two
   * names. Fixing the attribution model is its own item; until it lands, every family figure below
   * is a ceiling, not a total. */
  w.families.forEach((r) => {
    console.log("    " + String(r.sites).padStart(5) + "   " + String(r.credited).padStart(7) + "   " + String(r.oneChar).padStart(6)
      + "   " + String(r.escaped).padStart(6) + "   " + String(r.real).padStart(5) + "   " + r.family);
    console.log("             " + r.methods.slice(0, 8).map((m) => "." + m.method + " " + m.sites + (m.oneChar ? " (1ch " + m.oneChar + ")" : "")).join(",  "));
  });
  console.log("");
}

module.exports = { computeWorklist };

/* Run directly for the report; `require` it for the data. */
if (require.main === module) {
  const w = computeWorklist({ examples: process.argv.includes("--examples"), clauses: process.argv.includes("--clauses") });
  if (process.argv.includes("--json")) console.log(JSON.stringify(w, null, 2));
  else report(w);
}
