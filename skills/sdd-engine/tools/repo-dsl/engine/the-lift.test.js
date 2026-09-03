/* the-lift.test.js — §4B THE LIFT, AS A STANDING PROHIBITION. RED.
 *
 * §4B: "a file is never one word ... Every file must render as its constituent words." On the night
 * of 2026-09-02 a file-level naming pass was built that gave every file one short name — precisely
 * the thing §4B forbids — and it took a human reading the PRD to catch it. This file is that catch,
 * mechanised, so the next attempt fails in a test run instead of in review.
 *
 * ------------------------------------------------------------------------------------------------
 * THE CONTRADICTION THIS TEST USED TO NAVIGATE IS RESOLVED. Amir ruled on 2026-09-03: the AMENDED
 * form wins, and §4B's prose was corrected to match R-MINE-7 rather than the reverse (the old
 * wording is quoted in place in tools/prd/07-live-path-recursive-lzw.md per §9). His reasoning: the
 * worry behind THE LIFT was "the reader sees one opaque reference instead of the file's structure",
 * and a NAMED, EXPANDABLE word is not opaque — the structure is one expansion away. His own
 * approved rendering target opens with a short whole-file line that expands.
 *
 * SO THIS TEST NO LONGER REPORTS TWO NUMBERS AND DECLINES TO RULE. It asserts one rule, the amended
 * one, in both its halves:
 *
 *   UNEXPANDABLE  a file may not render as ONE top-level chunk that is ATOMIC — a single sealed
 *                 word with nothing beneath it to open. This is the shape the 2026-09-02 file-naming
 *                 pass created, and it is what the guard exists to catch.
 *   UNNAMED       a whole-run word must also CARRY A NAME. This half was in R-MINE-7 from the day it
 *                 was amended and was never checked here, because while the strict reading was still
 *                 live the atomic test alone was the conservative subset. With the ruling in, the
 *                 omission is no longer covered by anything, so it is asserted.
 *
 * The 257 files that render as a single top-level chunk are NOT violations, and are now reported as
 * what they are — the target shape — rather than as a pending count against a superseded sentence.
 * ------------------------------------------------------------------------------------------------
 */
const fs = require("fs");
const path = require("path");
const EN = require("./enfile");
const CR = require("./corpus-root");
const P = require("./en-prose");
const { SKIP } = require("./walk-skip");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
  }
  return o;
};

/* THE SHAPE OF THE TOP LEVEL, read off the emitted bytes. `stats.oneWord` is not used as the
 * subject here: it answers "one top-level span and nothing outside it", which cannot distinguish a
 * sealed atomic word from a structural chunk with a whole tree under it — and that distinction is
 * the entire amendment. */
function topShape(en) {
  const s = P.stripPayloads(en);
  let depth = 0, tops = 0, firstMark = null, outsideNonWs = 0, cursor = 0, hadChild = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === P.OPEN) {
      if (depth === 0) { outsideNonWs += s.slice(cursor, i).replace(/\s/g, "").length;
        let j = i + 1; while (j < s.length && s[j] === " ") j++;
        if (tops === 0) firstMark = s[j]; }
      else if (depth === 1) hadChild = true;
      depth++;
    } else if (ch === P.CLOSE) { depth--; if (depth === 0) { tops++; cursor = i + 1; } }
  }
  outsideNonWs += s.slice(cursor).replace(/\s/g, "").length;
  return { tops, outsideNonWs, atomic: firstMark === P.GEN, hadChild };
}

const SRC = CR.sourceRoot(), CORPUS = CR.corpusRoot();
const index = EN.loadIndex(CORPUS);
const files = walk(SRC);

const WN = require("./word-names");
const wn = (() => { try { return WN.load(CORPUS); } catch (_) { return { names: {}, chunks: {} }; } })();
/* The hand-authored labels, as TEXT. A name is matched by what it says and never by word id, since
 * ids are array indices renumbered by every re-mine (R-PAY-6) — comparing by id would make this
 * assertion pass or fail on whether someone had mined recently. */
const NAMED_LABELS = new Set();
for (const rec of Object.values(wn.chunks || {})) if (rec && rec.en) NAMED_LABELS.add(String(rec.en).trim());
for (const rec of Object.values(wn.names || {})) if (rec && rec.en && rec.named) NAMED_LABELS.add(String(rec.en).trim());

let byteExact = 0, empty = 0, wholeRun = 0;
const sealed = [];    // unexpandable: one top-level chunk, atomic, nothing beneath
const unnamed = [];   // named-half: a whole-run word whose label is the bare derived gloss

for (const abs of files) {
  const rel = path.relative(SRC, abs);
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let r; try { r = EN.renderFileEn(source, index); } catch (_) { continue; }
  if (EN.compileFileEn(r.en, index) === source) byteExact++;

  const t = topShape(r.en);
  /* structurally empty files have nothing to lift and are not violations of anything. */
  if (t.tops === 0) { empty++; continue; }
  if (t.tops === 1 && t.outsideNonWs === 0) {
    wholeRun++;
    if (t.atomic && !t.hadChild) sealed.push({ rel, bytes: source.length });
    /* THE UNNAMED HALF. A whole-run word is permitted BECAUSE it carries a name a reader can trust;
     * a whole-run word wearing only the derived gloss is the opaque reference §4B was written
     * against, wearing a label. `labelsOf` returns the emitted label, and a named whole-run word is
     * one whose label is present in the hand-authored chunk ledger. */
    const label = (P.labelsOf(r.en)[0] || "").trim();
    if (!label || !NAMED_LABELS.has(label)) unnamed.push({ rel, bytes: source.length, label });
  }
}

/* THE FLOOR FIRST. */
eq(byteExact, files.length, "byte-identity holds for every file while this is measured");

console.log("");
console.log("  files                                    " + files.length);
console.log("  structurally empty (no chunk at all)     " + empty);
console.log("  whole-run words (one top chunk, nothing outside)  " + wholeRun + "   <- PERMITTED, and the target");
console.log("                                                        shape (Amir's ruling, 2026-09-03)");
console.log("  ...of those, SEALED   (atomic, nothing to expand)  " + sealed.length + "   <- asserted: must be 0");
console.log("  ...of those, UNNAMED  (no hand-authored name)      " + unnamed.length + "   <- asserted: must be 0");
console.log("");
if (sealed.length) {
  console.log("  SEALED FILES (largest first — most source hidden behind one unexpandable word)");
  sealed.sort((a, b) => b.bytes - a.bytes);
  for (const s of sealed.slice(0, 15)) console.log("    " + String(s.bytes).padStart(7) + " B  " + s.rel);
  console.log("");
}

if (unnamed.length) {
  console.log("  UNNAMED WHOLE-RUN WORDS (largest first — a whole file behind a derived gloss)");
  unnamed.sort((a, b) => b.bytes - a.bytes);
  for (const u of unnamed.slice(0, 15)) console.log("    " + String(u.bytes).padStart(7) + " B  " + u.rel + "\n             | " + u.label.slice(0, 90));
  console.log("");
}

eq(sealed.length, 0, "no whole-run word is UNEXPANDABLE — no file is a single atomic word with nothing beneath it (R-MINE-7)");
eq(unnamed.length, 0, "no whole-run word is UNNAMED — every whole-file word carries a hand-authored name (R-MINE-7)");

/* AND THE GUARD IS SHOWN TO FIRE (§10.3). A prohibition that has never rejected anything is
 * indistinguishable from a prohibition that cannot. `topShape` is run against a hand-built .en of
 * exactly the forbidden shape, and against one that is allowed, so a future refactor that quietly
 * breaks the detector fails HERE rather than passing the corpus check by seeing nothing. */
{
  const forbidden = "«▶ the links router ⟪x⟫»";
  const allowed = "«▷ the links router ⟨«▶ a ⟪x⟫»«▶ b ⟪y⟫»⟩»";
  const f = topShape(forbidden), a = topShape(allowed);
  ok(f.tops === 1 && f.atomic && !f.hadChild, "the detector rejects a sealed whole-file word");
  ok(a.tops === 1 && !a.atomic && a.hadChild, "the detector accepts a whole-file word with structure beneath it");
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\nRED ON PURPOSE: these files hide their whole contents behind one word a reader cannot open.");
