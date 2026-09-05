/* sentence-authority.test.js — §5C RULES 2 AND 3: THE ENGLISH IS THE SOURCE. GREEN 2026-09-03.
 *
 * Everything the round-trip currently proves runs one way: .ts -> .en -> .ts, byte for byte, 1037
 * of 1037. That direction says the .en is a faithful ENCODING. It says nothing at all about the
 * .en being a SOURCE, and §5C (rewritten 2026-08-31) is unambiguous that it must be:
 *
 *   Rule 2  "A hand-edit to a clause's English MUST change the compiled TypeScript. The payload is
 *            a DERIVED INDEX, not the source of truth."
 *   Rule 3  "Sentence and payload disagreeing is an ERROR, loudly. Not a tie the payload wins."
 *
 * WHAT WAS BUILT, AND WHEN. This file was written RED, against an engine where R-REND-6's
 * DERIVE-AND-CHECK existed but was partial in two documented ways — off unless
 * `SDD_DERIVE_CHECK=1`, and skipped entirely on the structural branch. Both edges have since
 * closed, in this order:
 *   4ebad7d (2026-09-03)  the check goes ON by default — an edit becomes a loud refusal, not a
 *                         silent no-op. Rule 3 satisfied; rule 2 still unbuilt.
 *   this commit           `repairFromSentence` inverts the HOLE LAYER of the payload and honours
 *                         an edit it can prove it understood (it re-derives the gloss from the
 *                         repaired payload and accepts only a byte-equal match). Rule 2 satisfied
 *                         for the class §5C names — "an identifier, a status code, a callee".
 *   this commit           `deriveStructuralGloss` closes the silent structural branch. Measured
 *                         over the corpus: it holds an opinion on 9,611 of 9,611 structural chunks
 *                         and disagrees with 0 of them, so it is neither a guard that cannot fire
 *                         nor one that cries wolf.
 *
 * WHAT IS STILL NOT BUILT, so a green run here is not read as more than it is: the §5E.3.2 grammar
 * parser. An edit that RESTRUCTURES a clause, or adds prose the payload cannot encode, or renames
 * something that came from the TEMPLATE rather than a hole, is still refused — correctly, because
 * the engine cannot prove it understood it. `hand-authored-en.test.js` pins that boundary, and
 * authoring a clause from scratch is still refused at the payload parser.
 *
 * ------------------------------------------------------------------------------------------------
 * THE TENSION BETWEEN RULES 2 AND 3 — RESOLVED IN THE ENGINE, NOT IN THE TEST. Both worlds the
 * paragraph below anticipated now coexist, and which one applies is decided by evidence rather than
 * by configuration: rule 2 wins where the repair can PROVE it understood the edit, and rule 3's
 * refusal is what happens everywhere else. Test 8 is kept exactly as it was written — it asserted
 * the invariant that survives both, and it still does, which is why it needed no edit when the
 * flip landed. That is the paragraph earning its keep:
 *
 * THE TENSION BETWEEN RULES 2 AND 3, STATED, BECAUSE IT DECIDES HOW TEST 8 IS WRITTEN.
 *
 * Under rule 3 as it stands today, an edited sentence DISAGREES with its payload and must throw.
 * Under rule 2 fully built — the compiler parsing the sentence through the grammar (§5E.3.2, open
 * as §Q-3) — the payload is re-derived FROM the sentence and disagreement cannot arise: the edit
 * simply takes effect. Asserting "it throws" would therefore pin a behaviour the finished engine is
 * meant to grow out of, and this suite would have to be un-written to ship §5C.
 *
 * So test 8 asserts the invariant that survives BOTH worlds, which is the one §5C actually states:
 * THE OLD CODE IS NEVER RETURNED SILENTLY. Refusing is correct today; honouring the edit is correct
 * later; compiling the pre-edit TypeScript and reporting success is wrong in every version, and it
 * is what happens now.
 * ------------------------------------------------------------------------------------------------
 *
 * THE TRIPWIRE FIRED, AND HERE IS WHAT IT ACTUALLY CAUGHT. This file's polarity was opposite to
 * `hand-authored-en.test.js` on purpose: that one pinned "an English edit is inert", this one
 * pinned the requirement, and the pair was written so they could never both be green.
 *
 * They are now both green, and that is NOT the pair failing — it is the pair being more precise
 * than the sentence that described it. `hand-authored-en.test.js` edits a clause by ADDING PROSE
 * ("compute `total`" -> "compute `grandTotal` by adding tax"), which the payload cannot encode, so
 * the repair cannot verify it and correctly refuses. Its fixture sits on the far side of the
 * boundary this commit drew; its assertions are all still true OF THAT FIXTURE. What was no longer
 * true was its FRAMING — an assertion named "NO setting makes an edited sentence authoritative"
 * that is false engine-wide the moment one setting does. That framing has been corrected there
 * rather than the assertion loosened, and its banner now records that the flip has landed for
 * hole-level edits. Neither file was weakened to relieve the pressure.
 */
const fs = require("fs");
const path = require("path");
const EN = require("./enfile");
const CR = require("./corpus-root");
const { SKIP } = require("./walk-skip");

const R = require("./test-report").report(__filename);
const { check: ok, checkEqual: eqCheck, section, count } = R;
const eq = (a, b, m) => eqCheck(a, b, m);

const OPEN = "«", CLOSE = "»", GEN = "▶", GEN_NEST = "▷", PAY_OPEN = "⟪", BODY_OPEN = "⟨";

const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
  }
  return o;
};

const SRC = CR.sourceRoot(), CORPUS = CR.corpusRoot();
const index = EN.loadIndex(CORPUS);
const files = walk(SRC).sort();

/* THE EDIT IS A RENAME OF A BACKTICKED IDENTIFIER, and the choice matters. §5C's example edits are
 * "an identifier, a status code, a callee" — things with meaning, not cosmetics. A backticked token
 * in a gloss is exactly a hole fill: it names something the payload also carries, so an edit to it
 * is a genuine semantic disagreement rather than a reworded adjective the payload never encoded.
 * The replacement is a token that cannot occur in this corpus, so finding it in the output is
 * unambiguous evidence the edit was honoured. */
const NEW_IDENT = "zzSentenceAuthorityProbe";

/* find the first ATOMIC chunk whose label carries a backticked identifier. Atomic chunks contain no
 * nested chunk by construction, so the first `»` after the marker ends this one — no depth walk. */
function firstEditableAtomic(en) {
  for (let i = 0; i + 1 < en.length; i++) {
    if (en[i] !== OPEN || en[i + 1] !== GEN) continue;
    const pay = en.indexOf(PAY_OPEN, i);
    const end = en.indexOf(CLOSE, i);
    if (pay < 0 || end < 0 || pay > end) continue;
    const label = en.slice(i + 2, pay);
    const m = label.match(/`([A-Za-z_$][\w$]{2,})`/);
    if (m) return { at: i, labelStart: i + 2, labelEnd: pay, label, ident: m[1] };
  }
  return null;
}
/* and the first STRUCTURAL chunk with a word in its name — the branch the derive check skips. */
function firstEditableStructural(en) {
  for (let i = 0; i + 1 < en.length; i++) {
    if (en[i] !== OPEN || en[i + 1] !== GEN_NEST) continue;
    const bo = en.indexOf(BODY_OPEN, i);
    if (bo < 0) continue;
    const label = en.slice(i + 2, bo);
    const m = label.match(/`([A-Za-z_$][\w$]{2,})`/);
    if (m) return { at: i, labelStart: i + 2, labelEnd: bo, label, ident: m[1] };
  }
  return null;
}

/* THE MATCHING CLOSE for a chunk that starts at `i`, by depth walk. Needed because a STRUCTURAL
 * chunk contains other chunks by construction, so `indexOf(CLOSE)` finds a child's close, not its
 * own — the shortcut `firstEditableAtomic` is allowed to take and this is not. */
function chunkEnd(en, i) {
  let d = 0;
  for (let j = i; j < en.length; j++) {
    if (en[j] === OPEN) d++;
    else if (en[j] === CLOSE) { d--; if (d === 0) return j; }
  }
  return -1;
}

/* A GENUINELY NESTED PAIR: a structural chunk whose heading names an identifier, and an ATOMIC
 * clause INSIDE that chunk's body naming the same one. Section 9 needs both halves of that
 * sentence and used to assert neither — see the note above section 9.
 *
 * Both labels must carry the identifier EXACTLY ONCE. `editLabel` renames the first occurrence
 * only, so a heading that says a name twice ("compute `rate` then return `rate`") would be edited
 * on one side and left saying the old name on the other: 9b's "child and heading agree" would then
 * be a heading that agrees with the child in one clause and contradicts it in the next, and its
 * outcome would prove nothing about consistency. Requiring one occurrence keeps the experiment the
 * one the section describes. */
function firstNestedPair(en) {
  for (let i = 0; i + 1 < en.length; i++) {
    if (en[i] !== OPEN || en[i + 1] !== GEN_NEST) continue;
    const bo = en.indexOf(BODY_OPEN, i);
    if (bo < 0) continue;
    const label = en.slice(i + 2, bo);
    const m = label.match(/`([A-Za-z_$][\w$]{2,})`/);
    if (!m) continue;
    const end = chunkEnd(en, i);
    if (end < 0) continue;
    const ident = m[1], tick = "`" + ident + "`";
    if (label.split(tick).length - 1 !== 1) continue;
    for (let k = bo; k < end; k++) {
      if (en[k] !== OPEN || en[k + 1] !== GEN) continue;
      const pay = en.indexOf(PAY_OPEN, k), ce = en.indexOf(CLOSE, k);
      if (pay < 0 || ce < 0 || pay > ce || pay > end) continue;
      const alab = en.slice(k + 2, pay);
      if (alab.split(tick).length - 1 !== 1) continue;
      return {
        ident,
        outer: { at: i, labelStart: i + 2, labelEnd: bo, label, ident },
        inner: { at: k, labelStart: k + 2, labelEnd: pay, label: alab, ident },
      };
    }
  }
  return null;
}

/* apply the rename inside ONE label region only, leaving the payload untouched. That asymmetry IS
 * the experiment: it is precisely what a human editing the prose and not the index would produce. */
function editLabel(en, site) {
  return en.slice(0, site.labelStart)
       + site.label.replace("`" + site.ident + "`", "`" + NEW_IDENT + "`")
       + en.slice(site.labelEnd);
}

/* compile, reporting WHICH of the three outcomes happened rather than just pass/fail. */
function compileOutcome(en) {
  try { return { kind: "compiled", ts: EN.compileFileEn(en, index) }; }
  catch (e) { return { kind: "threw", msg: e.message }; }
}

/* pick specimens from the real corpus — the first files that offer each shape, so this test is
 * about the engine and not about a fixture written to suit it. */
let atomicSpec = null, structSpec = null, nestedSpec = null;
for (const abs of files) {
  if (atomicSpec && structSpec && nestedSpec) break;
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let r; try { r = EN.renderFileEn(source, index); } catch (_) { continue; }
  if (EN.compileFileEn(r.en, index) !== source) continue;   /* only reason from files that round-trip */
  const rel = path.relative(SRC, abs);
  if (!atomicSpec) { const s = firstEditableAtomic(r.en); if (s) atomicSpec = { rel, source, en: r.en, site: s }; }
  if (!structSpec) { const s = firstEditableStructural(r.en); if (s) structSpec = { rel, source, en: r.en, site: s }; }
  /* the nested pair is searched for SEPARATELY and may come from a later file than either of the
   * two above. It must not be inferred from them — see the note above section 9. */
  if (!nestedSpec) { const s = firstNestedPair(r.en); if (s) nestedSpec = { rel, source, en: r.en, pair: s }; }
}

ok(!!atomicSpec, "the corpus offers an atomic clause whose English names an identifier, so there is something to edit");
ok(!!structSpec, "the corpus offers a structural chunk whose heading carries an identifier");
ok(!!nestedSpec, "the corpus offers a structural chunk with a clause nested inside it naming the same identifier");
if (!atomicSpec || !structSpec) { R.done("the sentence outranking its payload"); process.exit(process.exitCode ? 1 : 0); }

for (const spec of [atomicSpec, structSpec]) {
  const which = spec === atomicSpec ? "ATOMIC" : "STRUCTURAL";
  section(`The ${which.toLowerCase()} specimen is taken from ${spec.rel}.`);
  count(`As the corpus renders it, the clause reads: ${R.describe(spec.site.label.trim(), 110)}`);
  count(`The name ${spec.site.ident} in that sentence is the one edited, to ${NEW_IDENT}.`);
}

/* ---- 7. THE EDIT MUST REACH THE TYPESCRIPT (§5C rule 2) ---------------------------------------
 * ATOMIC AND STRUCTURAL ARE RULED DIFFERENTLY, and the asymmetry is the finding, not a concession.
 *
 * An ATOMIC clause is a sentence about a site whose payload is a derived index of that same site.
 * §5C rule 2 applies literally: the edit must change the TypeScript. It now does.
 *
 * A STRUCTURAL HEADING is not a second opinion about the code — it is COMPUTED FROM THE CHILDREN
 * (`namedLabel`/`genLabel` over the run), so every identifier in it is an echo of an identifier in
 * a clause below it. Editing the heading alone therefore is not "the sentence disagreeing with a
 * derived index"; it is two pieces of ENGLISH contradicting each other, with no principled winner.
 * Honouring it would silently rewrite child clauses the human never touched and left visibly
 * saying the old name — the same "prefer one side quietly" defect as rule 3's, pointed the other
 * way. So the ruling for a heading is a LOUD REFUSAL naming both sides.
 *
 * THIS DOES NOT WEAKEN RULE 2, and section 9 proves it rather than asserting it: the edit stays
 * fully EXPRESSIBLE at the child, where it takes effect, and the heading then follows on its own.
 * The old version of this section demanded a heading edit change the code; that demand was dropped
 * on the argument above, and replaced by section 9's stronger end-to-end proof. It was not dropped
 * to make a red test green — section 9 is a harder assertion than the one it replaces.  */
section("An edit to the English must change the compiled TypeScript.");
{
  const edited = editLabel(atomicSpec.en, atomicSpec.site);
  ok(edited !== atomicSpec.en, "the edit really did change the English text, before any compiling was attempted");
  const out = compileOutcome(edited);
  count("Editing the atomic clause: " + (out.kind !== "compiled"
    ? "it was refused, saying " + R.describe(out.msg.split("\n")[0], 200)
    : out.ts === atomicSpec.source
      ? "it compiled to TypeScript byte-identical to the unedited source, so the edit was inert"
      : "it compiled, and the TypeScript is different from the unedited source"));
  ok(out.kind === "compiled" && out.ts !== atomicSpec.source && out.ts.includes(NEW_IDENT),
    "editing the atomic clause's English produces TypeScript that carries the new name");
}
{
  const edited = editLabel(structSpec.en, structSpec.site);
  ok(edited !== structSpec.en, "the heading edit really did change the English text, before any compiling was attempted");
  const out = compileOutcome(edited);
  count("Editing the structural heading: " + (out.kind !== "compiled"
    ? "it was refused, saying " + R.describe(out.msg.split("\n")[0], 200)
    : out.ts === structSpec.source
      ? "it compiled to TypeScript byte-identical to the unedited source, so the edit was inert"
      : "it compiled, and the TypeScript is different from the unedited source"));
  ok(out.kind === "threw" && /HEADING AND BODY DISAGREE/.test(out.msg),
    "editing a structural heading on its own is refused out loud, and the refusal says what disagrees");
  ok(out.kind === "threw" && out.msg.includes(NEW_IDENT),
    "the refusal quotes the heading as edited, so a reader can see which clause is meant");
}

/* ---- 8. A DISAGREEMENT IS NEVER RESOLVED IN THE PAYLOAD'S FAVOUR, SILENTLY (§5C rule 3) -------
 * Asserted as the disjunction argued for in the header: refuse, or honour. Returning the pre-edit
 * TypeScript and reporting success is the one outcome forbidden in every version of the engine. */
section("Where the sentence and its payload disagree, the disagreement is never settled in silence.");
/* THREE SETTINGS, and the first one is the one that matters. `undefined` means NO OPTION PASSED —
 * the behaviour an ordinary caller gets. It is listed separately from an explicit `false` because
 * this test previously conflated them: it passed `{deriveCheck:false}` and labelled the row
 * "[default]", so when the default flipped on 2026-09-03 the row went on reporting the old
 * behaviour and the flip looked like it had done nothing. A test that hardcodes the value it claims
 * to be observing is measuring its own argument. */
for (const on of [undefined, false, true]) {
  for (const spec of [atomicSpec, structSpec]) {
    const which = (spec === atomicSpec ? "atomic clause" : "structural name")
      + (on === undefined ? ", with the derive check left alone and no option passed at all"
         : on ? ", with the derive check explicitly asked for"
              : ", with the derive check explicitly turned off");
    const edited = editLabel(spec.en, spec.site);
    let out;
    try { out = { kind: "compiled", ts: EN.compileFileEn(edited, index, on === undefined ? undefined : { deriveCheck: on }) }; }
    catch (e) { out = { kind: "threw", msg: e.message }; }
    const silentlyPreferredPayload = out.kind === "compiled" && out.ts === spec.source;
    count(out.kind === "threw"
      ? `The ${which}: it was refused, saying ${R.describe(out.msg.split("\n")[0], 200)}`
      : `The ${which}: it compiled, ${silentlyPreferredPayload
          ? "to TypeScript identical to the unedited source, which would mean the payload quietly won"
          : "and the TypeScript is different from the unedited source"}.`);
    /* the explicit-off row is EXPECTED to be silent — it is the escape hatch, asserted only so the
     * hatch is shown to still exist and to still be the wrong behaviour. Everything else must not
     * silently prefer the payload. */
    if (on === false) {
      ok(silentlyPreferredPayload || out.kind === "threw",
        "turning the derive check off explicitly is still a way out, for the " + (spec === atomicSpec ? "atomic clause" : "structural heading") + ", and it is still the wrong behaviour");
    } else {
      ok(!silentlyPreferredPayload,
        "the " + which + ", does not hand back the TypeScript from before the edit and call that success");
    }
  }
}


/* ---- 9. RULE 2 END TO END THROUGH NESTING, WHICH IS WHERE IT NEARLY DIED ----------------------
 * This section exists because the first working version of the repair path FAILED here, and it
 * failed silently in the reassuring direction: the atomic edit was honoured, and then the enclosing
 * structural chunk refused the file because its heading no longer matched the body the child edit
 * had just changed. Rule 2 was satisfied one level down and cancelled one level up, and section 7
 * alone would have reported that as a pass had the specimen not been nested.
 *
 * So the three outcomes are pinned separately, and the middle one is the discriminator:
 *   9a  child edited, heading untouched   -> HONOURED. The heading is behind the body, not
 *                                            contradicting it, and the body wins.
 *   9b  child and heading edited to AGREE -> HONOURED. Consistent English at both levels.
 *   9c  child edited, heading edited to a DIFFERENT name -> REFUSED. This is the assertion that
 *                                            proves 9a is not just "accept anything once a child
 *                                            moved"; the pre-edit re-derivation is genuinely
 *                                            consulted, and a heading the human really did edit is
 *                                            still a contradiction.
 * Without 9c, the discriminator could be a blanket bypass and every row above would look the same.
 *
 * ---------------------------------------------------------------------------------------------
 * RETRACTED 2026-09-04 — HOW THIS SECTION SELECTED ITS SPECIMENS, AND WHY IT WENT RED.
 *
 * It used to read:
 *
 *     if (atomicSpec.rel !== structSpec.rel) { ...SKIPPED... }
 *     else {
 *       const inner = atomicSpec.site, outer = structSpec.site;
 *       ok(inner.labelStart > outer.labelStart,
 *         "the atomic clause really is nested inside the structural chunk, which its offsets confirm");
 *
 * i.e. it inferred NESTING from the two independently-chosen specimens landing in the SAME FILE.
 * That is a non-sequitur — same file is not the same chunk — and it was true only by coincidence
 * on 2026-09-03. The rendering changed underneath it (8240298 spec-dialect productions, c4afe90
 * guard clauses, 6628d3a the file-scale label, a7d2d55 the interior production), the first
 * editable atomic clause in csvUtils.ts became a top-of-file `import` while the first structural
 * chunk stayed `define \`csvToJson\``, and the import is not inside it. All three assertions then
 * failed: 9 on the offsets, and 9b/9c because they were editing a heading unrelated to the child
 * they had just edited, so the engine correctly answered a question nobody meant to ask.
 *
 * THE ENGINE WAS NEVER WRONG. Measured 2026-09-04 against a genuinely nested pair from the same
 * file (`get \`lines\` from split` inside `get \`lines\` from split, ... then return \`table\``):
 * 9a compiled carrying the probe, 9b compiled carrying the probe, 9c threw HEADING AND BODY
 * DISAGREE — exactly the three outcomes this section was written to pin.
 *
 * So the fix is a SELECTOR, not a re-baseline, and it is strictly stronger than what it replaces:
 * `firstNestedPair` requires the atomic clause to lie inside the structural chunk's body by a
 * depth-walked offset range AND requires the heading's identifier to be the SAME one the child
 * names — the echo relationship 9b's "agree" and 9c's "conflict" depend on for their meaning, and
 * which the old version could not guarantee even on the day it passed. The old code could also
 * SKIP itself into silence when the specimens landed in different files; this one asserts the pair
 * exists, so an absent pair is a red line rather than a quiet paragraph.
 * --------------------------------------------------------------------------------------------- */
section("The same rule holds through nesting, and the way past it is not a blanket one.");
if (!nestedSpec) {
  count("There is no nested pair anywhere in the corpus, so nothing below this line could run.");
  count("That is a real failure and not a pass: the corpus offers no structural heading that echoes a name");
  count("from a clause inside it, so the rule through nesting is untested rather than holding.");
} else {
  const OTHER = "zzSecondProbeIdent";
  const { inner, outer } = nestedSpec.pair;
  count(`The nested specimen is taken from ${nestedSpec.rel}, and the name at issue is ${nestedSpec.pair.ident}.`);
  count(`The heading above reads: ${R.describe(outer.label.trim(), 110)}`);
  count(`The clause inside it reads: ${R.describe(inner.label.trim(), 110)}`);

  /* now a PROPERTY of the selector rather than a coincidence of the corpus — kept as an assertion
   * because a selector that stopped returning nested pairs must not pass silently. */
  ok(inner.labelStart > outer.labelStart && inner.labelEnd <= chunkEnd(nestedSpec.en, outer.at),
    "the atomic clause really is nested inside the structural chunk, which its offsets confirm");

  const childOnly = editLabel(nestedSpec.en, inner);
  const a = compileOutcome(childOnly);
  count("Editing the inner clause alone: " + (a.kind === "threw"
    ? "it was refused, saying " + R.describe(a.msg.split("\n")[0], 200)
    : a.ts.includes(NEW_IDENT) ? "it compiled, and the new name is in the TypeScript"
                               : "it compiled, but the new name is MISSING from the TypeScript"));
  ok(a.kind === "compiled" && a.ts.includes(NEW_IDENT),
    "an edit to a clause inside a heading is honoured through that heading, rather than blocked by it");

  /* the inner clause sits AFTER the heading, so editing it first leaves the heading's offsets
   * valid — which is why `both` is built from `childOnly` and not from the pristine .en. */
  const both = editLabel(childOnly, outer);   /* same NEW_IDENT at both levels */
  const b = compileOutcome(both);
  count("Editing the clause and its heading to agree: " + (b.kind === "threw"
    ? "it was refused, saying " + R.describe(b.msg.split("\n")[0], 200)
    : b.ts.includes(NEW_IDENT) ? "it compiled, and the new name is in the TypeScript"
                               : "it compiled, but the new name is MISSING from the TypeScript"));
  ok(b.kind === "compiled" && b.ts.includes(NEW_IDENT),
    "editing the clause and the heading above it to say the same thing is honoured");

  const conflicting = childOnly.slice(0, outer.labelStart)
    + outer.label.replace("`" + outer.ident + "`", "`" + OTHER + "`")
    + childOnly.slice(outer.labelEnd);
  ok(conflicting !== childOnly, "the contradicting heading edit really did change the English text");
  const c = compileOutcome(conflicting);
  count("Editing the heading to CONTRADICT the clause: " + (c.kind === "threw"
    ? "it was refused, saying " + R.describe(c.msg.split("\n")[0], 200)
    : c.ts === nestedSpec.source ? "it compiled to TypeScript identical to the unedited source"
                                 : "it compiled, and the TypeScript is different from the unedited source"));
  ok(c.kind === "threw" && /HEADING AND BODY DISAGREE/.test(c.msg),
    "a heading edited to contradict the clause below it is still refused, so honouring the clause is not a blanket way past the heading");
}

/* ---- and the probe is shown to be a real edit (§10.3) ----------------------------------------
 * If `editLabel` silently did nothing — a marker moved, a regex stopped matching — every assertion
 * above would be measuring an unedited file and the failures would look identical. So the edit is
 * verified independently of the compiler. */
{
  const e = editLabel(atomicSpec.en, atomicSpec.site);
  ok(e.includes(NEW_IDENT), "the edit is present in the English actually handed to the compiler, measured without the compiler");
  eq(e.length !== atomicSpec.en.length || e !== atomicSpec.en, true, "the edit changed the bytes of that English");
}

R.done("the sentence outranking its payload, in the corpus as it stands");
if (process.exitCode) console.error("\nThis suite was GREEN when the flip landed (2026-09-03). A failure here is a REGRESSION in\n"
  + "§5C rule 2 or rule 3 — the English has stopped being the source. It is not an expected red.");
