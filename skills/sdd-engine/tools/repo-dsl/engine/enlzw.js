"use strict";
/**
 * enlzw.js — render/compile the multi-line generator layer through the RECURSIVE WORD
 * DICTIONARY (catalog/generators-lzw.json) instead of the flat generators.json (PRD §4A).
 *
 * RENDER: greedily segment each run of foldable statements against the word graph — longest
 * NARROW word first (byte-eliminating), WIDE only where narrow leaves a position (§5A
 * arbitration). A word of length L>=2 collapses L statements into one call; its payload is the
 * word id + the per-site hole texts. Byte-gated at emission: G.windowParts(win).fill === slice.
 * COMPILE: word id -> expandKey (recurse members -> leaf statement keys joined by ‹gap›) ->
 * G.refill(key, holes) === exact source bytes. maxDepth>=2 => the live path composes.
 * Deterministic; zero model calls.
 *
 * Exports: loadLzw(catalogPath), genSpans(sf, source, cat), compileSpan(payload, cat).
 */
const fs = require("fs");
const AC = require("./artifact-contract");
const ts = require("typescript");
const G = require("./generators");
const W = require("./wordlzw");
const REF = require("./refusals");

function loadLzw(catalogPath) {
  /* Contract-checked (PRD §8B): a dictionary whose shape we cannot verify is REFUSED, never
   * quietly treated as an empty vocabulary — an empty vocabulary renders as "this corpus has no
   * patterns", which reads like a measurement instead of a broken install. */
  const j = AC.load("generators-lzw", catalogPath);
  // rebuild an expand-friendly dict wrapper per axis: words{} keyed by id, symOfId not needed
  // (leaf words carry .sym directly), so expandSymbols recurses members -> leaf .sym.
  return j;
}

/* A "named unit" is a function/class definition (or a `const` whose initializer is one) — the
 * thing a reader thinks of as a single item. A composed span must never straddle >=2 of them, or
 * its label reads as several unrelated things joined however well each clause renders (e.g. "define
 * A, define B, define C" for three unrelated helpers). This predicate is the meaning-aware span
 * boundary. It is applied as candidate ADMISSIBILITY before the weighted-interval scheduler runs,
 * so it only ever REMOVES candidates — every surviving candidate still passes the identical byte
 * gate, and any statement left uncovered falls back to per-statement rendering, itself byte-gated.
 * Byte-identity is therefore preserved BY CONSTRUCTION. Shared with the flat-fallback path in
 * enfile.js so a merge rejected here cannot silently reappear there.
 *
 * NARROWED 2026-09-01 (Amir's call, R-MINE-8-amended, PRD §5D.4D). Read the reason above again:
 * every word in it is about the LABEL — "its label reads as several unrelated things". The rule
 * was never about correctness (the byte gate owns that) and never about the dictionary; it was
 * about a span whose BOUNDARIES ARE ARBITRARY. A miner-chosen window that happens to swallow
 * `alpha` and half of `beta` has no referent in the code, so no honest name exists for it.
 *
 * That argument does not reach a span that covers an ENTIRE run. A whole-run span's boundaries are
 * not chosen by the miner at all — they are the enclosing construct's: the file, for a run of
 * top-level statements, or one function body, for a run inside a Block. The word denotes exactly
 * one syntactic container, so "a word means one thing" still holds; the one thing is the container
 * rather than the definition inside it. A file with three exported helpers IS one thing — a module.
 *
 * So the rule now binds PROPER SUB-SPANS only. Whole-run spans are exempt, and remain gated on
 * `wholeRunOk` (chunkGloss) — they still have to be sayable. The residual cost is real and is
 * recorded in §5D.4D §3: such a word glosses as a LIST ("define A, then define B, then define C"),
 * which is a description, not a concept. The instrument for that is a NAME (§5D.3D chunk naming),
 * which is precisely the mechanism whose absence this rule was standing in for. */
function isUnit(st) {
  if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) return true;
  if (ts.isVariableStatement(st)) {
    const d = st.declarationList.declarations[0];
    const init = d && d.initializer;
    return !!(init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init)));
  }
  return false;
}

/* expand a word id in one axis to its flat window key (per-statement keys joined by ‹gap›). */
function expandKey(axis, id) {
  const w = axis.words[id];
  if (!w) throw new Error("enlzw: unknown word id " + id);
  if (w.len === 1) return w.sym;
  return expandKey(axis, w.m[0]) + W_GAP + expandKey(axis, w.m[1]);
}
const W_GAP = W.GAP;
/* THE LIFT, as amended (PRD §5D.4, §5D.4A, R-ARCH-17, R-MINE-7-amended).
 *
 * It used to refuse EVERY word covering an entire run, unconditionally — the original R-MINE-7,
 * "a file is never one word". Measured cost: 308 of 943 files lost their whole-file word, so the
 * one-word-per-file rate (R-ARCH-15) was 0.0% BY CONSTRUCTION, not for want of a dictionary.
 *
 * The rule's stated purpose was always to prevent ONE OPAQUE REFERENCE, not to prevent one word.
 * So the refusal is now CONDITIONAL on readability, decided by the caller: `wholeRunOk(run)`
 * returns true when the renderer can gloss the whole run as a named chunk (enfile.chunkGloss —
 * no mechanical repetition, nothing that says nothing). A run that cannot be glossed is still
 * refused and still re-segmented exactly as before, so an unruled repetitive kind never becomes
 * an opaque blob; it simply shows up as a file that did not collapse, which is the residual work
 * queue (§5D.4A).
 *
 * LIFT_TOP=0 still forces the old unconditional-collapse behaviour, for measurement only.
 * Byte-identity is untouched either way: this only admits or removes a CANDIDATE, and every
 * emitted span is byte-gated by `wp.fill === source.slice(...)` regardless. */
const LIFT_TOP = process.env.LIFT_TOP !== "0";

/* ONE_WORD_FIRST=0 restores the pure weight-maximising objective, for MEASUREMENT ONLY — it is how
 * the cost of the R-ARCH-15-first ordering below was quantified, and how it can be re-quantified
 * later. It is not a supported production mode: with it off, R-ARCH-15 is 30.6%, with it on, 93.1%. */
const ONE_WORD_FIRST = process.env.ONE_WORD_FIRST !== "0";

/* ALL kept words starting at run position p over symbol strings syms[], walking the prefix+symbol
 * automaton (leaf then ext). Returns [{ id, len }] for len 1..Lmax (kept words are prefix-closed,
 * so lengths are contiguous). Empty if syms[p] never recurred. */
function wordsAt(axis, syms, p) {
  let cur = axis.leaf[syms[p]];
  if (cur === undefined) return [];
  const out = [{ id: cur, len: 1 }];
  let q = p;
  while (q + 1 < syms.length) {
    const nid = axis.ext[cur + "|" + syms[q + 1]];
    if (nid === undefined) break;
    cur = nid; q++; out.push({ id: nid, len: q - p + 1 });
  }
  return out;
}

/* per-file generator spans through the recursive dictionary.
 *
 * A control-flow statement is foldable at its OWN block's run (whole `if`/`for`/… -> one symbol)
 * AND its inner blocks are tiled as their own runs, so the same bytes can be claimed at two
 * granularities (outer word spanning the CF stmt vs inner words inside it). We therefore gather
 * EVERY byte-gated candidate word across all runs and pick the max-weight NON-OVERLAPPING set by
 * weighted-interval scheduling over byte ranges (weight = stmts-1 = net reduction). This is
 * globally net-optimal and subsumes per-run tiling; the nesting overlap is resolved, not dropped. */
function genSpans(sf, source, cat, opts) {
  if (!cat) return [];
  /* Default when no predicate is supplied: the old unconditional refusal. A caller that cannot
   * gloss (a test, a measurement harness) must not silently start emitting whole-file words. */
  const wholeRunOk = (opts && opts.wholeRunOk) || (() => false);
  const blocks = [];
  /* `top` marks the SourceFile's own statement list — the run whose whole-run word, if one is
   * chosen and it covers every top-level statement, IS the file's single word (R-ARCH-15). */
  const collect = (n) => { if ((ts.isBlock(n) || ts.isSourceFile(n)) && n.statements.length) blocks.push({ stmts: [...n.statements], top: n === sf }); ts.forEachChild(n, collect); };
  collect(sf);

  // 1) gather all byte-gated candidate words (len>=2, both axes) across every run.
  const cands = []; // { start, end, weight, stmts, payload, depth }
  for (const blk of blocks) {
    const stmts = blk.stmts;
    let i = 0;
    while (i < stmts.length) {
      if (!G.isFoldable(stmts[i])) { i++; continue; }
      let j = i; while (j < stmts.length && G.isFoldable(stmts[j])) j++;
      const run = stmts.slice(i, j);
      const topRun = blk.top;
      const nsym = run.map((st) => { const p = G.generalStmtParts(st, sf, false); return p ? G.keyOf(p) : null; });
      const wsym = run.map((st) => { const p = G.generalStmtParts(st, sf, true); return p ? G.keyOf(p) : null; });
      let _glossable; const runGlossable = () => (_glossable === undefined ? (_glossable = !!wholeRunOk(run, sf)) : _glossable);
      for (let p = 0; p < run.length; p++) {
        const push = (ws, axis, wide) => {
          for (const w of ws) {
            if (w.len < 2) continue;
            /* LIFT (PRD §1 "re-emitted as a stream of those words"). A word that covers an ENTIRE
             * run collapses the whole thing to one opaque reference — technically maximal reuse,
             * useless to a reader. Refuse it so the scheduler must build the run out of the
             * largest words that are strictly smaller, i.e. the words the top word is made of.
             *
             * Why not "expand the top word one level": measured, 317 of 317 whole-file words
             * expand to [N-1, 1]. LZW entries are prefix + one symbol (§2.1), so a one-level lift
             * is ALWAYS a chain, never a branch, and lifting until a branch appears would recurse
             * to leaves and hand back the raw statements. Re-segmenting is the only lift that
             * yields a real paragraph.
             *
             * Byte-identity is untouched: this only removes a candidate. Every emitted span is
             * still byte-gated, and any statement left uncovered falls back to per-statement
             * rendering, itself byte-gated. */
            const wholeRun = p === 0 && w.len >= run.length && run.length >= 2;
            if (LIFT_TOP && wholeRun && !runGlossable()) continue;
            const win = run.slice(p, p + w.len);
            /* meaning-aware boundary (R-MINE-8-amended): a PROPER SUB-SPAN may not straddle >=2
             * units, because its edges are the miner's choice and nothing in the code names it.
             * A whole-run span is exempt — its edges are the enclosing file's or function's, and
             * it has already passed `wholeRunOk`. See the note on isUnit above. */
            if (!wholeRun && win.filter(isUnit).length >= 2) continue;
            const start = win[0].getStart(sf), end = win[win.length - 1].getEnd();
            const wp = G.windowParts(win, sf, wide);
            if (wp && wp.fill === source.slice(start, end)) {
              cands.push({ start, end, weight: w.len - 1, stmts: w.len, wide, depth: cat[axis].words[w.id].d,
                topRun, wholeRun,
                payload: { d: "lzw", a: wide ? "w" : "n", w: w.id, h: wp.holes } });
            }
          }
        };
        if (nsym[p] != null) push(wordsAt(cat.narrow, nsym, p), "narrow", false);
        if (wsym[p] != null) push(wordsAt(cat.wide, wsym, p), "wide", true);
      }
      i = j;
    }
  }
  if (!cands.length) return [];

  /* 2) R-ARCH-15 FIRST (Amir's call, 2026-09-01, PRD §5D.4D §4). The objective below maximises
   * total weight (= statements removed). That objective and R-ARCH-15 ("every file should be able
   * to be one word") genuinely conflict: because `weight = w.len - 1`, k nested words covering the
   * same bytes score `n - k` against a single whole-file word's `n - 1`, so the scheduler PREFERS
   * fragments — measured, 306 of 941 files had a whole-file word available and did not take it
   * (`src/build-react-index.ts`: whole-file weight 5 vs two nested spans totalling 8).
   *
   * Weight maximisation was never the goal; it was a proxy for "least left to read", and it is the
   * wrong proxy — one word is less to read than three, whatever the arithmetic says. So the
   * ordering is now stated rather than implied: WHERE A SINGLE WORD COVERS THE WHOLE FILE, IT WINS,
   * and the weighted-interval scheduler decides everything else. Lexicographic, not a tuned bonus:
   * no weight is adjusted, so the fallback objective is bit-for-bit the one it always was.
   *
   * Admissibility is unchanged, so this cannot break byte-identity — the candidate returned here
   * passed the same `wp.fill === source.slice(...)` gate as every other, and it is a candidate the
   * DP was free to choose already. */
  const first = sf.statements[0], last = sf.statements[sf.statements.length - 1];
  if (ONE_WORD_FIRST && first) {
    const fs_ = first.getStart(sf), fe = last.getEnd();
    const whole = cands.filter((c) => c.topRun && c.wholeRun && c.start === fs_ && c.end === fe);
    if (whole.length) {
      /* Same deterministic tie-break the sort below uses: most statements, then narrow axis. */
      whole.sort((a, b) => (b.stmts - a.stmts) || (a.wide - b.wide));
      const c = whole[0];
      return [{ start: c.start, end: c.end, payload: c.payload, stmts: c.stmts, depth: c.depth }];
    }
  }

  // 3) weighted-interval scheduling: max total weight over non-overlapping byte ranges.
  //    Sort by end; tie-break so the deterministic winner is stable (wider, then narrow axis).
  cands.sort((a, b) => a.end - b.end || a.start - b.start || (b.stmts - a.stmts) || (a.wide - b.wide));
  const ends = cands.map((c) => c.end);
  // p(i) = last index whose end <= cands[i].start (binary search)
  const prevIdx = cands.map((c) => {
    let lo = 0, hi = cands.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ends[m] <= c.start) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  });
  const M = cands.length;
  const dp = new Array(M + 1).fill(0);   // dp[i] = best weight using cands[0..i-1]
  for (let i = 1; i <= M; i++) {
    const c = cands[i - 1];
    const take = c.weight + dp[prevIdx[i - 1] + 1];
    dp[i] = Math.max(dp[i - 1], take);
  }
  // reconstruct chosen set
  const chosen = [];
  for (let i = M; i >= 1;) {
    const c = cands[i - 1];
    const take = c.weight + dp[prevIdx[i - 1] + 1];
    if (take >= dp[i - 1] && take === dp[i]) { chosen.push(c); i = prevIdx[i - 1] + 1; }
    else i--;
  }
  chosen.reverse();
  return chosen.map((c) => ({ start: c.start, end: c.end, payload: c.payload, stmts: c.stmts, depth: c.depth }));
}

/* runWord(run, sf, source, cat) -> a byte-gated word covering the ENTIRE run, or null.
 *
 * NESTED RENDERING (PRD §5D.4E, R-ARCH-19). genSpans answers "which non-overlapping spans should
 * this file emit"; that question has no recursive answer, because a whole-file word and the words
 * inside its statements' bodies necessarily overlap. The nested renderer asks a different, local
 * question — "is there one word for exactly THIS run" — and recurses into the bodies itself, so
 * the two sets stop competing for the same bytes and become parent and child.
 *
 * `run.length === 1` is deliberately allowed: a leaf word (len 1) is a real dictionary entry, and
 * it is what lets the recursion bottom out on a single statement with its skeleton still in the
 * catalog rather than emitted verbatim.
 *
 * NARROW IS PREFERRED, as everywhere else (§5A arbitration): wide only where narrow has no word.
 * The byte gate is the same one genSpans uses, on the same bytes, so admitting a word here can no
 * more break byte-identity than admitting it there. */
const kindName = (n) => (n && ts.SyntaxKind[n.kind]) || "Unknown";

function runWord(run, sf, source, cat) {
  if (!cat || !run.length) return null;
  const start = run[0].getStart(sf), end = run[run.length - 1].getEnd();
  const slice = source.slice(start, end);
  /* REFUSAL RECORDING (observational — see refusals.js). Both axes are tried, so a run that fails
   * twice would count twice; instead we keep only the FURTHEST point reached across axes and record
   * one event per run. Furthest is the informative one: "no word existed on either axis" and "a
   * word existed and its skeleton no longer refills these bytes" are different facts, and the
   * second is drift. Nothing is recorded when either axis succeeds. */
  let far = null;
  const reach = (rank, reason, rule, axis, detail) => {
    if (!REF.active()) return;
    if (!far || rank > far.rank) far = { rank, reason, rule, axis, detail };
  };
  for (const wide of [false, true]) {
    const ax = wide ? "wide" : "narrow";
    const axis = wide ? cat.wide : cat.narrow;
    let bad = -1;
    const syms = run.map((st, i) => { const p = G.generalStmtParts(st, sf, wide); if (!p && bad < 0) bad = i; return p ? G.keyOf(p) : null; });
    if (syms.some((s) => s == null)) {
      /* The rule that declined is the canonicalizer for THAT node kind — the actionable name, since
       * fixing it means teaching generalStmtParts this shape. */
      reach(1, "no-symbol", "generalStmtParts:" + kindName(run[bad]), ax, "statement " + (bad + 1) + " of " + run.length);
      continue;
    }
    const w = wordsAt(axis, syms, 0).filter((x) => x.len >= run.length)[0];
    if (!w) { reach(2, "no-word", "dictionary:" + kindName(run[0]), ax, "run of " + run.length + " starting " + kindName(run[0])); continue; }
    const wp = G.windowParts(run, sf, wide);
    /* From here the rule that declined is a NAMED CATALOG ENTRY: word #id was mined from source that
     * looked like this and no longer refills it. This is the drift the audit exists to surface. */
    if (!wp) { reach(3, "parts-inexact", "word#" + w.id + "@" + ax, ax, "len " + w.len + ", d " + axis.words[w.id].d); continue; }
    if (wp.fill !== slice) { reach(4, "byte-gate", "word#" + w.id + "@" + ax, ax, "refilled " + wp.fill.length + " B vs " + slice.length + " B of source"); continue; }
    return { start, end, stmts: run.length, depth: axis.words[w.id].d,
             payload: { d: "lzw", a: wide ? "w" : "n", w: w.id, h: wp.holes } };
  }
  if (far) REF.record({ reason: far.reason, rule: far.rule, axis: far.axis, detail: far.detail, start, end, stmts: run.length });
  return null;
}

/* compile one span payload back to exact source bytes.
 *
 * INTERIOR PRODUCTION — LANDED, AND DELIBERATELY UNUSED. `opts.compileChild` lets a caller supply
 * the source bytes for holes the payload marks as child slots (`payload.c`), instead of the payload
 * carrying those bytes as hole text. Nothing in the renderer wires it, and per the 2026-09-03
 * ruling nothing is to: measured corpus-wide, routing if-blocks through it costs +1,403 constructs
 * rather than saving 2,215, because the braces are HOLE TEXT and hole text is on the page.
 *
 * It is landed rather than deleted so the door is open in CODE and not in memory —
 * interior-production.test.js asserts the price is not a reduction and FIRES if the braces ever do
 * leave the page, which needs a canon change (§10:42: 0 of 244,795 dictionary words wrap a content
 * hole in braces; the 232 that wrap anything wrap a `gap`, i.e. an empty body).
 *
 * IT THROWS RATHER THAN RETURNING NULL, on purpose. `refill` splices its argument in positionally,
 * so a null would land the four characters "null" in the output and byte-identity would report the
 * file as WRONG BYTES with no indication of which hole did it. Refusing loudly is the §8 contract. */
function compileSpan(payload, cat, opts) {
  const axis = payload.a === "n" ? cat.narrow : cat.wide;
  const key = expandKey(axis, payload.w);
  let holes = payload.h;
  const slots = payload.c;
  if (slots && slots.length) {
    /* A child slot with no producer is not a default-to-hole-text case: the payload was written by
     * an encoder that believed the bytes live elsewhere, so the hole text is NOT the source. */
    if (!opts || typeof opts.compileChild !== "function")
      throw new Error("enlzw: payload marks " + slots.length + " child slot(s) but no opts.compileChild was given"
        + " — refusing to compile hole text that is not the source");
    /* Arity is checked against the KEY, not against payload.h, so a dictionary word that changed
     * shape under a re-mine is refused here rather than silently mis-filled. */
    const types = (key.match(/‹\w+›/g) || []).length;
    if (types !== holes.length)
      throw new Error("enlzw: word " + payload.w + " on axis " + payload.a + " expects " + types
        + " holes, payload carries " + holes.length + " — refusing to refill");
    holes = holes.slice();
    for (let n = 0; n < slots.length; n++) {
      const i = slots[n];
      if (!Number.isInteger(i) || i < 0 || i >= holes.length)
        throw new Error("enlzw: child slot " + JSON.stringify(i) + " is not a hole index of word " + payload.w);
      const bytes = opts.compileChild(n);
      if (typeof bytes !== "string")
        throw new Error("enlzw: compileChild(" + n + ") returned " + typeof bytes + ", expected the child's source bytes");
      holes[i] = bytes;
    }
  }
  return G.refill(key, holes);
}

module.exports = { loadLzw, genSpans, compileSpan, expandKey, isUnit, wordsAt, runWord };
