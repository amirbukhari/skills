"use strict";
/**
 * STAGE 4 — WHOLE-FILE MINING.
 *
 * The fragment miner (fanout -> LZW -> pipeline) discovers leaf/mid/high words
 * *inside* files. This pass discovers whole-FILE domain words: recurring
 * whole-file shapes, auto-parameterized and byte-verified, so re-mining a corpus
 * fills the Author picker with domain words automatically instead of needing a
 * human to hand-author each one.
 *
 * Pipeline (all deterministic, no model):
 *   1. CANONICALIZE  each file -> a whole-file shape (the fanout token-shape
 *      stream; identifier/number/string values are typed slots, so two files
 *      that differ only in names/constants canonicalize identically).
 *   2. CLUSTER       group files by exact whole-file shape; also record near
 *      matches (token-shape edit distance) for explainability.
 *   3. MINT          for each cluster of size >= minClusterSize, align the
 *      members' slots: positions that agree across all members are baked
 *      constants, positions that differ become typed params. The result is a
 *      parameterized whole-file word + a fill template.
 *   4. BYTE-VERIFY   expand the word with each member's extracted params and
 *      assert byte-identity against the real file. Residue (e.g. a dropped
 *      trailing `// 15;` comment) is classified and recorded, never hidden.
 *   5. SINGLETONS    size-1 clusters are the degenerate 1:1 case; they are NOT
 *      auto-minted — they surface as escalation candidates.
 *
 * Exports: mineWholeFile(perFile, opts) -> { words, singletons, nearMatches, stats }
 *   perFile item: { rel, source, tokens, gaps }   (as produced by fanout)
 */

const { fill } = require("./fanout");

const SEP = "";

/* --------------------------- canonicalization ---------------------------- */

/** Whole-file shape = the ordered token-shape stream (value-insensitive). */
function fileShape(tokens) { return tokens.map((t) => t.shape); }
function shapeKey(tokens) { return fileShape(tokens).join(SEP); }

/**
 * A gap is baked RAW when it is identical across every cluster member — so a
 * comment that is part of the shared file shape (e.g. the `// NOTE:` line every
 * member carries) is reproduced, not dropped. Only when members DISAGREE on a
 * gap (e.g. `// 15;` vs `// 14;`) is the comment stripped, and it then shows up
 * as residue on byte-verify (class C). This mirrors the hand-authored domain
 * words exactly: shared body comments kept, incidental trailing comments dropped.
 *
 * stripComments removes the comment AND the horizontal whitespace immediately
 * before it, so dropping a trailing `; // 15;` leaves `;` with no dangling space.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/[ \t]*\/\/[^\n]*/g, "");
}
/** Bake one gap position from its per-member texts (raw if unanimous). */
function bakeGap(texts) {
  return texts.every((t) => t === texts[0]) ? texts[0] : stripComments(texts[0]);
}

/* ------------------------------- clustering ------------------------------ */

/** Levenshtein over two arrays of shape-tokens (structural edit distance). */
function shapeEditDistance(a, b) {
  const n = a.length, m = b.length;
  if (n === 0) return m; if (m === 0) return n;
  let prev = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1); cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[m];
}

/** Group perFile by exact whole-file shape (deterministic order by rel). */
function clusterExact(perFile) {
  const byKey = new Map();
  for (const pf of [...perFile].sort((a, b) => a.rel.localeCompare(b.rel))) {
    const key = shapeKey(pf.tokens);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(pf);
  }
  return byKey;
}

/** Near matches between representatives of distinct exact clusters (explainable). */
function nearMatchesBetween(clusters, nearThreshold) {
  const reps = [...clusters.values()].map((members) => ({
    rep: members[0], shape: fileShape(members[0].tokens), size: members.length,
  }));
  const out = [];
  for (let i = 0; i < reps.length; i++) {
    for (let j = i + 1; j < reps.length; j++) {
      const d = shapeEditDistance(reps[i].shape, reps[j].shape);
      const denom = Math.max(reps[i].shape.length, reps[j].shape.length) || 1;
      const ratio = d / denom;
      if (ratio <= nearThreshold) {
        out.push({
          a: reps[i].rep.rel, b: reps[j].rep.rel,
          editDistance: d, tokens: denom, ratio: +ratio.toFixed(3),
          reason: `token-shape edit distance ${d}/${denom} (<= ${nearThreshold}) — differ only by a slot or small tail`,
        });
      }
    }
  }
  return out.sort((x, y) => x.ratio - y.ratio);
}

/* --------------------------------- minting -------------------------------- */

const KIND_TO_TYPE = { ID: "identifier", STR: "string", NUM: "number", BOOL: "boolean" };

/** A light, deterministic, structural name hint for a param (never value-derived). */
function paramHint(tok, si) {
  const sh = tok.shape;
  const kind = tok.slots[si] && tok.slots[si].kind;
  if (/^ExportKeyword (FunctionKeyword|ConstKeyword) ID/.test(sh) && si === 0) return "exportName";
  if (/^ImportKeyword/.test(sh)) return kind === "STR" ? "modulePath" : "importedSymbol";
  if (/^ConstKeyword ID/.test(sh)) return si === 0 ? "constName" : "constValue";
  return null;
}

/**
 * Mint a parameterized word from an exact-shape cluster.
 * Returns { params, tokenPlans, items, ref } where tokenPlans[ti] is the list of
 * per-local-slot plans ({const,text}|{param}) for token ti, and items is the
 * ref's merged (gap|token) stream used for expansion.
 */
function mintFromCluster(members) {
  const ref = members[0];
  const nTok = ref.tokens.length;

  // per-token local-slot plans, computed by comparing each slot across members
  const tokenPlans = [];
  const params = [];
  for (let ti = 0; ti < nTok; ti++) {
    const localPlans = [];
    const nSlots = ref.tokens[ti].slots.length;
    for (let si = 0; si < nSlots; si++) {
      const texts = members.map((m) => m.tokens[ti].slots[si].text);
      const kind = ref.tokens[ti].slots[si].kind;
      const allSame = texts.every((t) => t === texts[0]);
      if (allSame) {
        localPlans.push({ const: true, text: texts[0], kind });
      } else {
        const hint = paramHint(ref.tokens[ti], si);
        const base = hint || `${KIND_TO_TYPE[kind] || "arg"}`;
        const name = `${base}${params.filter((p) => p.base === base).length ? params.filter((p) => p.base === base).length + 1 : ""}` || `p${params.length}`;
        const idx = params.length;
        params.push({ index: idx, base, name: name || `p${idx}`, kind, type: KIND_TO_TYPE[kind] || "identifier", tokenIndex: ti, slotIndex: si });
        localPlans.push({ param: idx, kind });
      }
    }
    tokenPlans.push(localPlans);
  }

  // Bake each gap position: raw when unanimous across members, comment-stripped
  // when they disagree. Aligned by gap order (exact clusters share gap structure;
  // if a member's gap count diverges, fall back to that member's own text).
  const nGaps = ref.gaps.length;
  const bakedGaps = [];
  for (let gi = 0; gi < nGaps; gi++) {
    const texts = members.map((m) => (m.gaps.length === nGaps && m.gaps[gi] ? m.gaps[gi].text : ref.gaps[gi].text));
    bakedGaps.push(bakeGap(texts));
  }

  // merged stream of gaps + tokens (by start)
  const items = [];
  ref.gaps.forEach((g, gi) => items.push({ kind: "gap", start: g.start, gi }));
  ref.tokens.forEach((t, ti) => items.push({ kind: "tok", start: t.start, tokenIndex: ti, templateParts: t.templateParts }));
  items.sort((a, b) => a.start - b.start);

  return { ref, params, tokenPlans, items, bakedGaps };
}

/** Expand a minted word with an ordered array (or map) of param values -> code. */
function expandWord(word, paramValues) {
  const val = Array.isArray(paramValues)
    ? (i) => paramValues[i]
    : (i) => paramValues[word.params[i].name];
  let out = "";
  for (const it of word.items) {
    if (it.kind === "gap") { out += word.bakedGaps[it.gi]; continue; }
    const plan = word.tokenPlans[it.tokenIndex];
    out += it.templateParts.map((p) => {
      if (p.lit !== undefined) return p.lit;
      const sp = plan[p.slot];
      return sp.const ? sp.text : val(sp.param);
    }).join("");
  }
  return out;
}

/** Extract a member file's param values (ordered) by aligning it to the word. */
function extractParams(word, memberPf) {
  return word.params.map((p) => memberPf.tokens[p.tokenIndex].slots[p.slotIndex].text);
}

/* ------------------------------ byte-verify ------------------------------- */

function classifyResidue(expanded, real) {
  if (expanded === real) return { identical: true, chars: 0, byClass: {}, lines: [] };
  const eo = expanded.split("\n"), ro = real.split("\n");
  const byClass = { A: 0, B: 0, C: 0, D: 0 }; const lines = []; let chars = 0;
  for (let i = 0; i < Math.max(eo.length, ro.length); i++) {
    if (eo[i] === ro[i]) continue;
    const e = eo[i] ?? "", r = ro[i] ?? "";
    // a dropped trailing comment: real == expanded + `<ws>// ...`
    const cls = (/\/\/[^\n]*$/.test(r) && r.replace(/\s*\/\/[^\n]*$/, "") === e.replace(/\s*$/, "")) ? "C" : "A";
    byClass[cls] += Math.abs(r.length - e.length) || Math.max(r.length, e.length);
    chars += Math.abs(r.length - e.length) || Math.max(r.length, e.length);
    lines.push({ line: i + 1, expanded: e, real: r, cls });
  }
  return { identical: false, chars, byClass, lines };
}

/* --------------------------------- driver -------------------------------- */

function mineWholeFile(perFile, opts = {}) {
  const minClusterSize = opts.minClusterSize || 2;
  const nearThreshold = opts.nearThreshold != null ? opts.nearThreshold : 0.15;

  const clusters = clusterExact(perFile);
  const nearMatches = nearMatchesBetween(clusters, nearThreshold);

  const words = [];
  const singletons = [];
  let wordSeq = 0;

  for (const [key, members] of [...clusters.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    if (members.length < minClusterSize) { singletons.push(...members.map((m) => m.rel)); continue; }

    const minted = mintFromCluster(members);
    const word = {
      name: `w_${(++wordSeq).toString().padStart(2, "0")}_${hash6(key)}`,
      tier: "domain", minedWholeFile: true,
      memberFiles: members.map((m) => m.rel),
      params: minted.params.map((p) => ({ name: p.name, type: p.type, kind: p.kind })),
      items: minted.items, tokenPlans: minted.tokenPlans, bakedGaps: minted.bakedGaps,
      _paramsFull: minted.params,
    };

    // byte-verify every member
    const verify = [];
    for (const m of members) {
      const vals = extractParams({ params: minted.params }, m);
      const expanded = expandWord(word, vals);
      const res = classifyResidue(expanded, m.source);
      verify.push({
        file: m.rel, byteIdentical: res.identical, residueChars: res.chars,
        residueClass: res.identical ? null : Object.entries(res.byClass).filter(([, n]) => n).map(([c]) => c).join(""),
        residueLines: res.lines.map((l) => ({ line: l.line, cls: l.cls, real: l.real })),
        params: Object.fromEntries(word.params.map((p, i) => [p.name, vals[i]])),
      });
    }
    word.verify = verify;
    word.allVerified = verify.every((v) => v.byteIdentical);
    word.production = productionOf(word);
    words.push(word);
  }

  const memberFilesCovered = new Set(words.flatMap((w) => w.memberFiles));
  const allVerify = words.flatMap((w) => w.verify);
  const stats = {
    corpusFiles: perFile.length,
    minClusterSize, nearThreshold,
    minedWords: words.length,
    filesCovered: memberFilesCovered.size,
    memberByteIdentical: allVerify.filter((v) => v.byteIdentical).length,
    memberWithResidue: allVerify.filter((v) => !v.byteIdentical).length,
    wordsFullyVerified: words.filter((w) => w.allVerified).length,
    escalationCandidates: singletons.length,
    nearMatchPairs: nearMatches.length,
  };
  return { words, singletons, nearMatches, stats };
}

function productionOf(word) {
  return `${word.name}( ${word.params.map((p) => `<${p.name}:${p.type}>`).join(", ")} )  ->  ${word.memberFiles.length} file(s)`;
}
function hash6(s) { return require("crypto").createHash("sha256").update(s).digest("hex").slice(0, 6); }

module.exports = {
  mineWholeFile, mintFromCluster, expandWord, extractParams, classifyResidue,
  clusterExact, nearMatchesBetween, stripComments, bakeGap, fileShape, shapeKey, shapeEditDistance,
};
