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

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

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
let atomicSpec = null, structSpec = null;
for (const abs of files) {
  if (atomicSpec && structSpec) break;
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let r; try { r = EN.renderFileEn(source, index); } catch (_) { continue; }
  if (EN.compileFileEn(r.en, index) !== source) continue;   /* only reason from files that round-trip */
  const rel = path.relative(SRC, abs);
  if (!atomicSpec) { const s = firstEditableAtomic(r.en); if (s) atomicSpec = { rel, source, en: r.en, site: s }; }
  if (!structSpec) { const s = firstEditableStructural(r.en); if (s) structSpec = { rel, source, en: r.en, site: s }; }
}

ok(!!atomicSpec, "found an atomic clause in the corpus whose English names an identifier");
ok(!!structSpec, "found a structural chunk in the corpus whose name carries an identifier");
if (!atomicSpec || !structSpec) { console.log("\n" + pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0); }

for (const spec of [atomicSpec, structSpec]) {
  const which = spec === atomicSpec ? "ATOMIC" : "STRUCTURAL";
  console.log("\n  " + which + " specimen: " + spec.rel);
  console.log("    clause as rendered : " + spec.site.label.trim().slice(0, 110));
  console.log("    identifier edited  : `" + spec.site.ident + "`  ->  `" + NEW_IDENT + "`");
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
console.log("\n  --- 7. an English edit changes the compiled TypeScript ---");
{
  const edited = editLabel(atomicSpec.en, atomicSpec.site);
  ok(edited !== atomicSpec.en, "7. the atomic clause edit actually changed the .en text");
  const out = compileOutcome(edited);
  console.log("    atomic clause -> " + out.kind + (out.kind === "compiled" ? (out.ts === atomicSpec.source ? " (BYTE-IDENTICAL TO THE UNEDITED SOURCE — the edit was inert)" : " (output differs)") : " : " + out.msg.split("\n")[0]));
  ok(out.kind === "compiled" && out.ts !== atomicSpec.source && out.ts.includes(NEW_IDENT),
    "7. editing the atomic clause's English produces TypeScript carrying `" + NEW_IDENT + "`");
}
{
  const edited = editLabel(structSpec.en, structSpec.site);
  ok(edited !== structSpec.en, "7. the structural name edit actually changed the .en text");
  const out = compileOutcome(edited);
  console.log("    structural name -> " + out.kind + (out.kind === "compiled" ? (out.ts === structSpec.source ? " (BYTE-IDENTICAL TO THE UNEDITED SOURCE — the edit was inert)" : " (output differs)") : " : " + out.msg.split("\n")[0]));
  ok(out.kind === "threw" && /HEADING AND BODY DISAGREE/.test(out.msg),
    "7. editing a structural heading ALONE is refused loudly, naming the disagreement");
  ok(out.kind === "threw" && out.msg.includes(NEW_IDENT),
    "7. the refusal quotes the edited heading, so the human can see which clause it means");
}

/* ---- 8. A DISAGREEMENT IS NEVER RESOLVED IN THE PAYLOAD'S FAVOUR, SILENTLY (§5C rule 3) -------
 * Asserted as the disjunction argued for in the header: refuse, or honour. Returning the pre-edit
 * TypeScript and reporting success is the one outcome forbidden in every version of the engine. */
console.log("\n  --- 8. sentence/payload disagreement is never silently resolved ---");
/* THREE SETTINGS, and the first one is the one that matters. `undefined` means NO OPTION PASSED —
 * the behaviour an ordinary caller gets. It is listed separately from an explicit `false` because
 * this test previously conflated them: it passed `{deriveCheck:false}` and labelled the row
 * "[default]", so when the default flipped on 2026-09-03 the row went on reporting the old
 * behaviour and the flip looked like it had done nothing. A test that hardcodes the value it claims
 * to be observing is measuring its own argument. */
for (const on of [undefined, false, true]) {
  for (const spec of [atomicSpec, structSpec]) {
    const which = (spec === atomicSpec ? "atomic clause" : "structural name")
      + (on === undefined ? " [default — no option passed]" : on ? " [deriveCheck:true]" : " [deriveCheck:false]");
    const edited = editLabel(spec.en, spec.site);
    let out;
    try { out = { kind: "compiled", ts: EN.compileFileEn(edited, index, on === undefined ? undefined : { deriveCheck: on }) }; }
    catch (e) { out = { kind: "threw", msg: e.message }; }
    const silentlyPreferredPayload = out.kind === "compiled" && out.ts === spec.source;
    if (out.kind === "threw") console.log("    " + which + " -> REFUSED: " + out.msg.split("\n")[0]);
    else console.log("    " + which + " -> compiled" + (silentlyPreferredPayload ? ", IDENTICAL TO THE UNEDITED SOURCE" : ", output differs"));
    /* the explicit-off row is EXPECTED to be silent — it is the escape hatch, asserted only so the
     * hatch is shown to still exist and to still be the wrong behaviour. Everything else must not
     * silently prefer the payload. */
    if (on === false) {
      ok(silentlyPreferredPayload || out.kind === "threw",
        "8. deriveCheck:false is still an available escape hatch for the " + (spec === atomicSpec ? "atomic" : "structural") + " case");
    } else {
      ok(!silentlyPreferredPayload,
        "8. the " + which + " does not compile the pre-edit TypeScript and report success");
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
 * Without 9c, the discriminator could be a blanket bypass and every row above would look the same. */
console.log("\n  --- 9. rule 2 survives nesting, and the bypass is not a blanket one ---");
if (atomicSpec.rel !== structSpec.rel) {
  console.log("    SKIPPED: the atomic and structural specimens came from different files");
  console.log("    (" + atomicSpec.rel + " vs " + structSpec.rel + ") — this section needs one file offering both.");
  ok(false, "9. specimens share a file so nesting can be exercised (see the skip note above)");
} else {
  const OTHER = "zzSecondProbeIdent";
  /* the atomic clause sits INSIDE the structural chunk, so its label offset is the larger one;
   * editing it first leaves the heading's offsets untouched. */
  const inner = atomicSpec.site, outer = structSpec.site;
  ok(inner.labelStart > outer.labelStart,
    "9. the atomic clause is nested inside the structural chunk (offsets confirm it)");

  const childOnly = editLabel(atomicSpec.en, inner);
  const a = compileOutcome(childOnly);
  console.log("    9a child only              -> " + a.kind + (a.kind === "threw" ? " : " + a.msg.split("\n")[0] : (a.ts.includes(NEW_IDENT) ? ", carries the probe" : ", probe ABSENT")));
  ok(a.kind === "compiled" && a.ts.includes(NEW_IDENT),
    "9a. a child clause edit is honoured THROUGH its enclosing heading, not blocked by it");

  const both = editLabel(childOnly, outer);   /* same NEW_IDENT at both levels */
  const b = compileOutcome(both);
  console.log("    9b child + heading agree   -> " + b.kind + (b.kind === "threw" ? " : " + b.msg.split("\n")[0] : (b.ts.includes(NEW_IDENT) ? ", carries the probe" : ", probe ABSENT")));
  ok(b.kind === "compiled" && b.ts.includes(NEW_IDENT),
    "9b. editing child and heading consistently is honoured");

  const conflicting = childOnly.slice(0, outer.labelStart)
    + outer.label.replace("`" + outer.ident + "`", "`" + OTHER + "`")
    + childOnly.slice(outer.labelEnd);
  ok(conflicting !== childOnly, "9. the conflicting heading edit actually changed the .en text");
  const c = compileOutcome(conflicting);
  console.log("    9c child + heading conflict -> " + c.kind + (c.kind === "threw" ? " : " + c.msg.split("\n")[0] : (c.ts === atomicSpec.source ? ", IDENTICAL TO THE UNEDITED SOURCE" : ", output differs")));
  ok(c.kind === "threw" && /HEADING AND BODY DISAGREE/.test(c.msg),
    "9c. a heading edited to CONTRADICT the child edit is still refused — 9a is not a blanket bypass");
}

/* ---- and the probe is shown to be a real edit (§10.3) ----------------------------------------
 * If `editLabel` silently did nothing — a marker moved, a regex stopped matching — every assertion
 * above would be measuring an unedited file and the failures would look identical. So the edit is
 * verified independently of the compiler. */
{
  const e = editLabel(atomicSpec.en, atomicSpec.site);
  ok(e.includes(NEW_IDENT), "the probe edit is present in the .en handed to the compiler");
  eq(e.length !== atomicSpec.en.length || e !== atomicSpec.en, true, "the probe edit changed the bytes");
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\nThis suite was GREEN when the flip landed (2026-09-03). A failure here is a REGRESSION in\n"
  + "§5C rule 2 or rule 3 — the English has stopped being the source. It is not an expected red.");
