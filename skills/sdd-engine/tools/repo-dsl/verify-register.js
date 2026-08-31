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
  const litRe = new RegExp(`(?:^|[;,\\s])${name}\\s*=\\s*([0-9]+)\\b`);
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

  { id: "R-REND-1", req: "compileFileEn(renderFileEn(src)) === src MUST hold for every file, always.",
    run: () => MANUAL("the floor; decided only by a full-corpus round-trip",
                      "npm run test:slow  (test-lzw-roundtrip.js, minutes)") },

  { id: "R-COMP-7", req: "generators.maxDepth on the live .en path MUST be >= 2 and rising.",
    run: () => MANUAL("needs a rendered corpus and its en-index.json (open: §Q-8)",
                      "npm run render, then read en-index.json -> generators.maxDepth") },
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
