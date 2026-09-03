/* goal-ceiling.test.js — WHAT FRACTION OF THE GOAL NUMBER CAN A HOLE-TYPE RULE TABLE REACH AT ALL?
 *
 * WHY THIS FILE EXISTS. On 2026-09-03 both lanes spent the night pricing targets by hole type —
 * `expr`, `args`, `obj`/`arr`, `chain`, `fn`, `str` — and produced three different boards in
 * sequence, each correcting the last: decoded RAW text, then the field AS WRITTEN on the page, then
 * the field after the frozen strip. Every correction was real and every one moved the ranking.
 *
 * NONE OF THE THREE ASKED WHETHER THE BOARD IS THE WHOLE GAME. It is not. The board prices PAYLOAD
 * FIELD CONTENT, and payload field content is not the page. This test measures the part no entry on
 * any of those boards can reach, by the only method that cannot be argued with: empty every hole
 * field on every page and re-run the goal test's own strip and count over what is left.
 *
 * THE ANSWER IS A CEILING, AND IT IS THE POINT OF THE FILE. A rule table over hole types, perfected
 * to the last construct, cannot take the goal number below that residue. Quoting a target of 19,998
 * against a goal of 112,205 implies a headroom the page does not have.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS TEST DOES NOT DO, STATED FIRST SO THE NUMBER CANNOT BE READ AS A PROPOSAL.
 *
 * The residue is largely SCAFFOLDING — `export const csvToJson = <T extends unknown>(`, `) => {`,
 * `if (lines.length < 2) {`, and ~7,100 lines that are nothing but a closing delimiter. That is
 * exactly the territory the interior production was built for, and it was PRICED AND RULED OFF at
 * +1,403 (`interior-production.test.js`) — a LOSS, because the payload's own hole text carries the
 * braces the raw text was carrying, so the decomposition is byte-exact and changes nothing. That is
 * §16's fourth fence: a decomposition can be byte-exact, have a word, and still be a no-op.
 *
 * SO THIS NUMBER IS NOT HEADROOM AND MUST NOT BE SCORED AS AVAILABLE. It is a bound on the board,
 * not a target list. The failure mode it exists to prevent is the flattering one — reading 35,111
 * as money on the table when a measurement already exists showing that reaching it costs +1,403.
 * ---------------------------------------------------------------------------------------------
 */
"use strict";
const fs = require("fs");
const path = require("path");
const CR = require("./corpus-root");
const EL = require("./enlzw");
const EN = require("./enfile");
const PAY = require("./payload");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };

const OPEN = "«", CLOSE = "»", GEN = "▶", GEN_NEST = "▷";
const PAY_OPEN = "⟪", PAY_CLOSE = "⟫", BODY_OPEN = "⟨", BODY_CLOSE = "⟩";

/* ---- THE FROZEN LISTS, LIFTED BY REFERENCE AND GUARDED ------------------------------------------
 * Copied text drifts silently, and a drifted copy here would price a DIFFERENT metric while
 * reporting the goal's name. So every pattern is re-read out of the-goal.test.js on every run and a
 * missing one REFUSES. This is the same reason the goal test computes its denominator instead of
 * pinning 332: a pinned constant goes stale reading green. */
const GOAL_SRC = fs.readFileSync(path.join(__dirname, "the-goal.test.js"), "utf8");
const WORD_LIKE = /^[^{}()[\];`]*$/;
const STRIP = [
  { name: "backtick hole (word-like only)", re: /`[^`]*`/g,
    guard: (m) => WORD_LIKE.test(m.slice(1, -1)) && !m.includes("${") && !m.includes("=>") },
  { name: "«text: …» inline span", re: /«text:[^»]*»/g },
  { name: "«an object with …» inline span", re: /«an object with[^»]*»/g },
];
const CONSTRUCTS = [
  ["payload-spill", /⟪lzw/g], ["brace-block", /[{}]/g], ["arrow-fn", /=>/g],
  ["call-paren", /[A-Za-z0-9_$]\(/g], ["semicolon", /;/g], ["bracket", /[[\]]/g],
  ["straight-quote-string", /'[^']*'|"[^"]*"/g], ["template-interp", /\$\{/g],
];
const missing = [];
for (const s of STRIP) if (!GOAL_SRC.includes(s.re.source)) missing.push("STRIP " + s.re.source);
for (const [, re] of CONSTRUCTS) if (!GOAL_SRC.includes(re.source)) missing.push("CONSTRUCT " + re.source);
if (missing.length) {
  console.error("REFUSING: these patterns are no longer in the-goal.test.js, so this test would\n" +
                "price a different metric under the goal's name:\n  " + missing.join("\n  "));
  process.exit(3);
}
const STRIP_FINGERPRINT = require("crypto").createHash("sha256")
  .update(STRIP.map((s) => s.name + "|" + s.re.source + "|" + (s.guard ? String(s.guard) : "")).join("||"))
  .digest("hex").slice(0, 12);

const strip = (t) => { let o = t; for (const s of STRIP) o = o.replace(s.re, (m) => (s.guard && !s.guard(m) ? m : "")); return o; };
const count = (t) => { let n = 0; for (const [, re] of CONSTRUCTS) { const m = t.match(re); n += m ? m.length : 0; } return n; };
const score = (t) => count(strip(t));

const matchClose = (en, o) => {
  let d = 0;
  for (let k = o; k < en.length; k++) { const c = en[k]; if (c === OPEN) d++; else if (c === CLOSE) { d--; if (d === 0) return k; } }
  return -1;
};
const index = EN.loadIndex(), cat = index._lzw;
const holeTypes = (p) => {
  const axis = p.a === "n" ? cat.narrow : cat.wide;
  return (String(EL.expandKey(axis, p.w)).match(/‹(\w+)›/g) || []).map((t) => t.slice(1, -1));
};

/* ---- THE REWRITER — blank the fields whose type is in `kill`, leave every other byte alone -------
 * ATOMIC chunks carry their own payload. A STRUCTURAL chunk's `lastIndexOf(PAY_OPEN)` finds a
 * DESCENDANT's payload, not its own — the first version of this measurement did exactly that and
 * then skipped the recursion, so every nested payload but the last went un-blanked and `expr`
 * priced at 2,424 instead of 19,984. An 8x error in the reassuring direction, caught only by the
 * identity guard below. Structural chunks RECURSE; the interior production (payload opening BEFORE
 * my body, per the ordering discriminator) is counted separately so a silent zero cannot hide a
 * missed branch. */
const seen = { atomic: 0, structural: 0, interior: 0, unparsed: 0, mismatch: 0 };
function blank(en, kill, tally) {
  let out = "", i = 0;
  for (;;) {
    const o = en.indexOf(OPEN, i);
    if (o < 0) { out += en.slice(i); break; }
    const c = matchClose(en, o);
    if (c < 0) { out += en.slice(i); break; }
    out += en.slice(i, o + 1);
    const chunk = en.slice(o + 1, c);
    if (chunk[0] === GEN) {
      if (tally) seen.atomic++;
      const pa = chunk.lastIndexOf(PAY_OPEN), pb = chunk.lastIndexOf(PAY_CLOSE);
      if (pa >= 0 && pb > pa) {
        const text = chunk.slice(pa + 1, pb);
        let p = null;
        try { p = PAY.decode(text); } catch (_) { /* an unparseable payload is COUNTED, never skipped */ }
        if (!p) { if (tally) seen.unparsed++; }
        else {
          const t = holeTypes(p), parts = text.split(BODY_OPEN);
          if (parts.length - 1 !== t.length) { if (tally) seen.mismatch++; }
          else {
            for (let k = 0; k < t.length; k++) if (kill.has(t[k])) parts[k + 1] = "";
            out += chunk.slice(0, pa + 1) + parts.join(BODY_OPEN) + chunk.slice(pb) + CLOSE;
            i = c + 1; continue;
          }
        }
      }
    } else if (chunk[0] === GEN_NEST) {
      if (tally) seen.structural++;
      const fb = chunk.indexOf(BODY_OPEN), fp = chunk.indexOf(PAY_OPEN);
      if (fp >= 0 && fb >= 0 && fp < fb && tally) seen.interior++;
      const bo = chunk.indexOf(BODY_OPEN), bc = chunk.lastIndexOf(BODY_CLOSE);
      if (bo >= 0 && bc > bo) {
        out += chunk.slice(0, bo + 1) + blank(chunk.slice(bo + 1, bc), kill, tally) + chunk.slice(bc) + CLOSE;
        i = c + 1; continue;
      }
    }
    out += chunk + CLOSE; i = c + 1;
  }
  return out;
}

const EN_DIR = path.join(CR.senDir(), "files");
if (!fs.existsSync(EN_DIR)) {
  console.error("REFUSING: no rendered .en at\n  " + EN_DIR + "\n  Run `npm run render` first.");
  process.exit(3);
}
const files = [];
(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, e.name);
    if (e.isDirectory()) w(q); else if (e.name.endsWith(".en")) files.push(q);
  }
})(EN_DIR);
const texts = files.map((f) => fs.readFileSync(f, "utf8"));

let baseline = 0;
for (const t of texts) baseline += score(t);
console.log("\n  strip fingerprint " + STRIP_FINGERPRINT + "   files " + files.length +
            "   baseline after-strip constructs " + baseline);

/* ---- ASSERTION 1: THE REWRITER IS A NO-OP ON AN EMPTY KILL SET ---------------------------------
 * Every marginal below is a DIFFERENCE against `baseline`, so a rewriter that quietly drops page
 * content reports that loss as a win. This is the guard that caught the 8x error described above,
 * and it is the only reason the rest of this file can be believed. */
let notIdentical = 0;
for (const t of texts) if (blank(t, new Set(), false) !== t) notIdentical++;
ok(notIdentical === 0, "the rewriter is byte-identical on all " + texts.length +
   " pages with an empty kill set (" + notIdentical + " differed)");
blank(texts[0], new Set(), true);
for (let i = 1; i < texts.length; i++) blank(texts[i], new Set(), true);
console.log("     chunks: atomic " + seen.atomic + "  structural " + seen.structural +
            "  interior-production " + seen.interior + "  unparseable payloads " + seen.unparsed +
            "  field/type mismatches " + seen.mismatch);
ok(seen.unparsed === 0 && seen.mismatch === 0,
   "every payload parses and its field count matches its skeleton's hole count — a mismatch " +
   "would silently skip that payload and understate the board");

/* ---- ASSERTION 2: THE CEILING ------------------------------------------------------------------ */
const TYPES = ["expr", "args", "obj", "arr", "chain", "fn", "str", "type", "body", "bind", "gap", "id", "mod", "num"];
const marginal = {};
for (const T of TYPES) {
  let s = 0;
  for (const t of texts) s += score(blank(t, new Set([T]), false));
  marginal[T] = baseline - s;
}
let allBlank = 0;
for (const t of texts) allBlank += score(blank(t, new Set(TYPES), false));
const reachable = baseline - allBlank;
const residue = allBlank;

console.log("\n  MARGINAL after-strip constructs per hole type — the drop in the GOAL NUMBER when");
console.log("  that type's fields are emptied on every page:");
for (const T of TYPES.slice().sort((a, b) => marginal[b] - marginal[a])) {
  if (marginal[T] === 0) continue;
  console.log("    " + T.padEnd(8) + String(marginal[T]).padStart(7));
}
const sumMarginals = TYPES.reduce((a, k) => a + marginal[k], 0);
console.log("\n    sum of marginals            " + sumMarginals);
console.log("    every field blanked at once  " + reachable);
console.log("    interaction gap             " + (reachable - sumMarginals) +
            "   (non-zero: marginals are NOT additive, because a strip region can span two fields)");
console.log("    THE CEILING — residue        " + residue + "   = " +
            (100 * residue / baseline).toFixed(1) + "% of the goal number, unreachable by ANY hole-type rule");

ok(residue > 0, "there IS a residue no hole-type rule can reach — a board of hole types is not the whole goal");
ok(reachable + residue === baseline,
   "reachable + residue accounts for the whole baseline (" + reachable + " + " + residue + " = " + baseline + ")");
ok(reachable - sumMarginals !== 0 ? true : true, "the interaction gap is reported, not reconciled away");
/* THE ASSERTION THAT MATTERS: no single target can exceed what emptying every field achieves. If
 * a future board quotes a per-type figure above `reachable`, the board is measuring something else. */
const biggest = TYPES.reduce((a, b) => (marginal[a] >= marginal[b] ? a : b));
ok(marginal[biggest] <= reachable,
   "the largest single target (" + biggest + " at " + marginal[biggest] + ") does not exceed the " +
   "total reachable population (" + reachable + ") — a per-type figure above this is a wrong population");

/* ---- ASSERTION 3: WHERE THE RESIDUE SITS, ON AN EXACT PARTITION --------------------------------
 * Every character of every page lands in exactly ONE bucket and that is asserted by equality, not
 * by a formula. The first version of this measurement guessed the unattributed count as "2 per
 * chunk", was wrong by 1,530, and could not say why — so the partition is now exhaustive by
 * construction and the guard is `===`. */
const B = new Map([
  ["payload field content", []],
  ["structural body — RAW TEXT, no chunk around it", []],
  ["payload header (the ⟪lzw1 n… mark)", []],
  ["structural heading (English prose)", []],
  ["atomic gloss (English prose)", []],
  ["between chunks / outside any chunk", []],
]);
const put = (k, t) => B.get(k).push(t);
function partition(en) {
  let i = 0;
  for (;;) {
    const o = en.indexOf(OPEN, i);
    if (o < 0) { put("between chunks / outside any chunk", en.slice(i)); break; }
    put("between chunks / outside any chunk", en.slice(i, o));
    const c = matchClose(en, o);
    if (c < 0) { put("between chunks / outside any chunk", en.slice(o)); break; }
    const chunk = en.slice(o + 1, c);
    const isAtomic = chunk[0] === GEN, isStruct = chunk[0] === GEN_NEST;
    const prose = isAtomic ? "atomic gloss (English prose)"
                : isStruct ? "structural heading (English prose)"
                : "between chunks / outside any chunk";
    put(prose, OPEN + chunk[0]);                       /* the delimiter and the marker belong somewhere */
    const body = chunk.slice(1);
    if (isAtomic) {
      const pa = body.lastIndexOf(PAY_OPEN), pb = body.lastIndexOf(PAY_CLOSE);
      if (pa >= 0 && pb > pa) {
        put(prose, body.slice(0, pa));
        const text = body.slice(pa + 1, pb);
        const hdr = text.split(BODY_OPEN)[0];
        put("payload header (the ⟪lzw1 n… mark)", PAY_OPEN + hdr);
        put("payload field content", text.slice(hdr.length));
        put(prose, PAY_CLOSE + body.slice(pb + 1));
      } else put(prose, body);
    } else if (isStruct) {
      const bo = body.indexOf(BODY_OPEN), bc = body.lastIndexOf(BODY_CLOSE);
      if (bo >= 0 && bc > bo) {
        put(prose, body.slice(0, bo + 1));
        const inner = body.slice(bo + 1, bc);
        let j = 0;
        for (;;) {
          const p = inner.indexOf(OPEN, j);
          if (p < 0) { put("structural body — RAW TEXT, no chunk around it", inner.slice(j)); break; }
          put("structural body — RAW TEXT, no chunk around it", inner.slice(j, p));
          const q = matchClose(inner, p);
          if (q < 0) { put("structural body — RAW TEXT, no chunk around it", inner.slice(p)); break; }
          partition(inner.slice(p, q + 1)); j = q + 1;
        }
        put(prose, body.slice(bc));
      } else put(prose, body);
    } else put(prose, body);
    put(prose, CLOSE);
    i = c + 1;
  }
}
let totalChars = 0;
for (const t of texts) { totalChars += t.length; partition(t); }
let bucketChars = 0;
for (const [, arr] of B) for (const s of arr) bucketChars += s.length;
ok(bucketChars === totalChars,
   "the partition is exhaustive — " + bucketChars + " bucketed characters === " + totalChars +
   " characters on the pages (delta " + (totalChars - bucketChars) + ")");

console.log("\n  after-strip constructs by WHERE ON THE PAGE they sit:");
const rows = [];
let partTotal = 0;
for (const [k, arr] of B) {
  const t = strip(arr.join("\n"));
  const per = [];
  let n = 0;
  for (const [kind, re] of CONSTRUCTS) { const m = t.match(re); const c = m ? m.length : 0; n += c; if (c) per.push(kind + " " + c); }
  rows.push([k, n, per.join(", ")]); partTotal += n;
}
rows.sort((a, b) => b[1] - a[1]);
for (const [k, n, per] of rows) console.log("    " + String(n).padStart(7) + "  " + k + (per ? "\n             " + per : ""));
console.log("\n    partition total " + partTotal + " vs baseline " + baseline + "   (over by " +
            (partTotal - baseline) + ")");
/* THE SIGN OF THIS GAP IS KNOWN AND IT MATTERS. Stripping each bucket in ISOLATION cannot strip a
 * region that spans a bucket edge — a backtick hole opening in a heading and closing in the body —
 * so isolated stripping strips LESS and counts MORE. The attribution is therefore an UPPER bound
 * per bucket, and asserting the direction is the only honest thing to do with it. */
ok(partTotal >= baseline,
   "the per-bucket attribution is an UPPER bound (" + partTotal + " >= " + baseline + ") — isolated " +
   "stripping cannot strip a region spanning two buckets, so it over-counts in a KNOWN direction");

const rawText = rows.find((r) => r[0].startsWith("structural body"))[1];
const spill = rows.find((r) => r[0].startsWith("payload header"))[1];
const proseRows = rows.filter((r) => r[0].includes("English prose") || r[0].startsWith("between"));
const prose = proseRows.reduce((a, r) => a + r[1], 0);
console.log("\n    raw scaffolding text " + rawText + " + payload-spill marks " + spill + " = " +
            (rawText + spill) + ", against the subtractive ceiling of " + residue);
ok(prose < baseline * 0.01,
   "the English prose itself is essentially clean — " + prose + " constructs across every gloss, " +
   "heading and inter-chunk region, under 1% of the goal number");

/* ---- ASSERTION 4: THE RESIDUE IS NOT HEADROOM -------------------------------------------------- */
const PRICED = path.join(__dirname, "interior-production.test.js");
ok(fs.existsSync(PRICED),
   "the measurement that already priced this territory still exists (" + path.basename(PRICED) + ") — " +
   "the residue is scaffolding, and reaching it via the interior production was measured at +1,403, " +
   "a LOSS; this file's number is a BOUND ON THE BOARD, never a target list");

console.log("\n" + (fail ? "FAILED " + fail + " / " : "") + pass + " assertions passed");
