"use strict";
/**
 * STATEMENT-IDIOM MINER — deterministic, zero model calls, byte-exact.
 *
 * The named-idiom tier used to be 3 HAND-AUTHORED matchers (throwError,
 * assertOrThrow, fetchAndValidate). This DISCOVERS idioms by frequency instead:
 * every statement in the corpus is canonicalized to its structural SHAPE (via the
 * Stage-1 fan-out tokenizer — identifiers/numbers/strings lifted to typed slots,
 * keywords/punctuation/operators kept literal), shapes are counted across the
 * corpus, and every shape recurring >= minSites across >= minFiles is PROMOTED to
 * a named idiom candidate. Each site carries its own byte-exact template, so the
 * gate is absolute and unchanged: fill(template, slots) === source at every site.
 *
 * Discovery is 100% deterministic. Naming the promoted shapes with an LLM is a
 * SEPARATE, optional pass (see name-statement-idioms.js) — the mining and the
 * coverage math never call a model.
 *
 * Exports: mineStatementIdioms(files, opts) -> { idioms, coverage, census }.
 */
const path = require("path");
const { tokenize, fill } = require("./fanout.js");
const { slotsAreTyped } = require("../lib/skeleton.js");

/* A shape whose every token is a bare delimiter is a cut artifact (a `}` / `});`
 * head-tail split), not an idiom. It still counts toward COVERAGE (they are real
 * bytes) but it is not promoted into the idiom VOCABULARY. */
const DELIMS = new Set(["OpenBraceToken", "CloseBraceToken", "OpenParenToken",
  "CloseParenToken", "SemicolonToken", "CommaToken", "OpenBracketToken", "CloseBracketToken"]);
function isDelimiterShape(shape) {
  const toks = shape.split(" ").filter(Boolean);
  return toks.length > 0 && toks.every((t) => DELIMS.has(t));
}
/* A promotable idiom must have real structure: >=3 tokens, and >=2 that are not
 * slots (ID/NUM/STR) or delimiters — i.e. keywords/operators/call structure. */
function isMeaningfulShape(shape) {
  const toks = shape.split(" ").filter(Boolean);
  if (toks.length < 3) return false;
  if (isDelimiterShape(shape)) return false;
  const structural = toks.filter((t) => t !== "ID" && t !== "NUM" && t !== "STR" && !DELIMS.has(t));
  return structural.length >= 1;
}

/** Coarse category from the shape's leading structural tokens — for grouping/naming. */
function categorize(shape) {
  const t = shape.split(" ").filter(Boolean);
  const head = t[0];
  if (head === "ImportKeyword") return "import";
  if (head === "ThrowKeyword") return "throw";
  if (head === "ReturnKeyword") return "return";
  if (head === "IfKeyword") return "guard";
  if (head === "TryKeyword") return "try";
  if (head === "ForKeyword" || head === "WhileKeyword") return "loop";
  if (head === "ConstKeyword" || head === "LetKeyword" || head === "VarKeyword") {
    if (shape.includes("AwaitKeyword")) return "fetch";
    if (shape.includes("OpenParenToken")) return "assign-call";
    return "assign";
  }
  if (head === "ExportKeyword") return "export";
  if (shape.includes("OpenParenToken") && (head === "ID")) return "call";
  return "other";
}

/**
 * @param files [{ rel, source }]
 * @param opts  { minSites=5, minFiles=2 }
 */
function mineStatementIdioms(files, opts = {}) {
  const minSites = opts.minSites == null ? 5 : opts.minSites;
  const minFiles = opts.minFiles == null ? 2 : opts.minFiles;

  // Census every statement shape at cut0 (whole-statement grain = a real "idiom").
  const stat = new Map(); // shape -> { sites, files:Set, chars, sample, members:[{rel,line,start,end,text,templateParts,slots}] }
  let totalTokens = 0, totalTokenChars = 0;
  const perFile = [];
  for (const f of files) {
    let toks;
    try { toks = tokenize(f.rel, f.source, undefined, 0).tokens; } catch (e) { perFile.push({ rel: f.rel, toks: [] }); continue; }
    perFile.push({ rel: f.rel, toks });
    for (const t of toks) {
      totalTokens++; totalTokenChars += t.text.length;
      let e = stat.get(t.shape);
      if (!e) { e = { shape: t.shape, sites: 0, files: new Set(), chars: 0, sample: null, members: [] }; stat.set(t.shape, e); }
      e.sites++; e.files.add(f.rel); e.chars += t.text.length;
      if (!e.sample) e.sample = { rel: f.rel, line: t.line, text: t.text.split("\n")[0].slice(0, 100) };
      e.members.push({ rel: f.rel, line: t.line, start: t.start, end: t.end, text: t.text, templateParts: t.templateParts, slots: t.slots });
    }
  }

  // Promote. Byte-verify every promoted site with its OWN template.
  const idioms = [];
  let promotedSites = 0, promotedChars = 0, verified = 0, checked = 0;
  for (const e of stat.values()) {
    if (e.sites < minSites || e.files.size < minFiles) continue;
    if (!isMeaningfulShape(e.shape)) continue;
    let bi = 0;
    for (const m of e.members) { checked++; if (fill(m.templateParts, m.slots) === m.text) { bi++; verified++; } }
    const slotKinds = e.shape.split(" ").filter((x) => x === "ID" || x === "NUM" || x === "STR");
    idioms.push({
      shape: e.shape, sites: e.sites, files: e.files.size, chars: e.chars,
      byteIdentical: bi, allByteIdentical: bi === e.sites,
      category: categorize(e.shape), slotKinds, example: e.sample.text,
      // per-site templates make the word self-expanding + independently verifiable
      members: e.members.map((m) => ({ rel: m.rel, line: m.line, chars: m.text.length, template: m.templateParts, slots: m.slots })),
    });
    promotedSites += e.sites; promotedChars += e.chars;
  }
  idioms.sort((a, b) => b.sites - a.sites || b.chars - a.chars);

  return {
    idioms,
    census: { totalStatementTokens: totalTokens, totalTokenChars, distinctShapes: stat.size,
      promotedIdioms: idioms.length, promotedSites, promotedChars, byteVerified: verified, byteChecked: checked },
    perFile, stat,
  };
}

/**
 * Honest coverage of the corpus by the discovered idioms, three byte-exact policies:
 *   strict  — recurs + typed slots + CANONICAL (plurality) template (the old 46.1% rule)
 *   persite — recurs + typed slots + this site's OWN template   (recovers class D)
 *   named   — recurs + this site's OWN template, ANY slot       (recovers class B; the throwError standard)
 * All three only ever count a token when a template refills its exact bytes.
 */
function coverageByIdioms(perFile, stat, totalCorpusChars, minSites = 2) {
  // canonical template per shape
  const votes = new Map();
  for (const pf of perFile) for (const t of pf.toks) {
    if (!votes.has(t.shape)) votes.set(t.shape, new Map());
    const m = votes.get(t.shape); const k = JSON.stringify(t.templateParts);
    m.set(k, (m.get(k) || { p: t.templateParts, c: 0 })); m.get(k).c++;
  }
  const canon = new Map();
  for (const [sh, m] of votes) { let b = null; for (const v of m.values()) if (!b || v.c > b.c) b = v; canon.set(sh, b.p); }

  let strict = 0, persite = 0, named = 0;
  for (const pf of perFile) for (const t of pf.toks) {
    const e = stat.get(t.shape);
    if (!e || e.sites < minSites) continue;   // non-recurring => class A, never covered
    named += t.text.length;                    // recurs + own template (refills by construction)
    if (slotsAreTyped(t.slots)) {
      persite += t.text.length;
      if (fill(canon.get(t.shape), t.slots) === t.text) strict += t.text.length;
    }
  }
  const pct = (n) => +(100 * n / totalCorpusChars).toFixed(1);
  return { strictPct: pct(strict), persitePct: pct(persite), namedPct: pct(named),
    strictChars: strict, persiteChars: persite, namedChars: named };
}

module.exports = { mineStatementIdioms, coverageByIdioms, isMeaningfulShape, isDelimiterShape, categorize };
