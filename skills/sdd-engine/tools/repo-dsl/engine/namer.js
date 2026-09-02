"use strict";
/**
 * namer.js — THE ONLY PLACE A MODEL IS SPOKEN TO (PRD §5D.2, §5D.3A; R-LANG-11, R-LANG-15).
 *
 * Everything the model can influence passes through this file, which is the point: the blast radius
 * is auditable by reading one module. What goes OUT is code-built evidence keyed by `#index`; what
 * may come BACK is `[{index, name, rationale}]` and nothing else. There is no field in which a
 * production, a connective, a slot boundary or a hole fill could arrive, so none can. That is the
 * same contract `refine-language.js` has enforced since it was written, and it is deliberately
 * copied rather than reinvented.
 *
 * WHAT A NAME IS AT EACH LEVEL — the two are different things and the validator knows it (§5D.3D):
 *   d=0, a LEAF SKELETON  -> a short English CLAUSE for one statement shape, holes left as holes.
 *                            The skeleton is `const ‹id› = ‹id›.‹m›(‹args›);`; the clause is what a
 *                            reader sees where the hole fills supply the specifics. Written to
 *                            word-names.json `names`, keyed by sha256(sym).
 *   d>=1, a CHUNK         -> a short English clause naming what the whole multi-statement run DOES.
 *                            Written to `chunks`, keyed by sha256(ordered leaf skeletons).
 *
 * WHY A CLAUSE AND NOT AN IDENTIFIER. `refine-language.js` names mined composites in a compose-layer
 * library, where a lowerCamelCase identifier is the right shape. These names are rendered INTO
 * ENGLISH PROSE by enfile's label path, so `chargeCommission` would read as notation in the middle
 * of a sentence. The validator below therefore enforces clause shape, not IDENT — the one place this
 * module deliberately differs from its precedent, and it is a spelling rule, not a grammar one.
 *
 * REJECTION IS FREE AND SILENCE IS SAFE. A name that fails validation costs a re-ask, never a corpus
 * edit; a word left unnamed falls back to spanProse, which is the honest failure word-names.js was
 * built around. So the retry policy can afford to be shallow, and is (Q-9 proposal, §5D.3F).
 */
const fs = require("fs");
const { spawnSync } = require("child_process");
const sdd = require("../../sdd-lib");

/* Label sentinels (enfile.js:149) plus the dictionary's own hole markers. A name carrying ⟪ or ▶
 * would corrupt the span scan; a name carrying ‹…› would look like an unfilled hole to a reader.
 * Both are REFUSED rather than sanitized: a silently rewritten name is a name nobody chose. */
const FORBIDDEN = /[«»⟪⟫▶‹›]/;
const MAX_LEN = 80;
const MIN_LEN = 3;

/* A clause, not a sentence and not an identifier. Bans a trailing period so the renderer keeps
 * ownership of punctuation — the model supplies the WORD, code supplies the sentence (§5D.3A). */
function validateName(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "not a string" };
  const name = raw.trim();
  if (name.length < MIN_LEN) return { ok: false, reason: "too short to be a clause" };
  if (name.length > MAX_LEN) return { ok: false, reason: `longer than ${MAX_LEN} chars — a name, not a paragraph` };
  if (/[\r\n]/.test(name)) return { ok: false, reason: "contains a newline — a name is one clause" };
  if (FORBIDDEN.test(name)) return { ok: false, reason: "contains a render sentinel or hole marker (« » ⟪ ⟫ ▶ ‹ ›)" };
  if (/[.!?]$/.test(name)) return { ok: false, reason: "ends with sentence punctuation — code owns the sentence, the model owns the word" };
  if (/^[A-Z]/.test(name) && !/^[A-Z]{2,}/.test(name)) return { ok: false, reason: "starts with a capital — a clause is spliced mid-sentence" };
  if (!/[a-z]/.test(name)) return { ok: false, reason: "no lowercase letters — not English prose" };
  return { ok: true, name };
}

/**
 * INJECTIVITY (§5E.4, §5D.2's gate): two distinct words must not render to the same phrase, or the
 * `.en` stops being readable back to a unique word. Enforced PER AXIS: the wide and narrow axes
 * generalize differently and the same text under two axes is genuinely two entries, so an identical
 * clause there is one word seen twice, not a collision. Anything else is rejected.
 */
function makeInjectivityLedger(existing) {
  const seen = new Map(); // axis -> Map(lowercased name -> key)
  const add = (axis, name, key) => {
    if (!seen.has(axis)) seen.set(axis, new Map());
    seen.get(axis).set(name.toLowerCase(), key);
  };
  for (const [key, rec] of Object.entries(existing || {})) {
    if (rec && rec.en) add(key.slice(0, 1), rec.en, key);
  }
  return {
    claim(axis, name, key) {
      const map = seen.get(axis);
      const prior = map && map.get(name.toLowerCase());
      if (prior && prior !== key) return { ok: false, reason: `collides with the name already held by ${prior} (injectivity)` };
      add(axis, name, key);
      return { ok: true };
    },
  };
}

/* ------------------------------------------------------------------ the prompt */

const SYSTEM = {
  leaf: [
    "You are naming STATEMENT SHAPES mined from a TypeScript codebase so they can be read as English.",
    "Each shape is one statement with its specifics replaced by holes: ‹id› an identifier, ‹m› a method,",
    "‹args› arguments, ‹str› a string, ‹type› a type, ‹expr› an expression, ‹gap› whitespace.",
    "Write a SHORT ENGLISH CLAUSE saying what a statement of that shape DOES — lowercase, no trailing",
    "period, under 80 characters, no code identifiers from the examples (they are not part of the shape).",
    "Example: for `const ‹id› = await ‹id›.‹m›(‹args›);` write \"await a method call and keep the result\".",
    "Output ONLY a JSON array [{\"index\": <n>, \"name\": \"<clause>\", \"rationale\": \"<short why>\"}].",
    "No prose, no markdown fences — just the JSON array.",
  ].join(" "),
  chunk: [
    "You are naming recurring MULTI-STATEMENT PATTERNS mined from a TypeScript codebase.",
    "Each pattern is a fixed run of statement shapes that recurs across the codebase; you are given the",
    "shapes it is made of, the English names already assigned to those shapes, and real call-sites.",
    "Write a SHORT ENGLISH CLAUSE naming what the WHOLE run does as one action — lowercase, no trailing",
    "period, under 80 characters. Name the pattern's purpose, not its statement kinds.",
    "Output ONLY a JSON array [{\"index\": <n>, \"name\": \"<clause>\", \"rationale\": \"<short why>\"}].",
    "No prose, no markdown fences — just the JSON array.",
  ].join(" "),
};

/** The evidence block for one row. Code builds every character of this. */
function blockFor(row, i, opts) {
  const lines = [`#${i}  (seen at ${row.sites} site${row.sites === 1 ? "" : "s"})`];
  if (row.depth === 0) {
    lines.push(`    shape: ${row.sym}`);
  } else {
    lines.push(`    a run of ${row.leaves.length} statements:`);
    for (const sym of row.leaves.slice(0, 12)) {
      const named = opts.namesBySym && opts.namesBySym[sym];
      lines.push(`      - ${sym}${named ? `   [named: ${named}]` : ""}`);
    }
    if (row.leaves.length > 12) lines.push(`      - ... and ${row.leaves.length - 12} more`);
  }
  for (const s of (row.snippets || []).slice(0, 2)) lines.push(`    seen as: ${s}`);
  if (row.files && row.files.length) lines.push(`    in: ${row.files.slice(0, 3).join(", ")}`);
  return lines.join("\n");
}

function buildPrompt(rows, opts = {}) {
  const kind = rows[0] && rows[0].depth === 0 ? "leaf" : "chunk";
  const body = rows.map((r, i) => blockFor(r, i, opts)).join("\n\n");
  const rejected = (opts.rejected || []).length
    ? ["", "These were rejected on the previous attempt — the reason is given; do not repeat the mistake:",
       ...opts.rejected.map((r) => `  #${r.index} "${r.name}" — ${r.reason}`)].join("\n")
    : "";
  return {
    system: SYSTEM[kind],
    user: [
      kind === "leaf"
        ? "Name each statement shape below. Return a JSON array keyed by #index."
        : "Name each recurring pattern below. Return a JSON array keyed by #index.",
      "",
      body,
      rejected,
      "",
      "Output ONLY the JSON array [{index, name, rationale}].",
    ].join("\n"),
  };
}

/* ------------------------------------------------------------------ transport */

/**
 * TRANSPORT — Q-9 asked "a `namer` module with the prompt in-repo, versus shelling to a CLI".
 * PROPOSED, not ruled (§5D.3F): the module is in-repo and it shells to the `claude` CLI, which is
 * what `refine-language.js` already does — one transport in the tree, one place to change it, and
 * no API key handling of our own. `--stub <file>` replaces the call with a file for tests, so the
 * whole pipeline is exercisable with zero model calls.
 */
function callModel(prompt, opts = {}) {
  if (opts.stub) return { raw: fs.readFileSync(opts.stub, "utf8"), calls: 0 };
  const model = opts.model || sdd.DEFAULT_MODEL;
  const res = spawnSync("claude", ["-p", "--model", model, "--append-system-prompt", prompt.system],
    { input: prompt.user, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: opts.timeoutMs || 240000 });
  if (res.error) throw new Error(`claude CLI could not be run: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`claude CLI failed (status ${res.status}): ${(res.stderr || "").slice(0, 500)}`);
  return { raw: res.stdout, calls: 1 };
}

/** Parse the ONLY shape the model is permitted to return. A stray sentence around the array is
 *  tolerated; anything that is not an array of {index,name} is a hard failure, not a salvage job. */
function parseProposals(raw) {
  const m = String(raw).match(/\[[\s\S]*\]/);
  if (!m) throw new Error("model did not return a JSON array of proposals");
  let arr;
  try { arr = JSON.parse(m[0]); } catch (e) { throw new Error("model returned unparseable JSON: " + e.message); }
  if (!Array.isArray(arr)) throw new Error("model returned JSON that is not an array");
  return arr.filter((p) => p && typeof p.index === "number");
}

/**
 * Name ONE batch, with the shallow retry Q-9 leaves open. Returns
 * {accepted:[{key,axis,name,rationale,sym|leaves}], rejected:[...], calls}.
 * A row that is still unnamed after `retries` is LEFT UNNAMED — the fallback is spanProse and that
 * is a correct render, so failing to name is never a reason to fail the run.
 */
function nameBatch(rows, ledger, opts = {}) {
  const retries = opts.retries === undefined ? 1 : opts.retries;
  const accepted = [];
  let pending = rows.map((r, i) => ({ row: r, index: i }));
  let rejected = [];
  let calls = 0;

  for (let attempt = 0; attempt <= retries && pending.length; attempt++) {
    const promptRows = pending.map((p) => p.row);
    const prompt = buildPrompt(promptRows, Object.assign({}, opts, { rejected: attempt ? rejected : [] }));
    const res = callModel(prompt, attempt === 0 ? opts : Object.assign({}, opts, { stub: opts.retryStub || opts.stub }));
    calls += res.calls;
    const byIndex = new Map(parseProposals(res.raw).map((p) => [p.index, p]));

    const stillPending = [];
    rejected = [];
    for (let i = 0; i < pending.length; i++) {
      const { row } = pending[i];
      const p = byIndex.get(i);
      if (!p) { rejected.push({ key: row.key, index: i, name: null, reason: "no proposal returned" }); stillPending.push(pending[i]); continue; }
      const v = validateName(p.name);
      if (!v.ok) { rejected.push({ key: row.key, index: i, name: String(p.name).slice(0, 100), reason: v.reason }); stillPending.push(pending[i]); continue; }
      const inj = ledger.claim(row.axis, v.name, row.key);
      if (!inj.ok) { rejected.push({ key: row.key, index: i, name: v.name, reason: inj.reason }); stillPending.push(pending[i]); continue; }
      accepted.push({ key: row.key, axis: row.axis, depth: row.depth, name: v.name, rationale: String(p.rationale || "").slice(0, 200), sym: row.sym, leaves: row.leaves, sites: row.sites });
    }
    pending = stillPending;
  }
  return { accepted, rejected, unnamed: pending.map((p) => p.row.key), calls };
}

module.exports = { FORBIDDEN, MAX_LEN, MIN_LEN, validateName, makeInjectivityLedger, buildPrompt, parseProposals, callModel, nameBatch, SYSTEM };
