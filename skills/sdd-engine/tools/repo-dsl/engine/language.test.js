"use strict";
/* GUARD: `repo-dsl language --json` — the published vocabulary/grammar document.
 *
 * A cross-repo consumer (the Kraken SDD panel) renders its Syntax and Grammar tabs from this JSON.
 * There are therefore two ways to be wrong, and only one of them is loud:
 *
 *   (1) WRONG SHAPE — a missing block, a renamed key. The consumer breaks visibly. Section A.
 *   (2) WRONG CONTENT — a well-formed document that describes a grammar the engine no longer has.
 *       Nothing breaks. The panel keeps rendering, confidently, a language nobody speaks any more.
 *
 * (2) is the whole reason this file is long. It is the `catch { return null }` class in publishing
 * form, and it cannot be caught by asserting the document against a fixture — a fixture is just a
 * second hand-maintained copy of the grammar, and it goes stale in exactly the same way.
 *
 * So every assertion below compares the document to the LIVE tables (generators.js COMPOSITES /
 * LEAVES, dsl.js classify()/grammar()/LEXICAL, explain.js tierOf) rather than to any expected value
 * written here. Three layers, because each catches what the others cannot:
 *
 *   B. COMPLETENESS — nothing in the live tables is missing from the document, and every published
 *      fact equals the live one. Catches a producer that stops keeping up.
 *   C. NO HAND-AUTHORED VOCABULARY — language.js's own source contains no composite name and no
 *      leaf id as a literal. Catches the fix that "works" by pasting today's grammar into the
 *      producer, which would pass every assertion in B on the day it was written.
 *   D. IT ACTUALLY TRACKS CHANGE — a composite is injected into the live table, the document is
 *      rebuilt, and the new word must appear and move the fingerprint. B and C both pass against a
 *      snapshot taken at require-time; only D proves the derivation is live.
 *
 * No corpus prerequisite: the document is built against a tmpdir, so the absent-import-map branch
 * is exercised on purpose rather than skipped.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const L = require("../language");
const DSL = require("../dsl");
const AC = require("./artifact-contract");
const { tierOf } = require("../explain");
const { LEAVES, COMPOSITES } = require("../generators");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

/* A corpus dir that exists but holds no artifacts: the document must still build, and must SAY the
 * import map is absent rather than publishing an empty resolution that reads as "nothing resolves". */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-language-"));
const built = L.buildLanguage(TMP, { generated: "2026-09-01" });

/* ASSERT AGAINST THE WIRE FORM, not the in-memory object.
 *
 * Found by mutation-testing this file, 2026-09-01: replacing the regex publisher with the identity
 * function (`rx = (r) => r`, i.e. emit the RegExp itself) left every assertion GREEN, because a live
 * RegExp satisfies `typeof r.source === "string"` — while `JSON.stringify` turns it into `{}`. The
 * document a consumer receives was broken and the suite said 22 passed.
 *
 * A producer's contract is with the bytes it publishes, so the tests read the bytes. Anything that
 * does not survive serialization — a RegExp, a function, an `undefined`, a Map — is now caught by
 * whichever assertion covers that field, rather than by none of them. */
const doc = JSON.parse(JSON.stringify(built));

/* ======================================================================== A. SHAPE */

ok("A1: carries the full §8B header, sourced from the registry and not hand-typed", () => {
  const spec = AC.specOf("language");
  assert.strictEqual(doc.schema, spec.schema, "schema must come from the ARTIFACTS registry");
  assert.strictEqual(doc.artifactVersion, 1);
  assert.strictEqual(doc.corpus, TMP, "corpusPinned kinds record the dir they describe");
  assert.strictEqual(typeof doc.fingerprint, "string");
  assert.match(doc.fingerprint, /^[0-9a-f]{16}$/);
  assert.strictEqual(built.modelCalls, 0, "publishing a grammar is deterministic — it spends no model call");
});

ok("A2: every key the registry says consumers read is actually present", () => {
  for (const k of AC.specOf("language").requires) {
    assert.ok(k in doc, `registry declares consumers read "${k}", but the document has no such key`);
  }
});

ok("A3: re-reading it through the contract validates (so a consumer's load cannot fail)", () => {
  const dest = path.join(TMP, "language.json");
  fs.writeFileSync(dest, JSON.stringify(built, null, 2) + "\n");
  const back = AC.load("language", dest, { corpus: TMP });
  assert.strictEqual(back.fingerprint, built.fingerprint, "the seal must survive a JSON round-trip");
  /* The seal is taken over the body, so it also proves the body survived serialization intact —
   * which is the property the `wire` form above exists to test field by field. */
  assert.deepStrictEqual(back, doc, "the document changed shape on its way through JSON");
});

ok("A4: the top-level blocks exist with the right container types", () => {
  assert.ok(Array.isArray(doc.vocabulary.primitives));
  assert.ok(Array.isArray(doc.vocabulary.words));
  assert.ok(Array.isArray(doc.grammar.forms));
  assert.ok(Array.isArray(doc.grammar.keywords));
  assert.ok(Array.isArray(doc.grammar.markers));
  assert.strictEqual(typeof doc.grammar.markerIndex, "object");
  assert.strictEqual(typeof doc.grammar.lexical, "object");
  assert.strictEqual(typeof doc.resolution, "object");
  assert.strictEqual(typeof doc.counts, "object");
});

ok("A5: every record carries every declared field with the declared type", () => {
  for (const p of doc.vocabulary.primitives) {
    assert.strictEqual(typeof p.id, "string");
    assert.ok(p.patternId === null || typeof p.patternId === "string");
    assert.ok(p.label === null || typeof p.label === "string");
    assert.strictEqual(typeof p.tier, "string");
    assert.strictEqual(typeof p.structural, "boolean");
    assert.strictEqual(typeof p.trivia, "boolean");
    assert.strictEqual(typeof p.params, "object");
    assert.ok(Array.isArray(p.paramOrder));
    assert.strictEqual(p.arity, p.paramOrder.length);
  }
  for (const w of doc.vocabulary.words) {
    assert.strictEqual(typeof w.name, "string");
    assert.strictEqual(typeof w.tier, "string");
    assert.strictEqual(typeof w.surface, "boolean");
    assert.strictEqual(typeof w.derived, "object");
    assert.ok(Array.isArray(w.derivedParams));
    assert.strictEqual(w.arity, w.paramOrder.length);
    assert.strictEqual(typeof w.emits.readable, "boolean");
    assert.ok(Array.isArray(w.emits.leaves) && Array.isArray(w.emits.composites));
  }
  for (const f of doc.grammar.forms) {
    assert.strictEqual(typeof f.composite, "string");
    assert.strictEqual(typeof f.keyword, "string");
    assert.ok(Array.isArray(f.types) && Array.isArray(f.markers) && Array.isArray(f.roles));
    assert.ok(Array.isArray(f.lines) && f.lines.length >= 1);
    assert.strictEqual(f.lines[0].position, "header", "the header line is always first — the parser keys on position");
  }
});

ok("A6: a regex is published as source+flags, not as a stringified object", () => {
  /* JSON.stringify(/x/) is "{}". Publishing the regex object directly would emit an empty object
   * that a consumer reads as "no rule", with nothing malformed to notice. */
  for (const k of ["identifier", "moduleSpecifier"]) {
    const r = doc.grammar.lexical[k];
    /* `doc` is the WIRE form: a RegExp that reached here unconverted is now `{}`, which is what a
     * consumer would actually receive. Asserting on the in-memory object cannot see this. */
    assert.strictEqual(typeof r.source, "string", `${k} must publish a rebuildable source string, not a RegExp that serializes to {}`);
    assert.strictEqual(typeof r.flags, "string");
    assert.ok(r.source.length > 0, `${k} published an empty pattern`);
    new RegExp(r.source, r.flags);                       // must be rebuildable by the consumer
  }
});

/* ============================================== B. COMPLETENESS AGAINST THE LIVE TABLES */

ok("B1: every leaf in the live LEAVES table is published, with its live signature", () => {
  const byId = new Map(doc.vocabulary.primitives.map((p) => [p.id, p]));
  for (const [id, def] of Object.entries(LEAVES)) {
    const p = byId.get(id);
    assert.ok(p, `leaf "${id}" exists in generators.js but is absent from the published vocabulary`);
    assert.deepStrictEqual(p.params, def.params || {}, `leaf "${id}" published a signature that is not its own`);
    assert.deepStrictEqual(p.paramOrder, Object.keys(def.params || {}), `leaf "${id}" published its params out of signature order`);
    assert.strictEqual(p.tier, tierOf(def, "leaf"), `leaf "${id}" published a tier the live rule does not give it`);
    assert.strictEqual(p.structural, !!def.structural);
    assert.strictEqual(p.trivia, !!def.trivia);
  }
  assert.strictEqual(doc.vocabulary.primitives.length, Object.keys(LEAVES).length, "published more or fewer leaves than exist");
});

ok("B2: every composite in the live COMPOSITES table is published, with its live signature", () => {
  const byName = new Map(doc.vocabulary.words.map((w) => [w.name, w]));
  for (const [name, def] of Object.entries(COMPOSITES)) {
    const w = byName.get(name);
    assert.ok(w, `composite "${name}" exists in generators.js but is absent from the published vocabulary`);
    assert.deepStrictEqual(w.params, def.params || {}, `word "${name}" published a signature that is not its own`);
    assert.deepStrictEqual(w.paramOrder, Object.keys(def.params || {}));
    assert.deepStrictEqual(w.derived, def.derived || {}, `word "${name}" published the wrong derived-import map`);
    assert.strictEqual(w.tier, tierOf(def, "composite"));
    assert.strictEqual(w.surface, !def.structural && !def.tier, `word "${name}" disagrees with grammar()'s own surface filter`);
  }
  assert.strictEqual(doc.vocabulary.words.length, Object.keys(COMPOSITES).length, "published more or fewer words than exist");
});

ok("B3: a word's `emits` is what its own build() actually produces", () => {
  /* Not re-derived here from a second walker — compared against language.js's own emitsOf run on
   * the live definition, which is the only thing that can be checked without writing a third copy
   * of the composition walk. What this pins is that the DOCUMENT carries that result unaltered. */
  for (const w of doc.vocabulary.words) {
    assert.deepStrictEqual(w.emits, L.emitsOf(w.name, COMPOSITES[w.name]), `word "${w.name}" published an emits block that is not its build()'s`);
    assert.strictEqual(w.emits.readable, true, `word "${w.name}" could not be walked: ${w.emits.why}`);
  }
});

ok("B4: every surface form equals what dsl.js classify() says right now", () => {
  const live = DSL.grammar();
  assert.strictEqual(doc.grammar.forms.length, live.length, "published a different number of surface forms than grammar() yields");
  for (const c of live) {
    const f = doc.grammar.forms.find((x) => x.composite === c.name);
    assert.ok(f, `composite "${c.name}" has a surface form but was not published`);
    assert.strictEqual(f.keyword, c.keyword, `"${c.name}" published keyword "${f.keyword}" but classify() says "${c.keyword}"`);
    assert.deepStrictEqual(f.roles.map((r) => r.param), c.roles.map((r) => r.name), `"${c.name}" published its roles out of signature order`);
    assert.deepStrictEqual(f.roles.map((r) => r.kind), c.roles.map((r) => r.kind), `"${c.name}" published role kinds classify() does not give it`);
    for (const r of c.roles) {
      const pub = f.roles.find((x) => x.param === r.name);
      assert.strictEqual(pub.marker, r.marker === undefined ? null : r.marker, `"${c.name}".${r.name} published the wrong marker`);
      assert.strictEqual(pub.droppedPrefix, r.prefix === undefined ? null : r.prefix, `"${c.name}".${r.name} published the wrong dropped const prefix`);
      assert.strictEqual(pub.importParam, r.importParam === undefined ? null : r.importParam);
    }
    assert.deepStrictEqual(f.derived, c.derived);
  }
});

ok("B5: a published keyword actually parses — grammarByKeyword resolves every one", () => {
  /* The strongest completeness check available without writing a program in the language: the
   * parser's own keyword lookup must accept every keyword the grammar advertises. A published
   * keyword the parser rejects is a document promising syntax that cannot be written. */
  for (const kw of doc.grammar.keywords) {
    const g = DSL.grammarByKeyword(kw);                  // throws on an unknown keyword
    assert.ok(g, `published keyword "${kw}" but the parser has no surface form for it`);
  }
  assert.strictEqual(doc.grammar.keywords.length, new Set(doc.grammar.keywords).size, "duplicate keyword published");
});

ok("B6: the lexical rules are dsl.js's own, not a second copy", () => {
  const LX = DSL.LEXICAL;
  assert.strictEqual(doc.grammar.lexical.identifier.source, LX.identifier.source, "the published identifier rule is not the parser's");
  assert.strictEqual(doc.grammar.lexical.identifier.flags, LX.identifier.flags);
  assert.strictEqual(doc.grammar.lexical.moduleSpecifier.source, LX.moduleSpecifier.source, "the published module-specifier rule is not the parser's");
  assert.strictEqual(doc.grammar.lexical.comment, LX.comment);
  assert.strictEqual(doc.grammar.lexical.typeSeparator, LX.typeSeparator);
  assert.strictEqual(doc.grammar.lexical.importKeyword, LX.importKeyword);
});

ok("B7: the marker index is consistent with the forms it indexes", () => {
  for (const [marker, keywords] of Object.entries(doc.grammar.markerIndex)) {
    for (const kw of keywords) {
      const f = doc.grammar.forms.find((x) => x.keyword === kw);
      assert.ok(f, `markerIndex points "${marker}" at unknown keyword "${kw}"`);
      assert.ok(f.markers.some((m) => m.marker === marker), `markerIndex claims "${kw}" accepts "${marker}", but its form does not list it`);
    }
  }
  for (const f of doc.grammar.forms) {
    for (const m of f.markers) {
      assert.ok((doc.grammar.markerIndex[m.marker] || []).includes(f.keyword), `form "${f.keyword}" accepts marker "${m.marker}" but the index omits it`);
    }
  }
  assert.deepStrictEqual(doc.grammar.markers, Object.keys(doc.grammar.markerIndex).sort());
});

ok("B8: forms and vocabulary describe the same words (no form for an unpublished word)", () => {
  const names = new Set(doc.vocabulary.words.map((w) => w.name));
  for (const f of doc.grammar.forms) {
    assert.ok(names.has(f.composite), `form "${f.keyword}" names composite "${f.composite}", absent from the vocabulary`);
    const w = doc.vocabulary.words.find((x) => x.name === f.composite);
    assert.strictEqual(w.surface, true, `"${f.composite}" has a surface form but is published as non-surface`);
    for (const r of f.roles) assert.ok(r.param in w.params, `form "${f.keyword}" names param "${r.param}" that its word does not declare`);
  }
  for (const w of doc.vocabulary.words) {
    if (!w.surface) assert.ok(!doc.grammar.forms.some((f) => f.composite === w.name), `"${w.name}" is internal but a surface form was published for it`);
  }
});

ok("B9: every published count equals the collection it counts", () => {
  const c = doc.counts;
  assert.strictEqual(c.primitives, doc.vocabulary.primitives.length);
  assert.strictEqual(c.words, doc.vocabulary.words.length);
  assert.strictEqual(c.forms, doc.grammar.forms.length);
  assert.strictEqual(c.keywords, doc.grammar.keywords.length);
  assert.strictEqual(c.markers, doc.grammar.markers.length);
  assert.strictEqual(c.surfaceWords, doc.vocabulary.words.filter((w) => w.surface).length);
  assert.strictEqual(c.structuralPrimitives, doc.vocabulary.primitives.filter((p) => p.structural).length);
  assert.strictEqual(c.surfaceWords, c.forms, "every surface word gets exactly one form");
});

/* ================================================= C. NO HAND-AUTHORED VOCABULARY */

ok("C1: language.js hand-authors no composite name and no leaf id", () => {
  /* The fix that would defeat every assertion above: paste today's grammar into the producer as a
   * literal. It passes B on the day it is written and rots from then on. The only defence is to
   * assert the producer's SOURCE does not name any member of the vocabulary.
   *
   * Names come from the live tables, so this guard has nothing hand-written in it either.
   *
   * Deliberately NOT extended to markers: markers here include "by" and "via", which are ordinary
   * English words and would flag prose in comments. A guard that cries wolf gets ignored and then
   * removed (CLAUDE.md §3), so it checks only the two unambiguous identifier spaces. */
  const src = fs.readFileSync(path.join(__dirname, "..", "language.js"), "utf8");
  const offenders = [];
  for (const name of [...Object.keys(COMPOSITES), ...Object.keys(LEAVES)]) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(src)) offenders.push(name);
  }
  assert.deepStrictEqual(offenders, [],
    `language.js names ${offenders.join(", ")} literally. The document must be DERIVED from the live ` +
    `tables — a hand-written vocabulary passes every completeness check on the day it is written and ` +
    `is wrong from the next commit onward, silently.`);
});

ok("C2: the human view is rendered from the same document, not built a second time", () => {
  /* Two renderers reading two sources is how a panel and a terminal come to disagree about the
   * same grammar. renderHuman takes the document as its only input; this pins that by asserting
   * every published word and keyword appears in its output. */
  const text = L.renderHuman(doc);
  for (const w of doc.vocabulary.words) assert.ok(text.includes(w.name), `the human view omits word "${w.name}"`);
  for (const p of doc.vocabulary.primitives) assert.ok(text.includes(p.id), `the human view omits primitive "${p.id}"`);
  for (const kw of doc.grammar.keywords) assert.ok(text.includes(kw), `the human view omits keyword "${kw}"`);
  assert.ok(text.includes(doc.grammar.lexical.identifier.source), "the human view omits the identifier rule");
});

/* ==================================================== D. IT TRACKS THE LIVE GRAMMAR */

ok("D1: adding a composite changes the document — the derivation is live, not a snapshot", () => {
  /* B and C both pass against a producer that snapshotted the grammar at require-time. This is the
   * assertion that cannot: inject a word into the live table, rebuild, and require it to appear.
   *
   * The probe is named so it sorts last and could never collide with a real word, and it is removed
   * in a finally block so the table is exactly as found even if an assertion throws. */
  const PROBE = "zzzProbeOnlyNotARealWord";
  const before = L.buildLanguage(TMP, { generated: "2026-09-01" });
  COMPOSITES[PROBE] = {
    patternId: "p_probe", label: "injected by language.test.js",
    params: { exportName: "identifier", widgetType: "typeName", helperFn: "identifier" },
    build: () => [],
  };
  try {
    const after = L.buildLanguage(TMP, { generated: "2026-09-01" });
    const w = after.vocabulary.words.find((x) => x.name === PROBE);
    assert.ok(w, "a composite added to the live table did not reach the published vocabulary — the producer is not deriving, it is remembering");
    assert.strictEqual(after.counts.words, before.counts.words + 1);

    const f = after.grammar.forms.find((x) => x.composite === PROBE);
    assert.ok(f, "the new composite got no surface form, though it is neither structural nor mid-tier");
    assert.strictEqual(f.keyword, PROBE, "the keyword must come from keywordFor(), not from a table");
    assert.deepStrictEqual(f.types.map((r) => r.param), ["widgetType"], "a typeName param must classify as a type role");
    assert.deepStrictEqual(f.markers.map((r) => r.marker), ["via"], "a *Fn param must classify as the `via` delegate role");
    assert.notStrictEqual(after.fingerprint, before.fingerprint, "the grammar changed and the fingerprint did not — the seal is not over the content");
  } finally {
    delete COMPOSITES[PROBE];
  }

  const restored = L.buildLanguage(TMP, { generated: "2026-09-01" });
  assert.strictEqual(restored.fingerprint, before.fingerprint, "the probe leaked: the live table was not restored");
});

ok("D2: renaming a param moves the published signature and the fingerprint", () => {
  /* The subtler drift: not a new word, an altered one. A snapshotting producer survives D1 if it
   * merely re-lists names; this requires it to re-read the signature itself. */
  const victim = Object.keys(COMPOSITES).find((n) => !COMPOSITES[n].structural && !COMPOSITES[n].tier);
  const def = COMPOSITES[victim];
  const original = def.params;
  const before = L.buildLanguage(TMP, { generated: "2026-09-01" });
  def.params = Object.assign({}, original, { zzzProbeParam: "identifier" });
  try {
    const after = L.buildLanguage(TMP, { generated: "2026-09-01" });
    const w = after.vocabulary.words.find((x) => x.name === victim);
    assert.ok("zzzProbeParam" in w.params, "a param added to a live signature did not reach the published one");
    assert.strictEqual(w.arity, before.vocabulary.words.find((x) => x.name === victim).arity + 1);
    const f = after.grammar.forms.find((x) => x.composite === victim);
    assert.ok(f.roles.some((r) => r.param === "zzzProbeParam"), "the new param produced no surface role");
    assert.notStrictEqual(after.fingerprint, before.fingerprint);
  } finally {
    def.params = original;
  }
  assert.strictEqual(L.buildLanguage(TMP, { generated: "2026-09-01" }).fingerprint, before.fingerprint, "the probe leaked");
});

ok("D3: the fingerprint is stable when nothing changes (so a moved seal MEANS something)", () => {
  /* Without this, D1/D2 prove nothing: a fingerprint that moves on every call would "detect" every
   * change and also every non-change, which is not detection. `generated` is pinned because it is a
   * header key and deliberately outside the seal. */
  const a = L.buildLanguage(TMP, { generated: "2026-09-01" });
  const b = L.buildLanguage(TMP, { generated: "2026-09-01" });
  assert.strictEqual(a.fingerprint, b.fingerprint, "two builds of an unchanged grammar disagreed");
  assert.strictEqual(a.contentFingerprint, b.contentFingerprint);
});

/* ========================================================== E. THE CORPUS-DEPENDENT BLOCK */

ok("E1: an absent import map is STATED, never published as an empty resolution", () => {
  /* The document was built against an empty tmpdir. "0 symbols resolve" and "the map has not been
   * mined" are different facts and must not render identically — that collapse is exactly the bug
   * class dsl.js's own resolution() was fixed for. */
  assert.strictEqual(doc.resolution.present, false);
  assert.strictEqual(doc.resolution.symbols, null, "an unmined map must publish null, not 0 — 0 reads as `nothing in your corpus resolves`");
  assert.ok(doc.resolution.why && doc.resolution.why.length > 0, "absence must carry a reason");
  assert.ok(doc.resolution.fix && doc.resolution.fix.length > 0, "absence must name its own fix");
  assert.ok(doc.resolution.path.startsWith(TMP), "the resolution block must name the dir it looked in");
});

ok("E2: the document says which of its blocks depend on the corpus dir", () => {
  /* The grammar does not vary by corpus and the resolution does. A consumer that cannot tell which
   * is which will either cache the wrong half or re-fetch the half that never changes. */
  assert.deepStrictEqual(doc.corpusIndependent, ["vocabulary", "grammar"]);
  const other = JSON.parse(JSON.stringify(L.buildLanguage(fs.mkdtempSync(path.join(os.tmpdir(), "sdd-language-2-")), { generated: "2026-09-01" })));
  for (const block of doc.corpusIndependent) {
    assert.deepStrictEqual(other[block], doc[block], `"${block}" is published as corpus-independent but changed with the dir`);
  }
});

console.log(`\n${pass} assertions passed`);
