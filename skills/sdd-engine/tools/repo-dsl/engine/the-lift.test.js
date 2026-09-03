/* the-lift.test.js — §4B THE LIFT, AS A STANDING PROHIBITION. RED.
 *
 * §4B: "a file is never one word ... Every file must render as its constituent words." On the night
 * of 2026-09-02 a file-level naming pass was built that gave every file one short name — precisely
 * the thing §4B forbids — and it took a human reading the PRD to catch it. This file is that catch,
 * mechanised, so the next attempt fails in a test run instead of in review.
 *
 * ------------------------------------------------------------------------------------------------
 * A PRD CONTRADICTION THIS TEST HAS TO NAVIGATE, STATED RATHER THAN QUIETLY RESOLVED.
 *
 * §4B's prose still reads absolutely: the renderer "refuses any word that covers an entire run".
 * R-MINE-7 and §5D.4 record the same rule AMENDED on 2026-08-31 to refuse only whole-run words that
 * are UNNAMED OR UNEXPANDABLE — a named word with structure beneath it is allowed to span the run.
 * The two readings are not equivalent and they give different corpus numbers, so this test does not
 * pick one silently:
 *
 *   THE AMENDED READING IS ASSERTED.  It is what the register says, it is what the renderer was
 *      built to, and it is decidable: a file may not render as ONE top-level chunk that is ATOMIC —
 *      a single sealed word with nothing to expand. That is the exact shape the file-naming pass
 *      created, so the guard covers the mistake it exists to prevent.
 *   THE STRICT READING IS REPORTED, NOT ASSERTED.  The count of files rendering as a single
 *      top-level chunk of any kind is printed below. Under §4B's literal prose that number must be
 *      zero; under R-MINE-7 it is fine. Asserting it would be this test taking a ruling that is
 *      Amir's to make, and asserting the wrong side of an open question is worse than reporting it.
 *
 * Whichever way that lands, THE AMENDED FORM IS A SUBSET, so nothing asserted here becomes wrong.
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

let byteExact = 0, empty = 0, strictOneChunk = 0;
const sealed = [];   // the amended violation: one top-level chunk, atomic, nothing beneath

for (const abs of files) {
  const rel = path.relative(SRC, abs);
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let r; try { r = EN.renderFileEn(source, index); } catch (_) { continue; }
  if (EN.compileFileEn(r.en, index) === source) byteExact++;

  const t = topShape(r.en);
  /* structurally empty files have nothing to lift and are not violations of anything. */
  if (t.tops === 0) { empty++; continue; }
  if (t.tops === 1 && t.outsideNonWs === 0) {
    strictOneChunk++;
    if (t.atomic && !t.hadChild) sealed.push({ rel, bytes: source.length });
  }
}

/* THE FLOOR FIRST. */
eq(byteExact, files.length, "byte-identity holds for every file while this is measured");

console.log("");
console.log("  files                                    " + files.length);
console.log("  structurally empty (no chunk at all)     " + empty);
console.log("  ONE top-level chunk, nothing outside it  " + strictOneChunk + "   <- must be 0 under §4B's literal prose,");
console.log("                                                 allowed under R-MINE-7 as amended 2026-08-31. REPORTED,");
console.log("                                                 NOT ASSERTED — this is Amir's ruling to make.");
console.log("  ...of those, SEALED (atomic, nothing to expand)  " + sealed.length + "   <- asserted below");
console.log("");
if (sealed.length) {
  console.log("  SEALED FILES (largest first — most source hidden behind one unexpandable word)");
  sealed.sort((a, b) => b.bytes - a.bytes);
  for (const s of sealed.slice(0, 15)) console.log("    " + String(s.bytes).padStart(7) + " B  " + s.rel);
  console.log("");
}

eq(sealed.length, 0, "no file renders as a single atomic whole-file word with nothing beneath it (§4B / R-MINE-7)");

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
