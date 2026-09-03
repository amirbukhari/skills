/* sentence-authority.test.js — §5C RULES 2 AND 3: THE ENGLISH IS THE SOURCE. RED.
 *
 * Everything the round-trip currently proves runs one way: .ts -> .en -> .ts, byte for byte, 1037
 * of 1037. That direction says the .en is a faithful ENCODING. It says nothing at all about the
 * .en being a SOURCE, and §5C (rewritten 2026-08-31) is unambiguous that it must be:
 *
 *   Rule 2  "A hand-edit to a clause's English MUST change the compiled TypeScript. The payload is
 *            a DERIVED INDEX, not the source of truth."
 *   Rule 3  "Sentence and payload disagreeing is an ERROR, loudly. Not a tie the payload wins."
 *
 * WHAT IS ALREADY BUILT, so this test is aimed at the real gap and not at a strawman. R-REND-6's
 * DERIVE-AND-CHECK exists in `compileChunk`: it re-derives the gloss from the payload and throws on
 * a mismatch. It is deliberately partial, in two documented ways — it is OFF unless
 * `SDD_DERIVE_CHECK=1`, and its structural branch returns before the check, so a hand-edit to a
 * structural chunk's NAME is silent even when it is on. This file pins both edges and the
 * unbuilt half.
 *
 * ------------------------------------------------------------------------------------------------
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
 * THIS FILE'S POLARITY IS OPPOSITE TO `hand-authored-en.test.js`, ON PURPOSE. That test pins the
 * CURRENT behaviour — an English edit is inert — and carries a banner saying it is expected to fail
 * the day the flip lands. This one pins the REQUIREMENT. They can never both be green, and that is
 * the point: the day this file passes, that one fails, and the pair is the flip's tripwire. Neither
 * should be edited to relieve the pressure without the other being deleted in the same commit.
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

/* ---- 7. THE EDIT MUST REACH THE TYPESCRIPT (§5C rule 2) --------------------------------------- */
console.log("\n  --- 7. an English edit changes the compiled TypeScript ---");
for (const spec of [atomicSpec, structSpec]) {
  const which = spec === atomicSpec ? "atomic clause" : "structural name";
  const edited = editLabel(spec.en, spec.site);
  ok(edited !== spec.en, "7. the " + which + " edit actually changed the .en text");
  const out = compileOutcome(edited);
  console.log("    " + which + " -> " + out.kind + (out.kind === "compiled" ? (out.ts === spec.source ? " (BYTE-IDENTICAL TO THE UNEDITED SOURCE — the edit was inert)" : " (output differs)") : ""));
  ok(out.kind === "compiled" && out.ts !== spec.source && out.ts.includes(NEW_IDENT),
    "7. editing the " + which + "'s English produces TypeScript carrying `" + NEW_IDENT + "`");
}

/* ---- 8. A DISAGREEMENT IS NEVER RESOLVED IN THE PAYLOAD'S FAVOUR, SILENTLY (§5C rule 3) -------
 * Asserted as the disjunction argued for in the header: refuse, or honour. Returning the pre-edit
 * TypeScript and reporting success is the one outcome forbidden in every version of the engine. */
console.log("\n  --- 8. sentence/payload disagreement is never silently resolved ---");
for (const on of [false, true]) {
  for (const spec of [atomicSpec, structSpec]) {
    const which = (spec === atomicSpec ? "atomic clause" : "structural name") + (on ? " [SDD_DERIVE_CHECK=1]" : " [default]");
    const edited = editLabel(spec.en, spec.site);
    let out;
    try { out = { kind: "compiled", ts: EN.compileFileEn(edited, index, { deriveCheck: on }) }; }
    catch (e) { out = { kind: "threw", msg: e.message }; }
    const silentlyPreferredPayload = out.kind === "compiled" && out.ts === spec.source;
    if (out.kind === "threw") console.log("    " + which + " -> REFUSED: " + out.msg.split("\n")[0]);
    else console.log("    " + which + " -> compiled" + (silentlyPreferredPayload ? ", IDENTICAL TO THE UNEDITED SOURCE" : ", output differs"));
    ok(!silentlyPreferredPayload,
      "8. the " + which + " does not compile the pre-edit TypeScript and report success");
  }
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
if (fail) console.error("\nRED ON PURPOSE: §5C's direction is settled; these are its mechanics (§Q-3), unbuilt.");
