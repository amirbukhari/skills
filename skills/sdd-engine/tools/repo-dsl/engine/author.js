"use strict";
/**
 * author.js — the ENGLISH-IN parser: controlled-natural-language authoring, the
 * inverse of engine/prose.js. Parses controlled English sentences to the SAME slot
 * schema engine/generate.js consumes, so reading and writing become one language.
 *
 * This is a CNL parser, not NL understanding: the grammar is fixed and strict. A
 * sentence that doesn't match is REJECTED with the offending phrase — never guessed.
 * Deterministic, zero model calls.
 *
 * Grammar (entities):
 *   "<Class> is an entity stored in <table>."
 *   "It has <field>, <field>, and <field>."          (one 'It has' sentence)
 *       field := "an auto-generated <words>"                              -> @PrimaryGeneratedColumn
 *              | "a required|an optional <words> [(<type>[ <EnumName>])]" -> @Column {name:snake, type, nullable}
 *   "It belongs to a <Target> [(join <col>)]."       -> @ManyToOne [+ @JoinColumn]
 *   "It has one <Target> [(join <col>)]."            -> @OneToOne
 *   "It has many <Target>[, <Target> ...]."          -> @OneToMany
 *   "It relates to many <Target>[, ...]."            -> @ManyToMany
 *   "It also defines ... local types ..."            -> ignored (not authored)
 */

const TYPE_TS = { int: "number", integer: "number", tinyint: "number", smallint: "number", bigint: "number", float: "number", double: "number", decimal: "string", numeric: "string", bit: "boolean", bool: "boolean", boolean: "boolean", varchar: "string", char: "string", text: "string", timestamp: "Date", datetime: "Date", date: "Date" };

function words(id) { return String(id).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase(); }
function snake(s) { return words(s).replace(/ /g, "_"); }
function camelFromWords(w) { return w.trim().replace(/\s+(.)/g, (_, c) => c.toUpperCase()); }
function lowerFirst(s) { return s ? s[0].toLowerCase() + s.slice(1) : s; }
function a(noun) { return (/^[aeiou]/i.test(noun) ? "an " : "a ") + noun; }
function isIdent(s) { return /^[A-Za-z_$][\w$]*$/.test(s || ""); }
function oxford(arr) { arr = arr.filter(Boolean); if (arr.length <= 1) return arr.join(""); if (arr.length === 2) return `${arr[0]} and ${arr[1]}`; return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`; }

/* ------------------------------------------------------------------ PARSE (in) */
function splitSentences(text) {
  return text.replace(/\s+/g, " ").trim().split(/\.(?:\s+|$)/).map((s) => s.trim()).filter(Boolean);
}
function parseColumnPhrase(p) {
  let m = p.match(/^an auto-generated (.+)$/);
  if (m) { const w = m[1].trim(); return { role: "column", pk: true, prop: camelFromWords(w), tsType: "number" }; }
  m = p.match(/^(?:a|an) (required|optional) (.+?)(?: \(([^)]*)\))?$/);
  if (!m) throw new Error(`cannot parse field phrase: "${p}"`);
  const nullable = m[1] === "optional";
  const w = m[2].trim();
  const col = { role: "column", prop: camelFromWords(w), name: snake(w), nullable };
  if (m[3] != null) {
    const toks = m[3].trim().split(/\s+/).filter(Boolean);
    if (toks[0] === "enum") { col.colType = "enum"; if (toks[1]) col.enum = toks[1]; }
    else if (toks.length) col.colType = toks[0];
  }
  col.tsType = col.enum || TYPE_TS[col.colType] || "string";
  return col;
}
function parseTargets(s) { return s.split(/,\s*|\s+and\s+/).map((t) => t.replace(/^and\s+/, "").trim()).filter(Boolean); }
function parseEntityCNL(text) {
  const sents = splitSentences(text);
  if (!sents.length) throw new Error("empty document");
  const h = sents[0].match(/^([A-Za-z_$][\w$]*) is an entity stored in ([A-Za-z_$][\w$]*)$/);
  if (!h) throw new Error(`bad opening sentence (expected "<Class> is an entity stored in <table>"): "${sents[0]}"`);
  const model = { className: h[1], table: h[2], base: null, members: [] };
  for (let i = 1; i < sents.length; i++) {
    const s = sents[i];
    let m;
    if ((m = s.match(/^It belongs to (?:a|an) ([A-Za-z_$][\w$]*)(?: \(join ([A-Za-z_$][\w$]*)\))?$/))) {
      const r = { role: "relation", decorator: "ManyToOne", target: m[1], prop: lowerFirst(m[1]) }; if (m[2]) r.join = m[2]; model.members.push(r);
    } else if ((m = s.match(/^It has one ([A-Za-z_$][\w$]*)(?: \(join ([A-Za-z_$][\w$]*)\))?$/))) {
      const r = { role: "relation", decorator: "OneToOne", target: m[1], prop: lowerFirst(m[1]) }; if (m[2]) r.join = m[2]; model.members.push(r);
    } else if ((m = s.match(/^It has many (.+)$/))) {
      for (const t of parseTargets(m[1])) { if (!isIdent(t)) throw new Error(`bad relation target: "${t}"`); model.members.push({ role: "relation", decorator: "OneToMany", target: t, prop: lowerFirst(t) }); }
    } else if ((m = s.match(/^It relates to many (.+)$/))) {
      for (const t of parseTargets(m[1])) { if (!isIdent(t)) throw new Error(`bad relation target: "${t}"`); model.members.push({ role: "relation", decorator: "ManyToMany", target: t, prop: lowerFirst(t) }); }
    } else if (/^It also defines /.test(s)) {
      /* declarative local types — not authored, ignored */
    } else if (/^It has /.test(s)) {
      for (const f of parseTargets(s.replace(/^It has /, ""))) model.members.push(parseColumnPhrase(f));
    } else {
      throw new Error(`unrecognized sentence: "${s}"`);
    }
  }
  return model;
}

/* ---------------------------------------------------------------- RENDER (out) */
/** renderEntityCNL(norm) -> controlled English, re-parseable by parseEntityCNL. */
function renderEntityCNL(norm) {
  const out = [`${norm.className} is an entity stored in ${norm.table}.`];
  const phrases = norm.columns.map((c) => {
    if (c.pk) return `an auto-generated ${words(c.prop)}`;
    let paren = "";
    if (c.type === "enum" || (!c.type && c.enum)) paren = isIdent(c.enum) ? ` (enum ${c.enum})` : " (enum)";
    else if (c.type) paren = ` (${c.type})`;
    return `${c.nullable ? "an optional" : "a required"} ${words(c.prop)}${paren}`;
  });
  if (phrases.length) out.push(`It has ${oxford(phrases)}.`);
  const by = (d) => norm.relations.filter((r) => r.decorator === d).map((r) => r.target);
  for (const t of by("ManyToOne")) out.push(`It belongs to ${a(t)}.`);
  for (const t of by("OneToOne")) out.push(`It has one ${t}.`);
  const many = by("OneToMany"); if (many.length) out.push(`It has many ${oxford(many)}.`);
  const m2m = by("ManyToMany"); if (m2m.length) out.push(`It relates to many ${oxford(m2m)}.`);
  return out.join(" ");
}

/* -------------------------------------------------- normalized slot projection */
function targetFromArgs(args) { const m = String(args || "").match(/=>\s*([A-Za-z_$][\w$]*)/); return m ? m[1] : null; }
function normColumnsFromTile(segments) {
  return segments.filter((s) => s.kind === "column").map((s) => { const c = s.structured; return c.pk
    ? { prop: c.prop, pk: true, nullable: false, type: null, enum: null, name: null }
    : { prop: c.prop, pk: false, nullable: c.nullable === "true", type: c.type || null, enum: c.enum || null, name: c.name || snake(c.prop) }; });
}
function normRelationsFromTile(segments) {
  return segments.filter((s) => s.kind === "relation").map((s) => ({ decorator: s.structured.decorator, target: targetFromArgs(s.structured.args) }));
}
function normColumnsFromModel(m) {
  return m.members.filter((x) => x.role === "column").map((c) => c.pk
    ? { prop: c.prop, pk: true, nullable: false, type: null, enum: null, name: null }
    : { prop: c.prop, pk: false, nullable: !!c.nullable, type: c.colType || null, enum: c.enum || null, name: c.name || snake(c.prop) });
}
function normRelationsFromModel(m) {
  return m.members.filter((x) => x.role === "relation").map((r) => ({ decorator: r.decorator, target: r.target }));
}
function sortRel(rs) { return rs.slice().sort((x, y) => (x.decorator + x.target).localeCompare(y.decorator + y.target)); }
/** Compare two normalized slot sets. Columns compared in order; relations as a multiset. */
function slotsEqual(A, B) {
  const colDiff = [];
  if (A.columns.length !== B.columns.length) return { equal: false, why: `column count ${A.columns.length} vs ${B.columns.length}` };
  for (let i = 0; i < A.columns.length; i++) {
    if (JSON.stringify(A.columns[i]) !== JSON.stringify(B.columns[i])) colDiff.push({ prop: A.columns[i].prop, a: A.columns[i], b: B.columns[i] });
  }
  const ra = JSON.stringify(sortRel(A.relations)), rb = JSON.stringify(sortRel(B.relations));
  if (colDiff.length) return { equal: false, why: `column(s) differ: ${colDiff.map((d) => d.prop).join(", ")}`, colDiff };
  if (ra !== rb) return { equal: false, why: `relations differ` };
  return { equal: true };
}

module.exports = {
  parseEntityCNL, renderEntityCNL, parseColumnPhrase, splitSentences,
  normColumnsFromTile, normRelationsFromTile, normColumnsFromModel, normRelationsFromModel,
  slotsEqual, words, snake, camelFromWords, targetFromArgs, TYPE_TS,
};
