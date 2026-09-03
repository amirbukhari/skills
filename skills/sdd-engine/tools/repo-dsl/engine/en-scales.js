"use strict";
/* en-scales.js — THE FOLDER AND PROGRAM SCALES (Amir, 2026-09-03; §5C, R-ARCH-15/16).
 *
 * WHAT WAS MISSING, AND WHY IT MATTERED MORE THAN IT LOOKED. The engine's unit was the FILE. The
 * largest thing it could name was one file, so Amir's actual ask — *"one word with the composition
 * of the words that made up that one word"* — was true at chunk and file scale and merely
 * aspirational above it. His approved target rendering opens *"Root src."* and *"Group alpha:"*;
 * those are a PROGRAM scale and a FOLDER scale, and neither existed.
 * `synth-composition.test.js` §5 asserted both by name and both failed.
 *
 * THE SHAPE IS THE ONE THE FILE RENDERER ALREADY USES, one and two levels up:
 *
 *     a FOLDER  is a word made of its FILES' words
 *     a PROGRAM is a word made of its FOLDERS' words
 *
 * which is the same recursion as a structural chunk being a word made of its children's words
 * (§5D.4E). Nothing new is invented here: a folder entry is `«▤ heading ⟨children⟩»` exactly as a
 * structural chunk is `«▷ heading ⟨children⟩»`, and the heading is DERIVED from the children rather
 * than stored, so R-REND-6's sentence authority extends up both scales for free.
 *
 * WHY IT IS A SEPARATE MODULE. `enfile.js` is 2,000 lines and is the file several sessions edit at
 * once — two lanes landed in it on 2026-09-03 alone, and the shared index makes that expensive
 * (CLAUDE.md §7). This module owns the two new scales and `enfile.js` re-exports it, so the file
 * renderer's hot function is untouched by this work. The dependency is one-way and lazy: the file
 * renderer knows nothing about folders.
 *
 * BYTE-IDENTITY IS INHERITED, NOT RE-ASSERTED — the same argument the structural branch makes. A
 * folder `.en` contains each file's `.en` VERBATIM inside a named entry; compiling it splits the
 * container and hands each block to `compileFileEn`, so per-file byte-exactness is exactly the
 * guarantee the file renderer already provides. The container adds structure and headings, and
 * headings are re-derived on compile rather than trusted. The round-trip contract is therefore a
 * MAP, not a byte stream — a folder is not one file and pretending it is would be the real error:
 *
 *     compileFolderEn(renderFolderEn(files).en)  ===  files      (rel -> source, every byte)
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not write prose. `synth-composition.test.js` §6 pins
 * Amir's exact target wording ("numeric constant one is 1", "compose five from alpha.one through
 * beta.three"), and that is per-site production work owned by another lane (§5C / spanProse). This
 * module composes the SCALES and reuses the label idiom already ruled for chunks — R-LANG-19's
 * heading-OVER-content, additive, never a replacement. Inventing a second prose policy here is how
 * two renderers start disagreeing about the same span.
 */
const path = require("path");

const OPEN = "«", CLOSE = "»";
const BODY_OPEN = "⟨", BODY_CLOSE = "⟩";
/* The three new scale markers. Distinct from ▶/▷ so a scan can never mistake a scale for a chunk,
 * and checked against every path segment below — a marker appearing in a filename would make the
 * container ambiguous, so it is refused rather than escaped. Escaping would work, but a path
 * containing ⟨ is a thing to look at, not a thing to quietly encode. */
const FILE_IN = "◈", FOLDER = "▤", PROGRAM = "▥";
/* THE NAME/LABEL SEPARATOR, and it exists because of a defect this file caught by being run.
 * The first version stored a folder entry as `«▤ <composed heading> ⟨body⟩»` and, on compile,
 * recovered the folder's NAME by slicing the heading up to its first ":". That makes the check
 * SELF-FULFILLING: edit the name inside the heading and the "derived" heading is rebuilt from the
 * edited name, so it agrees with itself and the guard cannot fire. It is the §16 class — a check
 * that cannot fire reports success no matter what is true — and it was invisible in review.
 * The fix is structural: a folder entry carries its NAME as its own field, ahead of ▸, exactly as
 * a file entry carries its `rel`. The label after ▸ is prose and is DERIVED from (name, children)
 * on compile, so nothing the check depends on comes from the thing being checked. */
const SEP = "▸";
const MARKERS = [OPEN, CLOSE, BODY_OPEN, BODY_CLOSE, FILE_IN, FOLDER, PROGRAM, SEP, "▶", "▷", "⟪", "⟫"];

function assertPathSafe(rel) {
  for (const m of MARKERS) {
    if (rel.includes(m)) {
      throw new Error("en-scales: refusing a path containing the scale marker " + JSON.stringify(m)
        + "\n  path: " + rel
        + "\n  The container would be ambiguous. Rename the file rather than escaping the marker.");
    }
  }
  return rel;
}

/* depth-aware close match — the container and the file .en both use «», so ONE depth counter
 * spans both and a file's own chunks can never end a container entry early. This is the same
 * argument (and the same bug, avoided) as enfile's matchClose. */
function matchClose(s, open) {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    const c = s[k];
    if (c === OPEN) depth++;
    else if (c === CLOSE) { depth--; if (depth === 0) return k; }
  }
  return -1;
}

/* THE WORDS OF A FILE — its depth-0 chunk labels, in order. This is what makes a folder "a word
 * made of its files' words" mechanical rather than metaphorical: the folder heading is composed
 * from exactly these strings, and re-composed from them on compile. A file that collapses to one
 * top-level word (R-ARCH-15) contributes one; a file that does not contributes what it has, which
 * is the honest input and is why the folder heading degrades gracefully instead of refusing. */
function topWordsOf(en) {
  const out = [];
  let i = 0;
  while (i < en.length) {
    const o = en.indexOf(OPEN, i);
    if (o < 0) break;
    const c = matchClose(en, o);
    if (c < 0) break;
    const chunk = en.slice(o + 1, c);
    const pay = chunk.indexOf("⟪"), body = chunk.indexOf(BODY_OPEN);
    let end = chunk.length;
    if (pay >= 0) end = Math.min(end, pay);
    if (body >= 0) end = Math.min(end, body);
    const label = chunk.slice(1, end).trim();
    if (label) out.push(label);
    i = c + 1;
  }
  return out;
}

/* ---- THE LABEL, at both new scales ------------------------------------------------------------
 * R-LANG-19 AS AMENDED, ONE AND TWO LEVELS UP. A chunk name is a HEADING OVER its content, never a
 * REPLACEMENT FOR it — the amendment that stopped ~23,000 concrete identifiers being deleted. The
 * same rule applies here by the same argument: a folder heading names the folder AND still carries
 * what its files say, so nothing a file established is lost by grouping it. A heading that replaced
 * its children would make the folder scale a summary, and a summary is the documentation generator
 * this engine just stopped being.
 *
 * DERIVED, NEVER STORED — which is what extends R-REND-6 up. `compileFolderEn` recomputes the
 * heading from the children it just compiled and compares; a hand-edited folder heading is
 * therefore a loud refusal, exactly as a hand-edited structural heading is, and for the identical
 * reason (a heading is computed from its children, so editing it alone is two pieces of English
 * contradicting each other with no principled winner — ruled 2026-09-03, §10). The edit stays
 * expressible at the file, one level down. */
function folderLabel(name, childWords) {
  const inner = childWords.filter(Boolean).join(", then ");
  return inner ? name + ": " + inner : name;
}
function programLabel(name, folderWords) {
  const inner = folderWords.filter(Boolean).join(", ");
  return inner ? "root " + name + ": " + inner : "root " + name;
}

/* ---- RENDER -----------------------------------------------------------------------------------
 * One recursion for both scales, because they ARE one recursion — the program is the folder case
 * with a different marker at the top. Written generally rather than for the two-level fixture: a
 * folder holding folders composes from its SUB-FOLDERS' words, so a deep tree works without a
 * third function. Amir's fixture is src/{alpha,beta,gamma}; the corpus is not that shallow.
 *
 * The tree is built from the path map rather than from the filesystem, so this is testable on a
 * fixture and never walks anything. SOURCE is never read here (CLAUDE.md §2). */
function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const rel of Object.keys(files).sort()) {
    assertPathSafe(rel);
    const parts = rel.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push(rel);
  }
  return root;
}

/* render one node's children, returning { en, words } — `words` is what the PARENT composes its
 * heading from, which is the whole mechanism of "a word made of its children's words". */
function renderNode(node, files, index, stats, depth) {
  const EN = require("./enfile");        /* lazy: enfile requires this module */
  let en = "", words = [];
  for (const [name, sub] of node.dirs) {
    const r = renderNode(sub, files, index, stats, depth + 1);
    const label = folderLabel(name, r.words);
    stats.folders++;
    stats.maxDepth = Math.max(stats.maxDepth, depth + 1);
    en += OPEN + FOLDER + " " + assertPathSafe(name) + " " + SEP + " " + label + " " + BODY_OPEN + r.en + BODY_CLOSE + CLOSE + "\n";
    words.push(label);
  }
  for (const rel of node.files) {
    const src = files[rel];
    const r = EN.renderFileEn(src, index);
    const fileWords = topWordsOf(r.en);
    stats.files++;
    if (fileWords.length === 1) stats.filesOneWord++;
    en += OPEN + FILE_IN + " " + rel + " " + BODY_OPEN + r.en + BODY_CLOSE + CLOSE + "\n";
    /* a file's contribution to its folder's heading is its OWN top-level word(s) — the same
     * strings `topWordsOf` will recover on compile, so the composition is reproducible. */
    words.push(fileWords.join("; "));
  }
  return { en, words };
}

/* A FOLDER: a word made of its files' words. `files` is { rel -> source }; every rel must live
 * under `name` or be given relative to it — the map's keys are the truth, not the filesystem. */
function renderFolderEn(files, index, opts) {
  const name = (opts && opts.name) || "";
  const stats = { files: 0, folders: 0, filesOneWord: 0, maxDepth: 0 };
  const tree = buildTree(files);
  const r = renderNode(tree, files, index, stats, 0);
  const label = folderLabel(name || ".", r.words);
  stats.folders++;
  return { en: OPEN + FOLDER + " " + assertPathSafe(name || ".") + " " + SEP + " " + label + " " + BODY_OPEN + r.en + BODY_CLOSE + CLOSE + "\n", stats };
}

/* A PROGRAM: a word made of its folders' words. Same recursion, PROGRAM marker at the top. */
function renderProgramEn(files, index, opts) {
  const stats = { files: 0, folders: 0, filesOneWord: 0, maxDepth: 0 };
  let tree = buildTree(files);
  /* THE PROGRAM ENTRY RECORDS THE PATH PREFIX IT CONSUMED, and that field is load-bearing rather
   * than decorative. Two real shapes exist and they need different arithmetic:
   *
   *   ROOTED    every path shares a leading directory — "src/alpha/one.ts" — so descending into it
   *             makes the program root `src` and its children start at parts[1]. Amir's fixture.
   *             The prefix is a real path segment, so it CAN be cross-checked.
   *   SYNTHETIC the tree root holds several directories — the real corpus is src/ + packages/ +
   *             tests/ — so the program root corresponds to NO path segment. Its children start at
   *             parts[0], and its display name has no ground truth anywhere in the paths.
   *
   * Measured, and this is why the field exists: the first version assumed rooted and named the
   * synthetic root "src", which shifted every depth by one and produced a confident refusal —
   * `named: enums / paths say: EDocumentType.ts` — on the untouched corpus at
   * packages/hydra-internal/src/enums/. A guard that cries wolf gets ignored, then removed (§3),
   * and the fixture could never have shown it: six files under one directory is the rooted case
   * only. So the container states which shape it is, and compile reads it rather than guessing:
   * a prefix of "." means synthetic.  */
  const prefix = [];
  while (tree.files.length === 0 && tree.dirs.size === 1) {
    const [only] = [...tree.dirs.keys()];
    prefix.push(only); tree = tree.dirs.get(only);
  }
  const nameField = prefix.length ? prefix.join("/") : ".";
  const display = prefix.length ? prefix[prefix.length - 1] : ((opts && opts.name) || "program");
  const r = renderNode(tree, files, index, stats, prefix.length);
  const label = programLabel(display, r.words);
  stats.folders++;
  stats.programRooted = prefix.length > 0;
  return { en: OPEN + PROGRAM + " " + assertPathSafe(nameField) + " " + SEP + " " + label + " " + BODY_OPEN + r.en + BODY_CLOSE + CLOSE + "\n", stats };
}

/* ---- COMPILE ----------------------------------------------------------------------------------
 * Returns { rel -> source }. Byte-exactness per file is INHERITED from compileFileEn; this layer's
 * own job is to split the container without ambiguity and to check the headings it did not store.
 *
 * A MAP, NOT A BYTE STREAM, and that is deliberate. A folder is not one file, and defining the
 * round-trip as "concatenate everything and compare" would silently make file boundaries part of
 * the contract — so a re-ordering or a separator change would read as byte-identical when the tree
 * had actually moved. Comparing the map compares what a person would restore. */
/* PATH DEPTH IS NOT NESTING DEPTH, and conflating them was a real bug caught on the second entry
 * point. The two renderers use different path conventions, legitimately:
 *
 *   renderProgramEn  keys are rooted     — "src/alpha/one.ts", and the PROGRAM entry IS `src`,
 *                                          so the root's name has a witness at parts[0].
 *   renderFolderEn   keys are relative   — "one.ts" under a caller-named folder, so the outermost
 *                                          name has NO witness anywhere in the paths.
 *
 * So `pathDepth` starts at 0 for a PROGRAM entry and at -1 for a top-level FOLDER, and increments
 * per level. A negative pathDepth means "no segment exists to check this name against" and is
 * COUNTED as unchecked rather than passed — the §16 denominator rule. Deriving one from nesting
 * depth alone made a nested relative folder check parts[1] against a path whose parts[0] was the
 * name, which reported a confident mismatch on a correct container. */
function compileNode(en, index, opts, out, acc, depth, pathDepth) {
  const EN = require("./enfile");
  let i = 0;
  while (i < en.length) {
    const o = en.indexOf(OPEN, i);
    if (o < 0) break;
    const c = matchClose(en, o);
    if (c < 0) throw new Error("en-scales: unbalanced « in a scale container (no matching »)");
    const chunk = en.slice(o + 1, c);
    const kind = chunk[0];
    if (kind !== FILE_IN && kind !== FOLDER && kind !== PROGRAM) {
      /* a stray chunk at container level means the container and a file .en have been mixed —
       * exactly the ambiguity the distinct markers exist to make impossible. */
      throw new Error("en-scales: unexpected chunk marker " + JSON.stringify(kind)
        + " at container level — a scale container holds only ◈ / ▤ / ▥ entries");
    }
    const bo = chunk.indexOf(BODY_OPEN), bc = chunk.lastIndexOf(BODY_CLOSE);
    if (bo < 0 || bc < bo) throw new Error("en-scales: malformed " + kind + " entry (no ⟨…⟩ body)");
    const body = chunk.slice(bo + 1, bc);

    if (kind === FILE_IN) {
      const rel = chunk.slice(1, bo).trim();
      if (!rel) throw new Error("en-scales: a ◈ file entry carries no path");
      if (out[rel] !== undefined) throw new Error("en-scales: duplicate file entry for " + rel);
      out[rel] = EN.compileFileEn(body, index, Object.assign({}, opts, { file: rel }));
      acc.words.push(topWordsOf(body).join("; "));
      acc.rels.push(rel);
      i = c + 1;
      continue;
    }

    /* FOLDER or PROGRAM: name is its own field, label is derived from (name, children). */
    const sep = chunk.indexOf(SEP);
    if (sep < 0 || sep > bo) throw new Error("en-scales: a " + kind + " entry carries no ▸ name/label separator"
      + " — re-render it; a heading with no separate name field cannot be checked");
    const name = chunk.slice(1, sep).trim();
    const written = chunk.slice(sep + SEP.length, bo).trim();
    if (!name) throw new Error("en-scales: a " + kind + " entry carries no name");

    const inner = { words: [], rels: [], problems: acc.problems };
    /* children of a PROGRAM start after its consumed prefix; children of a FOLDER one deeper */
    const childPathDepth = kind === PROGRAM ? (name === "." ? 0 : name.split("/").length) : pathDepth + 1;
    compileNode(body, index, opts, out, inner, depth + 1, childPathDepth);

    /* THE PROGRAM'S DISPLAY NAME, and the one place this module cannot verify anything. For a
     * ROOTED program the display name is the prefix's last segment, so it is derived from the
     * cross-checked field. For a SYNTHETIC one ("." — the real corpus) there is no path segment
     * anywhere that names the tree root, so no ground truth exists and the display name is read
     * back out of the written label. That IS self-fulfilling for those few characters, and it is
     * counted in `_uncheckedNames` rather than presented as checked (§16's denominator rule) —
     * the children half of the label is still fully derived and still refuses on disagreement. */
    let derived;
    if (kind === FOLDER) derived = folderLabel(name, inner.words);
    else if (name !== ".") derived = programLabel(name.split("/").pop(), inner.words);
    else {
      const m = /^root\s+(.*?):/.exec(written);
      derived = programLabel(m ? m[1] : "program", inner.words);
      acc.uncheckedNames++;
    }
    if (derived !== written) inner.problems.push({ kind, name, written, derived });

    /* THE NAME IS CHECKED TOO, AGAINST THE FILE PATHS — otherwise the name field is the new
     * self-fulfilling input. A folder's name is structural, like a file's `rel`, so its ground
     * truth is the path segment its own descendants carry at this depth. Editing the name in the
     * .en is a RENAME REQUEST, which this layer does not implement, so it is refused rather than
     * honoured silently. Skipped only when the descendants' paths are too short to carry a segment
     * at this depth — a flat map handed to renderFolderEn, where the caller supplies the name and
     * there is nothing to check it against; that case is counted, not assumed away. */
    /* a synthetic program root names no segment, so it has no witness and is counted, not passed */
    const segs = kind === PROGRAM ? (name === "." ? -1 : name.split("/").length - 1) : pathDepth;
    const witnesses = segs < 0 ? [] : inner.rels.filter((r) => r.split("/").length > segs);
    if (witnesses.length) {
      const expect = kind === PROGRAM ? name.split("/")[segs] : name;
      const wrong = witnesses.filter((r) => r.split("/")[segs] !== expect);
      if (wrong.length) inner.problems.push({ kind, name, nameMismatch: true,
        written: name, derived: wrong[0].split("/")[segs],
        detail: wrong.length + " of " + witnesses.length + " descendant path(s) disagree, e.g. " + wrong[0] });
    } else acc.uncheckedNames++;

    acc.words.push(written);
    for (const r of inner.rels) acc.rels.push(r);
    i = c + 1;
  }
}

function compileScales(en, index, opts) {
  const out = Object.create(null);
  const acc = { words: [], rels: [], problems: [], uncheckedNames: 0 };
  /* the outermost entry decides the path convention — see pathDepth above. */
  const firstOpen = en.indexOf(OPEN);
  compileNode(en, index, opts, out, acc, 0, -1);
  const deriveCheck = !(opts && opts.deriveCheck === false) && process.env.SDD_DERIVE_CHECK !== "0";
  if (deriveCheck && acc.problems.length) {
    const p = acc.problems[0];
    const scale = p.kind === FOLDER ? "folder" : "program";
    throw new Error(p.nameMismatch
      ? "en-scales: FOLDER NAME AND FILE PATHS DISAGREE (a rename is not an edit this layer honours)\n" +
        "  scale:    " + scale + "\n" +
        "  named:    " + p.written + "\n" +
        "  paths say: " + p.derived + "\n" +
        "  " + p.detail + "\n" +
        "  A folder's name is structural, like a file's path — not prose. Renaming it in the .en is\n" +
        "  a rename request, and this layer does not implement one. It is NOT compiled silently."
      : "en-scales: HEADING AND CHILDREN DISAGREE (R-REND-6 — the sentence is authoritative)\n" +
        "  scale:    " + scale + "\n" +
        "  name:     " + p.name + "\n" +
        "  written:  " + p.written + "\n" +
        "  derived:  " + p.derived + "\n" +
        "  A folder or program heading is composed from the words beneath it, so an edit to the\n" +
        "  heading alone contradicts them. Make the edit one level down — in the file whose word\n" +
        "  you meant — and the heading follows from it. It is NOT compiled silently.\n" +
        "  (" + acc.problems.length + " heading(s) disagree in this container.)");
  }
  const files = Object.assign({}, out);
  /* the honest denominator, per §16: say how many names could NOT be cross-checked rather than
   * letting a skipped check read as a passed one. */
  Object.defineProperty(files, "_uncheckedNames", { value: acc.uncheckedNames, enumerable: false });
  return files;
}
const compileFolderEn = compileScales;
const compileProgramEn = compileScales;

module.exports = { OPEN, CLOSE, BODY_OPEN, BODY_CLOSE, FILE_IN, FOLDER, PROGRAM,
  SEP, MARKERS, assertPathSafe, matchClose, topWordsOf,
  folderLabel, programLabel, buildTree,
  renderFolderEn, renderProgramEn, compileFolderEn, compileProgramEn, compileScales };

