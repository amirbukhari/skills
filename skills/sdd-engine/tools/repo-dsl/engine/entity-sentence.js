"use strict";
/**
 * entity-sentence.js — the ENGLISH grammar for the Entity archetype, in BOTH directions.
 *
 * WHY THIS EXISTS. `engine/generate.js` already has a forward DSL, but it is SQL-shaped:
 *
 *     entity PaymentPlan table "payment_plans" {
 *       column id pk
 *       column account_id int not-null
 *     }
 *
 * PRD §5D.0 statement 3 rules that out as the authoring surface: *"we need to make sure we are using
 * grammar and words to form sentences that can be patterns that generate code. its supposed to be
 * code generators that call code generators but its sentences."* And §5D.1's Author -> Compile panel
 * already speaks the sentence form. So this module is the missing layer: sentences in, model out,
 * and the model back to the identical sentence.
 *
 * THE GRAMMAR, written as productions (PRD §5E.3.2). A nonterminal is a word; a production is its
 * expansion; a nonterminal appearing in a RHS is one generator calling another.
 *
 *   Entity    -> "«Name» is an entity stored in «table»." [Extends] [Columns] [Relations]
 *   Extends   -> " It extends «Base»."
 *   Columns   -> " It has " ColumnList "."
 *   ColumnList-> Column ("," Column)* ["," "and" Column]          -- Oxford comma, always
 *   Column    -> "an auto-generated id"                            -- ALT 1: no type, no nullability
 *              | "a required «name» («type»)"                      -- ALT 2
 *              | "an optional «name» («type»)"                     -- ALT 3
 *   Relation  -> " It belongs to a «Target» (join «col»)."         -- ALT 1: ManyToOne
 *              | " It belongs to a «Target»."                      -- ALT 2: ManyToOne, no join
 *              | " It has many «Target»."                          -- ALT 3: OneToMany
 *              | " It has and belongs to many «Target»."           -- ALT 4: ManyToMany
 *
 * ALTERNATIVES ARE LOAD-BEARING, not stylistic. §5E.4 measured this against the real extractor:
 * `an auto-generated id` comes back with NO `parsed.type` at all while `a required amount (decimal)`
 * carries type and nullability. One nonterminal, different expansions — which is exactly why a slot
 * cannot be a single word-id reference.
 *
 * INJECTIVITY IS A GATE (proposed R-ARCH-17). Because the lifecycle runs both ways (§5D.0
 * statement 4), the grammar must be unambiguous in BOTH directions or AT-ARCH-1 fails
 * nondeterministically: two sentences must not compile to the same TypeScript, and each TypeScript
 * shape must derive to exactly one sentence. Two consequences visible here:
 *   - the column-name canonicalization (`account id` <-> `account_id` <-> `accountId`) is a FUNCTION
 *     this module owns, and it is injective: db form is the authored form, `camel()` derives the
 *     prop, and rendering goes back through `spaced()`. `accountId` and `account_id` cannot both be
 *     authored for the same column.
 *   - a COLUMN name is spoken (`account id`) but a JOIN column is quoted VERBATIM (`account_id`).
 *     Both appear in §5D.1's one reference sentence, deliberately: the join clause names a database
 *     column, and §5C's rule is that a word-like hole stays verbatim. Flattening the two broke
 *     round-trip on the reference case the first time this file was written.
 *   - `It belongs to a X (join c)` and `It belongs to a X` are DIFFERENT productions because they
 *     compile differently (with and without @JoinColumn). Collapsing them would break injectivity.
 *
 * ZERO MODEL CALLS. Deterministic, pure, no I/O. (PRD R-MECH-4; §5D.1's panel is labelled
 * "no model call" and this is why it can be.)
 */
const { camel, lowerFirst } = require("./generate");

const TYPE_TS = { int: "number", integer: "number", tinyint: "number", smallint: "number", bigint: "number",
  float: "number", double: "number", decimal: "string", numeric: "string", bit: "boolean", bool: "boolean",
  boolean: "boolean", varchar: "string", char: "string", text: "string", timestamp: "Date", datetime: "Date", date: "Date" };

/* db form <-> spoken form. `account_id` is spoken `account id`. Injective in both directions for
 * snake_case and single words, which is the whole authored space. */
const spaced = (dbName) => dbName.replace(/_/g, " ");
const snaked = (spokenName) => spokenName.trim().replace(/\s+/g, "_");

class SentenceError extends Error {
  constructor(msg, clause) {
    super(`entity-sentence: ${msg}` + (clause ? `\n  clause: ${JSON.stringify(clause)}` : ""));
    this.name = "SentenceError"; this.clause = clause;
  }
}

/* ---------------------------------------------------------------- PARSE (sentence -> model) */

/* Split on sentence boundaries, keeping it simple and total: a period followed by space or end.
 * Parenthesised type annotations never contain a period, so this cannot split inside one. */
function sentences(text) {
  return text.replace(/\s+/g, " ").trim().split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
}

function parseColumnPhrase(phrase) {
  const p = phrase.trim();
  /* ALT 1 — the auto-generated id. Carries no type and no nullability, which is why Column needs
   * alternatives rather than one shape with optional fields. */
  if (/^an auto-generated id$/i.test(p)) return { role: "column", prop: "id", pk: true, tsType: "number" };
  /* ALT 2/3 — a required|optional <name> (<type>) */
  /* The enum alternative accepts BOTH spellings TypeORM allows, because the miner produces both:
   * a named enum (`enum EPaymentPlanStatus`) and an INLINE LITERAL LIST (`enum ['active',
   * 'deleted']`, from `@Column({ type: 'enum', enum: ['active', 'deleted'] })`). Only the named one
   * was accepted before, so the five literal-enum entities in the corpus rendered a sentence this
   * parser could not read back — half of the separator-injection defect below. */
  /* THE NAME MAY NOT CONTAIN PARENTHESES, and that is a correctness fix, not a tidy-up. With a
   * bare `.+?` the name group can swallow a whole trailing type group, so
   * `a required a (int) and a required b (int)` has TWO readings: two columns, or one column named
   * `a (int) and a required b`. Measured 2026-09-04 — the second reading is the one the lazy group
   * actually took, which silently turned a non-Oxford two-column list into one absurd column.
   * `spaced()` can never produce a parenthesis (db names have none), so excluding them costs
   * nothing and makes the phrase unambiguous — which is what the parseColumnList fallback below
   * relies on. */
  const m = p.match(/^an?\s+(required|optional)\s+([^()]+?)\s*\(\s*(?:enum\s+(\[[^\]]*\]|[A-Za-z_$][\w$]*)|([A-Za-z]+))\s*\)$/i);
  if (!m) throw new SentenceError("not a column phrase — expected \"an auto-generated id\" or \"a required|optional <name> (<type>)\"", phrase);
  const [, req, rawName, enumName, plainType] = m;
  const dbName = snaked(rawName);
  const col = { role: "column", src: dbName, prop: camel(dbName), nullable: /^optional$/i.test(req) };
  if (dbName.includes("_")) col.name = dbName;
  if (enumName) { col.colType = "enum"; col.enum = enumName; col.tsType = enumName; }
  else { col.colType = plainType.toLowerCase(); col.tsType = TYPE_TS[col.colType] || "string"; }
  return col;
}

/* SEPARATOR INJECTION — the defect this scanner exists to prevent, and the reason a regex `split`
 * cannot be used here at all.
 *
 * The list separators are "," and " and ". BOTH can occur INSIDE a single column phrase:
 *   - a comma inside a type annotation: `a required hydra state (enum ['active', 'deleted'])`;
 *   - the word "and" inside a column NAME: `terms_and_conditions` is spoken `terms and conditions`.
 * A `String.split` on the separators cuts straight through either, and the phrase it produces is
 * truncated mid-literal. Measured 2026-09-04: 5 of the 58 corpus entities failed exactly this way,
 * every one on the comma-in-enum shape, and `terms_and_conditions` fails identically BY
 * CONSTRUCTION — it is one defect class with two doors, so both are closed here rather than the
 * five instances being patched.
 *
 * WHAT CHANGED IN THE LANGUAGE THIS ACCEPTS: nothing. The Oxford-comma form the renderer emits
 * parses as before, and the non-Oxford form (`a ... and b ...`, no comma) is still accepted — see
 * parseColumnList. What is no longer accepted is a SPLIT THROUGH a bracketed group or a quoted
 * string, which was never a sentence any renderer produced.
 *
 * INJECTIVITY IS PRESERVED, and this is the part worth checking rather than assuming (§5E.3.2's
 * one hard rule is that two distinct sentences must not compile to the same TypeScript). A column
 * phrase is `an? (required|optional) NAME (TYPE)` with exactly ONE trailing bracketed group, so a
 * phrase can never be cut into two phrases that BOTH parse: the left half of any interior cut ends
 * before that group and therefore carries no type, and the right half carries no article. So the
 * "parse the segment whole, split on a bare `and` only if that fails" rule below has at most one
 * successful reading — it resolves the ambiguity, it does not choose between two live ones. */
function splitTopLevel(body, sep) {
  const out = [];
  let depth = 0, quote = null, cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === "\"" || ch === "`") { quote = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; cur += ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; cur += ch; continue; }
    if (depth === 0) {
      if (sep === "," && ch === ",") { out.push(cur); cur = ""; continue; }
      if (sep === "and" && /\s/.test(ch) && /^\s+and\s/i.test(body.slice(i))) {
        out.push(cur); cur = ""; i += body.slice(i).match(/^\s+and\s/i)[0].length - 1; continue;
      }
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseColumnList(body) {
  /* "a, b, and c" — the Oxford comma is REQUIRED on render, so on parse we accept it and also
   * accept its absence, but a re-render always produces it. That is what keeps render(parse(s))
   * total without making the grammar ambiguous. */
  const out = [];
  for (const raw of splitTopLevel(body, ",")) {
    /* A leading "and " can only be the Oxford conjunction: every phrase starts with "a " or "an ". */
    const seg = raw.replace(/^and\s+/i, "");
    let col = null, whole = null;
    try { col = parseColumnPhrase(seg); } catch (e) { whole = e; }
    if (col) { out.push(col); continue; }
    /* The non-Oxford reading, tried ONLY because the segment does not parse whole. A name that
     * merely CONTAINS "and" (`terms and conditions`) parses whole and never reaches this line. */
    const parts = splitTopLevel(seg, "and");
    if (parts.length > 1) {
      let sub = null;
      try { sub = parts.map(parseColumnPhrase); } catch (_) { sub = null; }
      if (sub) { out.push(...sub); continue; }
    }
    throw whole;
  }
  return out;
}

function parseRelationSentence(s) {
  let m;
  if ((m = s.match(/^It belongs to an?\s+([A-Za-z_$][\w$]*)\s*\(\s*join\s+(.+?)\s*\)\.$/i)))
    /* The join column is quoted VERBATIM, not spoken. §5D.1's reference sentence says
     * "a required account id (int)" for the column but "(join account_id)" for the join, in the
     * same sentence — deliberately, because the join clause names a DATABASE COLUMN and §5C's rule
     * is that a word-like hole stays verbatim. Speaking it would round-trip to "account id" and
     * break AT-ARCH-1 on the reference case. Measured: it did, before this line. */
    return { role: "relation", decorator: "ManyToOne", target: m[1], prop: lowerFirst(m[1]), join: m[2].trim() };
  if ((m = s.match(/^It belongs to an?\s+([A-Za-z_$][\w$]*)\.$/i)))
    return { role: "relation", decorator: "ManyToOne", target: m[1], prop: lowerFirst(m[1]) };
  if ((m = s.match(/^It has and belongs to many\s+([A-Za-z_$][\w$]*?)s?\.$/i)))
    return { role: "relation", decorator: "ManyToMany", target: m[1], prop: lowerFirst(m[1]) + "s" };
  if ((m = s.match(/^It has many\s+([A-Za-z_$][\w$]*?)s?\.$/i)))
    return { role: "relation", decorator: "OneToMany", target: m[1], prop: lowerFirst(m[1]) + "s" };
  return null;
}

/** parseEntitySentence(text) -> the SAME model shape generate.js's emitEntityCanonical consumes. */
function parseEntitySentence(text) {
  const ss = sentences(text);
  if (!ss.length) throw new SentenceError("empty input");
  const head = ss[0].match(/^([A-Za-z_$][\w$]*)\s+is an entity stored in\s+(.+?)\.$/i);
  if (!head) throw new SentenceError("first sentence must be \"<Name> is an entity stored in <table>.\"", ss[0]);
  const model = { className: head[1], table: head[2].trim(), base: null, members: [] };

  for (const s of ss.slice(1)) {
    let m;
    if ((m = s.match(/^It extends\s+([A-Za-z_$][\w$]*)\.$/i))) { model.base = m[1]; continue; }
    if ((m = s.match(/^It has\s+(.+)\.$/i)) && !/^many\b|^and belongs to many\b/i.test(m[1])) {
      for (const c of parseColumnList(m[1])) model.members.push(c);
      continue;
    }
    const rel = parseRelationSentence(s);
    if (rel) { model.members.push(rel); continue; }
    throw new SentenceError("no production matches this sentence", s);
  }
  return model;
}

/* -------------------------------------------------------------- RENDER (model -> sentence) */

function renderColumnPhrase(c) {
  if (c.pk) return "an auto-generated id";
  const name = spaced(c.name || c.src || c.prop);
  const type = c.colType === "enum" ? `enum ${c.enum}` : c.colType;
  const article = /^[aeiou]/i.test(c.nullable ? "optional" : "required") ? "an" : "a";
  return `${article} ${c.nullable ? "optional" : "required"} ${name} (${type})`;
}

function renderRelationSentence(r) {
  if (r.decorator === "OneToMany") return `It has many ${r.target}s.`;
  if (r.decorator === "ManyToMany") return `It has and belongs to many ${r.target}s.`;
  return r.join ? `It belongs to a ${r.target} (join ${r.join}).` : `It belongs to a ${r.target}.`;
}

/** renderEntitySentence(model) -> the canonical sentence. Inverse of parseEntitySentence. */
function renderEntitySentence(model) {
  const cols = model.members.filter((m) => m.role === "column");
  const rels = model.members.filter((m) => m.role === "relation");
  const out = [`${model.className} is an entity stored in ${model.table}.`];
  if (model.base) out.push(`It extends ${model.base}.`);
  if (cols.length) {
    const phrases = cols.map(renderColumnPhrase);
    const list = phrases.length === 1 ? phrases[0]
      : phrases.slice(0, -1).join(", ") + (phrases.length > 1 ? ", and " : "") + phrases[phrases.length - 1];
    out.push(`It has ${list}.`);
  }
  for (const r of rels) out.push(renderRelationSentence(r));
  return out.join(" ");
}

/* ------------------------------------------- BACKWARD (mined slots -> model -> sentence)
 *
 * THE OTHER HALF OF THE LIFECYCLE. PRD §5D.0 statement 4: mine the codebase to get the .en,
 * hand-edit it, compile it back — AND edit the code directly, re-mine, and get the .en back
 * matching. *"Neither direction is the derived one."* parseEntitySentence covers authoring;
 * this covers mining. Together they are AT-ARCH-1 (§5E.2):
 *
 *     sentence -> model -> .ts -> extractEntity -> model' -> sentence'      sentence' === sentence
 *
 * It reads `slots`, which is where extractEntity actually stores things (R-ARCH-6, corrected), and
 * the NAMED relation fields from parseRelationArgs (R-ARCH-18) — before those existed the join
 * column was dropped and this function could not have been written at all. */
function modelFromExtraction(ex) {
  if (!ex || ex.archetype !== "Entity") throw new SentenceError("not an Entity extraction");
  const model = { className: ex.slots.className, table: ex.slots.table, base: ex.slots.base || null, members: [] };
  for (const c of ex.slots.columns) {
    if (c.decorator === "PrimaryGeneratedColumn") { model.members.push({ role: "column", prop: c.prop, pk: true, tsType: "number" }); continue; }
    const p = c.parsed || {};
    const col = { role: "column", prop: c.prop, src: p.name || c.prop, nullable: p.nullable === "true" || p.nullable === true };
    if (p.name) col.name = p.name;
    if (p.enum) { col.colType = "enum"; col.enum = p.enum; col.tsType = p.enum; }
    else { col.colType = p.type || "varchar"; col.tsType = TYPE_TS[col.colType] || "string"; }
    model.members.push(col);
  }
  for (const r of ex.slots.relations) {
    const p = r.parsed || {};
    const rel = { role: "relation", prop: r.prop, decorator: p.kind || r.decorator, target: p.target };
    /* `join === true` means @JoinColumn() with the name implied — there is no name to speak, so the
     * sentence uses the no-join production. Distinguishing that from a named join is exactly why
     * parseRelationArgs records `true` rather than dropping the flag. */
    if (typeof p.join === "string") rel.join = p.join;
    if (p.inverse) rel.inverse = p.inverse;
    model.members.push(rel);
  }
  return model;
}

/** sentenceFromSource(ts) -> the entity's English, mined straight from TypeScript. */
function sentenceFromSource(src, fileName = "x.ts") {
  const A = require("./archetypes");
  const ex = A.extractEntity(src, fileName);
  if (!ex.conforms) throw new SentenceError(`file does not conform to the Entity archetype: ${ex.reason}`);
  return renderEntitySentence(modelFromExtraction(ex));
}

module.exports = { modelFromExtraction, sentenceFromSource, parseEntitySentence, renderEntitySentence, renderColumnPhrase, renderRelationSentence, SentenceError, spaced, snaked };
