"use strict";
/**
 * synth-corpus.js — BUILD, MINE AND READ A THROWAWAY CORPUS. The harness under every synthetic
 * structural test.
 *
 * WHY A SYNTHETIC CORPUS AT ALL, in Amir's framing (2026-09-03): if LZW is discovering repeated AST
 * sequences and assigning each learned pattern a controlled-English token, then the test corpus has
 * to exercise STRUCTURAL COMPOSITION AT EVERY AST SCALE. The real corpus cannot do that. It is one
 * codebase with one house style, so its coverage of the AST is whatever hydra happens to contain,
 * and — the reason the specimen tests were retired — a target sentence about an invoice confounds
 * AST coverage with domain semantics. A production that has learned the word "invoice" can satisfy
 * a semantic target while spanning nothing. `export const one = 1;` cannot be satisfied that way.
 *
 * WHY IT IS MINED FRESH RATHER THAN READ THROUGH THE REAL CATALOG. The dictionary is the subject.
 * Rendering a synthetic file against the hydra catalog would ask "does hydra's vocabulary happen to
 * cover this", which is a question about hydra. Mining the fixture asks "given exactly these six
 * programs, what patterns does the miner find and what English does it assign" — which is a
 * question about the ENGINE, and it is the one being asked.
 *
 * WHY IT IS SAFE. The real corpus is never touched, read or written. Both roots are repointed at a
 * fresh temp directory via SOURCE= and CORPUS= — one env change per root, which is exactly the
 * interface corpus-root.js exists to provide (Amir: "if you need to make more than 1 file change to
 * alter the directory we are pointing at then we have done this wrong"). The miner is spawned as a
 * child process rather than required, because it resolves its roots once at module load and this
 * harness builds several corpora per run.
 *
 * THE OBSERVABLES, and why these and not the English alone. Amir's mutation table is written in
 * terms of what must and must not change — "only the literal slot changes", "AST-pattern token
 * changes", "folder AST changes; code AST does NOT". Those are claims about the PATTERN and its
 * SLOTS separately, so comparing rendered sentences would not decide them: two different patterns
 * can render the same sentence, and one pattern with different fills renders different sentences.
 * So `observe()` reports, per chunk:
 *      syms   the SKELETON of the dictionary word behind it, expanded through composites to a
 *             sequence of leaf skeletons. This is the "AST-pattern token" the table talks about.
 *             Keyed by skeleton text and never by word id, because ids are array indices and every
 *             re-mine renumbers them (R-PAY-6) — an id comparison across two mines is meaningless.
 *      slots  the per-site hole fills from the payload.
 *      label  the controlled English actually emitted.
 * A mutation then has a decidable expectation: same syms + different slots, or different syms.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const EN = require("./enfile");
const PAY = require("./payload");

const REPO_DSL = path.resolve(__dirname, "..");
const MINER = path.join(REPO_DSL, "build-lzw-generators.js");

const OPEN = "«", CLOSE = "»", GEN = "▶", GEN_NEST = "▷";
const PAY_OPEN = "⟪", PAY_CLOSE = "⟫", BODY_OPEN = "⟨";

/* temp roots live under one parent per process so a crashed run leaves one directory to sweep and
 * never anything inside the real corpus. */
const TMP_PARENT = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-synth-"));
let seq = 0;

/* SWEPT ON EXIT, and only ever this one directory. `rm -rf` in a test harness is how a corpus gets
 * deleted by accident, so the path removed is not computed from anything a caller passes: it is the
 * mkdtemp result captured above, inside the OS temp dir, created by this process. Kept on request
 * with SDD_KEEP_SYNTH=1 when a fixture needs inspecting after a failure. */
process.on("exit", () => {
  if (process.env.SDD_KEEP_SYNTH === "1") { console.error("[synth-corpus] fixtures kept at " + TMP_PARENT); return; }
  try { fs.rmSync(TMP_PARENT, { recursive: true, force: true }); } catch (_) { /* best effort */ }
});

/** write a { "src/alpha/one.ts": "…" } map into a fresh root. Returns the root. */
function writeCorpus(files, name) {
  const root = path.join(TMP_PARENT, (name || "corpus") + "-" + (++seq));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

/** expand a word to the sequence of LEAF SKELETONS it is built from. The composition itself. */
function symsOf(axisCat, id, seen) {
  const w = axisCat.words[String(id)] || axisCat.words[id];
  if (!w) return ["<unknown word " + id + ">"];
  if (w.sym !== undefined) return [w.sym];
  if (w.m) {
    const g = seen || new Set();
    if (g.has(id)) return ["<cycle>"];
    g.add(id);
    return [...symsOf(axisCat, w.m[0], g), ...symsOf(axisCat, w.m[1], g)];
  }
  return ["<wordless " + id + ">"];
}

/* walk the rendered .en and report every chunk with its pattern and slots. Depth-tracked so a
 * structural chunk and its children are reported separately and at their real depths — the
 * recursive composition is the subject, so flattening it away would erase the measurement. */
function observeEn(en, cat) {
  const out = [];
  const walk = (s, depth) => {
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== OPEN) continue;
      const mark = s[i + 1];
      /* find this chunk's matching close, counting depth so a child's » cannot end the parent */
      let d = 0, end = -1;
      for (let j = i; j < s.length; j++) {
        if (s[j] === OPEN) d++;
        else if (s[j] === CLOSE) { d--; if (d === 0) { end = j; break; } }
      }
      if (end < 0) break;
      const body = s.slice(i, end + 1);

      if (mark === GEN) {
        const a = body.lastIndexOf(PAY_OPEN), b = body.lastIndexOf(PAY_CLOSE);
        const label = (a > 0 ? body.slice(2, a) : body.slice(2, -1)).trim();
        let syms = [], slots = [], axis = null, wid = null;
        if (a > 0 && b > a) {
          try {
            const o = PAY.decode(body.slice(a + 1, b));
            axis = o.a; wid = o.w; slots = o.h.slice();
            syms = symsOf(o.a === "w" ? cat.wide : cat.narrow, o.w);
          } catch (e) { syms = ["<undecodable payload: " + e.message + ">"]; }
        }
        out.push({ kind: "atomic", depth, label, axis, wordId: wid, syms, slots });
      } else if (mark === GEN_NEST) {
        const bo = body.indexOf(BODY_OPEN);
        out.push({ kind: "structural", depth, label: bo > 0 ? body.slice(2, bo).trim() : "", syms: [], slots: [] });
        if (bo > 0) walk(body.slice(bo + 1, -2), depth + 1);
      }
      i = end;
    }
  };
  walk(en, 0);
  return out;
}

/**
 * build({ files, name, env }) — write, mine, and hand back a reader.
 *   files  { "src/alpha/one.ts": "export const one = 1;\n", … }
 *   env    extra environment for the miner (MIN_SKEL, MIN_COUNT, MAXWIN …)
 * Throws if the miner fails, with its stderr — a fixture that did not mine must never be read as
 * a fixture with no patterns (§8B: "not configured" is a state, "configured wrong" is a bug).
 */
function build({ files, name, env } = {}) {
  const root = writeCorpus(files, name);
  const res = spawnSync(process.execPath, [MINER], {
    cwd: REPO_DSL, encoding: "utf8",
    env: { ...process.env, SOURCE: root, CORPUS: root, ...(env || {}) },
  });
  if (res.status !== 0) {
    throw new Error("synth-corpus: the miner failed on " + root + "\n" + (res.stderr || res.stdout || "(no output)"));
  }
  const catPath = path.join(root, "sen", "catalog", "generators-lzw.json");
  if (!fs.existsSync(catPath)) throw new Error("synth-corpus: no catalog written at " + catPath);
  const cat = JSON.parse(fs.readFileSync(catPath, "utf8"));
  const index = EN.loadIndex(root);

  const api = {
    root, cat, index, minerOutput: (res.stdout || "") + (res.stderr || ""),
    files: Object.keys(files),
    /** render one file. `byteIdentical` is always reported, never assumed. */
    render(rel) {
      const abs = path.join(root, rel);
      const source = fs.readFileSync(abs, "utf8");
      const r = EN.renderFileEn(source, index);
      let back = null, err = null;
      try { back = EN.compileFileEn(r.en, index); } catch (e) { err = e.message; }
      return { rel, source, en: r.en, stats: r.stats, byteIdentical: back === source, compileError: err };
    },
    /** every chunk in one file, with its pattern skeleton and its slots. */
    observe(rel) { return observeEn(api.render(rel).en, cat); },
    /** the controlled English of every chunk in one file, outermost first. */
    labels(rel) { return api.observe(rel).map((c) => c.label); },
    /** the distinct leaf skeletons the miner learned over the whole fixture. */
    leafSkeletons(axis) {
      const a = cat[axis || "narrow"];
      return Object.keys(a.leaf || {});
    },
    counts(axis) { return (cat[axis || "narrow"] || {}).counts || {}; },
    /** byte-identity over the whole fixture — the floor, asserted by every caller. */
    allByteIdentical() {
      const bad = [];
      for (const rel of api.files) { const r = api.render(rel); if (!r.byteIdentical) bad.push(rel + (r.compileError ? " (" + r.compileError + ")" : "")); }
      return { ok: bad.length === 0, bad, total: api.files.length };
    },
  };
  return api;
}

module.exports = { build, writeCorpus, observeEn, symsOf, TMP_PARENT };
