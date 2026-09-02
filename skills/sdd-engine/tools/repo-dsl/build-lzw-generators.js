"use strict";
/**
 * build-lzw-generators.js — mine the RECURSIVE WORD DICTIONARY (Amir's LZW-as-primary design).
 *
 * Replaces the FLAT window-cluster catalog (build-generators.js -> generators.json, PRD §4A
 * defect) with an LZW dictionary run over per-statement CANONICAL SYMBOLS. Output is a word
 * GRAPH: leaf words (one statement key) and composite words (m:[prefixWord, appendedLeaf])
 * — generators referencing generators, with emergent depth d. The word-graph fields (len/d/sym/m)
 * are the canonical short forms shared verbatim by the writer (engine/wordlzw.js) and the reader
 * (engine/enlzw.js); see wordlzw.js's header for why they are abbreviated.
 *
 * --json: emit an NDJSON PROGRESS STREAM on stdout (one document per line), prose to stderr, for a
 * UI to consume live. See engine/progress.js. Without the flag nothing changes.
 *   node build-lzw-generators.js --json
 *
 * Corpus is READ-ONLY (walked, never written). The catalog is written into the SKILLS REPO
 * (catalog/generators-lzw.json), NOT under hydra-source — the SOURCE-PROTECTED generators.json
 * (s1's live flat catalog) is left untouched. Deterministic; zero model calls.
 */
const fs = require("fs");
const path = require("path");
const AC = require("./engine/artifact-contract");
const ts = require("typescript");
const G = require("./engine/generators");
const W = require("./engine/wordlzw");
const CR = require("./engine/corpus-root");
const PROGRESS = require("./engine/progress");

const CORPUS = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root: the .ts tree
const OUT = AC.pathFor("generators-lzw", CORPUS); // CORPUS tree — the engine tree holds no corpus data (PRD §8B)
// MUST match write-en-files.js SKIP exactly. When it did not (this set excluded "tests"), the
// dictionary was mined over 956 files but applied to 1037, so every recurring body in a test file
// had no word by construction — 696 of 937 un-collapsed bodies traced to that one mismatch.
const { SKIP } = require("./engine/walk-skip");   // the ONE canonical corpus walk-skip set
/* --json: NDJSON on stdout, prose on stderr. Unchanged for every existing caller (engine/progress.js). */
const prog = PROGRESS.open({ step: "mine" });
const say = prog.say;
// MIN_SKEL = minimum skeleton bytes per statement before a word may be promoted. It is the
// readability dial, not a correctness one: every span is byte-gated at emission regardless.
// Measured over the full corpus (byte-identity 1037/1037 at every point):
//   12 -> filesUsing 649, netStatementReduction 5187   (was the default; too strict)
//    8 -> filesUsing 715, netStatementReduction 6920   <- the knee, and the default
//    6 -> filesUsing 719, netStatementReduction 7123
//    4 -> filesUsing 732, netStatementReduction 7209, but English coverage jumps 35.9% -> 45.4%
//         by promoting near-trivial skeletons, which makes the .en noisier to read.
// Lower it via MIN_SKEL= if more collapse is wanted; it cannot break byte-identity.
//
// MIN_COUNT = how many times a window must recur before it may become a word. It was frozen at 2,
// which made a WHOLE-FILE word impossible by construction: a file's own shape occurs exactly once,
// so no number of passes could ever admit it. At 1 a window may become a word on a single
// occurrence. Measured over the full corpus (byte-identity 1037/1037 at both settings):
//   2 -> filesUsing 916, net 11,180, dict 1.50 MB, .en 4,598,270 B, 0 whole-file words
//   1 -> filesUsing 929, net 15,388, dict 11.56 MB, .en 4,830,829 B, 74 whole-file words
// It is an ECONOMIC dial, not a correctness one: every span is byte-gated at emission regardless.
// NOTE: at MIN_COUNT=1 the binding constraint becomes MAXWIN, not recurrence.
//
// MAXWIN = longest window the miner will enumerate, in statements. Arbitrary bound, not a
// correctness gate. Swept at MIN_COUNT=1 / MIN_SKEL=8, byte-identity 1037/1037 at every value:
//   16 -> maxDepth 15 (pinned at MAXWIN-1), calls 4850, net 15,388, dict 11.02 MB, .en 4,830,829
//   32 -> maxDepth 31 (still pinned),       calls 4789, net 15,448, dict 12.35 MB, .en 4,829,397
//   64 -> maxDepth 57 (NOT pinned - ceiling found), calls 4782, net 15,455, dict 12.58 MB,
//         .en 4,829,217   <- the default; longest stream in the corpus is 60 statements
//  128 -> byte-for-byte identical to 64. Saturated; higher values are wasted work.
// RE-MEASURED 2026-08-31 — THE TWO LINES ABOVE ARE STALE. The corpus grew: its longest fold stream
// is now 77 statements (src/hydra-api/invoice.ts), with 5 streams >= 64. So 64 DOES pin, and
// maxDepth 63 == MAXWIN-1 is this file's own signature of pinning, not a found ceiling.
//  128 -> maxDepth 76 (= 77-1, so here the ceiling really is the corpus), +171 composites per axis,
//         4.2s mine. Rendered against it: byte-identity 1037/1037 and review surface 16,889 from
//         S=33,918 (50.2%) -- IDENTICAL TO 64, to the statement. The deeper words exist; the render
//         does not use them.
// So the default stays 64, for a different reason than the one written above: not "past the corpus
// ceiling" but "past the point where more ceiling buys any review surface". Re-measure the stream
// lengths, not the depth, if this is ever revisited -- depth pinned at MAXWIN-1 tells you only that
// the bound bound, never whether relaxing it would help.
// Mine wall-clock was 1-2s at every value, so cost was never the constraint.
// WHOLE-FILE WORDS DID NOT MOVE: 74/1037 at every value. MAXWIN was never what blocked them.
// AMIR'S DECISION, 2026-09-01 — THE CEILING IS GONE, AND IT WAS FREE TO REMOVE.
// MAXWIN was an arbitrary bound, and the sweep above concluded "the default stays 64" on the
// ground that a higher ceiling bought no review surface. That conclusion was measured against the
// OLD renderer, which refused every whole-run word unconditionally (the original R-MINE-7). With
// the LIFT now conditional (R-ARCH-17, §5D.4A) a whole-file word is something the renderer will
// actually emit, so the ceiling had to be re-examined rather than inherited.
//
// COST OF REMOVING IT: measured as zero. The K loop in buildSaturated is bounded by the LONGEST
// STREAM, not by MAXWIN, so windows enumerated are 152,844 at 64, 153,015 at 128, and 153,015 at
// both 256 and 1024 — identical, because the longest stream in the corpus is 77 statements. A
// ceiling below 77 does not save work; it only forbids words.
// The default is now effectively unbounded. Set MAXWIN explicitly to restore a ceiling.
const MIN_COUNT = +(process.env.MIN_COUNT || 1), MIN_SKEL = +(process.env.MIN_SKEL || 8), MAXWIN = +(process.env.MAXWIN || 100000);

function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
function blocks(sf) { const out = []; const visit = (n) => { if (ts.isBlock(n) || ts.isSourceFile(n)) { if (n.statements.length) out.push([...n.statements]); } ts.forEachChild(n, visit); }; visit(sf); return out; }

/* Per-block: maximal runs of foldable statements -> per-statement symbol streams (one per axis).
 * A statement whose parts don't refill exactly (generalStmtParts === null) splits the run. */
function symbolStreams(sf, wide) {
  const streams = [];
  for (const stmts of blocks(sf)) {
    let cur = [];
    for (const st of stmts) {
      const p = G.isFoldable(st) ? G.generalStmtParts(st, sf, wide) : null;
      if (!p) { if (cur.length) { streams.push(cur); cur = []; } continue; }
      cur.push(G.keyOf(p));
    }
    if (cur.length) streams.push(cur);
  }
  return streams;
}

const files = walk(SRC);
prog.start({ totalFiles: files.length, source: SRC, corpus: CORPUS, out: OUT,
             constants: { MIN_COUNT, MIN_SKEL, MAXWIN } });
const narrowStreams = [], wideStreams = [];
let parsed = 0;
/* The mine has genuinely distinct stages with different costs, and a UI showing one bar for all of
 * them is showing a bar that stalls. They are named so a panel can label what it is waiting on. */
prog.phase({ name: "parse", state: "begin", totalFiles: files.length });
for (const abs of files) {
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }
  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const n0 = narrowStreams.length, w0 = wideStreams.length;
  for (const s of symbolStreams(sf, false)) narrowStreams.push(s);
  for (const s of symbolStreams(sf, true)) wideStreams.push(s);
  parsed++;
  prog.file({ rel: path.relative(SRC, abs), done: parsed, total: files.length,
              narrowStreams: narrowStreams.length - n0, wideStreams: wideStreams.length - w0 });
}
prog.phase({ name: "parse", state: "end", parsed, narrowStreams: narrowStreams.length, wideStreams: wideStreams.length });

/* Build + promote each axis, then serialize a render-friendly graph keyed on symbol STRINGS. */
function buildAxis(streams, axis) {
  /* `minCount` here is INERT — buildSaturated ignores it (measured; see the note at its head).
   * It is kept, not dropped, so that if construction is ever gated on recurrence again this call
   * site already says which threshold it means. R-MINE-1 binds on the NEXT line only. */
  const model = W.buildSaturated(streams, { maxWin: MAXWIN, minCount: MIN_COUNT });
  const prom = W.promote(model, { minCount: MIN_COUNT, minSkelPerStmt: MIN_SKEL, skelBytesOf: G.skelBytes, saturated: true });
  // serialize: words{}, leaf{sym->wordId}, ext{prefixWordId|appendedSym -> wordId}.
  // promote() already emits the canonical word-graph fields (len/d/sym/m), so this is a straight
  // projection — no field renaming — keeping only the fields the on-disk catalog carries.
  const words = {}, leaf = {}, ext = {};
  let maxDepth = 0, composites = 0, edges = 0;
  for (const idStr in prom.words) {
    const w = prom.words[idStr];
    if (w.len === 1) {
      words[w.id] = { len: 1, d: w.d, sym: w.sym };
      leaf[w.sym] = w.id;
    } else {
      words[w.id] = { len: w.len, d: w.d, m: w.m }; // m=[prefixWordId, appendedLeafWordId]
      const appendedSym = model.symOfId[model.dict[w.m[1]].appended];
      ext[w.m[0] + "|" + appendedSym] = w.id;
      composites++; edges += 2;
      if (w.d > maxDepth) maxDepth = w.d;
    }
  }
  const leaves = Object.keys(leaf).length;
  return { axis, minCount: MIN_COUNT, minSkel: MIN_SKEL, counts: { leaves, composites, maxDepth, compositionEdges: edges, dictEntries: model.dict.length }, words, leaf, ext };
}

prog.phase({ name: "build", state: "begin", axis: "narrow", streams: narrowStreams.length });
const narrow = buildAxis(narrowStreams, "narrow");
prog.phase({ name: "build", state: "end", axis: "narrow", counts: narrow.counts });
prog.phase({ name: "build", state: "begin", axis: "wide", streams: wideStreams.length });
const wide = buildAxis(wideStreams, "wide");
prog.phase({ name: "build", state: "end", axis: "wide", counts: wide.counts });

// PROVENANCE — §8A protects this artifact, which is only meaningful if the next person can
// regenerate it rather than treat it as a mystery blob. Record the exact corpus and command.
/* STAMPED, not hand-written (PRD §8B). This producer used to assemble the header itself and
 * write it raw, so the artifact was BORN without `artifactVersion`, `generated` or `fingerprint`
 * — and every consumer that went through AC.load then refused it, which is exactly the
 * "missing fingerprint" failure. AC.stamp is the only way to publish: it takes the schema from
 * the registry, so the string cannot drift, and it fingerprints the body. `minedAt` stays in the
 * body as provenance; `generated` is the header date. Never re-introduce a raw write here. */
const catalog = AC.stamp("generators-lzw", {
  builtFrom: path.basename(SRC),
  minedAt: new Date().toISOString(),
  regenerate: `SOURCE=${path.resolve(SRC)} CORPUS=${path.resolve(CORPUS)} node build-lzw-generators.js`,
  tool: "build-lzw-generators.js",
  node: process.version,
  fileCount: parsed, gap: W.GAP, narrow, wide,
}, { corpus: path.resolve(SRC),
  /* §8B constants provenance. A swept value must not be indistinguishable from the settled one:
   * the three constants above were SETTLED by a sweep (see the measurements at the top of this
   * file), so an artifact mined at other values has to say so on itself. Only the ones that differ
   * from the default are recorded, so a default mine's body -- and its fingerprint -- is unchanged. */
  constants: { MIN_COUNT: { value: MIN_COUNT, default: 1 },
               MIN_SKEL:  { value: MIN_SKEL,  default: 8 },
               MAXWIN:    { value: MAXWIN,    default: 100000 } } });
prog.phase({ name: "write", state: "begin", out: OUT });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(catalog));
prog.phase({ name: "write", state: "end", out: OUT, bytes: fs.statSync(OUT).size });

say("=== build-lzw-generators ===");
say("corpus files parsed:", parsed);
say("NARROW  leaves:", narrow.counts.leaves, " composites:", narrow.counts.composites, " maxDepth:", narrow.counts.maxDepth, " dictEntries:", narrow.counts.dictEntries);
say("WIDE    leaves:", wide.counts.leaves, " composites:", wide.counts.composites, " maxDepth:", wide.counts.maxDepth, " dictEntries:", wide.counts.dictEntries);
say("wrote", OUT, "(" + (fs.statSync(OUT).size / 1e6).toFixed(2) + " MB)");

/* ---------- EXIT CODE — a mine that mined nothing must not report success ----------
 * This script exited 0 unconditionally, so `npm run mine` (and `sdd-run.js mine`, which passes the
 * child's code through unchanged) reported success for a run that walked zero files or promoted an
 * empty vocabulary. That is PRD §8B failure mode 2 in its most direct form — "the miner cannot mine
 * what it never sees, so the gap is reported as un-collapsed structure rather than as a walk
 * mismatch", the mismatch that once accounted for 696 of 937 un-collapsed bodies. A wrong SOURCE, a
 * SKIP set that swallowed the tree, or a corpus of only .d.ts files all land here, and all three
 * used to look like a clean mine that simply found little.
 *
 * R-PIN-6 is the same rule stated for artifacts: "a build that cannot walk the whole tree MUST fail
 * loudly or mark itself complete:false — it never emits a smaller plausible number."
 *
 * Measured before the change: parsed 1037, narrow 5684 leaves, wide 3238 leaves — exits 0. */
/* THE MINE'S GATE (R-UI-2), the counterpart of render's byte-identity: R-PIN-6 — "a build that
 * cannot walk the whole tree MUST fail loudly ... it never emits a smaller plausible number". A
 * mine that parsed nothing, or promoted an empty vocabulary, looks exactly like a clean mine that
 * found little, and that is the one thing a UI must not render as success. */
const problems = [];
if (!parsed) problems.push(`walked ${files.length} file(s) under ${path.resolve(SRC)} and parsed NONE`);
for (const ax of [narrow, wide]) {
  if (!ax.counts.leaves) problems.push(`${ax.axis} axis promoted 0 leaf words — an empty vocabulary`);
}
prog.gate({ name: "non-empty-mine", requirement: "R-PIN-6", pass: problems.length === 0,
            parsed, walked: files.length, problems });
prog.summary({ parsed, gap: W.GAP, out: OUT, bytes: fs.statSync(OUT).size,
               constants: { MIN_COUNT, MIN_SKEL, MAXWIN },
               narrow: narrow.counts, wide: wide.counts });
if (problems.length) {
  prog.error({ reason: "empty-mine", requirement: "R-PIN-6", problems });
  prog.end({ exitCode: 1, parsed, walked: files.length });
  console.error("\nMINE FAILED — refusing to report success:");
  for (const p of problems) console.error("  " + p);
  console.error(`  SOURCE ${path.resolve(SRC)}\n  CORPUS ${path.resolve(CORPUS)}`);
  console.error("  check the root (npm run roots) and the SKIP set before trusting any downstream number.");
  process.exit(1);
}
prog.end({ exitCode: 0, parsed, walked: files.length, out: OUT });
