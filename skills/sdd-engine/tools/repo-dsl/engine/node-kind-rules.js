"use strict";
/**
 * node-kind-rules.js — THE PHRASEBOOK (PRD §5D.3C, 22-node-kind-rules.md). R-LANG-16, R-LANG-17.
 *
 * Amir's decision, 2026-08-31: *"Key the phrasebook rules to the target language's own AST node
 * kinds, not to shapes mined from a specific corpus."* A mined table needed **437 templates for 90%
 * of Hydra alone** and started again at zero for the next repository. Node kinds are fixed by the
 * language: **28 rules reach 90% of node instances in ANY TypeScript codebase**, and the whole
 * corpus exercises only 100 of the language's 400 kinds — a set that can be finished.
 *
 * THREE PROPERTIES THIS FILE EXISTS TO ENFORCE, all from §5D.3C §2:
 *
 *   1. ONE RULE PER KIND, keyed by `ts.SyntaxKind` name. A key that is a mined shape string is a
 *      review failure (R-LANG-16). CARDINALITY IS A PARAMETER of a rule, never grounds for a second
 *      one — the CallExpression rule below renders a chain of one method and a chain of four
 *      through the same list-join.
 *   2. RULES COMPOSE RECURSIVELY. A rule renders by rendering its children and stitching per its own
 *      template, and never inspects WHAT its children are, only that they render (R-LANG-17).
 *   3. AN UNRULED KIND FALLS BACK, never fails. `render` returns null and the caller keeps whatever
 *      it did before, so the first rule ships alone and nothing regresses.
 *
 * WHY THE PRIMITIVES ARE PASSED IN. `dotted` and `q` live in enfile.js, which requires THIS module;
 * requiring it back would be a cycle, and copying them here would be a second definition of "how an
 * identifier is spelled" — the duplication class that cost this project the SKIP sets (CLAUDE.md
 * §8). The caller supplies them, so there stays exactly one of each.
 *
 * MEASURED ORDERING, 2026-09-04, over the 1,037-file corpus — structural nodes only, tokens and
 * bare identifiers excluded because they carry no rule: 274,091 instances across 95 distinct kinds.
 *
 *      1  PropertyAccessExpression  31,687   cum 11.6%
 *      2  CallExpression            29,021   cum 22.1%
 *      3  PropertyAssignment        23,326   cum 30.7%
 *      4  VariableDeclaration       13,261   cum 35.5%
 *
 * (§5D.3C's own table lists StringLiteral third; it counted literals, this pass excludes everything
 * at or below `LastToken`. The ordering of the kinds that take rules is unchanged.)
 *
 * RULES AUTHORED SO FAR: CallExpression, ObjectLiteralExpression, PropertyAccessExpression,
 * ElementAccessExpression — in measured order of the
 * defects they close, each shipped and committed alone so its effect is attributable.
 */
const ts = require("typescript");

/* Collection verbs whose result is worth naming in the reader's terms rather than the callee's.
 * MOVED HERE from enfile.js, not copied — it is the CallExpression rule's own vocabulary and
 * enfile now imports it back. Closed table, same discipline as MATCHERS: an entry may be added, but
 * an unknown method is NEVER de-camel-cased into a phrase — the rule declines and the caller's
 * older, truthful fallback stands. */
const VERBS = {
  map: "mapped", filter: "filtered", reduce: "reduced", sort: "sorted",
  slice: "sliced", flat: "flattened", flatMap: "mapped and flattened",
  reverse: "reversed", join: "joined", concat: "with more appended",
};

const unwrap = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAwaitExpression(n) || ts.isNonNullExpression(n))) n = n.expression;
  return n;
};

const RULES = {
  /* ── CallExpression ────────────────────────────────────────────────────────────────────────────
   * Renders a METHOD CHAIN as a noun phrase naming the thing the reader is tracking and what was
   * done to it: `parsed.map(...).filter(Boolean)` -> "`parsed` mapped then filtered".
   *
   * THE DEFECT IT CLOSES, measured before it was written. `returnCallGloss` in enfile.js named the
   * receiver for a ONE-link chain and then declined outright at
   *
   *     return null;   // receiver is itself a call -> cannot name it truthfully
   *
   * so every chained call fell through to `firstCallName`, which yields the LAST method name alone.
   * Measured over the corpus on 2026-09-04, the generic ReturnStatement clauses included
   * "return map" x44, "return then" x35, "return filter" x12, "return join" x10, "return find" x9 —
   * clauses assembled from a method name with the subject discarded. "return filter" for
   * `return parsed.map(...).filter(Boolean)` is not merely thin: it names the wrong half.
   *
   * Recursion is the whole mechanism (§5D.3C §2.2): the chain is walked to its base and the base is
   * rendered by the caller's `dotted`, exactly as a one-link chain always was. CARDINALITY IS A
   * PARAMETER — one method or four go through the same list-join, which is R-LANG-16's rule about
   * not writing a second rule per arity.
   *
   * IT DECLINES RATHER THAN GUESSES (§5C rule 3). Any method outside VERBS, a base that does not
   * render, or a chain of length zero returns null and the caller keeps its older output. A verb
   * table that de-camel-cased unknown methods would manufacture confident English about code it had
   * not understood, which is the failure this engine exists to eliminate. */
  CallExpression(node, sf, P) {
    const methods = [];
    let cur = unwrap(node);
    while (cur && ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
      const name = cur.expression.name && cur.expression.name.text;
      if (!name || !VERBS[name]) return null;      /* unknown link -> decline the whole chain */
      methods.unshift(name);
      cur = unwrap(cur.expression.expression);
    }
    if (!methods.length) return null;
    const base = P.dotted(cur, sf);
    if (!base) return null;                        /* base is itself unnameable -> decline */
    /* the list-join IS the cardinality parameter */
    const verbs = methods.map((m) => VERBS[m]);
    const tail = verbs.length === 1 ? verbs[0] : verbs.join(" then ");
    return P.q(base) + " " + tail;
  },

  /* ── ObjectLiteralExpression ───────────────────────────────────────────────────────────────────
   * Names the FIELDS, which is what a reader of a returned record is looking for, and says how many
   * more there are: "a record of `id`, `clientId`, `amount`, `dueDate`, `status` and 19 more fields".
   *
   * THE DEFECT IT CLOSES, measured over the corpus 2026-09-04 before it was written.
   * `ObjectLiteralExpression` is the LARGEST single source of contentless ReturnStatement clauses —
   * 124 bare sites plus 23 parenthesised, ahead of CallExpression's 90 — and the cause was a hard
   * CARDINALITY CLIFF. `recordGloss` listed every key up to five and then, at six, threw all of them
   * away for a bare count:
   *
   *     return { id: client.id, allowLateNotifications: ..., sCode: ..., fax: ..., ... }
   *       ==>  "return a record with 49 fields"
   *
   * Forty-nine field names were in hand and none reached the reader. That is precisely the shape
   * R-LANG-16 forbids: arity is a PARAMETER of one rule, never grounds for a different answer. The
   * same cliff produced "a record with 24 fields", "with 34 fields", "with 65 fields" — a number is
   * not English about this site, and it is identical for every record of that size in the corpus.
   *
   * IT DEGRADES, IT DOES NOT DECLINE. A computed key or an un-nameable spread used to return null
   * for the WHOLE literal, discarding the eleven fields that could be named; those now count toward
   * the tail. Declining outright is what sent `return ({ ids, genSubId, type, ... })` down to
   * `firstCallName` and out as "return map" — a clause built from a method name buried in a
   * property value, with the record itself discarded.
   *
   * IT NEVER SPLICES A VALUE (§5C honesty). Keys are named; what is assigned to them is not
   * guessed at. A literal with nothing nameable in it at all still returns null and the caller's
   * older output stands. */
  ObjectLiteralExpression(node, sf, P) {
    if (!ts.isObjectLiteralExpression(node)) return null;
    if (!node.properties.length) return "an empty object";
    const named = [];
    let hidden = 0;
    for (const pr of node.properties) {
      if (ts.isSpreadAssignment(pr)) {
        const t = P.dotted(pr.expression, sf);
        if (t) named.push("everything in " + P.q(t)); else hidden++;
        continue;
      }
      const nm = pr.name && P.member(pr.name, sf);
      if (nm) named.push(P.q(nm)); else hidden++;
    }
    if (!named.length) return null;                /* nothing nameable -> decline, do not waffle */
    /* SHOWN is 5 so that every literal today's `recordGloss` listed in full is rendered
     * byte-identically; the rule changes only what the cliff used to discard. */
    const SHOWN = 5;
    const shown = named.slice(0, SHOWN);
    const rest = named.length - shown.length + hidden;
    const tail = rest ? [rest + " more field" + (rest === 1 ? "" : "s")] : [];
    return "a record of " + P.list(shown.concat(tail));
  },

  /* ── PropertyAccessExpression ──────────────────────────────────────────────────────────────────
   * Names a property reached through something that is NOT a plain identifier chain:
   * `getCreditNotePostedAmounts(credits).roundingAdjustment`
   *   ->  "`roundingAdjustment` from the result of `getCreditNotePostedAmounts`".
   *
   * RANK 1 BY INSTANCE COUNT (31,687, 11.6% of all structural nodes) and, measured 2026-09-04, the
   * largest single cause of contentless ExpressionStatement clauses: of the 327 generic
   * `expect(...)` statements, 257 have a PropertyAccessExpression subject. `assertSubject` reached
   * for `dotted`, which handles only a pure `a.b.c` chain, and declined the moment a call appeared
   * anywhere in the base — so
   *
   *     expect(getCreditNotePostedAmounts(artefactCredits).roundingAdjustment).toBe('0.00000');
   *       ==>  "call to be"
   *
   * a clause with nothing of the site in it, assembled from a matcher's method name. This is
   * exactly the defect the CallExpression rule closed for returns ("receiver is itself a call ->
   * cannot name it truthfully"), one kind over: the receiver CAN be named truthfully, just not as
   * a dotted string.
   *
   * RECURSION IS THE MECHANISM (§5D.3C §2.2). The trailing property names are peeled off, and the
   * base is rendered by the phrasebook itself — so a base this rule has never heard of renders
   * through whatever rule owns its kind, and this rule never inspects what its child IS, only that
   * it rendered (R-LANG-17).
   *
   * IT IS ORDERED BEHIND `dotted`, DELIBERATELY. A plain `a.b.c` still renders exactly as before,
   * so this rule can only add clauses where there were none — it cannot restate an existing one
   * differently, which is what keeps its effect attributable to a measurement. */
  PropertyAccessExpression(node, sf, P) {
    if (!ts.isPropertyAccessExpression(node)) return null;
    const flat = P.dotted(node, sf);
    if (flat) return P.q(flat);                    /* plain chain -> unchanged, byte for byte */
    const names = [];
    let cur = node;
    while (cur && ts.isPropertyAccessExpression(cur)) {
      const nm = cur.name && cur.name.text;
      if (!nm) return null;
      names.unshift(nm);
      cur = unwrap(cur.expression);
    }
    if (!names.length || !cur) return null;
    const base = baseGloss(cur, sf, P);
    if (!base) return null;                        /* base unnameable -> decline, do not waffle */
    return P.q(names.join(".")) + " from " + base;
  },

  /* ── ElementAccessExpression ───────────────────────────────────────────────────────────────────
   * `notes[0]` -> "`notes` at `0`". Written as rule 4 because rule 3 MEASURED the need for it:
   * `PropertyAccessExpression` declined on 243 of its 257 sites purely because its base was an
   * element access that nothing could render — `expect(notes[0].subscriptionIds)` came out as
   * "call to equal". A rule renders by rendering its children (R-LANG-17), so a missing CHILD rule
   * silently caps a parent rule's yield. That is the mechanism, and it is why the phrasebook is
   * built child-first once a parent points at the gap.
   *
   * BOTH SIDES RECURSE. The base goes through `baseGloss`, so `a().b[0]` and `x[0][1]` render by
   * composition rather than by a case per shape; the index does too, so a named index reads
   * "`rows` at `idx`" rather than being dropped.
   *
   * `enfile.js`'s `elemAccess` now delegates here, so there is ONE definition of this gloss. It had
   * been a second one, restricted to a plain dotted base — the duplication class CLAUDE.md §8
   * records against the walk SKIP sets, which drifted and hid 696 of 937 un-collapsed bodies. */
  ElementAccessExpression(node, sf, P) {
    if (!ts.isElementAccessExpression(node)) return null;
    const arg = node.argumentExpression;
    if (!arg) return null;
    const base = baseGloss(node.expression, sf, P);
    if (!base) return null;
    const d = P.dotted(arg, sf);
    const idx = d ? P.q(d) : (P.literal(arg, sf) || render(arg, sf, P));
    if (!idx) return null;                         /* an index we cannot name -> decline */
    return base + " at " + idx;
  },
};


/* What a property hangs off, said truthfully. Tries the phrasebook FIRST so the base goes through
 * whatever rule owns its kind (R-LANG-17), and only then falls back to naming a plain call by its
 * callee. A base with no honest name at all returns null and its caller declines. */
function baseGloss(n, sf, P) {
  if (!n) return null;
  const d = P.dotted(n, sf);
  if (d) return P.q(d);
  const viaRule = render(n, sf, P);
  if (viaRule) return viaRule;
  if (ts.isCallExpression(n)) {
    const callee = P.dotted(n.expression, sf) || (ts.isIdentifier(n.expression) ? n.expression.text : null);
    return callee ? "the result of " + P.q(callee) : null;
  }
  return null;
}

/** Render ONE node through the phrasebook. Null = no rule for this kind, or the rule declined. */
function render(node, sf, P) {
  if (!node) return null;
  const rule = RULES[ts.SyntaxKind[node.kind]];
  return rule ? rule(node, sf, P) : null;
}

module.exports = { render, RULES, VERBS, KINDS: Object.keys(RULES) };
