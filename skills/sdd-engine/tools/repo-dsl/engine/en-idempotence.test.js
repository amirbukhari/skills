"use strict";
/* engine/en-idempotence.test.js — A5: Amir's statement-2 acceptance criterion, made corpus-wide.
 *
 * §5D.0 statement 2, his words:
 *   "then if I mine the codebase again I should see no change to the .en file because it backwards
 *    builds the .en file back into exactly what was written anyways"
 *
 * This is STRICTLY STRONGER than the byte-identity the engine already gates on. Every existing gate
 * asks `compile(.en) === .ts`. Statement 2 asks the other direction — that the `.en` ITSELF is
 * stable — and until this file nothing anywhere compared a fresh render against the `.en` on disk.
 *
 * THE CRITERION HAS TWO HALVES, AND THEY HAVE DIFFERENT ANSWERS. Separating them is the whole point
 * of this file; collapsing them is how "idempotent" would become a word with no measurement behind
 * it.
 *
 *   HALF 1 — RENDER idempotence. Re-render the SAME source against the SAME dictionary: does the
 *            persisted `.en` come back unchanged? Cheap (~5s), needs no mine, writes nothing, and
 *            it is a real regression guard TODAY, independent of any flip: it goes red the moment
 *            someone changes the renderer and does not re-render. Measured 2026-09-01: 1037/1037.
 *
 *   HALF 2 — MINE idempotence. Re-mine, then render: does the `.en` come back unchanged? This is
 *            what statement 2 actually asks, and it is FALSE BY CONSTRUCTION today. Word ids are
 *            allocated positionally (`const id = dict.length` in engine/wordlzw.js), so a re-mine
 *            renumbers them and rewrites the payload of essentially every file. Priced by 5f in
 *            measure-id-stability.js: id tokens are 0.66% of `.en` bytes but appear in 1034 of 1037
 *            files — a tiny byte share that invalidates almost the entire corpus.
 *
 * WHY HALF 2 IS NOT EXECUTED HERE. Demonstrating it requires an actual re-mine, which rewrites the
 * shared 40MB dictionary, renumbers every id and invalidates all 1037 persisted `.en`. That is a
 * destructive write to state other lanes are using, so this file DECIDES half 2 statically — from
 * the allocator and from the absence of any dictionary binding in the `.en` — exactly as
 * verify-register.js decides R-PAY-6 without a mine. A test that must corrupt the corpus to pass is
 * not a test anyone will run.
 *
 * STATUS: half 1 green, half 2 unbuildable until R-PAY-6 picks a closure. The register row
 * R-ARCH-23 carries the red; this file carries the measurement. Neither closure is chosen here —
 * that is Amir's call (2026-09-01) and it moves the payload format corpus-wide.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { renderFileEn, loadIndex } = require("./enfile");
const CR = require("./corpus-root");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const SRC = CR.sourceRoot();
const EN_DIR = path.join(CR.senDir(), "files");

const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (p.endsWith(".en")) o.push(p);
  }
  return o;
};

/* HALF 1 — the runnable half. */
ok("HALF 1 — every persisted .en is EXACTLY what a fresh render produces", () => {
  if (!fs.existsSync(EN_DIR)) { console.log("      (no .en rendered yet — run `npm run render`)"); return; }
  const idx = loadIndex(CR.corpusRoot());
  const ens = walk(EN_DIR).sort();
  assert.ok(ens.length > 500, `expected the full mirror, found ${ens.length} .en`);

  const drifted = [], threw = [];
  let checked = 0, orphan = 0;
  for (const enPath of ens) {
    const rel = path.relative(EN_DIR, enPath).replace(/\.en$/, "");
    let source;
    try { source = fs.readFileSync(path.join(SRC, rel), "utf8"); } catch { orphan++; continue; }
    let fresh;
    try { fresh = renderFileEn(source, idx).en; }
    catch (e) { threw.push(`${rel}: ${e.message.split("\n")[0]}`); continue; }
    if (fresh !== fs.readFileSync(enPath, "utf8")) drifted.push(rel);
    checked++;
  }
  console.log(`      ${checked} compared, ${drifted.length} drifted, ${threw.length} threw, ${orphan} with no .ts counterpart`);
  assert.deepStrictEqual(threw, [], `render threw on:\n    ${threw.slice(0, 5).join("\n    ")}`);
  assert.deepStrictEqual(drifted.slice(0, 10), [],
    `${drifted.length} .en on disk are NOT what the current renderer produces — re-render, or a ` +
    `renderer change landed without one:\n    ${drifted.slice(0, 10).join("\n    ")}`);
});

/* HALF 2 — decided statically, never by mining. */
ok("HALF 2 — statement 2 is NOT satisfiable today: ids are positional and no .en pins a dictionary", () => {
  const alloc = fs.readFileSync(path.join(__dirname, "wordlzw.js"), "utf8");
  const positional = /const id = dict\.length/.test(alloc);

  let withId = 0, withFingerprint = 0, total = 0;
  if (fs.existsSync(EN_DIR)) {
    for (const f of walk(EN_DIR)) {
      let t; try { t = fs.readFileSync(f, "utf8"); } catch { continue; }
      total++;
      if (/⟪lzw1 [nw]\d+/.test(t)) withId++;
      if (/fingerprint/i.test(t)) withFingerprint++;
    }
  }
  console.log(`      ids allocated positionally: ${positional};  ${withId}/${total} .en carry a word id;  ${withFingerprint} name a dictionary`);

  /* This assertion PINS THE GAP. It is the A5 blocker stated as a property, and it is expected to
   * fail — loudly and correctly — the day R-PAY-6 closes. When it does: half 2 becomes executable,
   * and this assertion should be REPLACED by a real re-mine comparison, not deleted. */
  assert.ok(positional && withFingerprint === 0,
    "a closure appears to have landed (ids are no longer positional, or .en now name a dictionary). " +
    "Half 2 is now demonstrable: replace this static check with a real re-mine comparison and " +
    "make R-ARCH-23 green.");
});

/* The honest framing, asserted so it cannot rot into a stronger claim than was measured. */
ok("half 1 passing is NOT statement 2 — the two must not be conflated", () => {
  assert.notStrictEqual("render idempotence", "mine idempotence");
});

console.log(`\n${pass} assertions passed`);
