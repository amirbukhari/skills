/* links-standard.test.js — THE APPROVED RENDERING, MADE EXECUTABLE. RED BY DESIGN.
 *
 * Amir approved an exact target rendering for `src/routers/links.ts` on 2026-09-03 (below). This
 * file pins it. It FAILS today, and that is its entire job: the gap between what the renderer emits
 * and what the standard says is now a number in a test run instead of a paragraph in a report.
 *
 * WHY A WHOLE-FILE SPECIMEN AND NOT MORE UNIT TESTS. Every existing quality metric is an aggregate
 * — vacuous-clause count, English-complete share, review surface — and an aggregate can improve
 * while every individual file stays unreadable. §7's criteria are all questions about *how the .en
 * reads*. One file, read end to end against a standard a human approved, is the only assertion
 * shaped like the actual requirement.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: byte-identity is asserted FIRST and separately, because every
 * other assertion here is about prose and prose must never be bought by breaking the round-trip.
 * A future change that makes this file read beautifully and drops a byte fails on assertion A and
 * the prose assertions are not even reached.
 */
const fs = require("fs");
const path = require("path");
const EN = require("./enfile");
const CR = require("./corpus-root");
const Q = require("./clause-quality");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

const REL = "src/routers/links.ts";

/* ---- THE STANDARD, verbatim as approved ------------------------------------------------------
 * Reproduced exactly. The line wrapping is presentation: the assertion below compares paragraphs
 * with internal whitespace normalised, so a different wrap column is not a failure and a different
 * WORD is. Pinning the wrap would make this a test of a formatter. */
const TARGET = `
The \`links\` router exposes two Freshbooks endpoints, both behind a JWT check.

Given a client and an invoice, it notifies user \`1\` and redirects to that
invoice's share link.

Given an authorization \`code\`, it authorizes the Freshbooks account and
returns the token's expiry.
`;

const paragraphs = (s) => s.trim().split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);

/* ---- reading the .en the way a human does ----------------------------------------------------
 * PAYLOADS ARE STRIPPED, and that is not a loophole. §5C item 2: "the payload is a DERIVED INDEX,
 * not the source of truth ... a cache of what the sentence says". It is verbatim TypeScript by
 * construction and always will be, so scanning it for TypeScript would make the standard
 * unreachable by design rather than by defect. What remains after stripping is exactly the reader's
 * surface: the label regions, and any source the renderer failed to say anything about — which is
 * where the whole gap lives. */
function stripPayloads(en) {
  let out = "", depth = 0;
  for (const ch of en) {
    if (ch === "⟪") { depth++; continue; }
    if (ch === "⟫") { depth--; continue; }
    if (!depth) out += ch;
  }
  return out;
}
/* the prose surface: payloads gone, chunk delimiters gone, verbatim un-escaped. */
function readable(en) {
  return EN.unescapeVerbatim(stripPayloads(en)).replace(/[«»▶▷⟨⟩]/g, "");
}
/* every emitted label region, in order — the clause metrics' subject. */
function labelsOf(en) {
  const s = stripPayloads(en), out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "«") continue;
    let j = i + 1;
    while (j < s.length && (s[j] === "▶" || s[j] === "▷" || s[j] === " ")) j++;
    let txt = "";
    while (j < s.length && s[j] !== "⟨" && s[j] !== "»" && s[j] !== "«") { txt += s[j]; j++; }
    if (txt.trim()) out.push(txt.trim());
    i = j - 1;
  }
  return out;
}

const SRC = CR.sourceRoot(), CORPUS = CR.corpusRoot();
const abs = path.join(SRC, REL);
if (!fs.existsSync(abs)) { console.error("SKIP: " + REL + " is not in this corpus at " + abs); process.exit(0); }
const source = fs.readFileSync(abs, "utf8");
const index = EN.loadIndex(CORPUS);
const r = EN.renderFileEn(source, index);
const en = r.en;

/* ---- A. THE FLOOR. Never traded for prose. --------------------------------------------------- */
ok(EN.compileFileEn(en, index) === source, "A. byte-identity — the .en compiles back to " + REL + " exactly");

/* ---- B. REVIEW SURFACE, BY COMPOSITION AND NOT BY TOTAL --------------------------------------
 * THE TOTAL ALONE WOULD BE A GUARD THAT CANNOT FIRE (§10.3). Measured 2026-09-03, this file's
 * review surface is ALREADY 3 — but as 1 top-level chunk plus 2 statements left as raw code, where
 * the standard is 3 paragraphs and no raw code at all. Same number, opposite meaning. So the
 * assertion is on the two components; the total is asserted after them, as arithmetic. */
eq(r.stats.topSpans, 3, "B1. three top-level paragraphs, one per thing the file does");
eq(r.stats.residualStatements, 0, "B2. no statement left as raw TypeScript — the standard has none");
eq(r.stats.reviewSurface, 3, "B3. review surface is 3 (= B1 + B2), and it is 3 for the right reason");

/* ---- C. NO VACUOUS CLAUSES (§5C honesty rule) ------------------------------------------------
 * HONEST LABELLING: this one PASSES today (0 of 18 clauses are in the frozen set). It is kept as a
 * regression guard with its current reading stated, so that a production written to satisfy B or D
 * cannot buy the gain by falling back to a placeholder. The frozen set is frozen: a production that
 * stops emitting one of these must do so by saying something TRUE, never by rewording it. */
{
  const vac = [];
  for (const L of labelsOf(en)) for (const c of Q.clausesOf(L)) if (Q.isVacuous(c)) vac.push(c);
  eq(vac.length, 0, "C. no clause is in the frozen vacuous set" + (vac.length ? " — " + vac.slice(0, 5).join(" / ") : ""));
}

/* ---- D. EVERY CLAUSE IS ENGLISH-COMPLETE (the §7 scanner, per clause) ------------------------- */
{
  const bad = [];
  for (const L of labelsOf(en)) for (const c of Q.clausesOf(L)) if (!Q.isEnglishComplete(c)) bad.push(c);
  if (bad.length) { console.error("    " + bad.length + " clause(s) still carry TypeScript:"); for (const c of bad.slice(0, 10)) console.error("      * " + c); }
  eq(bad.length, 0, "D. every emitted clause is English-complete");
}

/* ---- E. NO TYPESCRIPT ANYWHERE IN THE PROSE SURFACE ------------------------------------------
 * The scanner predicate applied to the WHOLE file rather than clause by clause: strip what is
 * deliberately verbatim (`identifiers`, “literals”) and the derived payloads, and nothing that
 * looks like TypeScript may survive. This is what catches the failure clause-level metrics cannot
 * see — source the renderer never claimed at all, sitting between the chunks. */
{
  const residue = Q.residueOf(readable(en));
  const hits = residue.split("\n").map((l) => l.trim()).filter((l) => l && Q.TS_SYNTAX.test(l));
  if (hits.length) { console.error("    " + hits.length + " line(s) of surviving TypeScript:"); for (const h of hits.slice(0, 12)) console.error("      | " + h.slice(0, 110)); }
  eq(hits.length, 0, "E. no TypeScript syntax survives outside verbatim regions and payloads");
}

/* ---- F. THE RENDERING IS THE APPROVED ONE ---------------------------------------------------- */
{
  const want = paragraphs(TARGET), got = paragraphs(readable(en));
  eq(got.length, want.length, "F1. the file reads as " + want.length + " paragraphs");
  for (let i = 0; i < want.length; i++) {
    const g = got[i] || "";
    if (g !== want[i]) {
      console.error("    paragraph " + (i + 1) + ":");
      console.error("      want: " + want[i]);
      console.error("      got:  " + (g.length > 220 ? g.slice(0, 220) + " …" : g));
    }
    ok(g === want[i], "F2." + (i + 1) + ". paragraph " + (i + 1) + " matches the approved standard");
  }
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) {
  console.error("\nThis test is RED ON PURPOSE. It pins the rendering Amir approved for " + REL + ";");
  console.error("the failures above are the distance between the engine and that standard.");
}
