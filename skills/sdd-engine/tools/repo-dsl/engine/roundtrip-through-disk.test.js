"use strict";
/* roundtrip-through-disk.test.js — THE END-TO-END, as Amir defined it: "No the end to end is TS in
 * then English out then ts compiled back right?"
 *
 *     a TypeScript file on disk
 *       -> its English written to a REAL FILE
 *       -> that file read back as an independent step
 *       -> compiled
 *       -> byte-compared against the TypeScript re-read from disk
 *
 * WHY THIS IS NOT test-lzw-roundtrip.js AGAIN. The 1037-file gate never reads an English file back
 * off disk: write-en-files.js:97 renders and compiles the IN-MEMORY string, and only afterwards
 * writes the file at :115. So that gate proves the MECHANISM and cannot prove the LOOP — a writer
 * that mangles what it writes, or a reader that mangles what it reads, leaves 1037/1037 completely
 * untouched. Every comparison here is file-to-file.
 *
 * WHAT IT COVERS, CORRECTED 2026-09-04. This header used to say "80 files sampled ... including the
 * five CRLF files and four carrying non-ASCII". THAT IS FALSE and it contradicted the code four
 * lines below it. The 80 was an exploratory run in a scratchpad that was never committed. The
 * committed test samples TWELVE files, and of the twelve it selects today, ZERO have Windows line
 * endings and ZERO carry a non-ASCII character. Those two classes are the ones most likely to break
 * on a write/read boundary and they are NOT exercised. Named here rather than quietly left, because
 * a sample that happens to be lucky today can be unlucky tomorrow, and the wrong figure was already
 * relayed to Amir once. Fixing the selection is a separate decision and is not made here.
 *
 * WHAT HAPPENED WHEN IT WAS FIRST RUN. IT PASSED IMMEDIATELY — no defect found. So the test has to
 * earn its green by being shown able to fail, and it is, five ways, every one by mutating the
 * artefact ON DISK and re-reading it:
 *
 *   the chunk's sentence, reworded   -> REFUSED: the sentence and the payload disagree
 *   a heading, reworded              -> REFUSED: the heading and its body disagree
 *   one name in the sentence changed -> COMPILES, and the TypeScript changes to match. This is the
 *                                       one that answers "type English, get code": the payload is
 *                                       rebuilt FROM the sentence rather than the edit refused.
 *   a value in the payload changed   -> COMPILES UNCHANGED. The sentence overrules the payload,
 *                                       which is why the case above is not merely "last edit wins".
 *   the dictionary changed           -> REFUSED.
 *
 * THE DICTIONARY CONTROL WAS A NO-OP THE FIRST TIME AND READ AS A PASS. It rewrote one entry on the
 * wide axis, while the compiler picks its axis from the payload and this fixture is narrow. A
 * control that cannot fire is worth less than no control, so it now rewrites every matching entry
 * on BOTH axes and asserts specifically that the compile was REFUSED.
 *
 * NO DIALECT CHARACTER IS SPELLED OUT IN THIS FILE. Amir: "I don't want to see any typescript or
 * symbols in any files". The marks live in the engine, which is the only place they can live —
 * they are the parser — and this test asks for them BY NAME through enfile's MARKS export.
 *
 * ONE ASSERTION PASSES BY CONSTRUCTION and says so: "what came off disk is what went on" is the
 * filesystem doing its job, not the engine doing its job. Its real control is the five mutations. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EN = require("./enfile");
const CR = require("./corpus-root");
const { SKIP } = require("./walk-skip");
const M = EN.MARKS;

const CORPUS = CR.corpusRoot(), SRC = CR.sourceRoot();
const index = EN.loadIndex(CORPUS);

/* Regular expressions built from the engine's own marks, so this file names them in English and
 * cannot drift from the dialect. */
const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sentenceOfAnAtomicChunk = new RegExp(esc(M.chunkOpen + M.atomicChunk) + " [^" + esc(M.payloadOpen) + "]*" + esc(M.payloadOpen));
const sentenceOfAHeading = new RegExp(esc(M.chunkOpen + M.structuralChunk) + " [^" + esc(M.bodyOpen) + "]*" + esc(M.bodyOpen));
const aNameInAHole = new RegExp(esc(M.bodyOpen) + "([A-Za-z_$][A-Za-z0-9_$]*)" + esc(M.bodyOpen), "g");
const aBacktickedNameInASentence = new RegExp(esc(M.chunkOpen + M.atomicChunk) + " [^" + esc(M.payloadOpen) + "]*?`([A-Za-z_$][A-Za-z0-9_$]*)`[^" + esc(M.payloadOpen) + "]*" + esc(M.payloadOpen));

/* A DETERMINISTIC SAMPLE, not a fixed file list: the corpus is untracked, so naming files here
 * would make the test fail for the wrong reason the day one moves. Sorted, so two runs see the same
 * files, and evenly spaced so the sample is spread across the tree rather than clustered. */
function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(d.name) || d.name.startsWith(".")) continue;
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) walk(abs, out);
    else if (d.name.endsWith(".ts") && !d.name.endsWith(".d.ts")) out.push(abs);
  }
  return out;
}
const all = walk(SRC).sort();
const SAMPLE = all.filter((_, i) => i % Math.max(1, Math.floor(all.length / 12)) === 0).slice(0, 12);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rt-disk-"));
let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.message}`); process.exitCode = 1; } };

/** the whole loop, through the filesystem, for one source file */
function throughDisk(abs, i) {
  const tsPath = path.join(TMP, i + "-" + path.basename(abs));
  fs.copyFileSync(abs, tsPath);                                  // work on a COPY, never in place
  const src = fs.readFileSync(tsPath, "utf8");
  const enPath = tsPath + ".en";
  fs.writeFileSync(enPath, EN.renderFileEn(src, index).en);      // English out, to a real file
  const enFromDisk = fs.readFileSync(enPath, "utf8");            // read the FILE back
  const back = EN.compileFileEn(enFromDisk, index, { file: path.relative(SRC, abs) });
  return { tsPath, enPath, enFromDisk, back, onDisk: fs.readFileSync(tsPath, "utf8") };
}

/* 1. THE END-TO-END, reported as a count. */
ok("every sampled TypeScript file survives being written out as English and compiled back, byte for byte", () => {
  assert.ok(SAMPLE.length >= 5, `only ${SAMPLE.length} files were sampled, which is too few to mean anything`);
  let identical = 0; const failures = [];
  SAMPLE.forEach((abs, i) => {
    const rel = path.relative(SRC, abs);
    let r;
    try { r = throughDisk(abs, i); }
    catch (e) { failures.push(`${rel} — compiling it threw: ${e.message.split("\n")[0]}`); return; }
    if (r.back === r.onDisk) identical++;
    else failures.push(`${rel} — came back ${r.back.length} bytes where the original is ${r.onDisk.length}`);
  });
  console.log(`      files: ${SAMPLE.length}  byte-identical: ${identical}  FAILURES: ${failures.length}`);
  for (const f of failures) console.log("        " + f);
  assert.equal(failures.length, 0, `${failures.length} of ${SAMPLE.length} files did not survive the round trip:\n        ` + failures.join("\n        "));
  assert.equal(identical, SAMPLE.length, `only ${identical} of ${SAMPLE.length} files came back byte-identical`);
});

/* the fixture the mutation assertions work on: the first sampled file carrying both an atomic chunk
 * and a heading, so one file can hold every control. */
const FIX = (() => {
  for (let i = 0; i < SAMPLE.length; i++) {
    const r = throughDisk(SAMPLE[i], "fix" + i);
    if (sentenceOfAnAtomicChunk.test(r.enFromDisk) && sentenceOfAHeading.test(r.enFromDisk))
      return { rel: path.relative(SRC, SAMPLE[i]), ...r };
  }
  return null;
})();

/** write a MUTATED English file to disk, read it back, compile it, and say what happened in words */
function whatHappensWhen(name, change, dictionary) {
  const p = path.join(TMP, name + ".en");
  fs.writeFileSync(p, change(FIX.enFromDisk));
  const fromDisk = fs.readFileSync(p, "utf8");
  try {
    const back = EN.compileFileEn(fromDisk, dictionary || index, { file: FIX.rel });
    return back === FIX.onDisk ? "it compiled to exactly the same TypeScript"
      : "it compiled to DIFFERENT TypeScript";
  } catch (e) { return "it was REFUSED: " + e.message.split("\n")[0]; }
}

/* 2. Passes by construction — named as such, per the header. */
ok("(by construction) the English read back off disk is the English that was written to it", () => {
  assert.ok(FIX, "no sampled file carried both a chunk and a heading, so the mutation controls have no fixture");
  assert.equal(fs.readFileSync(FIX.enPath, "utf8"), FIX.enFromDisk,
    "the file that came back off disk is not the file that was written");
});

/* 3-4. The sentence is authoritative (R-REND-6), pinned through the disk path. This is the
 *      strongest evidence the English is load-bearing rather than decorative. */
ok("rewording a chunk's sentence is refused, because the sentence outranks the payload", () => {
  const outcome = whatHappensWhen("sentence", (en) => en.replace(sentenceOfAnAtomicChunk,
    M.chunkOpen + M.atomicChunk + " a sentence nothing derived " + M.payloadOpen));
  assert.ok(/REFUSED: .*SENTENCE AND PAYLOAD DISAGREE/.test(outcome),
    `rewording the sentence should have been refused; instead ${outcome}`);
});
ok("rewording a heading is refused, because the heading outranks the body beneath it", () => {
  const outcome = whatHappensWhen("heading", (en) => en.replace(sentenceOfAHeading,
    M.chunkOpen + M.structuralChunk + " a heading nothing derived " + M.bodyOpen));
  assert.ok(/REFUSED: .*HEADING AND BODY DISAGREE/.test(outcome),
    `rewording the heading should have been refused; instead ${outcome}`);
});

/* 5. English in, TypeScript out — the headline. */
ok("changing one name in the sentence, and nothing else, changes the compiled TypeScript to match", () => {
  const m = FIX.enFromDisk.match(aBacktickedNameInASentence);
  assert.ok(m, "the fixture has no name quoted inside a sentence, so there is nothing to edit");
  const name = m[1];
  const p = path.join(TMP, "sentence-edit.en");
  fs.writeFileSync(p, FIX.enFromDisk.replace("`" + name + "`", "`" + name + "MutatedXY`"));
  const back = EN.compileFileEn(fs.readFileSync(p, "utf8"), index, { file: FIX.rel });
  assert.notEqual(back, FIX.onDisk, "the English was changed and the TypeScript did not change at all");
  assert.ok(back.includes(name + "MutatedXY"),
    `the new name "${name}MutatedXY" is missing from the compiled output`);
});

/* 6. The other direction, and the reason 5 is not a tautology. */
ok("changing a value in the payload alone leaves the TypeScript untouched, because the sentence overrules it", () => {
  const holes = [...FIX.enFromDisk.matchAll(aNameInAHole)];
  assert.ok(holes.length, "the fixture carries no name-shaped value in its payload to change");
  const h = holes[0][0];
  const outcome = whatHappensWhen("payload", (en) => en.replace(h, h.slice(0, -1) + "MutatedXY" + M.bodyOpen));
  assert.equal(outcome, "it compiled to exactly the same TypeScript",
    `changing the payload alone should have been overruled by the sentence; instead ${outcome}`);
});

/* 7. The dictionary, changed underneath a file that is otherwise untouched. */
ok("compiling against a changed dictionary is refused, not quietly compiled through", () => {
  const changed = EN.loadIndex(CORPUS);
  let entries = 0;
  for (const axis of ["narrow", "wide"]) {
    const words = changed._lzw && changed._lzw[axis] && changed._lzw[axis].words;
    if (!words) continue;
    for (const id of Object.keys(words)) {
      const w = words[id];
      if (typeof w.sym === "string" && w.sym.includes("import")) { w.sym = w.sym.replace("import", "IMPORTX"); entries++; }
    }
  }
  assert.ok(entries > 0, "no dictionary entry matched, so this control could not have fired");
  const outcome = whatHappensWhen("dictionary", (en) => en, changed);
  assert.ok(/^it was REFUSED/.test(outcome),
    `a changed dictionary should have been refused; instead ${outcome}`);
});

console.log(`\n${pass} assertions passed`);
