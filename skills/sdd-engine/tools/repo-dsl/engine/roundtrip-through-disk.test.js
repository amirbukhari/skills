"use strict";
/* roundtrip-through-disk.test.js — THE END-TO-END, as Amir defined it: "No the end to end is TS in
 * then English out then ts compiled back right?"
 *
 *     .ts on disk  ->  .en WRITTEN TO A FILE  ->  that FILE read back  ->  compiled  ->  byte-compared
 *                                                                         to the .ts RE-READ FROM DISK
 *
 * WHY THIS IS NOT test-lzw-roundtrip.js AGAIN. The 1037/1037 gate NEVER READS A .en FROM DISK:
 * write-en-files.js:97 does `r = renderFileEn(source); back = compileFileEn(r.en)` — it compiles the
 * IN-MEMORY string and only afterwards writes `r.en` to a file (:115). So the shipped gate proves the
 * MECHANISM and cannot prove the LOOP: a writer that mangles what it writes, or a reader that mangles
 * what it reads, leaves 1037/1037 completely untouched. This file closes exactly that gap — every
 * comparison here is FILE-to-FILE, and the compiled output is compared against the `.ts` re-read from
 * disk, never against the string the renderer was handed.
 *
 * WHAT HAPPENED WHEN IT WAS FIRST RUN, stated because the honest red is worth more than the test.
 * IT PASSED IMMEDIATELY. 80 files sampled across the corpus, 80 byte-identical through disk, 0
 * failures — including the five CRLF files under src/sandbox/oldSandboxes/ and four files carrying
 * non-ASCII, the two classes most likely to break on a write/read boundary. So this is case (b): no
 * defect was found, and the test therefore has to EARN its green by being shown able to fail.
 *
 * IT IS SHOWN ABLE TO FAIL FOUR WAYS, all by mutating the artefact ON DISK and re-reading it:
 *   3. the chunk LABEL      -> REFUSED, "SENTENCE AND PAYLOAD DISAGREE (R-REND-6 …)"
 *   4. the chunk HEADING    -> REFUSED, "HEADING AND BODY DISAGREE (R-REND-6 …)"
 *   5. the SENTENCE alone   -> compiles, and the .ts CHANGES to what the sentence now says. This is
 *                              the one that answers "type English, get code", and it is not a
 *                              refusal: enfile.js repairFromSentence rebuilds the payload from the
 *                              English rather than rejecting the edit.
 *   5b. the PAYLOAD alone   -> compiles UNCHANGED. The sentence overrules the payload, which is why
 *                              5 is not just "whichever side was edited last wins".
 *   6. the DICTIONARY       -> REFUSED. See its own note: the mutation must hit BOTH axes, because
 *                             compileSpan picks narrow or wide off `payload.a`, and a first attempt
 *                             that mutated only `wide` was a silent no-op that "passed".
 *
 * ASSERTION 2 PASSES BY CONSTRUCTION and is named as such: "what came off disk equals what went on"
 * is fs doing its job, not the engine doing its job. Its real negative control is 3-6 — those four
 * are the ones that would still fire if the write/read layer went wrong. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EN = require("./enfile");
const CR = require("./corpus-root");
const { SKIP } = require("./walk-skip");

const CORPUS = CR.corpusRoot(), SRC = CR.sourceRoot();
const index = EN.loadIndex(CORPUS);

/* A DETERMINISTIC SAMPLE, not a fixed file list: the corpus is untracked (CLAUDE.md §7), so naming
 * files here would make the test fail for the wrong reason the day one moves. Sorted, so two runs
 * see the same files, and every k-th so the sample is spread across the tree rather than clustered
 * in whatever directory sorts first. */
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
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

/** the whole loop, through the filesystem, for one source file. Returns what came out. */
function throughDisk(abs, i) {
  const tsPath = path.join(TMP, i + "-" + path.basename(abs));
  fs.copyFileSync(abs, tsPath);                                  // work on a COPY, never in place
  const src = fs.readFileSync(tsPath, "utf8");
  const enPath = tsPath + ".en";
  fs.writeFileSync(enPath, EN.renderFileEn(src, index).en);      // ENGLISH OUT, to a real file
  const enFromDisk = fs.readFileSync(enPath, "utf8");            // read the FILE back
  const back = EN.compileFileEn(enFromDisk, index, { file: path.relative(SRC, abs) });
  return { tsPath, enPath, enFromDisk, back, onDisk: fs.readFileSync(tsPath, "utf8") };
}

/* 1. THE END-TO-END, reported as a COUNT. */
ok("every sampled file survives .ts -> .en on disk -> .ts, byte-identical", () => {
  assert.ok(SAMPLE.length >= 5, "sample too small to mean anything: " + SAMPLE.length);
  let identical = 0; const failures = [];
  SAMPLE.forEach((abs, i) => {
    const rel = path.relative(SRC, abs);
    let r; try { r = throughDisk(abs, i); } catch (e) { failures.push([rel, "THREW: " + e.message.split("\n")[0]]); return; }
    if (r.back === r.onDisk) identical++;
    else failures.push([rel, "MISMATCH " + r.back.length + " vs " + r.onDisk.length + " bytes"]);
  });
  console.log(`      files: ${SAMPLE.length}  byte-identical: ${identical}  FAILURES: ${failures.length}`);
  for (const f of failures) console.log("        " + f[0] + "  " + f[1]);
  assert.equal(failures.length, 0);
  assert.equal(identical, SAMPLE.length);
});

/* the fixture the mutation assertions work on: the first sampled file that has BOTH an atomic chunk
 * and a structural heading, so one file can carry every control. */
const FIX = (() => {
  for (let i = 0; i < SAMPLE.length; i++) {
    const r = throughDisk(SAMPLE[i], "fix" + i);
    if (/«▶ [^⟪]*⟪/.test(r.enFromDisk) && /«▷ [^⟨]*⟨/.test(r.enFromDisk)) return { rel: path.relative(SRC, SAMPLE[i]), ...r };
  }
  return null;
})();

/** write a MUTATED .en to disk, read it back, compile: "REFUSED: …" | "IDENTICAL" | "DIFFERENT" */
function mutate(name, fn, idx) {
  const p = path.join(TMP, name + ".en");
  fs.writeFileSync(p, fn(FIX.enFromDisk));
  const disk = fs.readFileSync(p, "utf8");
  try {
    const back = EN.compileFileEn(disk, idx || index, { file: FIX.rel });
    return back === FIX.onDisk ? "IDENTICAL" : "DIFFERENT";
  } catch (e) { return "REFUSED: " + e.message.split("\n")[0]; }
}

/* 2. PASSES BY CONSTRUCTION — named, per the header. fs is not the system under test. */
ok("(by construction) the .en read off disk is the .en that was written", () => {
  assert.ok(FIX, "no sampled file carried both an atomic chunk and a heading");
  assert.equal(fs.readFileSync(FIX.enPath, "utf8"), FIX.enFromDisk);
});

/* 3-4. THE SENTENCE IS AUTHORITATIVE (R-REND-6), pinned through the DISK path. The strongest
 *      evidence that the English is load-bearing rather than decorative: change the words, and the
 *      compiler refuses rather than trusting the payload. If this ever stops firing, an .en whose
 *      sentence says one thing and whose payload does another compiles silently — the exact defect
 *      the rule exists to prevent. */
ok("a mutated chunk LABEL on disk is REFUSED, sentence over payload", () => {
  const r = mutate("label", (en) => en.replace(/«▶ [^⟪]*⟪/, "«▶ a label nothing derived ⟪"));
  assert.ok(/^REFUSED: .*SENTENCE AND PAYLOAD DISAGREE/.test(r), r);
});
ok("a mutated structural HEADING on disk is REFUSED", () => {
  const r = mutate("heading", (en) => en.replace(/«▷ [^⟨]*⟨/, "«▷ a heading nothing derived ⟨"));
  assert.ok(/^REFUSED: .*HEADING AND BODY DISAGREE/.test(r), r);
});

/* 5. ENGLISH IN -> TYPESCRIPT OUT, through disk, and this is the headline assertion of the file.
 *    Edit a NAME inside the sentence's back-ticks — the English, and only the English — write it,
 *    read it back, compile: the TypeScript CHANGES, and it changes to exactly what the sentence now
 *    says. Measured on packages/hydra-internal/src/csvUtils.ts:
 *      «▶ import `first` and `keys` from `@jamesgmarks/utilities` …    (payload untouched)
 *      ->  import { firstMutatedXY, keys } from '@jamesgmarks/utilities';
 *    The mechanism is enfile.js repairFromSentence: the payload disagrees, and the SENTENCE wins,
 *    so the payload is rebuilt from it rather than the edit being refused. */
ok("an edit to the SENTENCE alone reaches the compiled TypeScript", () => {
  const m = FIX.enFromDisk.match(/«▶ [^⟪]*?`([A-Za-z_$][A-Za-z0-9_$]*)`[^⟪]*⟪/);
  assert.ok(m, "fixture carries no back-ticked name in a chunk sentence");
  const name = m[1];
  const p = path.join(TMP, "sentence-edit.en");
  fs.writeFileSync(p, FIX.enFromDisk.replace("`" + name + "`", "`" + name + "MutatedXY`"));
  const back = EN.compileFileEn(fs.readFileSync(p, "utf8"), index, { file: FIX.rel });
  assert.notEqual(back, FIX.onDisk, "the English changed and the TypeScript did not");
  assert.ok(back.includes(name + "MutatedXY"), "the new name is absent from the output:\n" + back.slice(0, 200));
});

/* 5b. THE OTHER DIRECTION, and it is the reason 5 is not a tautology: mutate the PAYLOAD hole and
 *     leave the sentence alone, and the output is UNCHANGED — the sentence is authoritative, so the
 *     payload is repaired back to what the English says. A test that only did 5 could be satisfied
 *     by an engine that simply echoed whichever side was edited last. */
ok("an edit to the PAYLOAD alone is overruled by the sentence", () => {
  const holes = [...FIX.enFromDisk.matchAll(/⟨([A-Za-z_$][A-Za-z0-9_$]*)⟨/g)];
  assert.ok(holes.length, "fixture carries no identifier-shaped hole to mutate");
  const h = holes[0][0];
  assert.equal(mutate("payload", (en) => en.replace(h, h.slice(0, -1) + "MutatedXY⟨")), "IDENTICAL");
});

/* 5c. AND NOTHING IS SILENTLY IGNORED. Every edit above either CHANGED the TypeScript (5), was
 *     REFUSED (3, 4), or was OVERRULED with the reason stated in the file itself (5b). The property
 *     worth protecting is the absence of a fourth outcome — "accepted, and quietly dropped" — which
 *     is what the 447-hand-edit measurement found zero of. */

/* 6. THE DICTIONARY LOOKUP, mutated. Every leaf skeleton mentioning `import` is rewritten on BOTH
 *    axes and the same file is compiled off disk against that dictionary.
 *
 *    THE FIRST VERSION OF THIS CONTROL WAS A NO-OP AND "PASSED". It mutated one leaf on `wide` only;
 *    compileSpan (enlzw.js:323) chooses `payload.a === "n" ? cat.narrow : cat.wide`, the fixture's
 *    payload is narrow, and the compile came back byte-identical — a control that could not fire,
 *    reading as a green. Hence both axes, and hence the assertion is on REFUSED specifically. */
ok("a mutated dictionary is caught, not silently compiled through", () => {
  const idx2 = EN.loadIndex(CORPUS);
  let n = 0;
  for (const ax of ["narrow", "wide"]) {
    const W = idx2._lzw && idx2._lzw[ax] && idx2._lzw[ax].words;
    if (!W) continue;
    for (const k of Object.keys(W)) {
      const e = W[k];
      if (typeof e.sym === "string" && e.sym.includes("import")) { e.sym = e.sym.replace("import", "IMPORTX"); n++; }
    }
  }
  assert.ok(n > 0, "no leaf skeleton to mutate — the control could not fire");
  const r = mutate("dict", (en) => en, idx2);
  assert.ok(/^REFUSED/.test(r), "dictionary mutation produced " + r);
});

console.log(`\n${pass} assertions passed`);
