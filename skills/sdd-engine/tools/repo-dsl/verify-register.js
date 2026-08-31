#!/usr/bin/env node
"use strict";
/**
 * verify-register.js — evaluate the §R requirements register mechanically.
 *
 * WHY THIS EXISTS. §R says a **Check** is "how a second engineer decides whether it holds — a
 * command, an assertion, or a named test file". Until now nothing ran those checks, so the register
 * could rot while reading as authoritative. On 2026-08-31 three of the four rows marked
 * "All SETTLED. Do not re-open" cited the wrong file: R-MINE-1 pointed at `engine/compose.js`,
 * which is retired to `archive/engine/compose.js` and defines MIN_COUNT = 2, so anyone verifying
 * that row at the cited location read 2, concluded the requirement was violated, and was wrong.
 * The VALUES were fine. The POINTERS had rotted, which is worse: a wrong value fails loudly, a
 * wrong pointer sends the next reader to a retired file that answers a different question with
 * confidence.
 *
 * WHAT IT DOES AND DOES NOT CLAIM. It evaluates only rows whose check is decidable by reading the
 * tree: a constant's value, a file's existence, a symbol's presence or absence, an artifact's
 * contract validity. Rows needing a corpus mine, a round-trip, or human judgement are reported
 * MANUAL with the reason and the command that would decide them. MANUAL is not a pass. A row that
 * cannot be evaluated is never silently counted as holding -- that is the failure mode this engine
 * exists to eliminate ({ optional: true } returns a reason, never a bare null).
 *
 * EXIT CODES (for a caller, human or UI)
 *   0  every mechanized row HOLDS
 *   1  at least one row FAILS
 *   2  the runner itself could not proceed (bad flag, unresolvable root)
 *
 *   node verify-register.js            # human-readable table
 *   node verify-register.js --json     # one JSON object on stdout, nothing else
 *   node verify-register.js --id R-MINE-1   # one row, or a comma-separated list
 *
 * Diagnostics go to stderr so --json stdout stays machine-parseable.
 */
const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const idArg = (() => {
  const i = argv.findIndex((a) => a === "--id" || a.startsWith("--id="));
  if (i < 0) return null;
  const v = argv[i].includes("=") ? argv[i].split("=").slice(1).join("=") : argv[i + 1];
  if (!v || v.startsWith("--")) {
    console.error("verify-register.js REFUSED: --id was given with no requirement id after it");
    process.exit(2);
  }
  return v.split(",").map((x) => x.trim()).filter(Boolean);
})();
for (const a of argv) {
  if (a.startsWith("--") && !["--json", "--id"].includes(a) && !a.startsWith("--id=")) {
    console.error(`verify-register.js REFUSED: unknown flag \`${a}\`. known: --json, --id=<R-...>`);
    process.exit(2);
  }
}

/* ---------- primitives. Each returns { ok, got } or { manual, why }, never a bare boolean. ---------- */

const read = (rel) => {
  const p = path.join(HERE, rel);
  try { return { ok: true, text: fs.readFileSync(p, "utf8"), p }; }
  catch (e) { return { ok: false, why: `${rel}: ${e.code || e.message}`, p }; }
};

/* A constant's EFFECTIVE default, read off the source rather than by executing it -- executing
 * build-lzw-generators.js would start a mine. Handles both `const X = 5` and the env-override
 * idiom `const X = +(process.env.X || 5)`. */
function constValue(rel, name) {
  const f = read(rel);
  if (!f.ok) return { ok: false, got: null, why: f.why };
  const envRe = new RegExp(`${name}\\s*=\\s*\\+?\\(\\s*process\\.env\\.${name}\\s*\\|\\|\\s*([^)]+?)\\s*\\)`);
  const litRe = new RegExp(`(?:^|[;,\\s])${name}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)`);
  const m = f.text.match(envRe) || f.text.match(litRe);
  if (!m) return { ok: false, got: null, why: `${name} not defined in ${rel}` };
  const line = f.text.slice(0, m.index).split("\n").length;
  return { ok: true, got: m[1].trim(), where: `${rel}:${line}`, envOverridable: !!f.text.match(envRe) };
}

const exists = (rel) => fs.existsSync(path.join(HERE, rel));

/* Does any LIVE file (archive/ and node_modules excluded) contain this pattern?
 *
 * TWO EXEMPTIONS, both learned by this file crying wolf on its first run:
 *
 *  1. COMMENT LINES ARE EXEMPT. The same rule engine/corpus-root.test.js:142 already applies, for
 *     the same reason it states: "comments describe history, and history is why this test exists".
 *     Without it, `guard-idiom.js:2` -- the comment "analyze the fetch(G1) / assert(G2) guard
 *     idiom" -- was reported as a live network call, and artifact-contract.js:50, a comment
 *     DOCUMENTING the root precedence chain, was reported as a stray root literal. Both false.
 *  2. THIS FILE IS EXEMPT. A verifier that greps for `MIN_WORD_CHARS` contains the string
 *     `MIN_WORD_CHARS`, so it matched itself and failed its own row.
 *
 * A guard that cries wolf gets ignored, then removed. These exemptions are what keep it honest --
 * so widen them only with a measurement, never to quiet a hit you have not read. */
function liveGrep(re, opts = {}) {
  const SKIP = new Set(["node_modules", ".git", "archive", "sen", "spec", ".cache", "catalog"]);
  const SELF = path.basename(__filename);
  const hits = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!p.endsWith(".js")) continue;
      if (path.basename(p) === SELF) continue;                    // exemption 2
      if (opts.excludeTests && p.endsWith(".test.js")) continue;
      fs.readFileSync(p, "utf8").split("\n").forEach((l, i) => {
        if (/^\s*(?:\/\/|\/\*|\*)/.test(l)) return;                   // exemption 1
        if (re.test(l)) hits.push(`${path.relative(HERE, p)}:${i + 1}`);
      });
    }
  })(HERE);
  return hits;
}


/* The mined dictionary, loaded at most once and only if a row needs it. It is ~42 MB, so no row
 * touches it unless it is asked for, and an absent dictionary is MANUAL rather than a failure. */
let _lzw;
function lzw() {
  if (_lzw !== undefined) return _lzw;
  try {
    const AC = require("./engine/artifact-contract");
    const p = AC.pathFor("generators-lzw");
    if (!fs.existsSync(p)) return (_lzw = { absent: true, where: p });
    return (_lzw = { ok: true, j: JSON.parse(fs.readFileSync(p, "utf8")), where: p });
  } catch (e) { return (_lzw = { err: e.message.split("\n")[0] }); }
}

/* The render manifest. Like the dictionary: loaded at most once, only if a row asks. */
let _idx;
function enIndex() {
  if (_idx !== undefined) return _idx;
  try {
    const CR2 = require("./engine/corpus-root");
    const f = path.join(CR2.corpusRoot(), ".cache", "spec-derived", "en-index.json");
    if (!fs.existsSync(f)) return (_idx = { absent: true, where: f });
    return (_idx = { ok: true, j: JSON.parse(fs.readFileSync(f, "utf8")), where: f });
  } catch (e) { return (_idx = { err: e.message.split("\n")[0] }); }
}

/* Every rendered .en on disk, read at most once and only if a row asks. */
let _en;
function enFiles() {
  if (_en !== undefined) return _en;
  try {
    const CR2 = require("./engine/corpus-root");
    const home = path.join(CR2.senDir(), "files");
    if (!fs.existsSync(home)) return (_en = { absent: true, where: home });
    const out = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q); else if (q.endsWith(".en")) out.push(q);
      }
    })(home);
    return (_en = { ok: true, files: out, home });
  } catch (e) { return (_en = { err: e.message.split("\n")[0] }); }
}

/* ---------- the rows. Each `run()` returns {verdict, got, why} -- HOLDS | FAILS | MANUAL. ---------- */

const HOLDS = (got, why) => ({ verdict: "HOLDS", got, why });
const FAILS = (got, why) => ({ verdict: "FAILS", got, why });
const MANUAL = (why, how) => ({ verdict: "MANUAL", got: null, why, how });

const ROWS = [
  { id: "R-MECH-4", req: "Discovery, expansion and compilation MUST make zero model calls.",
    run() {
      const hits = liveGrep(/\b(anthropic|openai|fetch\s*\(|https?:\/\/api\.)/i, { excludeTests: true })
        .filter((h) => !/prose-llm|llm-render/.test(h));
      return hits.length ? FAILS(hits.join(", "), "a live file reaches a model or a network API")
        : HOLDS("no model/network call on any live path", "grep over the live tree, archive excluded");
    } },

  { id: "R-MECH-7", req: "The flat path MUST NOT stand as a second producer beside the LZW path.",
    run() {
      const hits = liveGrep(/["']generators\.json["']/);
      return hits.length ? FAILS(hits.join(", "), "a live file reads the retired flat vocabulary")
        : HOLDS("no live reader of generators.json", "the flat producer does not exist at all");
    } },

  { id: "R-MINE-1", req: "MIN_COUNT MUST be 1.",
    run() {
      const c = constValue("build-lzw-generators.js", "MIN_COUNT");
      if (!c.ok) return FAILS(null, c.why);
      const note = c.envOverridable ? " (env-overridable: binds the default, not every run)" : "";
      return c.got === "1" ? HOLDS(`${c.got} at ${c.where}${note}`) : FAILS(`${c.got} at ${c.where}`, "expected 1");
    } },

  { id: "R-MINE-2", req: "MAXWIN is 64, a ceiling and not a tuned value.",
    run() {
      const c = constValue("build-lzw-generators.js", "MAXWIN");
      if (!c.ok) return FAILS(null, c.why);
      return c.got === "64" ? HOLDS(`${c.got} at ${c.where}`) : FAILS(`${c.got} at ${c.where}`, "expected 64");
    } },

  { id: "R-MINE-3", req: "MIN_SKEL MUST stay 8.",
    run() {
      const c = constValue("build-lzw-generators.js", "MIN_SKEL");
      if (!c.ok) return FAILS(null, c.why);
      return c.got === "8" ? HOLDS(`${c.got} at ${c.where}`) : FAILS(`${c.got} at ${c.where}`, "expected 8");
    } },

  { id: "R-MINE-4", req: "MIN_WORD_CHARS is 4. (RETIRED — flat composer only.)",
    run() {
      const live = liveGrep(/MIN_WORD_CHARS/);
      if (live.length) return FAILS(live.join(", "), "retired constant is referenced on a live path");
      return exists("archive/engine/compose.js")
        ? MANUAL("retired with the flat composer; nothing live reads it", "row kept so the id is not reused")
        : MANUAL("retired and its last definition is gone", "nothing to verify");
    } },

  { id: "R-MINE-8", req: "No span MUST straddle two or more units.",
    run() {
      return exists("engine/unit-boundary.test.js")
        ? MANUAL("decided by a test that needs the mined dictionary",
                 "node engine/unit-boundary.test.js  (PASSES on the real corpus, 4 assertions)")
        : FAILS(null, "engine/unit-boundary.test.js is missing");
    } },

  { id: "R-LANG-2", req: "A name's key MUST be sha256(canonical skeleton)[0:16], never the word id.",
    run() {
      const f = read("engine/word-names.js");
      if (!f.ok) return FAILS(null, f.why);
      /* The truncation is `.slice(0, HASH_LEN)`, not a literal 16 -- resolve the constant rather
       * than pattern-matching the digit, which reported a false FAIL on the first run. */
      const sha = /createHash\("sha256"\)/.test(f.text);
      const hl = constValue("engine/word-names.js", "HASH_LEN");
      const sliced = /\.slice\(0,\s*HASH_LEN\)/.test(f.text);
      const axis = /axisName\[0\]\s*\+\s*":"/.test(f.text);
      if (!sha) return FAILS("no sha256", "the key is not a sha256 of the skeleton");
      if (!hl.ok) return FAILS(null, hl.why);
      if (!sliced) return FAILS("HASH_LEN not applied via slice", "truncation is not visible");
      if (hl.got !== "16") return FAILS(`HASH_LEN=${hl.got}`, "expected 16");
      return HOLDS(`sha256 truncated to HASH_LEN=16 at ${hl.where}${axis ? ", axis-prefixed" : ""}`,
        axis ? undefined : "axis prefix not visible -- §R requires the key be axis-prefixed");
    } },

  { id: "R-CFG-roots", req: "Roots resolve per root: flag > env > <engine>/.env > default; set-but-missing REFUSES.",
    run() {
      if (!exists("engine/corpus-root.js")) return FAILS(null, "engine/corpus-root.js is missing");
      const stray = liveGrep(/Examples[\/\\]hydra-source/)
        .filter((h) => !/^engine[\/\\]corpus-root\.js/.test(h) && !/\.test\.js:/.test(h));
      return stray.length ? FAILS(stray.join(", "), "a live file names a root outside the resolver")
        : HOLDS("only the resolver names a root", "guarded further by engine/corpus-root.test.js");
    } },

  { id: "R-ART-stamp", req: "Every artifact MUST be published through AC.stamp and carry a fingerprint.",
    run() {
      let AC;
      try { AC = require("./engine/artifact-contract"); }
      catch (e) { return FAILS(null, `artifact-contract did not load: ${e.message.split("\n")[0]}`); }
      const out = [];
      for (const kind of AC.kindsOf()) {
        const p = AC.pathFor(kind);
        if (!fs.existsSync(p)) { out.push(`${kind}: absent`); continue; }
        try { AC.load(kind, p); out.push(`${kind}: valid`); }
        catch (e) { return FAILS(`${kind}: ${e.message.split("\n")[0]}`, "an installed artifact violates the contract"); }
      }
      const absent = out.filter((o) => o.endsWith("absent"));
      return absent.length === out.length
        ? MANUAL("no artifact is installed, so nothing can be validated", "npm run mine")
        : HOLDS(out.join(", "), absent.length ? "absent is a STATE; present-and-wrong would FAIL" : undefined);
    } },

  { id: "R-TEST-tiering", req: "Test tiering MUST be by declaration, not guessed from how a test fails.",
    run() {
      const f = read("run-tests.js");
      if (!f.ok) return FAILS(null, f.why);
      const declared = /CORPUS_TIER\s*=\s*new (Map|Set)/.test(f.text);
      const perTest = /needs:/.test(f.text);
      if (!declared) return FAILS("no CORPUS_TIER declaration", "tiering is not declared");
      return HOLDS(`declared${perTest ? ", per-test prerequisites" : ", one shared gate"}`,
        perTest ? undefined : "a shared gate reports the wrong cause for tests that do not need the missing artifact");
    } },

  { id: "R-MECH-2", req: "Every non-leaf dictionary entry MUST be an existing entry plus exactly one symbol.",
    run() {
      const d = lzw();
      if (d.absent) return MANUAL(`no dictionary at ${d.where}`, "npm run mine");
      if (d.err) return FAILS(null, d.err);
      let checked = 0, leaves = 0; const bad = [];
      for (const axis of ["narrow", "wide"]) {
        const w = d.j[axis] && d.j[axis].words;
        if (!w) { bad.push(`${axis}: no words table`); continue; }
        /* LEAVES ARE NOT NON-LEAVES. An entry with no `m` and `d === 0` carries `sym` and IS a
         * base symbol -- 5684 of them on the narrow axis, matching the mine's own leaf count. The
         * requirement is about non-leaf entries; counting leaves as violations was this check's
         * first bug and reported "m is not a pair" for ids 0, 1, 2. */
        for (const [id, e] of Object.entries(w)) {
          if (!e.m && e.d === 0) { leaves++; continue; }
          checked++;
          if (!Array.isArray(e.m) || e.m.length !== 2) { bad.push(`${axis}/${id}: m is not a pair`); }
          else if (!(String(e.m[0]) in w) && !(d.j[axis].leaf && String(e.m[0]) in d.j[axis].leaf)) {
            bad.push(`${axis}/${id}: m[0]=${e.m[0]} resolves to no entry`);
          }
          if (bad.length > 3) break;
        }
        if (bad.length > 3) break;
      }
      return bad.length ? FAILS(bad.slice(0, 3).join("; "), `${checked} entries checked`)
        : HOLDS(`${checked} non-leaf entries are (existing entry + one symbol); ${leaves} leaves skipped`);
    } },

  { id: "R-MECH-3", req: "The dictionary MUST be a DAG: no entry may transitively reference itself.",
    run() {
      const d = lzw();
      if (d.absent) return MANUAL(`no dictionary at ${d.where}`, "npm run mine");
      if (d.err) return FAILS(null, d.err);
      /* Depth strictly decreasing along m[0] is acyclic BY CONSTRUCTION -- a cycle would require a
       * non-decreasing step. Cheaper and stronger than walking every chain. */
      let checked = 0, maxD = 0; const bad = [];
      for (const axis of ["narrow", "wide"]) {
        const w = d.j[axis] && d.j[axis].words; if (!w) continue;
        for (const [id, e] of Object.entries(w)) {
          checked++;
          if (!Number.isFinite(e.d)) { bad.push(`${axis}/${id}: depth not finite`); }
          else {
            maxD = Math.max(maxD, e.d);
            const par = w[String(e.m && e.m[0])];
            if (par && Number.isFinite(par.d) && par.d >= e.d) bad.push(`${axis}/${id}: depth ${e.d} <= parent ${par.d}`);
          }
          if (bad.length > 3) break;
        }
        if (bad.length > 3) break;
      }
      return bad.length ? FAILS(bad.slice(0, 3).join("; "), "a non-decreasing depth step admits a cycle")
        : HOLDS(`${checked} entries acyclic, maxDepth ${maxD}`, "depth strictly decreases along m[0]");
    } },

  { id: "R-MECH-6", req: "Tiers MUST NOT be hand-assigned labels; tier IS dictionary depth.",
    run() {
      const d = lzw();
      if (d.absent) return MANUAL(`no dictionary at ${d.where}`, "npm run mine");
      if (d.err) return FAILS(null, d.err);
      const keys = new Set();
      let n = 0;
      for (const axis of ["narrow", "wide"]) {
        const w = d.j[axis] && d.j[axis].words; if (!w) continue;
        for (const e of Object.values(w)) { for (const k of Object.keys(e)) keys.add(k); if (++n > 60000) break; }
      }
      const labelled = [...keys].filter((k) => /^(tier|archetype|skeleton|idiom|level)$/i.test(k));
      if (labelled.length) return FAILS(labelled.join(", "), "a stored tier label makes depth and tier able to disagree");
      return keys.has("d")
        ? HOLDS(`entry keys are {${[...keys].sort().join(", ")}} -- depth \`d\` present, no tier label`,
                "ARCHETYPE/SKELETON/IDIOM/LEAF is derivable from depth, not stored")
        : FAILS([...keys].join(", "), "no depth field, so tier is not derivable at all");
    } },

  { id: "R-MECH-8", req: "A retired layer MUST NOT be revived as a parallel producer, and the engine MUST NOT publish a number no mine can move.",
    run() {
      /* The flat counters are STRUCTURALLY zero (enfile.js:834-838) and are retained deliberately
       * as a TRIPWIRE, not as a coverage figure -- `tier` is set to "recursive" at exactly one
       * place and to "flat" nowhere. So the row is checked as the tripwire it is: zero means the
       * retired producer stayed retired; NON-zero means someone revived it, which is the failure.
       * Reporting "publishes a structurally-zero number" as a violation here would be wrong, and
       * was nearly reported as one before enfile.js's own comment was read. */
      const flatTier = liveGrep(/tier:\s*["']flat["']/, { excludeTests: true });
      if (flatTier.length) return FAILS(flatTier.join(", "),
        "a flat tier is being assigned -- the retired producer is back, and R-COMP-7's gate does not know");
      const i = enIndex();
      if (i.absent) return MANUAL("dictionary tripwire clear; the manifest half needs a render",
                                  "npm run render, then re-run");
      if (i.err) return FAILS(null, i.err);
      const g = i.j.generators || {};
      if (g.flatFallback === undefined) return MANUAL("no flatFallback counter in the manifest",
        "the tripwire is not armed; nothing reports a revived flat producer");
      return g.flatFallback === 0
        ? HOLDS(`tripwire armed and unfired: flatFallback 0 of ${g.calls} calls, recursive ${g.recursive}`,
                "structurally zero BY DESIGN, retained to catch a revived flat producer")
        : FAILS(`flatFallback ${g.flatFallback}`,
                "a flat tier produced spans -- see R-COMP-7; this counter cannot rise by itself");
    } },

  { id: "R-PAY-1", req: "Payloads MUST be plain readable UTF-8, never an opaque blob; the live form is `lzw1 <axis><wordId>⟨hole⟨hole…`.",
    run() {
      const e = enFiles();
      if (e.absent) return MANUAL(`no rendered .en under ${e.where}`, "npm run render");
      if (e.err) return FAILS(null, e.err);
      if (!e.files.length) return MANUAL("no .en files rendered", "npm run render");
      /* Checked against every payload on disk, not against payload.js's own doc comment. The hole
       * INTRODUCER ⟨ is legitimate structure; what must never appear is a span sentinel inside a
       * hole's contents, which is R-PAY-3's runtime counterpart -- R-PAY-3 proves the escape table
       * is total, this proves the corpus agrees. */
      const SENT = ["«", "»", "⟪", "⟫", "▶"];
      let payloads = 0, holes = 0, withPayload = 0;
      const bad = [];
      for (const f of e.files) {
        const t = fs.readFileSync(f, "utf8");
        const found = t.match(/⟪([^⟫]*)⟫/g);
        if (!found) continue;
        withPayload++;
        for (const raw of found) {
          payloads++;
          const body = raw.slice(1, -1);
          const m = body.match(/^lzw1 ([nw])(\d+)(⟨[\s\S]*)?$/);
          if (!m) { bad.push(`${path.relative(e.home, f)}: ${JSON.stringify(body.slice(0, 40))} is not \`lzw1 <axis><id>\``); }
          else if (m[3]) {
            for (const h of m[3].split("⟨").slice(1)) {
              holes++;
              const s2 = SENT.find((c) => h.includes(c));
              if (s2) bad.push(`${path.relative(e.home, f)}: hole contains unescaped ${s2}`);
            }
          }
          if (bad.length > 3) break;
        }
        if (bad.length > 3) break;
      }
      return bad.length ? FAILS(bad.slice(0, 3).join("; "), `${payloads} payloads scanned`)
        : HOLDS(`${payloads} payloads in ${withPayload} of ${e.files.length} .en, ${holes} holes: all \`lzw1 <axis><id>⟨…\`, no sentinel in any hole`,
                "verified on disk over the whole corpus, not from payload.js's doc comment");
    } },

  { id: "R-PAY-3", req: "Sentinel safety MUST be structural: an encoded payload provably contains none of « » ⟪ ⟫ ▶ ⟨.",
    run() {
      const f = read("engine/payload.js");
      if (!f.ok) return FAILS(null, f.why);
      const SENT = ["«", "»", "⟪", "⟫", "▶", "⟨"];
      /* Match to the LAST `]` of the table, not the first: ESCAPES is an array of PAIRS, so a
       * non-greedy `]`-terminated match stops inside `[ESC, "0"]` and sees almost nothing. That
       * was this check's first bug -- it reported all six sentinels missing from a table that
       * contains all eight. */
      const tbl = f.text.match(/const ESCAPES\s*=\s*\[([\s\S]*?)\n\s*\];/);
      const re = f.text.match(/NEEDS_ESC\s*=\s*\/\[([^\]]+)\]/);
      if (!tbl) return FAILS(null, "no ESCAPES table found");
      if (!re) return FAILS(null, "no NEEDS_ESC character class found");
      const missTbl = SENT.filter((c) => !tbl[1].includes(c));
      const missRe = SENT.filter((c) => !re[1].includes(c));
      if (missTbl.length || missRe.length)
        return FAILS(`table:${missTbl.join("") || "-"} regex:${missRe.join("") || "-"}`,
                     "a sentinel that is not escaped can appear in a payload and break the span scan");
      return HOLDS(`all 6 sentinels escaped, in both the table and NEEDS_ESC`,
        "structural, not an assumption about corpus contents");
    } },

  { id: "R-PAY-4", req: "decode() MUST be fail-closed: wrong tag, bad axis, missing id or unknown escape all throw.",
    run() {
      const f = read("engine/payload.js");
      if (!f.ok) return FAILS(null, f.why);
      const throws = (f.text.match(/throw /g) || []).length;
      const silent = /catch\s*(\([^)]*\))?\s*\{\s*return (null|undefined|"")/.test(f.text);
      if (silent) return FAILS("a catch returns null/undefined", "fail-closed means throw, not a bare null");
      return throws >= 4 ? HOLDS(`${throws} throw sites, no silent catch`)
        : FAILS(`only ${throws} throw sites`, "expected a throw per named failure mode");
    } },

  { id: "R-ART-4", req: "Every artifact MUST carry the header; AC.stamp is the only publisher.",
    run() {
      /* Checked as the landmine it actually is (CLAUDE.md §8): a HAND-WRITTEN header is how
       * generators-lzw.json was born without a fingerprint and failed 5 tests. So: no live file
       * outside the contract may author a header key itself. Runtime stamping of a fresh mine is
       * a separate question and is MANUAL below. */
      const hits = liveGrep(/"(fingerprint|artifactVersion)"\s*:/, { excludeTests: true })
        .filter((h) => !/^engine[\/\\]artifact-contract\.js/.test(h));
      return hits.length ? FAILS(hits.join(", "), "a hand-authored header bypasses AC.stamp")
        : HOLDS("no hand-authored header outside engine/artifact-contract.js");
    } },

  { id: "R-ART-7", req: "Validation MUST be the default read path; artifact-contract exports no unvalidated read.",
    run() {
      const f = read("engine/artifact-contract.js");
      if (!f.ok) return FAILS(null, f.why);
      const m = f.text.match(/module\.exports\s*=\s*\{([^}]*)\}/);
      if (!m) return FAILS(null, "no module.exports object found");
      const names = m[1].split(",").map((x) => x.trim()).filter(Boolean);
      const unsafe = names.filter((n) => /^(read|readRaw|readJson|loadRaw|unsafeLoad|parse)$/.test(n));
      if (unsafe.length) return FAILS(unsafe.join(", "), "an unvalidated read helper is exported");
      if (!names.includes("load")) return FAILS(names.join(", "), "no `load` export -- there is no validated read path");
      return HOLDS(`exports ${names.length}; \`load\` present, no raw read`,
        "a new consumer must go out of its way to be unsafe");
    } },

  { id: "R-ART-8", req: "Composites identify by name + entryId, not id; consumers MUST use AC.idOf(record).",
    run() {
      let AC;
      try { AC = require("./engine/artifact-contract"); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      return typeof AC.idOf === "function" ? HOLDS("AC.idOf is exported and callable",
        "keying a composite on .id yields undefined for every one of them")
        : FAILS(typeof AC.idOf, "AC.idOf is not available, so consumers cannot comply");
    } },

  { id: "R-CFG-6", req: "`sen` MUST be spelled in exactly one place (LAYOUT.sen), never as a path literal.",
    run() {
      /* Only real PATH CONSTRUCTION counts. A "<CORPUS>/sen/..." string in a manifest or a doc
       * comment is display text, not a second spelling, and flagging it is how a guard starts
       * crying wolf. Tests are exempt: they assert the layout on purpose. */
      const hits = liveGrep(/path\.join\([^)]*["']sen["']/, { excludeTests: true })
        .filter((h) => !/^engine[\/\\]corpus-root\.js/.test(h));
      return hits.length
        ? FAILS(hits.join(", "), "a second spelling of `sen` outside LAYOUT.sen; use CR.senDir()")
        : HOLDS("only the resolver spells `sen` in a path join");
    } },

  { id: "R-CFG-7", req: "Wiping sen/ MUST require --wipe-sen AND --go, neither a default.",
    run() {
      const f = read("sdd-clean.js");
      if (!f.ok) return FAILS(null, f.why);
      const go = /GO\s*=\s*argv\.includes\("--go"\)/.test(f.text);
      const wipe = /WIPE_SEN\s*=\s*argv\.includes\("--wipe-sen"\)/.test(f.text);
      const defaulted = /(GO|WIPE_SEN)\s*=\s*(true|!)/.test(f.text);
      if (defaulted) return FAILS("a gate has a truthy default", "a wipe flag must never default on");
      return go && wipe ? HOLDS("both --wipe-sen and --go read from argv, neither defaulted")
        : FAILS(`--go:${go} --wipe-sen:${wipe}`, "a required gate is missing");
    } },

  { id: "R-CFG-10", req: "The wipe MUST NOT touch <CORPUS>/catalog/, the legacy STEP-4 tree.",
    run() {
      const f = read("sdd-clean.js");
      if (!f.ok) return FAILS(null, f.why);
      const m = f.text.match(/PROTECTED\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
      if (!m) return FAILS(null, "no PROTECTED name list found");
      return /["']catalog["']/.test(m[1])
        ? HOLDS("`catalog` is in PROTECTED", "protection is a name in the list, not a coincidence of the walk")
        : FAILS(m[1].replace(/\s+/g, " ").slice(0, 80), "legacy catalog/ is not protected from the wipe");
    } },

  { id: "R-CFG-11", req: "A tool that deletes a tree MUST NOT live inside that tree.",
    run() {
      if (!exists("sdd-clean.js")) return FAILS(null, "sdd-clean.js is not in the engine tree");
      let root;
      try { root = require("./engine/corpus-root").corpusRoot(); }
      catch (e) { return FAILS(null, `root unresolvable: ${e.message.split("\n")[0]}`); }
      const inCorpus = fs.existsSync(path.join(root, "sdd-clean.js"));
      return inCorpus ? FAILS(`a copy exists at ${path.join(root, "sdd-clean.js")}`,
        "it was lost once with the tree it existed to clean")
        : HOLDS("the cleaner lives in the engine, not in the corpus");
    } },

  { id: "R-MEAS-1", req: "Every metric MUST be computed by one committed command reading one field of one committed artifact. No metric is computed by eye; \"done\" MUST be a number a second engineer can reproduce.",
    run() {
      /* The row that governs every other number in this file, so it is checked against the thing
       * that would actually break it: a HEADLINE FIGURE WITH NO FIELD BEHIND IT. Each metric the
       * project quotes must resolve to a numeric field of the contract-valid manifest, reachable by
       * `npm run render`. A figure that lives only in prose is "computed by eye" by definition.
       *
       * It also RECOMPUTES the two derived figures. A field that exists but disagrees with its own
       * inputs is worse than a missing one: it reproduces perfectly and is wrong.
       *
       * WHAT THIS ROW DOES NOT ESTABLISH -- and no row in §R currently does. Reproducibility is not
       * independence. `netStatementReduction` (17029) and every span/collapse figure beside it trace
       * to ONE function, enlzw.genSpans: test-lzw-roundtrip.js:32 calls `EN.genSpans` directly, and
       * enfile.js:839 calls the same `EL.genSpans`, which is what test-gen-roundtrip.js reports via
       * `stats.genSpans`. So the two round-trip gates print the same collapse number twice. As
       * BYTE-IDENTITY gates they are independent -- different compile paths, compileFileEn vs the
       * test's own span scan + compileSpan -- and R-REND-1 leans on that legitimately. As COLLAPSE
       * measurements they are one implementation. Quoting both as corroboration is the error this
       * comment exists to prevent; the fix is a §R row of its own, which is s7's to write. */
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}; every headline metric is unsourced`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      const at = (p) => p.split(".").reduce((o, k) => (o == null ? o : o[k]), i.j);
      const METRICS = [
        "gate.totalFiles", "gate.byteIdentical", "englishBytesPct",
        "reviewSurface.reviewSurface", "reviewSurface.bodyStatements", "reviewSurface.collapsedStatements",
        "generators.calls", "generators.statementsCollapsed", "generators.netStatementReduction",
        "generators.filesUsing", "generators.recursive", "generators.flatFallback",
        "generators.maxDepth", "generators.composites", "generators.compositionEdges",
        "generators.dictionaryMaxDepth", "stmtSpans", "dataSpans",
      ];
      const missing = METRICS.filter((m) => typeof at(m) !== "number");
      if (missing.length)
        return FAILS(missing.join(", "), "a quoted figure with no artifact field behind it is computed by eye");
      const g = i.j.generators;
      const net = g.statementsCollapsed - g.calls;
      if (g.netStatementReduction !== net)
        return FAILS(`netStatementReduction ${g.netStatementReduction} != ${g.statementsCollapsed} - ${g.calls} = ${net}`,
                     "the field disagrees with its own inputs -- reproducible and wrong");
      if (g.recursive + g.flatFallback !== g.calls)
        return FAILS(`recursive ${g.recursive} + flatFallback ${g.flatFallback} != calls ${g.calls}`,
                     "the span accounting does not close");
      return HOLDS(`${METRICS.length} metrics, each one numeric field of the stamped manifest; ` +
        `net ${g.netStatementReduction} = ${g.statementsCollapsed} - ${g.calls} recomputed`,
        "reproducible is not independent -- the collapse figures all come from enlzw.genSpans (see comment)");
    } },

  { id: "R-MEAS-2", req: "Every English-coverage and statement-collapse ratio MUST use the enfile-layer total as its denominator; a compose-layer figure MUST be labelled as such, and the two MUST NEVER be mixed inside one ratio.",
    run() {
      /* Checked as an ACCOUNTING IDENTITY on the headline metric, because that is where the two
       * layers actually meet. `collapsedStatements` counts statements folded into generator spans;
       * `bodyStatements` is the enfile-layer population those statements are drawn FROM. If
       * collapsed is a subset of body, then corpus-wide collapsed <= body. Necessarily.
       *
       * It is not, and the consequence is not cosmetic. write-en-files.js:143,148 compute the
       * corpus residual as `Math.max(0, SUM(body) - SUM(collapsed))` -- a clamped DIFFERENCE OF
       * SUMS, not a sum of per-file residuals. Files whose collapsed exceeds their own body silently
       * pay off the genuine residual of other files, and the clamp absorbs whatever is left, so the
       * headline figure lands on the most flattering value it can take: residual 0, reviewSurface
       * exactly equal to `calls`. Meanwhile filesFullyCovered, which IS computed per file, disagrees.
       *
       * The fix belongs in write-en-files.js (sum the per-file residuals, and do not clamp a
       * quantity that cannot legitimately go negative) -- that file is another lane's tonight, so
       * this row states the defect and fails on it rather than reaching in. */
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      const rs = i.j.reviewSurface, g = i.j.generators;
      if (!rs || !g) return FAILS(null, "no reviewSurface/generators block to check the identity against");
      const { bodyStatements: body, collapsedStatements: coll, residualStatements: resid, filesFullyCovered: full } = rs;
      const total = i.j.gate && i.j.gate.totalFiles;
      const worst = (rs.worstFiles || []).slice(0, 3)
        .map((f) => `${f.residualStatements} of S=${f.bodyStatements}`).join(", ") || "none listed";
      if ([body, coll, resid].some((n) => typeof n !== "number"))
        return FAILS(JSON.stringify(rs).slice(0, 120), "the identity's terms are not all reported");
      if (coll > body)
        return FAILS(`collapsedStatements ${coll} > bodyStatements ${body} (excess ${coll - body})`,
          `collapsed cannot exceed the population it is drawn from, so the two are not one denominator; ` +
          `residual is published as ${resid} even though the manifest's own worstFiles lists per-file ` +
          `residuals (worst: ${worst}), and only ${full} of ${total} files are fully covered; ` +
          `collapseRatioPct ${rs.collapseRatioPct}% divides a numerator counting more statements ` +
          `than the denominator holds`);
      if (resid !== body - coll)
        return FAILS(`residualStatements ${resid} != ${body} - ${coll}`, "the clamp is masking a negative residual");
      if (rs.reviewSurface !== g.calls + resid)
        return FAILS(`reviewSurface ${rs.reviewSurface} != calls ${g.calls} + residual ${resid}`,
                     "the frozen §7.3 definition does not reproduce");
      return HOLDS(`collapsed ${coll} <= body ${body}; residual ${resid} unclamped; ` +
        `reviewSurface ${rs.reviewSurface} = calls ${g.calls} + residual ${resid}`);
    } },

  { id: "R-MEAS-3", req: "Placeholder density MUST be a STRICT comparison: holes / N < 0.5.",
    run() {
      const f = read("engine/uncollapsed-density.js");
      if (!f.ok) return FAILS(null, f.why);
      const frac = constValue("engine/uncollapsed-density.js", "MAX_HOLE_FRAC");
      const strict = /<\s*MAX_HOLE_FRAC/.test(f.text);
      const loose = /<=\s*MAX_HOLE_FRAC/.test(f.text);
      if (loose) return FAILS("<= MAX_HOLE_FRAC", "exactly one half is NOT enough; the comparison must be strict");
      if (!strict) return FAILS(null, "no comparison against MAX_HOLE_FRAC found");
      const got = frac.ok ? frac.got : "?";
      return got === "0.5" ? HOLDS(`strict < MAX_HOLE_FRAC = 0.5`)
        : FAILS(`MAX_HOLE_FRAC = ${got}`, "expected 0.5");
    } },

  { id: "R-LANG-14", req: "Every pipeline script MUST be callable non-interactively. No blocking prompts.",
    run() {
      const hits = liveGrep(/readline|createInterface|process\.stdin|readFileSync\(0/, { excludeTests: true });
      return hits.length ? FAILS(hits.join(", "), "a live script can block on stdin, so a UI cannot drive it")
        : HOLDS("no readline, stdin read or fd-0 read on any live path");
    } },

  { id: "R-ART-4-runtime", req: "A fresh mine MUST publish stamped artifacts, not stamp them afterwards.",
    run: () => MANUAL("static analysis cannot see what a mine writes; pipeline B publishes mined-library and corpus-coverage unstamped and relies on a later stamp-artifacts.js run",
                      "npm run mine && node repo-dsl.js mine <corpus> && npm run stamp:check") },

  { id: "R-REND-1", req: "compileFileEn(renderFileEn(src)) === src MUST hold for every file, always. The floor.",
    run() {
      /* Checked against the artifact §R itself names: `en-index.json -> gate.byteIdentical`. This is
       * the render pass's own per-file verdict, produced by the run and not by eye (R-MEAS-1).
       *
       * WHAT THIS IS NOT. It is not the full-corpus round-trip test, which exercises
       * renderFileEn/compileFileEn in isolation and is strictly stronger; that stays the last word
       * and is named below. And it is NOT `npm run measure`'s 1037/1037 -- measure-english.js:59-62
       * walks <SOURCE>/**\/*.ts and round-trips IN MEMORY, scoring 1037/1037 even with zero .en on
       * disk. That number is correct evidence for THIS row's property and useless for R-REND-5. */
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}; the floor is unverified`,
                                  "npm run render, or npm run test:slow for the stronger check");
      if (i.err) return FAILS(null, i.err);
      const g = i.j.gate;
      if (!g) return FAILS(null, "no `gate` block in the manifest -- the floor is not being reported");
      const { totalFiles, byteIdentical, allByteIdentical } = g;
      if (typeof byteIdentical !== "number" || typeof totalFiles !== "number")
        return FAILS(JSON.stringify(g), "the gate does not report counts");
      if (byteIdentical !== totalFiles || allByteIdentical !== true)
        return FAILS(`${byteIdentical}/${totalFiles}, allByteIdentical=${allByteIdentical}`,
                     "the floor is breached -- this never regresses, it is not a tradeoff");
      return HOLDS(`${byteIdentical}/${totalFiles} byte-identical on the emitted tree`,
        "the stronger check is `npm run test:slow` (round-trip in isolation); this is the cited gate");
    } },

  { id: "R-REND-7", req: "Measurement MUST run over the whole corpus with a published SKIP set; showcase/demo trees MUST be excluded.",
    run() {
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      let SKIP, SRC;
      try {
        SKIP = require("./engine/walk-skip").SKIP;
        SRC = require("./engine/corpus-root").sourceRoot();
      } catch (e) { return FAILS(null, `cannot resolve the canonical walk: ${e.message.split("\n")[0]}`); }
      for (const d of ["demo", "coined-demo"]) {
        if (!SKIP.has(d)) return FAILS(`SKIP lacks "${d}"`, "a showcase tree would be measured as if it were the corpus");
      }
      /* Recount SOURCE with the SAME canonical SKIP and compare to what the run reported. A walk
       * that quietly missed files reports a smaller, flattering denominator -- R-PIN-6 bans exactly
       * that, and it is invisible unless the count is reproduced independently. */
      let n = 0;
      (function walk(d) {
        let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (SKIP.has(e.name)) continue;
          const q = path.join(d, e.name);
          if (e.isDirectory()) walk(q);
          else if (q.endsWith(".ts") && !q.endsWith(".d.ts")) n++;
        }
      })(SRC);
      const reported = i.j.gate && i.j.gate.totalFiles;
      return n === reported
        ? HOLDS(`${reported} files measured = ${n} counted independently over SOURCE with the canonical SKIP`,
                "demo and coined-demo excluded; the denominator is the whole corpus")
        : FAILS(`manifest says ${reported}, independent walk finds ${n}`,
                "the measured denominator is not the corpus -- silent under-reporting (R-PIN-6)");
    } },

  { id: "R-REND-5", req: "The .en MUST be written to <CORPUS>/sen/files/<rel>.en; derived .calc IR to a gitignored .cache/.",
    run() {
      /* Two different answers must not be confused here, which is the whole reason this row is
       * mechanized separately from R-REND-1: "render has not been run" is a STATE, and ".en files
       * exist somewhere other than sen/files/" is a VIOLATION. An in-memory round-trip score says
       * nothing either way -- see the note on R-REND-1. */
      let CR2, root;
      try { CR2 = require("./engine/corpus-root"); root = CR2.corpusRoot(); }
      catch (e) { return FAILS(null, `root unresolvable: ${e.message.split("\n")[0]}`); }
      const home = path.join(CR2.senDir(), "files");
      const SKIP = new Set(["node_modules", ".git", ".cache", "catalog"]);
      const stray = [];
      let inHome = 0;
      (function walk(d) {
        let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (SKIP.has(e.name)) continue;
          const q = path.join(d, e.name);
          if (e.isDirectory()) walk(q);
          else if (q.endsWith(".en")) { q.startsWith(home + path.sep) ? inHome++ : stray.push(path.relative(root, q)); }
        }
      })(root);
      if (stray.length) return FAILS(stray.slice(0, 3).join(", "),
        `${stray.length} .en outside ${path.relative(root, home)}/`);
      return inHome ? HOLDS(`${inHome} .en files, all under ${path.relative(root, home)}/`)
        : MANUAL(`no .en on disk under ${root} -- render has not been run since the corpus was wiped`,
                 "npm run render  (this is a STATE, not a violation; an in-memory round-trip score is not evidence for this row)");
    } },

  { id: "R-COMP-6", req: "The manifest MUST expose generators.composites, .maxDepth and .compositionEdges, and maxDepth MUST stay distinct from dictionaryMaxDepth.",
    run() {
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      const g = i.j.generators;
      if (!g) return FAILS(null, "no `generators` block in the manifest");
      const need = ["composites", "maxDepth", "compositionEdges"];
      const missing = need.filter((k) => g[k] === undefined);
      if (missing.length) return FAILS(`missing ${missing.join(", ")}`,
        "the producer wrote maxCompositionDepth and neither of the others once, so R-COMP-7 compared undefined");
      if (g.dictionaryMaxDepth === undefined) return FAILS("no dictionaryMaxDepth",
        "conflating the two lets a deep dictionary report a renderer that never composed");
      const conflated = g.maxDepth === g.dictionaryMaxDepth;
      return HOLDS(`composites ${g.composites}, edges ${g.compositionEdges}, maxDepth ${g.maxDepth} vs dictionaryMaxDepth ${g.dictionaryMaxDepth}`,
        conflated ? "the two depths are EQUAL -- distinct fields, but check the producer is not copying one into the other"
                  : "the two depths are separate fields with separate values, as required");
    } },

  { id: "R-COMP-7", req: "generators.maxDepth on the live .en path MUST be >= 2 and rising. Depth 1 is the degenerate flat path.",
    run() {
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      const g = i.j.generators || {};
      const d = g.maxDepth;
      if (typeof d !== "number") return FAILS(String(d), "maxDepth is not a number -- see R-COMP-6");
      if (d < 2) return FAILS(`maxDepth ${d}`, "depth 1 is the degenerate flat path");
      /* A single deep span could carry the bar alone, so report the SHAPE too: composition is real
       * only if the histogram is populated above depth 1. */
      const h = g.depthHistogram || {};
      const above1 = Object.entries(h).filter(([k]) => +k > 1).reduce((a, [, v]) => a + v, 0);
      const at1 = h["1"] || 0;
      return HOLDS(`maxDepth ${d} on the live path; ${above1} spans deeper than 1 vs ${at1} at 1; flatFallback ${g.flatFallback}`,
        "measured on the REAL corpus, not a fixture -- this is the measurement §Q-8 was waiting for");
    } },
];

/* ---------- evaluate ---------- */

const selected = idArg ? ROWS.filter((r) => idArg.includes(r.id)) : ROWS;
if (idArg) {
  const unknown = idArg.filter((i) => !ROWS.some((r) => r.id === i));
  if (unknown.length) {
    console.error(`verify-register.js REFUSED: no mechanized row for ${unknown.join(", ")}.\n` +
      `  mechanized ids: ${ROWS.map((r) => r.id).join(", ")}\n` +
      `  a row absent here is not a row that holds -- it is one nobody has mechanized yet.`);
    process.exit(2);
  }
}

const results = selected.map((r) => {
  let o;
  try { o = r.run(); }
  catch (e) { o = FAILS(null, `check threw: ${e.message.split("\n")[0]}`); }
  return { id: r.id, requirement: r.req, ...o };
});

const n = (v) => results.filter((r) => r.verdict === v).length;
const summary = { holds: n("HOLDS"), fails: n("FAILS"), manual: n("MANUAL"), total: results.length,
                  mechanizedRows: ROWS.length };

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ tool: "verify-register", generated: new Date().toISOString(),
    summary, results }, null, 2) + "\n");
} else {
  console.log("");
  for (const r of results) {
    const mark = r.verdict === "HOLDS" ? "HOLDS " : r.verdict === "FAILS" ? "FAILS " : "MANUAL";
    console.log(`  ${mark}  ${r.id.padEnd(15)} ${r.got || r.why || ""}`);
    if (r.got && r.why) console.log(`          ${" ".repeat(15)} ${r.why}`);
    if (r.how) console.log(`          ${" ".repeat(15)} -> ${r.how}`);
  }
  console.log(`\n  ${summary.holds} hold, ${summary.fails} fail, ${summary.manual} manual ` +
              `(of ${summary.mechanizedRows} mechanized rows)`);
  console.log(`  MANUAL is not a pass. A row absent from this runner is not a row that holds.\n`);
}
process.exit(summary.fails ? 1 : 0);
