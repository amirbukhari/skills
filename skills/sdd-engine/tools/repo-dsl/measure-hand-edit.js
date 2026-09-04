#!/usr/bin/env node
"use strict";
/**
 * measure-hand-edit.js — WHICH HAND EDITS TO THE ENGLISH REACH THE COMPILED `.ts`, AND WHICH DO NOT.
 *
 * WHY THIS EXISTS. §1's thesis is that the English is the source. §18 Q-1 lists the blockers on
 * actually flipping to it, and one of them is stated as prose rather than a number: *"`compileChunk`
 * must derive the payload from the sentence rather than only reading it"*. My PRD sweep called the
 * same thing the largest single gap — *a hand-edit to the English still cannot change the compiled
 * `.ts`* — and nothing in the tree measures its SURFACE. "Editing the English does nothing" is one
 * sentence covering at least six different edits with at least three different outcomes, and the
 * next person to work on it needs to know which is which before they start.
 *
 * A REPORTER, NOT A TEST, AND DELIBERATELY. An honest `.test.js` for this capability goes RED by
 * design — the capability does not exist yet — and a permanently-failing file in a tree several
 * sessions share is noise that trains people to ignore a red. This follows the existing
 * `measure-*.js` reports / `*.test.js` asserts split. It asserts exactly one thing, at the bottom:
 * that the two CONTROL edits still take effect, because a run where nothing at all reaches the `.ts`
 * is measuring a broken harness rather than the engine.
 *
 * WHAT IT CANNOT TELL YOU. It reports whether an edit CHANGED the compiled bytes, not whether the
 * change was CORRECT. An edit that alters the `.ts` in a way no author intended is counted here as
 * "took effect", which is the honest reading of what the compiler did with it.
 *
 * THE THREE OUTCOMES, which are the point of the exercise:
 *
 *   took-effect  the compiled `.ts` changed. The English was load-bearing for this edit.
 *   refused      the compile threw. The edit did not land, but nobody was misled.
 *   SILENT       the compiled `.ts` is byte-identical and nothing was raised. This is the
 *                dangerous cell: an author edits the English, the file still compiles, and their
 *                edit is gone. It is the `{ optional: true } / catch { return null }` defect class
 *                this engine exists to eliminate, at the level of the source language itself.
 *
 * MEASURED IN BOTH MODES. The derive check re-derives each gloss and throws on disagreement, which
 * converts SILENT into refused without making any edit take effect. Both columns are reported.
 *
 * CORRECTED 2026-09-04 — this paragraph said *"The mode is off by default, so … the left is what
 * an author meets today, the right is what the existing guard would give them if it were on."*
 * `enfile.js` reads `process.env.SDD_DERIVE_CHECK !== "0"`, so the check is ON by default and the
 * RIGHT column is what an author meets today. The left column is what they get only by explicitly
 * setting it to "0".
 *
 *   node measure-hand-edit.js [--files N] [--json]
 *
 * Read-only: it reads `.en` from CORPUS, compiles in memory, and writes nothing. No mine, no
 * render, no corpus mutation, and it cannot move byte-identity.
 */
const fs = require("fs");
const path = require("path");
const EN = require("./engine/enfile");
const CR = require("./engine/corpus-root");

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const nFlag = argv.indexOf("--files");
const LIMIT = nFlag >= 0 ? +argv[nFlag + 1] : 150;
if (!Number.isFinite(LIMIT) || LIMIT < 1) {
  console.error("measure-hand-edit.js REFUSED: --files needs a positive count");
  process.exit(2);
}

/* THE DIALECT SENTINELS (R-PAY-1). Copied rather than imported because `enfile.js` does not export
 * them — and a copy that drifts from its original is the exact hazard that module's own export
 * comment warns about, so the copy is CHECKED against the source below rather than trusted. */
const OPEN = "«", CLOSE = "»", GEN = "▶", GEN_NEST = "▷";
const PAY_OPEN = "⟪", PAY_CLOSE = "⟫", BODY_OPEN = "⟨", BODY_CLOSE = "⟩";
(function assertDialect() {
  const src = fs.readFileSync(path.join(__dirname, "engine", "enfile.js"), "utf8");
  const want = [["OPEN", OPEN], ["CLOSE", CLOSE], ["GEN", GEN], ["GEN_NEST", GEN_NEST],
    ["PAY_OPEN", PAY_OPEN], ["PAY_CLOSE", PAY_CLOSE], ["BODY_OPEN", BODY_OPEN], ["BODY_CLOSE", BODY_CLOSE]];
  const bad = want.filter(([n, ch]) => !new RegExp(`${n}\\s*=\\s*"${ch}"`).test(src));
  if (bad.length) {
    console.error(`measure-hand-edit.js REFUSED: the dialect drifted — ${bad.map(([n]) => n).join(", ")} ` +
      `no longer match enfile.js. Every edit below targets these sentinels, so a stale copy would ` +
      `report "no applicable site" instead of a wrong answer, which is worse.`);
    process.exit(2);
  }
})();

const CORPUS = CR.corpusRoot();
const enHome = path.join(CR.senDir(), "files");
const index = EN.loadIndex(CORPUS);

/* ---------- the corpus of .en files, sampled evenly rather than taken from the front ---------- */
function allEn(dir) {
  const out = [];
  (function walk(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith(".en")) out.push(p);
    }
  })(dir);
  return out;
}
const every = allEn(enHome);
if (!every.length) {
  console.error(`measure-hand-edit.js REFUSED: no .en under ${enHome}. Render first (npm run render).`);
  process.exit(2);
}
/* Evenly spaced, so the sample is not all of `packages/` — the tree is sorted and its shape varies
 * a great deal by directory (enums render very differently from routers). */
const step = Math.max(1, Math.floor(every.length / LIMIT));
const sample = every.filter((_, i) => i % step === 0).slice(0, LIMIT);

/* SEEDING THE SAMPLE SO THE VERBATIM CONTROL CAN LAND — and a finding in its own right.
 *
 * The first run of this file reported ZERO applicable sites for CONTROL-verbatim, and the harness
 * assertion at the bottom caught it rather than letting the English figures stand on an unproven
 * base. The cause is not the locator: MEASURED corpus-wide, only **4 of 1037** `.en` files contain
 * any identifier text at chunk depth 0 at all, and three of those four are `eslint-disable`
 * comments. Verbatim TypeScript outside every chunk has all but disappeared — which is what
 * one-word-per-file at 99.3% (R-ARCH-15) plus maximal-run structural children (a565df0) MEAN, seen
 * from the other side. An evenly-spaced sample of 150 will essentially never contain one.
 *
 * A control that cannot be applied is not a control, so the sample is seeded with those files
 * instead of the control being quietly dropped or the assertion loosened. They are APPENDED, never
 * substituted, so every English figure is still measured over the unbiased even sample. */
const outsideText = (en) => {
  let depth = 0;
  for (let i = 0; i < en.length; i++) {
    const ch = en[i];
    if (ch === "\u27e1") { i++; continue; }
    if (ch === OPEN) { depth++; continue; }
    if (ch === CLOSE) { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && /[A-Za-z_]/.test(ch) && /^[A-Za-z_][A-Za-z0-9_]{4,}/.test(en.slice(i, i + 64))) return true;
  }
  return false;
};
const seeded = [];
for (const f of every) {
  if (seeded.length >= 4) break;
  if (sample.includes(f)) continue;
  let en; try { en = fs.readFileSync(f, "utf8"); } catch { continue; }
  if (outsideText(en)) { seeded.push(f); sample.push(f); }
}

/* ---------- locating an edit site ----------
 * Each locator returns { at, len, replacement } for the FIRST applicable site in the file, or null.
 * They work on the raw `.en` text, which is what a human editing the file has in front of them. */

/* The first atomic chunk: «▶ gloss ⟪payload⟫». Returns the gloss and payload spans. */
function firstAtomic(en) {
  let i = -1;
  while ((i = en.indexOf(OPEN + GEN, i + 1)) >= 0) {
    const close = en.indexOf(CLOSE, i);
    const po = en.indexOf(PAY_OPEN, i), pc = en.indexOf(PAY_CLOSE, po + 1);
    if (close < 0 || po < 0 || pc < 0 || po > close || pc > close) continue;
    return { glossStart: i + 2, glossEnd: po, payStart: po + 1, payEnd: pc };
  }
  return null;
}
/* The first structural chunk: «▷ gloss ⟨children⟩». Its gloss is a NAME over children and carries
 * no payload of its own, so it is the one place where prose is all there is. */
function firstStructural(en) {
  const i = en.indexOf(OPEN + GEN_NEST);
  if (i < 0) return null;
  const bo = en.indexOf(BODY_OPEN, i);
  if (bo < 0) return null;
  return { glossStart: i + 2, glossEnd: bo };
}

/* Chunk depth of an offset: how many « are still open at it. A structural chunk at depth 0 is the
 * FILE's own chunk; anything deeper is a structural chunk nested inside another. The distinction is
 * not cosmetic — it is the difference between "re-parse the file" and "a second producer of the
 * renderer's run grouping" (§8B, R-REND-9) for anyone closing the structural half of cut 2. */
function depthAt(en, at) {
  let d = 0;
  for (let i = 0; i < at; i++) { const c = en[i]; if (c === OPEN) d++; else if (c === CLOSE) d--; }
  return d;
}

/* Corpus-wide census of structural chunks by depth. Read-only, whole tree, not the sample — the
 * sample cannot answer it, because every class here edits the FIRST structural chunk in a file and
 * that one is always the file's own. Reporting the sample's 120 without this line would invite
 * exactly the wrong generalisation. */
function structuralCensus(files) {
  let total = 0, depth0 = 0, maxDepth = 0;
  for (const f of files) {
    let t; try { t = fs.readFileSync(f, "utf8"); } catch { continue; }
    let d = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === OPEN) { if (t[i + 1] === GEN_NEST) { total++; if (d === 0) depth0++; if (d > maxDepth) maxDepth = d; } d++; }
      else if (c === CLOSE) d--;
    }
  }
  return { total, depth0, nested: total - depth0, maxDepth };
}

const splice = (s, at, len, rep) => s.slice(0, at) + rep + s.slice(at + len);

/* Each class: a one-line description and a mutate(en) -> newEn | null. */
const CLASSES = [
  { id: "gloss-plain-word", shape: "atomic",
    what: "rewrite an ordinary English word in an ATOMIC chunk's sentence",
    mutate(en) {
      const a = firstAtomic(en); if (!a) return null;
      const gloss = en.slice(a.glossStart, a.glossEnd);
      /* a bare alphabetic word, outside backticks and outside “quotes” */
      const m = /(^|[\s(])([a-z]{4,})(?=[\s,.)])/.exec(gloss.replace(/`[^`]*`/g, (x) => " ".repeat(x.length))
                                                       .replace(/“[^”]*”/g, (x) => " ".repeat(x.length)));
      if (!m) return null;
      const at = a.glossStart + m.index + m[1].length;
      return splice(en, at, m[2].length, "zqxwv");
    } },

  { id: "gloss-identifier", shape: "atomic",
    what: "rewrite a `backticked identifier` inside an ATOMIC chunk's sentence",
    mutate(en) {
      const a = firstAtomic(en); if (!a) return null;
      const gloss = en.slice(a.glossStart, a.glossEnd);
      const m = /`([^`]+)`/.exec(gloss); if (!m) return null;
      return splice(en, a.glossStart + m.index + 1, m[1].length, "zqxwvIdent");
    } },

  { id: "gloss-literal", shape: "atomic",
    what: "rewrite a “quoted literal” inside an ATOMIC chunk's sentence",
    mutate(en) {
      const a = firstAtomic(en); if (!a) return null;
      const gloss = en.slice(a.glossStart, a.glossEnd);
      const m = /“([^”]*)”/.exec(gloss); if (!m) return null;
      return splice(en, a.glossStart + m.index + 1, m[1].length, "ZQXWV-LITERAL");
    } },

  { id: "gloss-truncate", shape: "atomic",
    what: "delete the second half of an ATOMIC chunk's sentence",
    mutate(en) {
      const a = firstAtomic(en); if (!a) return null;
      const gloss = en.slice(a.glossStart, a.glossEnd);
      if (gloss.trim().length < 12) return null;
      const cut = a.glossStart + Math.floor(gloss.length / 2);
      return splice(en, cut, a.glossEnd - cut, " ");
    } },

  { id: "gloss-structural-name", shape: "structural",
    what: "rewrite a STRUCTURAL chunk's name — prose with no payload behind it",
    mutate(en) {
      const s = firstStructural(en); if (!s) return null;
      const gloss = en.slice(s.glossStart, s.glossEnd);
      if (!gloss.trim()) return null;
      return splice(en, s.glossStart, s.glossEnd - s.glossStart, " zqxwv renamed by hand ");
    } },

  /* ---- THE TWO CONTROLS. These are not English; they are the machine halves of the file. If
   * either of these comes back SILENT the harness is broken, not the engine, and the assertion at
   * the bottom of this file says so. ---- */
  { id: "CONTROL-payload-hole", shape: "atomic", control: true,
    what: "rewrite a hole fill INSIDE the payload — the machine half of the same chunk",
    mutate(en) {
      const a = firstAtomic(en); if (!a) return null;
      const pay = en.slice(a.payStart, a.payEnd);
      const m = /⟨([A-Za-z_][A-Za-z0-9_]{2,})/.exec(pay); if (!m) return null;
      return splice(en, a.payStart + m.index + 1, m[1].length, "zqxwvHole");
    } },

  { id: "CONTROL-verbatim", shape: "outside", control: true,
    what: "rewrite TypeScript that lies outside every chunk — never collapsed, always literal",
    mutate(en) {
      /* EVERY region at chunk depth 0 — before, between and after the chunks — not merely the text
       * before the first one. That earlier version found ZERO sites in a 40-file sample and the
       * harness assertion caught it: at 99.3% one-word-per-file most files ARE a single chunk
       * starting at offset 0, so "before the first chunk" is usually the empty string. The control
       * was reporting on nothing, which is exactly the failure the controls exist to expose.
       *
       * ⟡ escapes the sentinels inside verbatim text (V_ESC, enfile.js:88), so an escaped « or »
       * must not move the depth — hence the skip rather than a plain scan. */
      let depth = 0;
      for (let i = 0; i < en.length; i++) {
        const ch = en[i];
        if (ch === "⟡") { i++; continue; }
        if (ch === OPEN) { depth++; continue; }
        if (ch === CLOSE) { depth = Math.max(0, depth - 1); continue; }
        if (depth !== 0) continue;
        const m = /^([A-Za-z_][A-Za-z0-9_]{4,})/.exec(en.slice(i, i + 64));
        if (m) return splice(en, i, m[1].length, "zqxwvVerbatim");
        /* Skip the rest of THIS token so the scan does not restart mid-word — but only when we are
         * actually standing ON one. The first version skipped unconditionally, so from the space
         * before `eslint` it consumed the whole word and the for-loop's i++ then landed past it:
         * every depth-0 identifier in the file was stepped over and the control reported 0 sites in
         * files that demonstrably have them. Found because a dead control is an assertion here, not
         * a footnote. */
        if (/[A-Za-z0-9_]/.test(ch))
          while (i + 1 < en.length && /[A-Za-z0-9_]/.test(en[i + 1])) i++;
      }
      return null;
    } },
];

/* ---------- run ---------- */
const MODES = [{ key: "off", deriveCheck: false }, { key: "on", deriveCheck: true }];
const tally = {};
for (const c of CLASSES) {
  tally[c.id] = { what: c.what, shape: c.shape, control: !!c.control, applicable: 0,
    off: { effect: 0, refused: 0, silent: 0 }, on: { effect: 0, refused: 0, silent: 0 },
    examples: { silent: [], effect: [], refused: [] } };
}
let baselineOk = 0, baselineBad = 0;

for (const f of sample) {
  const en = fs.readFileSync(f, "utf8");
  const rel = path.relative(enHome, f);
  let base;
  /* The baseline is compiled with the check OFF, because that is the state of the world; a file
   * whose UNEDITED gloss already fails the derive-check is a finding of its own, counted below. */
  try { base = EN.compileFileEn(en, index, { deriveCheck: false }); }
  catch { baselineBad++; continue; }
  baselineOk++;

  for (const c of CLASSES) {
    let edited;
    try { edited = c.mutate(en); } catch { edited = null; }
    if (edited == null || edited === en) continue;          /* no applicable site in this file */
    tally[c.id].applicable++;
    for (const m of MODES) {
      const t = tally[c.id][m.key];
      let out, threw = false;
      try { out = EN.compileFileEn(edited, index, { deriveCheck: m.deriveCheck }); }
      catch { threw = true; }
      const cell = threw ? "refused" : (out === base ? "silent" : "effect");
      t[cell]++;
      if (m.key === "off" && tally[c.id].examples[cell].length < 3) tally[c.id].examples[cell].push(rel);
    }
  }
}

/* ---------- report ---------- */
const rows = CLASSES.map((c) => ({ id: c.id, ...tally[c.id] }));
const englishRows = rows.filter((r) => !r.control);
const silentOff = englishRows.reduce((a, r) => a + r.off.silent, 0);
const englishTried = englishRows.reduce((a, r) => a + r.applicable, 0);
const silentOn = englishRows.reduce((a, r) => a + r.on.silent, 0);
const effectOff = englishRows.reduce((a, r) => a + r.off.effect, 0);
/* WHERE THE STRUCTURAL SITES ACTUALLY ARE. Every structural class edits the FIRST ▷ chunk in a
 * file, and that one is always the file's own chunk, so the sample says nothing about nested
 * structural chunks — of which there are far more. Measured over the whole tree, not the sample. */
const census = structuralCensus(every);
let sampledStructural = 0, sampledStructuralDepth0 = 0;
for (const f of sample) {
  let t; try { t = fs.readFileSync(f, "utf8"); } catch { continue; }
  const st = firstStructural(t);
  if (!st) continue;
  sampledStructural++;
  if (depthAt(t, st.glossStart - 2) === 0) sampledStructuralDepth0++;
}

const summary = {
  corpus: CORPUS, enFilesTotal: every.length, sampled: sample.length, seededForVerbatimControl: seeded.length,
  baselineCompiled: baselineOk, baselineFailed: baselineBad,
  englishEditsTried: englishTried,
  englishEditsSilent: { deriveCheckOff: silentOff, deriveCheckOn: silentOn },
  englishEditsThatTookEffect: effectOff,
  byShape: Object.fromEntries(["atomic", "structural"].map((sh) => {
    const g = englishRows.filter((r) => r.shape === sh);
    return [sh, { tried: g.reduce((a, r) => a + r.applicable, 0),
      silentOff: g.reduce((a, r) => a + r.off.silent, 0),
      silentOn: g.reduce((a, r) => a + r.on.silent, 0),
      effectOff: g.reduce((a, r) => a + r.off.effect, 0) }];
  })),
  structuralChunks: { ...census, sampledSites: sampledStructural, sampledSitesAtDepth0: sampledStructuralDepth0 },
};

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ tool: "measure-hand-edit",
    generated: new Date().toISOString(), summary, classes: rows }, null, 2) + "\n");
} else {
  const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : "n/a");
  console.log(`\nHAND EDITS TO THE ENGLISH — what reaches the compiled .ts`);
  console.log(`  corpus ${CORPUS}`);
  console.log(`  ${sample.length} of ${every.length} .en files sampled evenly; ${baselineOk} compiled clean` +
              `${baselineBad ? `, ${baselineBad} failed at BASELINE and were skipped` : ""}`);
  console.log(`  ${seeded.length} seeded so the verbatim control has somewhere to land: only 4 of ` +
              `${every.length} files still hold any TypeScript outside a chunk at all.\n`);
  console.log(`  ${"edit class".padEnd(26)} ${"shape".padEnd(10)} ${"sites".padStart(5)}   DERIVE_CHECK off        DERIVE_CHECK on`);
  console.log(`  ${"".padEnd(26)} ${"".padEnd(10)} ${"".padStart(5)}   effect refuse SILENT    effect refuse SILENT`);
  for (const r of rows) {
    const c = (x) => String(x).padStart(6);
    console.log(`  ${(r.control ? "» " : "  ") + r.id.padEnd(24)} ${r.shape.padEnd(10)} ${String(r.applicable).padStart(5)}   ` +
      `${c(r.off.effect)}${c(r.off.refused)}${c(r.off.silent)}    ${c(r.on.effect)}${c(r.on.refused)}${c(r.on.silent)}`);
  }
  console.log(`\n  » = CONTROL (the machine half of the file, not English)`);
  /* CORRECTED 2026-09-04. These four lines used to read: *"SHAPE MATTERS AND IS NOT A FINDING …
   * a STRUCTURAL chunk has children instead of a payload — so there is nothing to derive from and
   * the check cannot fire on it. A structural row staying SILENT in the 'on' column is a documented
   * boundary of that guard, not a hole in it."* THE TABLE PRINTED DIRECTLY ABOVE THEM SAYS
   * OTHERWISE: gloss-structural-name is 120 refused, 0 silent, in the "on" column. `a5501a7`
   * (2026-09-02) gave the structural branch its own check — deriveStructuralGloss over the compiled
   * CHILD bytes — one day after this prose was written, and the prose was not updated. A report
   * whose commentary contradicts its own numbers is worse than one with no commentary, because the
   * sentence is what gets quoted onward. It was, on 2026-09-04. */
  console.log(`  SHAPE MATTERS, AND THE STRUCTURAL ROW IS NOT A BOUNDARY OF THE GUARD. An ATOMIC gloss is`);
  console.log(`  derived from its PAYLOAD; a STRUCTURAL chunk (▷, R-ARCH-19) has children instead, and is`);
  console.log(`  derived from its compiled CHILD BYTES by deriveStructuralGloss (a5501a7). Both are`);
  console.log(`  compared and both refuse. A structural row going SILENT in the "on" column would be a`);
  console.log(`  REGRESSION, not a documented limit — read the number, not this sentence.\n`);
  console.log(`  AND THE STRUCTURAL SITES ARE NOT A RANDOM SAMPLE OF STRUCTURAL CHUNKS. Every structural`);
  console.log(`  class edits the FIRST ▷ chunk in a file, and ${sampledStructuralDepth0} of ${sampledStructural} of those sat at chunk depth 0 —`);
  console.log(`  the file's OWN chunk. Corpus-wide there are ${census.total} structural chunks, ${census.depth0} at depth 0 and`);
  console.log(`  ${census.nested} NESTED (deepest ${census.maxDepth}), so ${pct(census.nested, census.total)} of them are unlike anything measured`);
  console.log(`  above. That distinction is load-bearing for whoever closes the structural half: a`);
  console.log(`  file-level chunk's run is recoverable by re-parsing the file, while a nested one's is`);
  console.log(`  the enclosing block's run — a renderer decision (§5D.4F) the compiled bytes do not`);
  console.log(`  carry. Recovering it at compile time is either a small change or a SECOND PRODUCER of`);
  console.log(`  that grouping, which is the shape R-REND-9 exists to prevent. Measured, not assumed,`);
  console.log(`  because the sample alone would have invited exactly the wrong generalisation.\n`);
  for (const r of rows) console.log(`  ${r.id.padEnd(26)} ${r.what}`);
  console.log(`\n  THE HEADLINE, in one line each:`);
  console.log(`    of ${englishTried} English edits, ${effectOff} reached the .ts and ${silentOff} were SILENT ` +
              `(${pct(silentOff, englishTried)}) with the check off — an author's edit vanishes and the file still compiles.`);
  const atomic = englishRows.filter((r) => r.shape === "atomic");
  const atomicTried = atomic.reduce((a, r) => a + r.applicable, 0);
  const atomicSilentOn = atomic.reduce((a, r) => a + r.on.silent, 0);
  console.log(`    with SDD_DERIVE_CHECK=1 the silent count is ${silentOn} (${pct(silentOn, englishTried)}) overall, ` +
              `and ${atomicSilentOn} of ${atomicTried} on ATOMIC chunks — the`);
  console.log(`    existing guard converts SILENT into refused where it can reach, and still makes no edit TAKE EFFECT.`);
  console.log(`    that is the gap §18 Q-1 states as "compileChunk must derive the payload from the`);
  console.log(`    sentence rather than only reading it" — priced per edit class rather than as one sentence.\n`);
  const withSilent = englishRows.filter((r) => r.off.silent);
  if (withSilent.length) {
    console.log(`  where to look first — files whose English edit vanished:`);
    for (const r of withSilent) console.log(`    ${r.id.padEnd(26)} ${r.examples.silent.join(", ")}`);
    console.log("");
  }
}

/* THE ONE ASSERTION. Everything above is a report, but a run in which NOTHING reached the .ts is
 * measuring a broken harness — a stale index, a dialect change, a bad sample — and would read as
 * the most alarming possible result. The controls are the machine halves of the very same files, so
 * if they do not land, no conclusion about the English half is safe. */
const controls = rows.filter((r) => r.control);
const dead = controls.filter((r) => r.applicable > 0 && r.off.effect === 0);
const unapplied = controls.filter((r) => r.applicable === 0);
if (dead.length || unapplied.length) {
  console.error(`\nmeasure-hand-edit.js: THE CONTROLS DID NOT LAND — this run measures the harness, not the engine.`);
  for (const r of dead) console.error(`  ${r.id}: ${r.applicable} sites, 0 took effect ` +
    `(refused ${r.off.refused}, silent ${r.off.silent})`);
  for (const r of unapplied) console.error(`  ${r.id}: no applicable site in ${sample.length} files — locator or dialect drift`);
  console.error(`  Every "SILENT" figure above is untrustworthy until this is explained.`);
  process.exit(1);
}
