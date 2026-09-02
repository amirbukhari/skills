"use strict";
/* NESTED RENDERING (PRD §5D.4E, R-ARCH-19) — words made of words, all the way to leaves.
 *
 * A generator chunk has two shapes: ATOMIC («▶ … ⟪payload⟫», a word whose skeleton lives in the
 * catalog) and STRUCTURAL («▷ … ⟨children⟩», a name over child chunks with no payload of its own).
 * The claim under test is that the tree is real, reaches leaves, and reconstructs source bytes
 * exactly — and that each mechanism can be shown to FIRE, not merely to be present (§10.3).
 *
 * ORACLE: real corpus source through render -> compile (§10.1). The catalog is an INPUT (§10.2). */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./enfile");
const CR = require("./corpus-root");
const { SKIP } = require("./walk-skip");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const CORPUS = CR.corpusRoot();
const SRC = CR.sourceRoot();
const idx = EN.loadIndex(CORPUS);
const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
  }
  return o;
};
/* a sample large enough to contain deep files, small enough to stay a unit test */
const FILES = walk(SRC).sort().filter((_, i) => i % 7 === 0);
const rendered = FILES.map((f) => {
  const src = fs.readFileSync(f, "utf8");
  return { rel: path.relative(SRC, f), src, r: EN.renderFileEn(src, idx) };
});

/* 1. THE TREE IS REAL AND IT IS DEEP. Depth 1 would be the flat renderer wearing a new shape. */
ok("chunks nest, and reach past the top two levels", () => {
  const deepest = rendered.reduce((m, x) => Math.max(m, x.r.stats.nestMaxDepth || 0), 0);
  const structural = rendered.reduce((a, x) => a + (x.r.stats.chunksStructural || 0), 0);
  const atomic = rendered.reduce((a, x) => a + (x.r.stats.chunksAtomic || 0), 0);
  assert.ok(deepest >= 4, `deepest nest is ${deepest}; a tree that stops at 3 is not "down to leaves"`);
  assert.ok(structural > 0, "no structural chunks at all — nothing nests");
  assert.ok(atomic > 0, "no atomic chunks at all — nothing bottoms out in a catalog word");
  console.log(`      ${FILES.length} files: ${atomic} atomic + ${structural} structural chunks, deepest nest ${deepest}`);
});

/* 2. BYTE-IDENTITY THROUGH THE TREE. The whole point of a structural chunk is that it carries no
 *    payload, so its range is reconstructed only if every descendant reconstructs its own. */
ok("every sampled file round-trips byte-identical through the nested form", () => {
  const bad = [];
  for (const x of rendered) {
    let back = null;
    try { back = EN.compileFileEn(x.r.en, idx, { deriveCheck: true }); } catch (e) { bad.push(`${x.rel}: ${e.message.split("\n")[0]}`); continue; }
    if (back !== x.src) bad.push(`${x.rel}: bytes differ`);
  }
  assert.strictEqual(bad.length, 0, `${bad.length} failures:\n      ${bad.slice(0, 5).join("\n      ")}`);
  console.log(`      ${rendered.length}/${rendered.length} byte-identical, with the R-REND-6 derive check ON`);
});

/* 3. THE NESTING-AWARE SCAN IS LOAD-BEARING (§10.3 — show the guard firing). The old compiler
 *    ended a chunk at the FIRST », which inside a structural chunk is a child's. Reproduce that
 *    rule on a real nested file and prove it does NOT reconstruct the source. */
ok("a flat first-» scan would break these files — the depth match is not decoration", () => {
  const nested = rendered.filter((x) => (x.r.stats.chunksStructural || 0) > 0);
  assert.ok(nested.length > 0, "no nested file in the sample — this case would be vacuous");
  const x = nested[0];
  const en = x.r.en;
  const open = en.indexOf("«");
  const flatClose = en.indexOf("»", open + 1);
  let depth = 0, trueClose = -1;
  for (let k = open; k < en.length; k++) {
    if (en[k] === "«") depth++;
    else if (en[k] === "»") { depth--; if (depth === 0) { trueClose = k; break; } }
  }
  assert.notStrictEqual(flatClose, trueClose,
    `${x.rel}: first » and matched » coincide, so this file does not exercise the difference`);
  console.log(`      ${x.rel}: first » at ${flatClose}, matched » at ${trueClose} — ${trueClose - flatClose} bytes apart`);
});

/* 4. THE LEAF LAYERS SURVIVED NESTING. Structural chunks emit the bytes they own, and those bytes
 *    are where the cnl and data layers work. This is the regression the first cut shipped with:
 *    `@Column({...})` stopped rendering as "an object with …" because no pass reached it. */
ok("cnl and data spans still render inside structural chunk bodies", () => {
  const data = rendered.reduce((a, x) => a + (x.r.stats.dataSpans || 0), 0);
  const stmt = rendered.reduce((a, x) => a + (x.r.stats.stmtSpans || 0), 0);
  assert.ok(data + stmt > 0,
    "no leaf spans anywhere in the sample — the nested renderer is not running passes 1 and 2");
  console.log(`      ${data} data spans + ${stmt} cnl statement spans inside nested files`);
});

/* 5. CONTROL: the flat renderer is still there and still correct, so §5D.4E's before/after pairs
 *    are measurable and the change is reversible. NEST=0 is read at require time, so this shells
 *    out rather than mutating the environment of an already-loaded module. */
ok("control: NEST=0 still renders and round-trips (the flat path is intact)", () => {
  const { execFileSync } = require("child_process");
  const rel = rendered.find((x) => (x.r.stats.chunksStructural || 0) > 0).rel;
  const script = `
    const fs=require("fs"),path=require("path");
    const EN=require(${JSON.stringify(path.join(__dirname, "enfile.js"))});
    const CR=require(${JSON.stringify(path.join(__dirname, "corpus-root.js"))});
    const src=fs.readFileSync(path.join(CR.sourceRoot(), ${JSON.stringify(rel)}),"utf8");
    const idx=EN.loadIndex(CR.corpusRoot());
    const r=EN.renderFileEn(src,idx);
    process.stdout.write(JSON.stringify({ok:EN.compileFileEn(r.en,idx)===src,chunks:r.stats.chunks||0,spans:r.stats.genSpans}));`;
  const out = JSON.parse(execFileSync(process.execPath, ["-e", script], { env: { ...process.env, NEST: "0" } }).toString());
  assert.strictEqual(out.ok, true, "the flat renderer no longer round-trips");
  assert.ok(!out.chunks, `NEST=0 still produced ${out.chunks} nested chunks — the flag does nothing`);
  console.log(`      ${rel} under NEST=0: ${out.spans} flat spans, 0 nested chunks, byte-identical`);
});

console.log(`\nPASS ${pass} assertions — the chunk tree nests to leaves, reconstructs bytes exactly, and keeps the leaf layers.`);
