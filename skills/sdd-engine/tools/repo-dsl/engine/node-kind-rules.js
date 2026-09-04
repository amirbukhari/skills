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
 * RULES AUTHORED SO FAR: CallExpression. Highest instance count with a MEASURED defect — see below.
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
};

/** Render ONE node through the phrasebook. Null = no rule for this kind, or the rule declined. */
function render(node, sf, P) {
  if (!node) return null;
  const rule = RULES[ts.SyntaxKind[node.kind]];
  return rule ? rule(node, sf, P) : null;
}

module.exports = { render, RULES, VERBS, KINDS: Object.keys(RULES) };
