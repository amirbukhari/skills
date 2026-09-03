"use strict";
/* en-file-claim.js — THE FILE-SCALE LABEL IS A CLAIM, NOT A CONCATENATION.
 *
 * WHY THIS EXISTS. On 2026-09-03 Amir was shown `src/routers/links.ts.en` and said *"You lied to
 * me."* Every reported metric was true and the picture was false: the file's first line is a
 * ~200-word run-on that names all fifteen imports and then every route, joined by "then". That is
 * the SAME defect that was fixed at folder scale (`en-scales.js`, PRD §10 "A SCALE LABEL IS A
 * CLAIM, NOT A CONCATENATION") and at program scale, and left in place one level down. His
 * approved target for that file:
 *
 *     The `links` router exposes two Freshbooks endpoints, both behind a JWT check.
 *
 * which COUNTS (two), CLASSIFIES (endpoints), states a SHARED PROPERTY (both behind a check) and
 * names ZERO imports. §4B already settled that imports are foldable, so nothing stops us: imports
 * are not what a file is about.
 *
 * WHY IT IS A SEPARATE MODULE, and why the trigger is CONTENT and not POSITION. `enfile.js` is the
 * file several lanes edit at once, and it computes a structural heading in exactly TWO mirrored
 * places — the renderer's `label()` closure and `deriveStructuralGloss()` — which R-REND-6 requires
 * to agree byte for byte. A file-scale-only label therefore CANNOT be gated on "am I at the top of
 * a file": `deriveStructuralGloss` re-derives an INNER body in isolation, where that body's own
 * start is 0 and its end is its own length, so a positional test is true for every inner chunk too
 * and the two sides would disagree on all of them. Refusals everywhere.
 *
 * So the trigger is a property of the STATEMENTS: a run that mixes IMPORT DECLARATIONS with real
 * declarations. In TypeScript an `import` is only legal at module top level, so that selects whole-
 * file runs and nothing else, and it is computable identically from the source slice and from the
 * recompiled body — which is exactly what makes the derive check able to check it.
 *
 * THE HONESTY RULE IS THE SAME ONE, AND IT IS IMPLEMENTED. Quantifiers are derived from counts, so
 * no claim can overstate. When nothing truthful can be said the file keeps its ordinary label and
 * the fallback is COUNTED, never dressed up. Amir: *"I would take an honest 40% vacuous over a
 * plausible 0%."*
 *
 * WHAT THIS DOES NOT DO. It does not write per-site prose — `spanProse` and the code-bearing holes
 * belong to the productions lane. This module reads statements that the engine ALREADY renders
 * clauses for and says one true sentence about the collection.
 */

const ts = require("typescript");

/* ---- OBSERVATIONS ------------------------------------------------------------------------------
 * Each entry classifies a TOP-LEVEL STATEMENT. As with `en-scales.js` CATEGORIES these are
 * observations, not archetypes: a file is never said to BE one of these, only to contain them.
 * `singular`/`plural` are the words that reach Amir, so they are nouns he would use about his own
 * code rather than compiler vocabulary. */
const KINDS = [
  { key: "suite",     singular: "test suite",       plural: "test suites" },
  { key: "route",     singular: "route",            plural: "routes" },
  { key: "endpoint",  singular: "endpoint",         plural: "endpoints" },
  { key: "handler",   singular: "handler",          plural: "handlers" },
  { key: "shape",     singular: "shape",            plural: "shapes" },
  { key: "choice",    singular: "set of choices",   plural: "sets of choices" },
  { key: "type",      singular: "type",             plural: "types" },
  { key: "record",    singular: "stored record",    plural: "stored records" },
  { key: "class",     singular: "class",            plural: "classes" },
  { key: "fn",        singular: "function",         plural: "functions" },
  { key: "constant",  singular: "constant",         plural: "constants" },
  { key: "reexport",  singular: "re-export",        plural: "re-exports" },
];
const KIND_BY_KEY = Object.create(null);
for (const k of KINDS) KIND_BY_KEY[k.key] = k;

function isImport(st) {
  return st.kind === ts.SyntaxKind.ImportDeclaration
      || st.kind === ts.SyntaxKind.ImportEqualsDeclaration;
}
function isReExport(st) {
  return st.kind === ts.SyntaxKind.ExportDeclaration
      || st.kind === ts.SyntaxKind.ExportAssignment;
}

/* HTTP verbs, spelled once. `use` is deliberately NOT here: mounting middleware is not exposing an
 * endpoint, and counting it as one would inflate the number Amir reads. */
const HTTP_VERBS = new Set(["get", "post", "put", "patch", "delete", "del", "head", "options", "all"]);

/* A route registration — `<something>.get("/path", ...)` as an expression statement. Returns the
 * receiver's text so a file's routes can be attributed to the router they hang off. */
function routeCall(st) {
  if (st.kind !== ts.SyntaxKind.ExpressionStatement) return null;
  let e = st.expression;
  while (e && e.kind === ts.SyntaxKind.AwaitExpression) e = e.expression;
  if (!e || e.kind !== ts.SyntaxKind.CallExpression) return null;
  const callee = e.expression;
  if (!callee || callee.kind !== ts.SyntaxKind.PropertyAccessExpression) return null;
  const verb = callee.name && callee.name.text;
  if (!verb || !HTTP_VERBS.has(verb)) return null;
  const recv = callee.expression;
  if (!recv) return null;
  const recvText = recv.kind === ts.SyntaxKind.Identifier ? recv.text : null;
  return { verb: verb.toUpperCase(), receiver: recvText, call: e };
}

/* A TEST SUITE — `describe("...", () => {...})` as a top-level expression statement. Without this a
 * test file reads as its FIXTURES ("10 constants"), which is true and is not what the file is
 * about; the suite is. Measured on the corpus before adding it: that is exactly what
 * `daysPeriodMinimum.test.ts` produced. */
const SUITE_FNS = new Set(["describe", "context", "suite", "it", "test"]);
function suiteCall(st) {
  if (st.kind !== ts.SyntaxKind.ExpressionStatement) return null;
  const e = st.expression;
  if (!e || e.kind !== ts.SyntaxKind.CallExpression) return null;
  let c = e.expression;
  /* `describe.only` / `it.each` are still suites */
  if (c && c.kind === ts.SyntaxKind.PropertyAccessExpression) c = c.expression;
  if (!c || c.kind !== ts.SyntaxKind.Identifier) return null;
  if (!SUITE_FNS.has(c.text)) return null;
  const arg = e.arguments && e.arguments[0];
  const title = arg && arg.kind === ts.SyntaxKind.StringLiteral ? arg.text : null;
  return { fn: c.text, title: title };
}

/* THE ROUTE GROUP, if the file declares one: `const linksRouter = new Router({ prefix: '/links' })`.
 * Returns the declared name and the prefix when it is a plain string literal, because a prefix is
 * the one piece of a router that names what it is FOR. */
function routerDecl(st) {
  if (st.kind !== ts.SyntaxKind.VariableStatement) return null;
  for (const d of st.declarationList.declarations) {
    const init = d.initializer;
    if (!init || init.kind !== ts.SyntaxKind.NewExpression) continue;
    const ctor = init.expression;
    const ctorName = ctor && ctor.kind === ts.SyntaxKind.Identifier ? ctor.text : null;
    if (!ctorName || !/router/i.test(ctorName)) continue;
    const name = d.name && d.name.kind === ts.SyntaxKind.Identifier ? d.name.text : null;
    let prefix = null;
    const arg = init.arguments && init.arguments[0];
    if (arg && arg.kind === ts.SyntaxKind.ObjectLiteralExpression) {
      for (const p of arg.properties) {
        if (p.name && p.name.text === "prefix" && p.initializer
            && p.initializer.kind === ts.SyntaxKind.StringLiteral) prefix = p.initializer.text;
      }
    }
    if (name) return { name: name, prefix: prefix };
  }
  return null;
}

/* Classify one non-import top-level statement. Returns a kind key, or null when nothing is
 * observable — null is counted, never guessed at. */
function classify(st) {
  if (isReExport(st)) return "reexport";
  switch (st.kind) {
    case ts.SyntaxKind.InterfaceDeclaration: return "shape";
    case ts.SyntaxKind.EnumDeclaration:      return "choice";
    case ts.SyntaxKind.TypeAliasDeclaration: return "type";
    case ts.SyntaxKind.FunctionDeclaration:  return "fn";
    case ts.SyntaxKind.ClassDeclaration: {
      const decs = ts.canHaveDecorators ? ts.getDecorators(st) : st.decorators;
      if (decs && decs.some((d) => /Entity/.test(d.getText ? d.getText() : ""))) return "record";
      return "class";
    }
    default: break;
  }
  if (suiteCall(st)) return "suite";
  if (routeCall(st)) return "route";
  if (st.kind === ts.SyntaxKind.VariableStatement) {
    if (routerDecl(st)) return null;              /* the router itself is the SUBJECT, not an item */
    for (const d of st.declarationList.declarations) {
      const i = d.initializer;
      if (!i) continue;
      if (i.kind === ts.SyntaxKind.ArrowFunction || i.kind === ts.SyntaxKind.FunctionExpression) return "fn";
    }
    return "constant";
  }
  return null;
}

/* ---- THE SHARED PROPERTY ----------------------------------------------------------------------
 * The half of Amir's target sentence that says something: *"both behind a JWT check"*. A count and
 * a classification describe a collection; a universal describes what is TRUE OF ALL OF IT.
 *
 * IT IS COMPUTED AS AN INTERSECTION AND QUANTIFIED FROM THE COUNT, which is what makes it safe: a
 * callee named in every item yields "all", in more than half "most", in at least one "some". It can
 * therefore never claim more than the code supports — and that matters here more than anywhere,
 * because THE APPROVED TARGET SENTENCE FOR `links.ts` IS ITSELF WRONG. `isValidJwt` appears in
 * exactly one of that file's two routes (source line 31); the second is a Freshbooks authorisation
 * callback with no JWT check anywhere in it. What IS true of both is the `validate` guard. Emitting
 * "both behind a JWT check" would have been a plausible sentence that misinformed him about his own
 * code — the precise failure this rule exists to prevent — so this returns the honest form and the
 * discrepancy is reported rather than papered over. */
const GUARDISH = /^(validate|authorize|authenticate|authorise|isValid|require|ensure|assert|check|guard|verify|can|must)/i;

function calleeNames(node) {
  const out = new Set();
  (function walk(n) {
    if (!n || typeof n.kind !== "number") return;
    if (n.kind === ts.SyntaxKind.CallExpression) {
      const c = n.expression;
      if (c) {
        if (c.kind === ts.SyntaxKind.Identifier) out.add(c.text);
        else if (c.kind === ts.SyntaxKind.PropertyAccessExpression && c.name) out.add(c.name.text);
      }
    }
    n.forEachChild(walk);
  })(node);
  return out;
}

function quantify(count, total) {
  if (count <= 0 || total <= 0) return null;
  if (count === total) return total === 2 ? "both" : "all";
  if (count * 2 > total) return "most";
  return "some";
}

/* The strongest TRUE universal over `items`, or null. Only guard-shaped callees are considered:
 * "all calling `intVal`" is true and says nothing, and a label has a word budget. */
function sharedGuard(items) {
  if (items.length < 2) return null;
  const sets = items.map((st) => calleeNames(st));
  const tally = new Map();
  for (const s of sets) for (const name of s) if (GUARDISH.test(name)) tally.set(name, (tally.get(name) || 0) + 1);
  let best = null;
  for (const [name, n] of tally) {
    if (best === null || n > best.n || (n === best.n && name.length > best.name.length)) best = { name: name, n: n };
  }
  if (!best) return null;
  const q = quantify(best.n, items.length);
  if (!q) return null;
  /* A SHARED PROPERTY THAT HOLDS FOR A MINORITY IS NOT A SHARED PROPERTY, and saying so is how a
   * true sentence still misleads. Measured on the corpus: `src/xero-api/contact.ts` produced *"some
   * behind a `checkForFbClientsNotInXeroWithInvoices` guard"* off ONE of twelve functions calling a
   * domain helper whose name happens to start with `check`. The COUNT was honest and the word
   * "guard" was a misclassification — precisely the *"plausible sentence that misinforms him about
   * his own code"* this module exists to avoid. So only a universal or a majority is stated; below
   * that the label says nothing, which costs Amir nothing. */
  if (q === "some") return null;
  return { quant: q, name: best.name, n: best.n, of: items.length };
}

/* ---- THE CLAIM --------------------------------------------------------------------------------- */

/* ---- THE DOMAIN WORD -------------------------------------------------------------------------
 * Amir's corrected target says *"two **Freshbooks** GET endpoints"*, and that word is the one part
 * of the sentence that is about his business rather than his framework. It is derived as the
 * INTERSECTION of the camelCase tokens of every identifier in every route, so a word only survives
 * if it is present in ALL of them — the same discipline as the shared guard. Framework and
 * language vocabulary is stoplisted, because `ctx`/`params`/`query` are in every route of every
 * router and say nothing. Nothing is inferred: if the intersection is empty the sentence simply
 * does not carry a domain word, which costs a reader nothing. */
const DOMAIN_STOP = new Set([
  "ctx", "params", "param", "query", "body", "request", "response", "res", "req", "next", "status",
  "http", "status", "code", "error", "errors", "meta", "data", "result", "results", "value", "void",
  "get", "post", "put", "patch", "delete", "head", "options", "all", "use", "router", "route",
  "routes", "validate", "valid", "is", "set", "api", "async", "await", "const", "let", "return",
  "id", "ids", "index", "item", "items", "list", "type", "types", "name", "names", "key", "keys",
  "string", "number", "boolean", "object", "array", "promise", "record", "partial", "date",
  "unauthorized", "forbidden", "found", "success", "failure", "message", "send", "fetch", "call",
]);
/* A DOMAIN WORD IS A COMPONENT OF A COMPOUND NAME, NEVER A WHOLE NAME. The final narrowing, and
 * the one that separates a domain from an operation.
 *
 * `freshbooks` never appears alone in `links.ts` — it is a part of `authorizeFreshbooksAccount`,
 * `freshbooksClientId`, `getSavedFreshbooksTokenData`. A programmer who spells a word into three
 * different compounds has named a THING his system deals with. One who calls `parse()` or declares
 * `ignored` has named an ACTION or a local, and hanging it on "endpoints" classifies them by
 * something that is not a classification. Measured, all emitted before this rule: `invoiceManagement.ts`
 * *"three **Parse** endpoints"*, `dataIntegrityChecks.ts` *"four **Ignored** endpoints"*,
 * `creditApplied.ts` *"two **Apply** DELETE endpoints"*. */
function camelTokens(text) {
  const out = new Set();      /* set of tokens, for the stoplist path (subject avoidance) */
  for (const raw of String(text).split(/[^A-Za-z]+/)) {
    if (!raw) continue;
    const whole = raw.toLowerCase();
    const parts = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/\s+/);
    for (const t of parts) {
      const w = t.toLowerCase();
      if (w.length < 5 || DOMAIN_STOP.has(w)) continue;
      if (w === whole) continue;   /* a whole name is an operation or a local, not a domain */
      /* A DOMAIN IS A NOUN. `dataIntegrityChecks.ts` cleared every test above and produced *"four
       * **Ignored** endpoints"* off a genuinely recurring `ignored…` family — shared across all
       * four routes, spelled in three distinct identifiers. It is not FALSE, and it does not
       * classify anything: a past participle names what was done to a record, never what kind of
       * endpoint acts on it. The slot in this sentence is for a noun or it is for nothing. */
      if (/ed$/.test(w)) continue;
      out.add(w);
    }
  }
  return out;
}
/* IDENTIFIERS ONLY — NOT STRING LITERALS, and this is a measured correction rather than a taste.
 * With literals included, `links.ts` came out *"two **Credentials** GET endpoints"*: both routes
 * answer failure with the message `'Invalid credentials'`, and "credentials" (11) beat "freshbooks"
 * (10) on the longest-wins tiebreak. An error message is not a classification of an endpoint, and
 * that label would have told Amir his Freshbooks routes were credential routes. Names the
 * programmer chose for things are evidence; prose he wrote for a client is not. */
const DOMAIN_GLOBALS = new Set(["console", "process", "Math", "JSON", "Object", "Array", "Number",
  "String", "Boolean", "Promise", "Date", "Error", "Map", "Set", "RegExp"]);

/* THE EVIDENCE FOR A DOMAIN WORD IS NARROW ON PURPOSE: names the programmer DECLARED or CALLED
 * BY NAME, and type references. Not member accesses, not literals, not globals.
 *
 * Measured, with every one of these actually emitted before the narrowing: presence anywhere in a
 * route body gave `rentsync.ts` *"six **Where** GET endpoints"* (a query builder's `.where`),
 * `lookups.ts` *"seven **Length** endpoints"* (`.length`), `payments.ts` *"five **Console**
 * endpoints"* (`console.log`) and `dataIntegrityChecks.ts` *"four **Ignored** endpoints"*. Each was
 * a true statement — the token really is in every route — attached to a word that classified the
 * endpoints wrongly. That is the exact defect that put `links.ts` in front of Amir: not a false
 * count, a false CLASSIFICATION, which is the harder kind to notice and the kind he acts on. */
/* tokens spelled by at least `min` DISTINCT identifiers in `text`. */
function tokensRecurring(text, min) {
  const seen = new Map();     /* token -> Set of the identifiers that spelled it */
  for (const raw of String(text).split(/[^A-Za-z]+/)) {
    if (!raw) continue;
    for (const t of camelTokens(raw)) {
      if (!seen.has(t)) seen.set(t, new Set());
      seen.get(t).add(raw);
    }
  }
  const out = new Set();
  for (const [t, ids] of seen) if (ids.size >= min) out.add(t);
  return out;
}

function identifierText(node) {
  const parts = [];
  (function walk(n) {
    if (!n || typeof n.kind !== "number") return;
    switch (n.kind) {
      case ts.SyntaxKind.CallExpression:
      case ts.SyntaxKind.NewExpression:
        /* only a BARE callee: `authorizeFreshbooksAccount(...)` is a name someone chose for this
         * domain; `qb.where(...)` is a library's vocabulary showing through. */
        if (n.expression && n.expression.kind === ts.SyntaxKind.Identifier
            && !DOMAIN_GLOBALS.has(n.expression.text)) parts.push(n.expression.text);
        break;
      case ts.SyntaxKind.TypeReference:
        if (n.typeName && n.typeName.kind === ts.SyntaxKind.Identifier) parts.push(n.typeName.text);
        break;
      case ts.SyntaxKind.VariableDeclaration:
      case ts.SyntaxKind.Parameter:
      case ts.SyntaxKind.BindingElement:
        if (n.name && n.name.kind === ts.SyntaxKind.Identifier) parts.push(n.name.text);
        break;
      default: break;
    }
    n.forEachChild(walk);
  })(node);
  return parts.join(" ");
}
/* the single word every one of `items` mentions, or null. Longest wins: a longer shared token is
 * the more specific claim, and specificity is the whole point of naming a domain at all. */
function domainWord(items, avoid, fileText) {
  if (items.length < 2) return null;
  /* distinct identifiers per token, over the WHOLE run the label describes */
  const fileIds = new Map();
  for (const raw of String(fileText || "").split(/[^A-Za-z]+/)) {
    if (!raw) continue;
    for (const t of camelTokens(raw)) {
      if (!fileIds.has(t)) fileIds.set(t, new Set());
      fileIds.get(t).add(raw);
    }
  }
  for (const [t, ids] of fileIds) fileIds.set(t, ids.size);
  /* A DOMAIN WORD THAT RESTATES THE SUBJECT IS NOT A CLAIM. Measured across `src/routers`: 24 of
   * the 38 routers produced *"The `accounts` router exposes 15 Accounts endpoints"* and its like —
   * a tautology occupying the one slot in the sentence that was supposed to say something new. */
  const skip = new Set(avoid ? camelTokens(avoid) : []);
  let inter = null;
  for (const st of items) {
    const toks = tokensRecurring(identifierText(st), 1);
    if (inter === null) inter = toks;
    else for (const t of [...inter]) if (!toks.has(t)) inter.delete(t);
    if (inter.size === 0) return null;
  }
  /* AND IT MUST RECUR ACROSS THE FILE: at least three DISTINCT identifiers spell it. Presence in
   * every route says the word is shared; recurrence says it is a DOMAIN and not an incident of
   * naming. Measured, and the two thresholds are not interchangeable — requiring the recurrence
   * PER ROUTE instead killed the one label this was built for, because `links.ts`'s first route
   * spells `freshbooks` in exactly one identifier (`freshbooksClientId`) while the file spells it
   * in three. Shared-across and recurs-within are different properties of different subjects;
   * §16's failure class 6, met while tuning a threshold. */
  let best = null;
  for (const t of inter) {
    if (skip.has(t)) continue;
    if ((fileIds.get(t) || 0) < 3) continue;
    if (best === null || t.length > best.length || (t.length === best.length && t < best)) best = t;
  }
  return best ? best[0].toUpperCase() + best.slice(1) : null;
}

/* Amir's target spells the count: *"exposes **two** ... endpoints"*. Digits past a dozen read
 * better than words, and "eleven routes" is where spelling stops helping. */
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve"];
function countWord(n) { return n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n); }

function plural(n, kind) { return n + " " + (n === 1 ? kind.singular : kind.plural); }

const MAX_KINDS = 2;          /* the word budget is ~24; two kinds plus a universal fills it */

/* `stmts` are the run's top-level statements, `sf` their source file. Returns a claim string, or
 * null to mean "say nothing here — keep the ordinary label", which the caller COUNTS. */
function fileClaim(stmts, sf) {
  if (!Array.isArray(stmts) || stmts.length === 0) return null;

  const imports = stmts.filter(isImport);
  const rest = stmts.filter((st) => !isImport(st));
  /* THE TRIGGER, and it is content rather than position — see the header. An `import` is only legal
   * at module top level, so a run holding one is a whole-file run, computable identically on both
   * sides of the round trip.
   *
   * `export … from …` CARRIES THE SAME WARRANT, and leaving it out left the two worst labels in the
   * corpus standing. Measured against the goal test after the import-only version landed: 4 labels
   * still over 30 words, and the worst two were `src/freshbooks-api/models/index.ts` at 47 words
   * and a components barrel at 31 — both pure re-export files with no imports at all, so the
   * trigger never fired and the run-on survived untouched. A re-export declaration is module
   * top-level-only in TypeScript exactly as an import is, so it selects whole-file runs on the same
   * grounds and stays computable from the recompiled bytes alone. */
  const barrel = stmts.filter(isReExport);
  if (imports.length === 0 && barrel.length === 0) return null;
  if (rest.length === 0) return null;             /* imports only: nothing to make a claim about */

  /* THE SUBJECT. A router names what the file is for far better than any count can. */
  let subject = null, subjectStmt = null, router = null;
  for (const st of rest) {
    const r = routerDecl(st);
    if (r) { subjectStmt = st; router = r; subject = "the `" + r.name + "` route group"; break; }
  }

  const counts = new Map();
  const byKind = new Map();
  let unclassified = 0;
  /* THE STATEMENT THAT BECAME THE SUBJECT IS NOT ALSO A LEFTOVER. It was double-counted in the
   * first version and `links.ts` read "...2 GET routes, both behind a `validate` guard, and 1 other
   * statement" where that one other statement WAS the `linksRouter` declaration already named at
   * the front of the same sentence. Found by reading the output against the file, not the code. */
  for (const st of rest) {
    if (st === subjectStmt) continue;
    const k = classify(st);
    if (k === null) { unclassified++; continue; }
    counts.set(k, (counts.get(k) || 0) + 1);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(st);
  }
  if (counts.size === 0) return null;             /* nothing observable — the caller counts this */

  const ranked = KINDS
    .map((k) => ({ kind: k, n: counts.get(k.key) || 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_KINDS);

  /* routes are described by their VERBS when they agree, because "2 GET routes" is more use than
   * "2 routes" and costs one word. */
  const parts = ranked.map((x) => {
    if (x.kind.key === "route") {
      const verbs = new Set(byKind.get("route").map((st) => routeCall(st).verb));
      const v = verbs.size === 1 ? [...verbs][0] + " " : "";
      return x.n + " " + v + (x.n === 1 ? x.kind.singular : x.kind.plural);
    }
    return plural(x.n, x.kind);
  });

  /* the universal, over the largest kind — the collection the count is about */
  const primary = ranked.length ? byKind.get(ranked[0].kind.key) : null;
  const guard = primary ? sharedGuard(primary) : null;

  /* AMIR'S SENTENCE, for the case it was written about: a file that declares a router and hangs
   * routes off it. Target, verbatim:
   *
   *     The `links` router exposes two Freshbooks GET endpoints under `/links`.
   *
   * Every clause is read off the file — the short name from the declaration, the count from the
   * registrations, the verb from their agreement, the domain word from an intersection, the prefix
   * from the constructor argument. Note what it does NOT contain: an import. §4B settled that
   * imports are foldable, and imports are not what a file is about. */
  let out;
  const routes = counts.get("route") || 0;
  if (router && routes > 0) {
    const short = router.name.replace(/router$/i, "") || router.name;
    const items = byKind.get("route");
    const verbs = new Set(items.map((st) => routeCall(st).verb));
    const verb = verbs.size === 1 ? [...verbs][0] + " " : "";
    const domain = domainWord(items, router.name + " " + (router.prefix || ""),
      items.map((st) => identifierText(st)).join(" "));
    out = "The `" + short + "` router exposes " + countWord(routes) + " "
        + (domain ? domain + " " : "") + verb + (routes === 1 ? "endpoint" : "endpoints")
        + (router.prefix ? " under `" + router.prefix + "`" : "");
    const others = ranked.filter((x) => x.kind.key !== "route").map((x) => plural(x.n, x.kind));
    if (others.length) out += ", plus " + others.join(" and ");
  } else {
    out = subject ? subject + ": " + parts.join(" and ") : parts.join(" and ");
  }
  if (guard) out += ", " + guard.quant + " behind a `" + guard.name + "` guard";
  if (unclassified > 0) out += ", and " + unclassified + " other statement" + (unclassified === 1 ? "" : "s");
  return out;
}

function labelWords(s) { return s && s.trim() ? s.trim().split(/\s+/).length : 0; }

/* MEASUREMENT IS INSTRUMENTED, NOT INFERRED FROM THE PAGE. Deciding vacuity by matching the .en's
 * first heading against a claim computed over the whole file is wrong, and measurably so: a file's
 * top-level run is not always the whole file (`src/hydra-ui/src/redux/features/documents/
 * interfaces.ts` leaves one statement outside its top chunk), so the two strings differ on files
 * where nothing is wrong. `fired`/`skipped` are counted where the decision is actually made. */
const stats = { fired: 0, skipped: 0 };
function resetStats() { stats.fired = 0; stats.skipped = 0; return stats; }

/* Convenience for tests and measurement: parse a text and claim it. */
function claimForText(text) {
  let sf;
  try { sf = ts.createSourceFile("s.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
  catch (_) { return null; }
  if (sf.parseDiagnostics && sf.parseDiagnostics.length) return null;
  const c = fileClaim([...sf.statements], sf);
  /* only runs that TRIGGERED (mixed imports with declarations) are candidates; an inner chunk
   * declining is not a vacuous file label and must not be counted as one. */
  if (c) stats.fired++;
  else if ([...sf.statements].some((st) => isImport(st) || isReExport(st))
        && [...sf.statements].some((st) => !isImport(st))) stats.skipped++;
  return c;
}

module.exports = { fileClaim, claimForText, stats, resetStats, domainWord, classify, routeCall, routerDecl,
  sharedGuard, calleeNames, quantify, labelWords, KINDS, HTTP_VERBS };
