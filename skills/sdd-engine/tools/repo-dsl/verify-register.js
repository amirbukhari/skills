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
const os = require("os");
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
/* TRACKED FILES ONLY, and this is a correctness property of the register, not an optimisation.
 *
 * liveGrep used to walk the working tree, which meant a row's verdict depended on what happened to
 * be sitting on disk. Demonstrated for real tonight: R-LANG-14 went red because ANOTHER LANE had an
 * uncommitted scratch file (`new-archetype.js`, `??` in git status) that matched a pattern -- and it
 * would have gone green again when they deleted it. A register whose answer changes with a
 * colleague's unsaved work is not reproducible from a commit, which is the same defect as the cite
 * rot this runner exists to remove, one layer down: at the evidence layer rather than the citation
 * layer. Raised independently by sdd-engine-5a and by my user; the credit is theirs.
 *
 * So the corpus of evidence is `git ls-files` -- exactly what a second engineer gets from a clone.
 * A violation in an uncommitted file is not missed, only deferred to the moment it is committed,
 * which is also the moment it becomes everyone's problem.
 *
 * FAIL-CLOSED: if git cannot answer, this throws rather than falling back to walking the tree. The
 * fallback IS the bug; a row that silently reverts to unreproducible evidence is worse than a row
 * that says it could not check. The runner turns the throw into a named FAILS. */
let _tracked;
function trackedJs() {
  if (_tracked) return _tracked;
  let out;
  try {
    out = require("child_process").execFileSync("git", ["-C", HERE, "ls-files", "-z", "*.js"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`cannot list tracked files (git ls-files failed: ${e.message.split("\n")[0]}); ` +
      `refusing to fall back to a working-tree walk, whose verdict is not reproducible from a commit`);
  }
  return (_tracked = out.split("\0").filter(Boolean));
}

function liveGrep(re, opts = {}) {
  const SKIP = new Set(["node_modules", ".git", "archive", "sen", "spec", ".cache", "catalog"]);
  const SELF = path.basename(__filename);
  const hits = [];
  for (const rel of trackedJs()) {
    if (rel.split("/").some((seg) => SKIP.has(seg))) continue;
    if (path.basename(rel) === SELF) continue;                    // exemption 2
    if (opts.excludeTests && rel.endsWith(".test.js")) continue;
    const abs = path.join(HERE, rel);
    let text; try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }  // tracked but deleted
    text.split("\n").forEach((l, i) => {
      if (/^\s*(?:\/\/|\/\*|\*)/.test(l)) return;                   // exemption 1
      if (re.test(l)) hits.push(`${rel}:${i + 1}`);
    });
  }
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
      /* TWO HALVES, because neither is sufficient on its own. The grep checks the CODE; the
       * artifact field checks the producer's own DECLARATION. A producer that grew a network call
       * and kept `modelCalls: 0` passes the field and fails the requirement; a call reached through
       * an indirection passes the grep. Requiring both closes each one's blind spot.
       *
       * The declaration half is new on 2026-08-31. The register's Check line used to name
       * `foldModelCalls`/`buildModelCalls` "in every published catalog" — fields that exist only in
       * `archive/`, so the PRD's most load-bearing requirement pointed at nothing on disk.
       * `AC.stamp` now writes `modelCalls` (defaulting to 0) into the FINGERPRINTED body of every
       * artifact, so flipping the number by hand breaks the seal. */
      const hits = liveGrep(/\b(anthropic|openai|fetch\s*\(|https?:\/\/api\.)/i, { excludeTests: true })
        .filter((h) => !/prose-llm|llm-render/.test(h));
      if (hits.length) return FAILS(hits.join(", "), "a live file reaches a model or a network API");

      const AC2 = require("./engine/artifact-contract.js");
      const declared = [], silent = [];
      for (const kind of AC2.kindsOf()) {
        let j; try { j = JSON.parse(fs.readFileSync(AC2.pathFor(kind, AC2.corpusRoot()), "utf8")); } catch (_) { continue; }
        if (j.modelCalls === undefined) silent.push(kind);           /* stamped before the field existed */
        else if (j.modelCalls !== 0) return FAILS(`${kind} declares modelCalls ${j.modelCalls}`, "a published artifact admits a model call");
        else declared.push(kind);
      }
      return HOLDS(`no model/network call on any live path; ${declared.length} artifact(s) declare modelCalls 0` +
          (silent.length ? ` (${silent.join(", ")} predate the field and re-declare on the next mine)` : ""),
        "grep over the live tree (archive excluded) AND the stamped, fingerprinted declaration on every artifact present");
    } },

  { id: "R-MECH-7", req: "The flat path MUST NOT stand as a second producer beside the LZW path.",
    run() {
      const hits = liveGrep(/["']generators\.json["']/);
      return hits.length ? FAILS(hits.join(", "), "a live file reads the retired flat vocabulary")
        : HOLDS("no live reader of generators.json", "the flat producer does not exist at all");
    } },

  { id: "R-DRIFT-1", req: "Every rule refusal on the byte-exact path MUST be recordable, naming which rule, which file/span, and why.",
    run() {
      /* The recorder is worthless if it is not WIRED. Checked as the set of recording sites rather
       * than as "refusals.js exists": a refactor that drops the call in runWord leaves the module
       * present, the audit reporting a tidy zero, and the drift invisible again. */
      const need = [[/REF\.record\(/, "engine/enlzw.js"], [/REF\.record\(/, "engine/enfile.js"]];
      const missing = need.filter(([re, rel]) => !re.test(fs.readFileSync(path.join(HERE, rel), "utf8")));
      if (missing.length) return FAILS(missing.map((m) => m[1]).join(", "), "a refusal site stopped recording");
      const R = require("./engine/refusals");
      const reasons = R.REASON_NAMES.length;
      return reasons >= 6 ? HOLDS(`${reasons} named reasons, recorded in enlzw.js and enfile.js`,
                                  "audit-rules.js is the consumer; 295 refused spans on the corpus at 2026-09-01")
                          : FAILS(String(reasons), "the refusal vocabulary shrank below the six recorded reasons");
    } },

  { id: "R-DRIFT-2", req: "Catalog drift MUST be gated differentially against a baseline, never on a refusal counter that cannot fire.",
    run() {
      const audit = fs.readFileSync(path.join(HERE, "audit-rules.js"), "utf8");
      const R = require("./engine/refusals");
      const dead = Object.keys(R.UNREACHABLE);
      if (!dead.length) return FAILS("none", "refusals.js no longer declares which reasons cannot fire (R-DRIFT-3)");
      /* The failure mode this row exists to catch: someone reinstating `drift = sum(dead reasons)`
       * and gating on it — a zero that cannot move, published as a passing guard (R-MECH-8). */
      const tautology = dead.some((r) => new RegExp("drift[\\s\\S]{0,120}" + r).test(audit));
      if (tautology) return FAILS("audit-rules.js", "the drift gate reads a counter that cannot fire");
      return /--write-baseline/.test(audit) && /refuse MORE than at baseline/.test(audit)
        ? HOLDS("baseline differential, " + dead.length + " reasons declared unreachable",
                "a rule whose refusal count ROSE is one that used to match this corpus and stopped")
        : FAILS("audit-rules.js", "no baseline comparison found — drift would be unobservable");
    } },

  { id: "R-MINE-1", req: "MIN_COUNT MUST be 1.",
    run() {
      const c = constValue("build-lzw-generators.js", "MIN_COUNT");
      if (!c.ok) return FAILS(null, c.why);
      const note = c.envOverridable ? " (env-overridable: binds the default, not every run)" : "";
      return c.got === "1" ? HOLDS(`${c.got} at ${c.where}${note}`) : FAILS(`${c.got} at ${c.where}`, "expected 1");
    } },

  { id: "R-MINE-12", req: "No fixed depth/window ceiling may bind below what the corpus needs. MAXWIN is not a tuned value (supersedes R-MINE-2's `MAXWIN is 64`).",
    run() {
      const c = constValue("build-lzw-generators.js", "MAXWIN");
      if (!c.ok) return FAILS(null, c.why);
      const maxWin = Number(c.got);
      const i = enIndex();
      if (i.absent) return MANUAL(`MAXWIN ${maxWin} at ${c.where}, but no manifest to compare against`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      const d = i.j.generators && i.j.generators.dictionaryMaxDepth;
      if (typeof d !== "number") return FAILS(null, "no generators.dictionaryMaxDepth to compare the ceiling against");
      // The signature of a BINDING ceiling is dictionaryMaxDepth === maxWin - 1: the mine stopped
      // because the parameter said to, not because the corpus ran out. That is the failure.
      if (d === maxWin - 1)
        return FAILS(`dictionaryMaxDepth ${d} === MAXWIN ${maxWin} - 1`,
          "the ceiling is PINNING the mine -- depth is parameter-bound, not corpus-bound (this is exactly what MAXWIN=64 did at depth 63)");
      return HOLDS(`MAXWIN ${maxWin} at ${c.where}; dictionaryMaxDepth ${d}, ${maxWin - 1 - d} below the ceiling`,
        "depth is bound by the longest statement stream in the corpus, not by the parameter");
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

  { id: "R-CFG-13", req: "A refusal MUST NOT present as a crash: declines exit 3 with prose, faults exit 1 with their stack.",
    run() {
      const rf = read("sdd-clean.js");
      if (!rf.ok) return FAILS(null, rf.why);
      const f = rf.text;
      /* STRUCTURAL, deliberately. The BEHAVIOURAL proof — declines exit 3, faults exit 1, both
       * mutation-checked — is engine/sdd-clean.test.js, which spawns the tool against throwaway
       * temp roots. This check must never spawn `--wipe-sen --go`, because verify-register runs
       * against the LIVE corpus and that is the one command that would delete it. */
      if (!/class Decline extends Error/.test(f))
        return FAILS("no Decline class", "declines are indistinguishable from faults");
      const guard = (f.split("function assertRemovable(rel) {")[1] || "").split("\nfunction ")[0];
      const plain = (guard.match(/throw new Error\(/g) || []).length;
      if (plain) return FAILS(`${plain} plain Error throw(s) in assertRemovable`, "a guard still crashes instead of declining");
      /* ORDER IS THE WHOLE REQUIREMENT. Installed below the root resolution, the handler never
       * sees a bad root — and the test that was meant to catch that passed anyway, because it was
       * measuring Node's default behaviour. Position, not presence. */
      const h = f.indexOf("process.on(\"uncaughtException\"");
      /* Anchor on the ASSIGNMENT, not on a bare `CR.corpusRoot()` — the handler's own comment
       * explains the ordering bug and names that call, so a loose match found the prose and
       * reported the correct code as broken. A check that reads comments is reading English. */
      const r = f.indexOf("const CORPUS = CR.corpusRoot()");
      if (h < 0) return FAILS("no handler", "an uncaught decline still prints a stack");
      if (r >= 0 && h > r)
        return FAILS("handler installed after the roots resolve", "a misconfigured root bypasses it entirely");
      return HOLDS("Decline class, no plain throws in the guard, handler installed before the roots resolve",
        "behaviour is pinned by engine/sdd-clean.test.js, not by this check");
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

  { id: "R-PAY-6", req: "A word id is not stable across a re-mine and payloads reference word ids, so a `.en` is decodable only against the dictionary it was rendered with. The engine MUST close this by (a) each `.en` naming the dictionary `fingerprint`, with `compileFileEn` REFUSING on mismatch, or (b) content-addressed ids.",
    run() {
      /* RED ON PURPOSE, same treatment as R-ARCH-15. Neither closure is built, and the row says
       * MUST, so the honest verdict is FAILS -- not MANUAL and not absence from this runner, which
       * would read as "nothing to see here" for the failure mode the register itself calls a
       * compile producing WRONG BYTES, NOT AN ERROR. Priced in measure-id-stability.js.
       *
       * Decided WITHOUT a mine, deliberately: a re-mine renumbers every id by construction and is
       * gated for that reason, so this checks the two closures' PRESENCE on disk rather than
       * demonstrating the drift. Closure (a) is a file-format fact and closure (b) an allocator
       * fact; both are decidable statically. */
      const e = enFiles();
      if (e.absent) return MANUAL(`no rendered .en under ${e.where}`, "npm run render");
      if (e.err) return FAILS(null, e.err);
      if (!e.files.length) return MANUAL("no .en files rendered", "npm run render");

      let withId = 0, withFp = 0;
      for (const f of e.files) {
        let t; try { t = fs.readFileSync(f, "utf8"); } catch { continue; }
        if (/⟪lzw1 [nw]\d+/.test(t)) withId++;
        if (/fingerprint/i.test(t)) withFp++;
      }
      /* Closure (b): an id that is a position cannot be content-addressed. The allocator says so
       * in one line, and the shipped dictionary agrees -- its words are keyed by nothing else. */
      const w = read("engine/wordlzw.js");
      const positional = w.ok && /const id = dict\.length/.test(w.text);

      if (withFp === 0 && withId > 0)
        return FAILS(`${withId} of ${e.files.length} .en reference a word id, ${withFp} name a dictionary fingerprint` +
            (positional ? "; ids are allocated as `dict.length`, i.e. by position" : ""),
          "NEITHER closure is built: no .en pins the dictionary it was rendered against (a), and ids are still mining-order positions (b). " +
          "A stale .en therefore compiles to WRONG BYTES instead of refusing -- the register's own words. This row is red on purpose");
      if (withFp < withId)
        return FAILS(`${withId} .en reference a word id but only ${withFp} name a fingerprint`,
          "closure (a) is partial -- an unstamped .en is exactly the one that compiles silently");
      return HOLDS(`${withFp} of ${e.files.length} .en name the dictionary fingerprint they were rendered against`,
        "a mismatched pair can be refused rather than compiled");
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

  /* ------------------------------------------------------------------ BATCH: the artifact rows.
   * Mechanized 2026-09-01. Every row here is decidable from tracked source, the exported contract,
   * or an artifact already on disk -- no mine, no render, no model call. Where a row could only be
   * decided by mining, it is left out rather than approximated: a row that checks a proxy for its
   * requirement reports on the proxy, and the register would then say something the requirement
   * does not. */

  { id: "R-ART-2", req: "Every artifact MUST resolve through AC.pathFor(kind, corpusRoot); no source line may name a corpus artifact relative to __dirname.",
    run() {
      let AC;
      try { AC = require("./engine/artifact-contract"); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      const files = AC.kindsOf().map((k) => AC.specOf(k).file).filter(Boolean);
      const alt = files.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      /* The violation is an artifact FILENAME reached from __dirname -- the engine tree resolving
       * corpus data by its own location, which is the R-ART-1 boundary breaking from the inside. */
      const hits = liveGrep(new RegExp(`__dirname[^\\n]*(${alt})|(${alt})[^\\n]*__dirname`))
        .filter((h) => !/^engine[\/\\]artifact-contract\.js/.test(h));
      return hits.length ? FAILS(hits.join(", "), "a corpus artifact is named relative to the engine tree, bypassing AC.pathFor")
        : HOLDS(`no live line joins __dirname to any of the ${files.length} registered artifact filenames`,
          "the corpus root is the only way to an artifact");
    } },

  { id: "R-ART-3", req: "`tracked` artifacts MUST live at <corpus>/sen/catalog/, `cache` at <corpus>/.cache/spec-derived/. Root catalog/ is forbidden for tracked artifacts.",
    run() {
      let AC, CR2;
      try { AC = require("./engine/artifact-contract"); CR2 = require("./engine/corpus-root"); }
      catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      const want = { tracked: path.join("sen", "catalog"), cache: path.join(".cache", "spec-derived") };
      const wrong = Object.entries(want).filter(([k, v]) => AC.HOMES[k] !== v).map(([k, v]) => `${k}=${AC.HOMES[k]} (want ${v})`);
      if (wrong.length) return FAILS(wrong.join(", "), "a home moved; every artifact under it moved with it");
      /* And check the resolution, not just the table: root catalog/ is forbidden because the corpus
       * .gitignore ignores it, so a SOURCE-PROTECTED artifact placed there is silently untracked --
       * the trap that had actually sprung on word-names.json (CLAUDE.md §5). */
      const root = CR2.corpusRoot();
      const bad = [];
      for (const k of AC.kindsOf()) {
        const rel = path.relative(root, AC.pathFor(k, root));
        const home = AC.specOf(k).home;
        if (!rel.startsWith(want[home])) bad.push(`${k} -> ${rel}`);
        if (home === "tracked" && /^catalog[\/\\]/.test(rel)) bad.push(`${k} resolves under root catalog/, where the corpus .gitignore would hide it`);
      }
      return bad.length ? FAILS(bad.join(", "), "an artifact resolves outside its declared home")
        : HOLDS(`${AC.kindsOf().length} kinds all resolve under their declared home; none under root catalog/`);
    } },

  { id: "R-ART-5", req: "`schema` MUST be bumped on any shape change, and the registry's `requires` MUST name the top-level keys a consumer actually reads.",
    run() {
      let AC;
      try { AC = require("./engine/artifact-contract"); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      const bad = [];
      for (const k of AC.kindsOf()) {
        const s = AC.specOf(k);
        if (!/^[\w-]+\/[\w-]+\/\d+$/.test(String(s.schema || ""))) bad.push(`${k}: schema ${JSON.stringify(s.schema)} carries no version`);
        if (!Array.isArray(s.requires) || !s.requires.length) bad.push(`${k}: requires is empty, so a shape change at the same version is invisible`);
      }
      if (bad.length) return FAILS(bad.join("; "), "the registry cannot catch a same-version shape change");
      /* `requires` is only a promise until validate() acts on it. Checked by running it: a body
       * missing a required key MUST be refused, and the refusal MUST name the key. */
      const k0 = AC.kindsOf()[0], spec = AC.specOf(k0);
      const body = { schema: spec.schema, artifactVersion: 1, corpus: "x", generated: "x", fingerprint: "x" };
      let refused = null;
      try { AC.validate(k0, body, "(synthetic)"); } catch (e) { refused = e.message; }
      if (!refused) return FAILS(`validate("${k0}") accepted a body with none of ${spec.requires.join(", ")}`,
        "requires is declared but not enforced -- a documented contract nothing checks");
      const names = spec.requires.some((r) => refused.includes(r));
      return names ? HOLDS(`${AC.kindsOf().length} kinds carry a versioned schema and non-empty requires; validate refuses a body missing them, naming the key`)
        : FAILS(`validate refused but named none of ${spec.requires.join(", ")}: ${refused.split("\n")[0]}`,
          "a refusal that does not name what was missing cannot be acted on (R-ART-6)");
    } },

  { id: "R-ART-6", req: "A consumer that cannot verify what it is reading MUST REFUSE, naming what it expected and what it got. `catch { return null }` is the bug class.",
    run() {
      /* SCOPED TO ARTIFACT READS, and the first version of this row was not -- it grepped every
       * `catch { return null }` on any live path and reported five, of which four were correct code:
       * a failed ts.createSourceFile meaning "no name is derivable here", a statSync probe meaning
       * "not present", and deriveGloss's own documented `a gloss we cannot derive is not evidence of
       * an edit`. Those are local control flow, not a consumer misreporting an artifact. The row is
       * about the artifact contract, so the check is too: a file that reads a REGISTERED artifact
       * without going through AC.load, and turns a failure into a bare null, is the bug class -- the
       * caller then cannot tell "the artifact is missing" from "the artifact says zero".
       *
       * A guard that cries wolf gets ignored, then removed; narrowing it to what the row actually
       * says is what keeps the four correct sites out of the report. */
      let AC;
      try { AC = require("./engine/artifact-contract"); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      const files = AC.kindsOf().map((k) => AC.specOf(k).file).filter(Boolean);
      const alt = files.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const bad = [];
      for (const rel of trackedJs()) {
        if (rel.split("/").some((seg) => ["node_modules", ".git", "archive"].includes(seg))) continue;
        if (path.basename(rel) === path.basename(__filename)) continue;
        let text; try { text = fs.readFileSync(path.join(HERE, rel), "utf8"); } catch { continue; }
        const lines = text.split("\n");
        lines.forEach((l, i2) => {
          if (/^\s*(?:\/\/|\/\*|\*)/.test(l)) return;
          if (!new RegExp(`(${alt})`).test(l)) return;
          if (/AC\.load|artifact-contract/.test(l)) return;                 // the validated path
          /* the read is here; is the catch within the next few lines a bare null? */
          const window = lines.slice(i2, i2 + 6).join("\n");
          if (/catch\s*(\([^)]*\))?\s*\{\s*return\s*(null|undefined|""|\[\]|\{\})\s*[;}]/.test(window))
            bad.push(`${rel}:${i2 + 1}`);
        });
      }
      return bad.length ? FAILS(bad.join(", "),
        "a registered artifact is read without AC.load and a failure becomes a bare null -- the caller cannot tell 'missing' from 'empty', which is the exact confusion this contract exists to remove")
        : HOLDS(`no live file reads any of the ${files.length} registered artifacts outside AC.load and swallows the failure`,
          "{ optional: true } returns a reason instead, so 'your vocabulary is missing' cannot read as 'your corpus contains no patterns'");
    } },

  { id: "R-ART-9", req: "The id spaces MUST stay disjoint: word-names keys are `w:`/`n:<16hex>` over the LZW dictionary; compose-layer leaves are `p_<8hex>`.",
    run() {
      let AC, CR2;
      try { AC = require("./engine/artifact-contract"); CR2 = require("./engine/corpus-root"); }
      catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      const root = CR2.corpusRoot();
      const wnP = AC.pathFor("word-names", root), mlP = AC.pathFor("mined-library", root);
      if (!fs.existsSync(wnP)) return MANUAL(`no word-names at ${wnP}`, "npm run name");
      if (!fs.existsSync(mlP)) return MANUAL(`no mined-library at ${mlP}`, "npm run mine");
      let wn, ml;
      try { wn = AC.load("word-names", wnP); ml = AC.load("mined-library", mlP); }
      catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      const wnKeys = Object.keys(wn.names || {});
      const badWn = wnKeys.filter((k) => !/^[wn]:[0-9a-f]{16}$/.test(k));
      const leaves = ml.leaves || {};
      const leafIds = Array.isArray(leaves) ? leaves.map((l) => AC.idOf(l)) : Object.keys(leaves);
      const badLeaf = leafIds.filter((i) => !/^p_[0-9a-f]{8}$/.test(String(i)));
      const overlap = leafIds.filter((i) => wnKeys.includes(String(i)));
      if (badWn.length || badLeaf.length || overlap.length)
        return FAILS(`${badWn.length} word-names keys off-shape (e.g. ${JSON.stringify(badWn[0] || null)}), ` +
          `${badLeaf.length} leaf ids off-shape (e.g. ${JSON.stringify(badLeaf[0] || null)}), ${overlap.length} shared`,
          "an id read in the wrong space resolves to the wrong record, or silently to none");
      return HOLDS(`${wnKeys.length} word-names keys all \`[wn]:<16hex>\`, ${leafIds.length} leaves all \`p_<8hex>\`, no key in both`,
        "names key the LZW dictionary and panel surfaces key the compose layer, and the shapes make a mix-up impossible to miss");
    } },

  { id: "R-ART-10", req: "`word-names` entries MUST be the v1 shape {sym, en, sites, named} keyed by sha256(sym)[0:16] axis-prefixed; the v0 {name, hint, tier} shape is retired.",
    run() {
      let AC, CR2;
      try { AC = require("./engine/artifact-contract"); CR2 = require("./engine/corpus-root"); }
      catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      const p = AC.pathFor("word-names", CR2.corpusRoot());
      if (!fs.existsSync(p)) return MANUAL(`no word-names at ${p}`, "npm run name");
      let wn; try { wn = AC.load("word-names", p); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      const entries = Object.entries(wn.names || {});
      if (!entries.length) return FAILS("no entries", "an empty naming artifact cannot be shown to be v1");
      const v0 = entries.filter(([, e]) => e && (e.name !== undefined || e.hint !== undefined || e.tier !== undefined));
      const missing = entries.filter(([, e]) => !e || typeof e.sym !== "string" || typeof e.en !== "string" || e.sites === undefined);
      if (v0.length) return FAILS(`${v0.length} entries carry a v0 field (name/hint/tier), e.g. ${v0[0][0]}`,
        "the retired v0 shape is still being written somewhere");
      if (missing.length) return FAILS(`${missing.length} entries missing sym/en/sites, e.g. ${missing[0][0]}`,
        "a consumer reading .sym or .en gets undefined and has no way to know why");
      return HOLDS(`${entries.length} entries, all {sym, en, sites, named}, no v0 field anywhere`);
    } },

  { id: "R-ART-11", req: "A stamped artifact MUST carry a contentFingerprint equal across two runs producing the same content; wall-clock, interpreter version and the regenerate command line are excluded by a declared VOLATILE list.",
    run() {
      let AC;
      try { AC = require("./engine/artifact-contract"); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      if (typeof AC.contentFingerprintOf !== "function") return FAILS("no contentFingerprintOf export", "there is nothing to compare two runs with");
      if (!Array.isArray(AC.VOLATILE) || !AC.VOLATILE.length) return FAILS("VOLATILE is empty or absent", "with nothing excluded, every run differs and the field is noise");
      /* KNOWN LIMIT, found by mutation-checking this row rather than by reading it: dropping a key
       * FROM the VOLATILE list leaves this green, because the check derives its test bodies from the
       * list itself. It proves the declared exclusions are honoured; it cannot prove the list is
       * complete. Naming the limit is the point -- a row that quietly checks less than it claims is
       * how a green stops meaning anything.
       *
       * Run it. Two bodies identical but for every declared VOLATILE key MUST agree; a body whose
       * CONTENT differs MUST NOT. Both halves matter: a fingerprint that never changes is as
       * useless as one that always does, and only the second half can tell them apart. */
      const base = { words: { 0: { sym: "a" } }, count: 1 };
      const volatiles = {};
      for (const k of AC.VOLATILE) volatiles[k] = "CHANGED-" + k;
      const a = AC.contentFingerprintOf({ ...base, ...Object.fromEntries(AC.VOLATILE.map((k) => [k, "x"])) });
      const b = AC.contentFingerprintOf({ ...base, ...volatiles });
      const c = AC.contentFingerprintOf({ ...base, count: 2 });
      if (a !== b) return FAILS(`same content, different VOLATILE fields -> ${a} vs ${b}`,
        `one of ${AC.VOLATILE.join(", ")} is still inside the hash, so two identical runs look different`);
      if (a === c) return FAILS(`different content -> the same ${a}`, "the hash does not cover the content it is supposed to seal");
      /* And the shipped artifact must actually carry the field. */
      const l = lzw();
      const carried = l.ok ? !!l.j.contentFingerprint : null;
      if (l.ok && !carried) return FAILS("generators-lzw.json carries no contentFingerprint", "the property holds in the library and is not stamped on the artifact");
      return HOLDS(`stable across ${AC.VOLATILE.length} volatile fields (${a}), changes with content (${c})` +
        (l.ok ? `; generators-lzw carries ${l.j.contentFingerprint}` : "; no dictionary on disk to check the stamp"));
    } },

  { id: "R-COMP-8", req: "Promotion MUST reject any composite whose members would introduce a cycle.",
    run() {
      const l = lzw();
      if (l.absent) return MANUAL(`no dictionary at ${l.where}`, "npm run mine");
      if (l.err) return FAILS(null, l.err);
      /* Checked on the shipped dictionary rather than by reading the promotion code: a cycle check
       * that exists and is wrong looks identical to one that works, from the source. A composite's
       * members are ids into the same band, so acyclicity is decidable here by walking them. */
      const bands = ["narrow", "wide"].filter((b) => l.j[b] && l.j[b].words);
      if (!bands.length) return FAILS("no bands with words", "nothing to check");
      const report = [];
      for (const b of bands) {
        const words = l.j[b].words;
        let composites = 0, forward = 0, dangling = 0;
        for (const k of Object.keys(words)) {
          const e = words[k], id = Number(k);
          if (!e || !e.m) continue;
          composites++;
          for (const m of e.m) {
            if (words[String(m)] === undefined) dangling++;
            else if (Number(m) >= id) forward++;   // a member at or above its own id is the only way to close a loop
          }
        }
        if (forward || dangling) return FAILS(`${b}: ${forward} members at or above their own id, ${dangling} dangling`,
          "a member that is not strictly below its parent can close a cycle, and expand() would not terminate");
        report.push(`${b}: ${composites} composites, every member strictly below its parent`);
      }
      return HOLDS(report.join("; "),
        "ids are allocated in construction order, so 'every member is below its parent' is acyclicity -- expand() must terminate");
    } },

  { id: "R-PAY-5", req: "Hole dedup via a shared fill table, and parameter hoisting, are REJECTED: both replace visible source text with an indirection a reader must resolve by hand.",
    run() {
      /* A rejection is verified by ABSENCE, so the check has to be specific enough to mean
       * something and loose enough to catch a rename. Both mechanisms need a table keyed by fill
       * text or a hoisted parameter list; neither exists under any of these spellings. */
      const hits = liveGrep(/\b(fillTable|holeTable|dedupeHoles|dedupHoles|sharedFills|hoistParams|paramHoist|hoistedParams)\b/, { excludeTests: true });
      const p = read("engine/payload.js");
      const indirection = p.ok && /\b(fillTable|holeTable|sharedFills)\b/.test(p.text);
      if (hits.length || indirection) return FAILS(hits.join(", ") || "engine/payload.js", "a rejected compression mechanism is implemented");
      return HOLDS("no fill table and no parameter hoisting under any live spelling",
        "every hole still shows its own source text; residual negative compression from gloss prose is the accepted cost");
    } },

  { id: "R-TEST-5", req: "Where a full-corpus assertion is too slow, a test MUST sample DETERMINISTICALLY (a fixed, evenly-spread sample) rather than narrowing its oracle.",
    run() {
      /* Non-determinism is the failure this row names: a random sample turns a red into a
       * sometimes-red, which is worse than no test because it teaches people to re-run. Checked
       * across tests AND the measure-*.js reporters, since a sampled REPORT has the same defect. */
      /* Math.random in a TEMP FILENAME is not this row's failure: it decides where a fixture is
       * written, never which files the oracle covers, so the verdict is identical on every run.
       * engine/namer.test.js:24 is exactly that (`stub-${Math.random()...}.json` under mkdtemp) and
       * reporting it would be the guard crying wolf on the first run. Excluded BY SHAPE -- the line
       * must also build a path -- and the count is reported either way, so the exemption cannot
       * quietly grow. */
      const all = liveGrep(/Math\.random\s*\(/);
      const naming = all.filter((h) => {
        const [rel, ln] = [h.slice(0, h.lastIndexOf(":")), Number(h.slice(h.lastIndexOf(":") + 1))];
        let t; try { t = fs.readFileSync(path.join(HERE, rel), "utf8"); } catch { return false; }
        const line = t.split("\n")[ln - 1] || "";
        return /path\.join|tmpdir|mkdtemp|\.json|\.ts|filename|dir/i.test(line);
      });
      const hits = all.filter((h) => !naming.includes(h));
      if (hits.length) return FAILS(hits.join(", "), "a sampled assertion that cannot be reproduced from a commit is not evidence");
      const samplers = trackedJs().filter((rel) => {
        if (!/(\.test\.js|^measure-[^/]*\.js)$/.test(rel) || rel.includes("archive")) return false;
        let t; try { t = fs.readFileSync(path.join(HERE, rel), "utf8"); } catch { return false; }
        return /%\s*step|i % \w+ === 0|\bstride\b/.test(t);
      });
      return HOLDS(`no Math.random decides a sample on any tracked path (${naming.length} use(s) name a temp file, which does not); ` +
        `${samplers.length} file(s) sample by a fixed stride`,
        "the same commit yields the same sample, so a red is reproducible");
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

  /* ── ROOTS (§1B) ──────────────────────────────────────────────────────────────────────────────
   * These are checked BEHAVIOURALLY wherever a behaviour is what the row claims. A grep can show
   * that a refusal message exists in the source; only running it shows that the refusal fires, and
   * CLAUDE.md §9's first entry is a whole incident caused by reading this subsystem instead of
   * running it. */

  { id: "R-CFG-1", req: "There MUST be exactly two roots: SOURCE (read, never written) and CORPUS (write, holds sen/).",
    run() {
      let CR; try { CR = require("./engine/corpus-root"); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      const names = CR.names();
      if (names.length !== 2 || names[0] !== "source" || names[1] !== "corpus")
        return FAILS(JSON.stringify(names), "exactly two roots, named source and corpus");
      /* `sen` must NOT be a root -- three designs were rejected before this one (CLAUDE.md §9) and
       * the failure mode each time was sen becoming configurable. */
      if (names.includes("sen") || CR.ROOTS.sen)
        return FAILS("sen appears in the root registry", "sen is a FOLDER NAME inside CORPUS, not a root");
      if (typeof CR.LAYOUT.sen !== "string")
        return FAILS(typeof CR.LAYOUT.sen, "LAYOUT.sen must be the one place `sen` is spelled");
      if (!Object.isFrozen(CR.ROOTS)) return FAILS("ROOTS is not frozen", "the registry must not be mutable at runtime");
      return HOLDS(`two roots (${names.join(", ")}), ROOTS frozen, sen only as LAYOUT.sen`);
    } },

  { id: "R-CFG-2", req: "The two roots MUST be independently settable with no crosstalk.",
    run() {
      let CR; try { CR = require("./engine/corpus-root"); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      /* Setting ONE root must not move the other. Checked by resolving both under an env that names
       * only SOURCE, and asserting CORPUS did not follow it. Resolution only -- nothing is written,
       * and the paths need not exist because select() does not touch the disk. */
      const probe = "/tmp/__r_cfg_2_probe__";
      const src = CR.select("source", { env: { SOURCE: probe }, argv: ["node", "s"] });
      const cor = CR.select("corpus", { env: { SOURCE: probe }, argv: ["node", "s"] });
      if (src.root !== probe) return FAILS(`SOURCE resolved to ${src.root}`, "an env-set root must win");
      if (cor.root === probe) return FAILS("CORPUS followed SOURCE", "crosstalk: setting one root moved the other");
      const cor2 = CR.select("corpus", { env: { CORPUS: probe }, argv: ["node", "s"] });
      const src2 = CR.select("source", { env: { CORPUS: probe }, argv: ["node", "s"] });
      if (cor2.root !== probe) return FAILS(`CORPUS resolved to ${cor2.root}`, "an env-set root must win");
      if (src2.root === probe) return FAILS("SOURCE followed CORPUS", "crosstalk in the other direction");
      return HOLDS("each root moves alone, in both directions", "resolution only; no disk touched");
    } },

  { id: "R-CFG-3", req: "Precedence MUST be resolved per root in exactly one module: flag > env > <engine>/.env > default.",
    run() {
      let CR; try { CR = require("./engine/corpus-root"); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      /* (i) the ORDER, exercised rather than read: stack all four layers and check the winner. */
      const flag = "/tmp/__by_flag__", env = "/tmp/__by_env__";
      /* argv follows the process.argv convention -- fromArgv scans from index 2, so a bare
       * ["--source", p] is silently skipped. Caught by this row failing on its first run. */
      const AV = (...a) => ["node", "script", ...a];
      const byFlag = CR.select("source", { argv: AV("--source", flag), env: { SOURCE: env } });
      if (byFlag.root !== flag) return FAILS(`${byFlag.root} via ${byFlag.layer}`, "the flag must outrank the env var");
      const byEnv = CR.select("source", { argv: AV(), env: { SOURCE: env } });
      if (byEnv.root !== env) return FAILS(`${byEnv.root} via ${byEnv.layer}`, "the env var must outrank .env and the default");
      const byRest = CR.select("source", { argv: AV(), env: {} });
      if (!/\.env|built-in default/.test(byRest.layer))
        return FAILS(byRest.layer, "with no flag and no env the winner must be .env or the built-in default");
      /* (ii) EXACTLY ONE MODULE. A second reader of SOURCE/CORPUS is a second resolver, which is
       * R-PIN-7's "two paths kept equal by discipline" -- not an invariant. */
      const others = liveGrep(/process\.env\.(SOURCE|CORPUS)\b/, {})
        .filter((h) => !/^engine[\/\\]corpus-root\.js/.test(h));
      if (others.length) return FAILS(others.join(", "), "a second module resolves a root, so precedence is no longer in one place");
      /* (iii) every layer names itself, so a wrong answer can be traced to the layer that gave it. */
      for (const s of [byFlag, byEnv, byRest])
        if (!s.layer) return FAILS(JSON.stringify(s), "a resolution with no named layer cannot be diagnosed");
      return HOLDS(`flag > env > .env/default exercised; sole reader is engine/corpus-root.js; every layer self-names`);
    } },

  { id: "R-CFG-4", req: "A root that is set but missing MUST refuse loudly, naming the root, the resolved absolute path, and which layer supplied it. No silent fallback.",
    run() {
      /* RUN IN A CHILD PROCESS, deliberately. This row is about what the engine does when it is
       * wrong, and the incident in CLAUDE.md §9 is exactly this: a stale root produced ENOENT that
       * MASKED a real failure, and the wrong diagnosis was reported as fact. An in-process assertion
       * on the message string would not have caught it; a real invocation does. */
      const ABSENT = "/definitely/not/a/root/__r_cfg_4__";
      let out = "";
      try {
        require("child_process").execFileSync(process.execPath,
          ["-e", 'require("./engine/corpus-root").sourceRoot()'],
          { cwd: HERE, env: { ...process.env, SOURCE: ABSENT }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return FAILS("exit 0", "a set-but-missing root was ACCEPTED -- this is the silent fallback the row bans");
      } catch (e) { out = `${e.stdout || ""}${e.stderr || ""}`; }
      const missing = [];
      if (!/\bsource\b/.test(out)) missing.push("the root's name");
      if (!out.includes(ABSENT)) missing.push("the resolved absolute path");
      if (!/supplied by:\s*SOURCE env/.test(out)) missing.push("the layer that supplied it");
      if (!/REFUSED|RootError/.test(out)) missing.push("a loud refusal (not a warning)");
      if (missing.length) return FAILS(`refusal omits ${missing.join(", ")}`, `got: ${out.trim().split("\n").slice(0, 3).join(" / ").slice(0, 200)}`);
      /* NO FALL-THROUGH. Checked on the `path:` line, not on the whole output: the refusal also
       * PRINTS the precedence table, which names the built-in default by design. My first draft
       * grepped the default out of the whole message and failed this row on its own help text --
       * the fall-through would show up as a resolved path that is not the one that was set. */
      const pathLine = (out.match(/^\s*path:\s*(.+)$/m) || [])[1];
      if (!pathLine || pathLine.trim() !== ABSENT)
        return FAILS(`path: ${pathLine || "(no path line)"}`, `expected exactly ${ABSENT} -- anything else is a fall-through`);
      return HOLDS("a real child process refused, naming root, absolute path and layer",
        "verified by running it, not by reading the message");
    } },

  { id: "R-PIN-1", req: "Every generated artifact MUST carry a corpus stamp written ON the artifact, never inferred from its path or filename. A filename is not provenance.",
    run() {
      let AC; try { AC = require("./engine/artifact-contract"); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      if (!AC.HEADER_KEYS.includes("corpus")) return FAILS(AC.HEADER_KEYS.join(","), "`corpus` must be a header key");
      /* (i) BEHAVIOURAL: the publisher refuses a corpus-pinned kind with no corpus. This is the
       * half that makes "never inferred" true -- if stamp could derive provenance from the path it
       * is writing to, it would have no reason to demand one. */
      const pinned = AC.kindsOf().filter((k) => AC.specOf(k).corpusPinned);
      if (!pinned.length) return FAILS("no corpusPinned kind in the registry", "provenance would be unenforced");
      const k = pinned[0], spec = AC.specOf(k);
      const body = {}; for (const r of spec.requires) body[r] = [];
      let refused = false;
      try { AC.stamp(k, body, {}); } catch { refused = true; }
      if (!refused) return FAILS(`stamp(${k}) accepted no corpus`, "provenance would be optional, so a filename could stand in for it");
      /* (ii) every artifact actually on disk carries one, and it is a non-empty absolute path. */
      const bad = [];
      for (const kind of AC.kindsOf()) {
        const p = AC.pathFor(kind);
        if (!fs.existsSync(p)) continue;
        let j; try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { bad.push(`${kind}: unreadable`); continue; }
        if (!AC.specOf(kind).corpusPinned) continue;
        if (typeof j.corpus !== "string" || !j.corpus.trim() || !path.isAbsolute(j.corpus)) bad.push(`${kind}: corpus=${JSON.stringify(j.corpus)}`);
      }
      if (bad.length) return FAILS(bad.join("; "), "a corpus-pinned artifact on disk carries no usable provenance");
      return HOLDS(`stamp refuses an unpinned publish; every corpus-pinned artifact present carries an absolute corpus path`,
        "that the stamp is not DERIVED from the write path is enforced by (i): stamp demands one it could otherwise infer");
    } },

  { id: "R-PIN-4", req: "An absent stamp is UNKNOWN, not WRONG: unusable for reporting until republished, and MUST NEVER be silently adopted. allowUnstamped is explicit, never default.",
    run() {
      let AC; try { AC = require("./engine/artifact-contract"); } catch (e) { return FAILS(null, e.message.split("\n")[0]); }
      /* BEHAVIOURAL, in a temp file, because the whole claim is about a DEFAULT -- and a default is
       * a runtime fact. Reading `!opts.allowUnstamped` in the source tells you the branch exists;
       * only calling load() with no opts tells you which way it goes when nobody chose. */
      const kind = AC.kindsOf().find((x) => !AC.specOf(x).corpusPinned);
      if (!kind) return FAILS("no unpinned kind available", "cannot construct an unstamped fixture");
      const spec = AC.specOf(kind);
      const body = { schema: spec.schema, artifactVersion: 1, generated: new Date().toISOString() };
      for (const r of spec.requires) body[r] = [];
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pin4-")), spec.file);
      fs.writeFileSync(tmp, JSON.stringify(body));                 // NO fingerprint: unstamped
      let def = null; try { AC.load(kind, tmp); def = "ACCEPTED"; } catch (e) { def = "refused"; }
      if (def !== "refused")
        return FAILS("load() accepted an unstamped artifact with no opts", "the default silently adopts an UNKNOWN as an answer");
      let opted = null; try { AC.load(kind, tmp, { allowUnstamped: true }); opted = "accepted"; } catch (e) { opted = `still refused (${e.message.split("\n")[0]})`; }
      if (opted !== "accepted")
        return FAILS(opted, "allowUnstamped must be a usable escape hatch, or callers will catch-and-continue instead");
      /* and nothing live may take that escape hatch silently on a reporting path */
      const users = liveGrep(/allowUnstamped\s*:\s*true/, { excludeTests: true })
        .filter((h) => !/^engine[\/\\]artifact-contract\.js/.test(h));
      if (users.length) return FAILS(users.join(", "), "a live consumer adopts an unstamped artifact by default");
      return HOLDS("unstamped is refused by default and accepted only when explicitly opted into; no live opt-in",
        "verified by calling load() both ways on a temp fixture");
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
       * THE CAUSE, measured by sdd-engine-5a over all 1037 files after this row went red, and it is
       * not the double-counted nesting I had guessed: the two figures range over DIFFERENT
       * POPULATIONS. enfile.js countBodyStatements counts only statements that are DIRECT CHILDREN
       * of a function-like body, while the generator layer folds statements anywhere in the file,
       * top level included. packages/hydra-internal/src/index.ts is the clean case -- 0 statements
       * in any function body, 9 collapsed. No clamp could ever have reconciled that.
       *
       * WHICH MEANS THE NARROW FIX IS NOT ENOUGH. Summing per-file residuals instead of clamping a
       * difference of sums yields residual 1,932 and reviewSurface 7,663, but leaves
       * collapseRatioPct still dividing 22,760 by 17,852 -- it removes the clamp that HID the
       * residual without making the ratio possible. Counting deeper does not fix it either: under
       * "any depth inside a function body" (S=33,100) 583 files still violate. Only "every
       * statement at any depth, in or out of a function" is coherent (S=33,918, 0 violations,
       * residual 11,158, reviewSurface 16,889) -- and that takes the headline from 95.4% to 50.2%.
       *
       * SO THIS ROW STAYS RED ON PURPOSE. §7.3 calls the definition FROZEN and the PRD calls it the
       * number the whole engine exists to move; choosing the denominator is Amir's call, not a
       * late-night one, and it is with him. A red row is the correct interim state -- it is the only
       * thing standing between a flattering number and a reader who believes it. Do not "fix" this
       * by adjusting the clamp; that produces a different wrong number and clears the row. */
      /* WHAT CHANGED, 2026-08-31 (s7). The comment above says this row stays red until the
       * denominator is CHOSEN, because §7.3 called it frozen and the choice was Amir's. It is now
       * chosen and written into §7.3: S is "every statement that is a direct child of a Block or a
       * SourceFile" — the folder's own walk — and the headline duly fell from 95.4% to 50.2%. The
       * row is therefore no longer red-on-purpose; it checks the SETTLED definition instead.
       *
       * The "two definitions of S" half was half wrong, and worth saying why. `fnStmtCount` has
       * exactly ONE live consumer, `measure-operations.js:84`, where it sizes a single clustered
       * function body. It never was a rival denominator — it was a per-function count that §7.3
       * mistakenly named as the corpus one. So the check is not "make them the same function"; it
       * is "S is defined ONCE, exported, and no ratio anywhere divides by anything else".
       *
       * The teeth are unchanged and deliberately not softened: the accounting identity below still
       * fails on any clamp, any mismatched population, and any drift between reviewSurface and its
       * own definition. Fixing the inequality by adjusting the clamp still cannot clear this row. */
      const problems = [];
      const ef = read("engine/enfile.js");
      if (!ef.ok) return FAILS(null, ef.why);
      const cbs = ef.text.match(/function countBodyStatements[\s\S]*?\n}/);
      if (!cbs) problems.push("engine/enfile.js has no countBodyStatements — the canonical S is gone");
      /* S must range over the folder's own universe. Checked structurally, against the same
       * predicate enlzw.genSpans uses to find runs, so a quiet narrowing back to function bodies
       * reopens the exact hole that published a perfect score. */
      else if (!/isBlock\([a-z]+\)\s*\|\|\s*ts\.isSourceFile\(/.test(cbs[0]))
        problems.push("countBodyStatements no longer walks Block|SourceFile — S has stopped matching the folder's own walk");
      /* One definition: it must be EXPORTED, so a second consumer reuses it rather than re-deriving. */
      if (!/module\.exports\s*=\s*\{[^}]*countBodyStatements/.test(ef.text))
        problems.push("countBodyStatements is not exported — a second consumer will define S again");
      /* And nothing may divide by the per-function count. `stmts:` in measure-operations is a
       * cluster SIZE, not a ratio, and is the one permitted use. */
      const asDenominator = liveGrep(/\/\s*fnStmtCount\(|fnStmtCount\([^)]*\)\s*\)?\s*\*\s*100/, { excludeTests: true });
      if (asDenominator.length)
        problems.push(`fnStmtCount is used as a ratio denominator at ${asDenominator.join(", ")} — it is a per-function cluster size, not S`);
      const i = enIndex();
      if (i.absent) return problems.length ? FAILS(problems.join("; "), "two definitions of S, and no manifest to check the identity against")
                                           : MANUAL(`no manifest at ${i.where}`, "npm run render");
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
        return FAILS(`collapsedStatements ${coll} > bodyStatements ${body} (excess ${coll - body})` +
          (problems.length ? ` -- AND ${problems.join("; ")}` : ""),
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
      if (problems.length)
        return FAILS(problems.join("; "),
          "the identity closes, but S is no longer the single settled definition §7.3 froze");
      return HOLDS(`collapsed ${coll} <= body ${body}; residual ${resid} unclamped; ` +
        `reviewSurface ${rs.reviewSurface} = calls ${g.calls} + residual ${resid}; ` +
        `S = ${body} from one exported definition over the folder's own walk`,
        "the denominator is §7.3's settled S (Block|SourceFile children), not the retired fnStmtCount");
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
      /* NARROWED, after this row produced a false positive that two other lanes had to measure to
       * refute. The old pattern failed on any textual `readFileSync(0`, which cannot tell
       * "blocks on stdin whether or not you asked" from "reads a pipe BECAUSE the caller passed
       * --stdin". The second is how a UI feeds a script; flagging it inverts the requirement.
       * Measured: `node new-archetype.js --json < /dev/null` returns a JSON refusal at exit 2
       * immediately -- R-LANG-14 satisfied, not violated.
       *
       * So a read of fd 0 must be OPT-IN: gated on an explicit flag, on its own line. An
       * ungated fd-0 read, or any readline/createInterface, is still a violation -- those have no
       * non-interactive form at all. This trades a little precision for the right direction of
       * error: it can miss a read gated by a flag check several lines away, and it no longer fails
       * a script for offering a pipe. */
      const interactive = liveGrep(/readline|createInterface/, { excludeTests: true });
      const fd0 = liveGrep(/readFileSync\(\s*0\b|process\.stdin/, { excludeTests: true })
        .filter((h) => {
          const [rel, ln] = h.split(":");
          const line = (read(rel).text || "").split("\n")[+ln - 1] || "";
          return !/(has|argv|includes|indexOf|flags?)\s*[.(]?.*--/.test(line);   // ungated
        });
      const bad = [...interactive, ...fd0];
      return bad.length ? FAILS(bad.join(", "), "a live script can block on stdin, so a UI cannot drive it")
        : HOLDS(`no readline/createInterface, and every fd-0 read is gated on an explicit flag`,
          "tracked files only -- an uncommitted script is not evidence (see liveGrep)");
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

  /* ══ THE HEADLINE ROWS ═══════════════════════════════════════════════════════════════════════
   * Added 2026-09-01. §7 and §5D.4 name these as the metrics the project is judged by, and the
   * producer has published every field they need since 2026-09-01 — but not one of them was
   * evaluated here, so the numbers lived in a 42 MB artifact nobody diffed. R-MECH-8's shape,
   * applied to the register's own headline: a metric that is published but never checked is a
   * metric that can move without anyone noticing.
   *
   * ONE OF THEM IS RED, AND THAT IS THE POINT. R-ARCH-15 says a file MUST be accounted for by one
   * top-level word; 34 files are not. Mechanizing it makes `verify-register.js` exit 1. That is not
   * a regression this runner introduced — it is the register's own THE RESIDUAL becoming visible at
   * the place the register is read. R-ARCH-22's own Check column already treats R-ARCH-15 as unmet
   * ("30.6% with it off and 93.1% with it on, so the row can be shown to bind").
   *
   * IDS ARE UNIQUE AGAIN — the four collisions (R-ARCH-18, R-MEAS-6, R-MEAS-7, R-REND-8, each
   * appearing TWICE with different requirements) were resolved 2026-09-01 by renumbering the
   * LATER arrival in each pair: R-ARCH-22, R-MEAS-9, R-MEAS-10, R-REND-9. The rows below
   * therefore carry the plain id again; the disambiguating suffixes they used to need retired
   * with the collision. The R-CFG-roots / R-ART-stamp / R-ART-4-runtime suffixes remain — those
   * name which ASPECT of one row is mechanized, which is a different thing. */

  { id: "R-ARCH-15", req: "A file MUST be accounted for by ONE top-level word. An opaque whole-file token is forbidden.",
    run() {
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      const rs = i.j.reviewSurface || {};
      const need = ["oneWordFiles", "oneWordPct", "filesNotCollapsed"];
      const missing = need.filter((k) => rs[k] === undefined);
      if (missing.length) return FAILS(`missing ${missing.join(", ")}`,
        "R-MEAS-9 requires the producer to publish the rate; without it this row cannot be decided at all");
      const not = rs.filesNotCollapsed;
      /* The row says MUST, so the bar is every file, not a good rate. The rate is reported either
       * way, because "34 left" and "34 of 1037" are different pieces of news. */
      if (not > 0) return FAILS(`${rs.oneWordFiles} of ${rs.oneWordFiles + not} files (${rs.oneWordPct}%), ${not} NOT collapsed`,
        "THE RESIDUAL (§5D.4). This row is red on purpose: the register says MUST, and 34 files are not accounted for by one word");
      return HOLDS(`${rs.oneWordFiles} files (${rs.oneWordPct}%), none left`, "every file collapses to one top-level word");
    } },

  { id: "R-ARCH-16", req: "Review surface MUST be reported PER FILE and as a corpus total, beside byte-identity.",
    run() {
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      const rs = i.j.reviewSurface || {};
      if (rs.reviewSurface === undefined || rs.residualStatements === undefined)
        return FAILS("no corpus total", "the corpus half of the row is missing");
      const g = i.j.gate || {};
      if (g.byteIdentical === undefined) return FAILS("no byte-identity beside it",
        "the row says BESIDE byte-identity — compression reported alone is what R-MEAS-6 forbids");
      /* THE PER-FILE HALF, measured rather than assumed. The producer computes a full perFile[] and
       * publishes only three top-15 SLICES of it, so per-file review surface exists for at most 45
       * distinct files out of 1037. R-MEAS-9's Check column cites `perFile[].topSpans` / `.oneWord`
       * as though the whole array were on disk. It is not: the top-level key is absent. */
      const total = g.totalFiles;
      const pf = i.j.perFile, missing = i.j.perFileMissing;

      if (Array.isArray(pf)) {
        /* ACCOUNT FOR EVERY FILE, not just every file that rendered. A row that THREW or came back
         * non-identical never reaches perFile, so an array of 1030 rows against a 1037-file corpus
         * is not "per file" — it is per file that worked, which reports a complete corpus. The
         * producer publishes the omissions as `perFileMissing` so ONE equation decides the row. */
        const nm = Array.isArray(missing) ? missing.length : null;
        if (nm === null) return FAILS(`perFile has ${pf.length} rows, no perFileMissing to account for the rest`,
          "without the omissions published, a short array is indistinguishable from a complete one");
        if (pf.length + nm !== total)
          return FAILS(`perFile ${pf.length} + perFileMissing ${nm} = ${pf.length + nm}, but gate.totalFiles is ${total}`,
            "the array does not account for the corpus — some files are in neither list");
        /* And the rows must actually carry review surface. A per-file array of `rel` alone would
         * satisfy the count and report nothing the row is about. */
        const bad = pf.filter((f) => !f || f.residualStatements === undefined || f.reviewSurfaceTop === undefined).length;
        if (bad) return FAILS(`${bad} of ${pf.length} rows carry no review surface`,
          "per-file REVIEW SURFACE is the requirement; per-file rel is a file list");
        return HOLDS(`corpus ${rs.reviewSurface} beside byteIdentical ${g.byteIdentical}/${total}; per-file rows for all ${pf.length} (+${nm} accounted missing)`,
          "top and whole reads are named per row (reviewSurfaceTop / reviewSurfaceWhole) — the corpus key `reviewSurface` is the WHOLE read and the per-file key of that name is the TOP read, measured 1610 vs 29260");
      }

      /* NO ARRAY. Two different diagnoses, and telling them apart matters: a reader who concludes
       * "the producer does not publish it" will go and add what is already there. */
      const rels = new Set();
      for (const arr of [i.j.topEnglishFiles, rs.worstFiles, rs.worstBySpans])
        for (const f of arr || []) if (f && f.rel && f.residualStatements !== undefined) rels.add(f.rel);
      const prod = read("write-en-files.js");
      const publishes = prod.ok && /^\s*perFile,\s*$/m.test(prod.text);
      if (publishes) return FAILS(`per-file rows for only ${rels.size} of ${total} files, but the producer DOES publish perFile`,
        "the manifest on disk PREDATES the producer — this is a stale artifact, not a missing feature. Re-render");
      return FAILS(`corpus total ${rs.reviewSurface} beside byteIdentical ${g.byteIdentical}/${total}, but per-file rows for only ${rels.size} of ${total} files`,
        "`perFile` is computed by write-en-files.js and published only as three top-15 slices; R-MEAS-9 cites `perFile[]` as if the array were on disk");
    } },

  { id: "R-ARCH-19", req: "A chunk MUST be able to carry CHILDREN instead of a payload, recursively, to leaves — no depth cap.",
    run() {
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      const rs = i.j.reviewSurface || {};
      const need = ["chunks", "chunksAtomic", "chunksStructural", "nestMaxDepth"];
      const missing = need.filter((k) => rs[k] === undefined);
      if (missing.length) return FAILS(`missing ${missing.join(", ")}`, "the nesting population is not published");
      if (!rs.chunksStructural) return FAILS(`${rs.chunks} chunks, 0 structural`,
        "every chunk is ATOMIC — the renderer is flat and nesting exists only in the writer");
      /* A cap would show up as a depth that stops at a round number, so the depth is REPORTED, not
       * merely thresholded. Amir, 2026-09-01: "capping at 2 levels just recreates the same 'some
       * code stays raw' problem one level in." */
      if (rs.nestMaxDepth < 3) return FAILS(`nestMaxDepth ${rs.nestMaxDepth}`,
        "depth 2 is a single level of children — indistinguishable from a cap");
      return HOLDS(`${rs.chunksAtomic} atomic + ${rs.chunksStructural} structural = ${rs.chunks}, deepest nest ${rs.nestMaxDepth}`,
        "structural chunks exist in quantity and nest well past two levels");
    } },

  { id: "R-ARCH-22", req: "R-ARCH-15 OUTRANKS R-ARCH-16: where one word covers a file the renderer MUST emit it, even when nested words would remove more statements.",
    run() {
      const f = read("engine/enlzw.js");
      if (!f.ok) return FAILS(null, f.why);
      const knob = /ONE_WORD_FIRST\s*=\s*process\.env\.ONE_WORD_FIRST\s*!==\s*"0"/.test(f.text);
      const applied = /if\s*\(ONE_WORD_FIRST\s*&&/.test(f.text);
      if (!knob) return FAILS("no ONE_WORD_FIRST knob", "the row's own Check requires ONE_WORD_FIRST=0 to restore the weight objective, so the row can be SHOWN to bind");
      if (!applied) return FAILS("ONE_WORD_FIRST is declared but never read",
        "a declared-and-unread constant is the dead-MAXWIN shape (§Q-6): the ordering would not be in force and nothing would say so");
      return HOLDS("ONE_WORD_FIRST defaults on and gates the whole-file candidate in genSpans",
        "lexicographic, not weighted — and the control that measures it exists (§10.3: a guard that cannot be shown to fire is not a guard)");
    } },

  { id: "R-MEAS-9", req: "The per-file ONE-WORD RATE MUST be published by the render producer, beside review surface.",
    run() {
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      const rs = i.j.reviewSurface || {};
      const missing = ["oneWordFiles", "oneWordPct", "filesNotCollapsed", "worstBySpans"].filter((k) => rs[k] === undefined);
      if (missing.length) return FAILS(`missing ${missing.join(", ")}`,
        "the rate had to be measured by an out-of-band script — the R-MECH-8 shape this row exists to close");
      /* BESIDE review surface, in the same block, is the requirement — not merely somewhere in the
       * artifact. A rate published apart from the surface it qualifies is how compression gets
       * reported as the goal (R-MEAS-6). */
      if (rs.reviewSurface === undefined) return FAILS("rate published without review surface beside it",
        "the row says BESIDE review surface");
      const p = read("write-en-files.js");
      const prints = p.ok && /ONE WORD PER FILE \(R-ARCH-15\)/.test(p.text);
      return HOLDS(`oneWordFiles ${rs.oneWordFiles}, oneWordPct ${rs.oneWordPct}, filesNotCollapsed ${rs.filesNotCollapsed}, beside reviewSurface ${rs.reviewSurface}`,
        prints ? "and the producer prints the rate on every run, so a run that cannot state it is visibly not a passing run"
               : "published in the artifact, but the producer no longer PRINTS it — the row's 'on every run' half is gone");
    } },

  { id: "R-MEAS-10", req: "Where the render is a TREE, review surface MUST be published as BOTH the top-level read and the whole-tree read, side by side, never one alone.",
    run() {
      const i = enIndex();
      if (i.absent) return MANUAL(`no manifest at ${i.where}`, "npm run render");
      if (i.err) return FAILS(null, i.err);
      const rs = i.j.reviewSurface || {};
      const top = rs.reviewSurfaceTop, whole = rs.reviewSurface;
      if (top === undefined || whole === undefined)
        return FAILS(`top:${top} whole:${whole}`, "one of the two reads is absent, and whichever is left flatters");
      /* EQUAL is the tell worth catching. The two reads answer different questions, so a producer
       * that copies one into the other satisfies a key-presence check and publishes one number
       * twice — the same conflation R-COMP-6 guards for the two depths. */
      if (top === whole) return FAILS(`both ${top}`,
        "the two reads are IDENTICAL — check the producer is not writing one number under both keys");
      const p = read("write-en-files.js");
      return HOLDS(`top ${top} beside whole-tree ${whole} (ratio ${(whole / top).toFixed(1)}x)`,
        p.ok && /reviewSurfaceTop/.test(p.text) ? "both are computed and published by the producer, not derived by a reader"
                                                : "published, but the producer does not name reviewSurfaceTop — check who wrote it");
    } },

  /* ══ THE THRESHOLDS, RECONCILED (Q-5, Q-6) ═══════════════════════════════════════════════════
   * Measured 2026-09-01, because "same knob or different knob" had never been answered and the two
   * numbers sit on ADJACENT LINES in repo-dsl.js, which is how they got conflated in the first
   * place. THREE distinct thresholds, not one:
   *
   *   MIN_COUNT      build-lzw-generators.js:90, default 1   occurrences   R-MINE-1. LIVE .en path.
   *   minCount       engine/pipeline.js:36, fallback 2        occurrences   R-WIDE-3. LEGACY mined-library path.
   *   --min          repo-dsl.js:249, default 80             PERCENT       the coverage GATE verdict.
   *
   * `--min` is not a count at all — it is a percentage of corpus coverage — and `repo-dsl.js:252`
   * carries its OWN `--min-count` (2) one line below it. Different units, different pipelines. */

  { id: "R-MINE-1-binding", req: "MIN_COUNT=1 is a SELECTION rule (what the renderer may use), not a construction rule.",
    run() {
      const c = constValue("build-lzw-generators.js", "MIN_COUNT");
      if (!c.ok) return FAILS(null, c.why);
      if (c.got !== "1") return FAILS(`MIN_COUNT = ${c.got}`, "R-MINE-1 binds the DEFAULT; see the R-MINE-1 row");
      const w = read("engine/wordlzw.js");
      if (!w.ok) return FAILS(null, w.why);
      /* MEASURED 2026-09-01: buildSaturated over a synthetic 6-stream corpus returns the IDENTICAL
       * dictionary (33 entries, sha256 f9c6148605369d1f) for opts.minCount of undefined, 1, 2 and 3.
       * Construction is gated on `createMinCount` (default 1), not on minCount — so of the two calls
       * build-lzw-generators.js makes, only `promote` binds. The register does not say this, and a
       * reader who assumes MIN_COUNT gates construction will "fix" the wrong call. */
      const createGate = /createGate\s*=\s*opts\.createMinCount\s*!=\s*null\s*\?\s*opts\.createMinCount\s*:\s*1/.test(w.text);
      const promoteReads = /function promote[\s\S]*?const minCount = opts\.minCount \|\| 2/.test(w.text);
      if (!createGate) return FAILS("buildSaturated no longer separates createMinCount from minCount",
        "if construction is gated on recurrence again, R-MINE-1 becomes a construction rule and every depth figure was measured under a different regime");
      if (!promoteReads) return FAILS("promote() no longer reads opts.minCount",
        "then MIN_COUNT reaches NOTHING and R-MINE-1 is vacuous — the register would still read green");
      return HOLDS("MIN_COUNT 1 -> promote() only; buildSaturated gates on createMinCount (default 1) and ignores minCount entirely",
        "creation-gate vs selection are separate knobs, measured: 4 values of opts.minCount, one identical dictionary");
    } },

  { id: "R-CFG-gate-threshold", req: "Q-5: the coverage gate threshold has TWO values — §8 records >= 20%, the code default is 80.",
    run() {
      const f = read("repo-dsl.js");
      if (!f.ok) return FAILS(null, f.why);
      const m = f.text.match(/flag\(args,\s*"--min",\s*(\d+)\)\s*;\s*\/\/\s*corpus coverage/);
      if (!m) return MANUAL("the gate's --min default could not be read off repo-dsl.js",
        "grep -n '\"--min\"' repo-dsl.js — the row cannot be decided without it");
      /* NOT a FAILS: which number binds is a DECISION (§18 Q-5 names three ways to close it), and a
       * runner must not cast a vote by turning one of them red. It is not a HOLDS either, because
       * a constant with two values is not a constant. So: MANUAL, carrying the consequence the
       * question never had attached to it — measured, not argued. */
      const cov = (() => {
        try {
          const CR2 = require("./engine/corpus-root");
          const j = JSON.parse(fs.readFileSync(path.join(CR2.corpusRoot(), ".cache", "spec-derived", "corpus-coverage.json"), "utf8"));
          return j.rollup && j.rollup.coveragePct;
        } catch { return null; }
      })();
      const verdicts = cov == null ? "no persisted coverage to price it against"
        : `corpus coverage is ${cov}%, so the code default ${m[1]} FAILS the gate and §8's 20 PASSES it`;
      return MANUAL(`two thresholds, opposite verdicts: ${verdicts}`,
        "node repo-dsl.js gate --no-mine   vs   --min 20. One decision, then DELETE the losing number (§18 Q-5)");
    } },

  { id: "R-CFG-12", req: "A SOURCE-PROTECTED artifact MUST NEVER be deleted in any cleanup.",
    run() {
      const f = read("sdd-clean.js");
      if (!f.ok) return FAILS(null, f.why);
      /* PROTECTED cannot express this: it matches a path's FIRST SEGMENT only, so it can say
       * "catalog/" and never "sen/catalog/". Until 2026-09-01 `--wipe-sen --go` deleted
       * sen/catalog/word-names.json — 20 authored names, 0 tracked files, unrecoverable. */
      const guarded = /GUARDED\s*=\s*\[/.test(f.text) && /path\.join\(SEN,\s*"catalog"\)/.test(f.text);
      const both = /inside\(gabs,\s*abs\)/.test(f.text);
      const wholesale = (() => { const i = f.text.indexOf("/* scope 2"); return i >= 0 && /\bplan\(SEN\)/.test(f.text.slice(i)); })();
      if (wholesale) return FAILS("scope 2 plans sen/ WHOLESALE",
        "one recursive rmSync over a directory nobody enumerated — the exact hole, and no name list can exempt a descendant of it");
      if (!guarded) return FAILS("no GUARDED entry for sen/catalog", "PROTECTED sees first path segments only");
      if (!both) return FAILS("the guard tests equality, not containment",
        "the hole was an ANCESTOR of the protected path, which an equality test never sees");
      return HOLDS(`sen/catalog is a GUARDED subtree behind --wipe-catalog, refused as target OR ancestor`,
        exists("engine/sdd-clean.test.js") ? "pinned by engine/sdd-clean.test.js (11 assertions, throwaway tmp roots), mutation-checked"
                                           : "NO TEST — the guard is asserted by reading the source only");
    } },

  { id: "R-REND-6", req: "THE SENTENCE IS AUTHORITATIVE: a hand-edit to a clause's English MUST change the compiled TypeScript.",
    run() {
      const f = read("engine/enfile.js");
      if (!f.ok) return FAILS(null, f.why);
      /* CUT 1 — detection. The register says it shipped 2026-08-31: deriveGloss re-derives the
       * gloss from the payload and THROWS on disagreement, opt-in via SDD_DERIVE_CHECK. Checked
       * structurally, because running it needs a corpus and this row must be decidable without one. */
      const derive = /function deriveGloss\(/.test(f.text);
      const wired = /const derived = deriveGloss\(/.test(f.text) && /deriveCheck\b/.test(f.text);
      const knob = /DERIVE_CHECK = process\.env\.SDD_DERIVE_CHECK === "1"/.test(f.text);
      if (!derive || !wired) return FAILS(`deriveGloss:${derive} wired:${wired}`,
        "CUT 1 is gone — a hand-edit is not even DETECTED, which the register records as shipped");
      if (!knob) return FAILS("no SDD_DERIVE_CHECK knob",
        "the check cannot be turned on, so its 1037/1037 zero-false-positive measurement is unreproducible");
      /* CUT 2 — effect. The register states plainly that it "needs the §5E.3.2 grammar parser and
       * is NOT BUILT". So the row's own MUST does not hold, and this is red on purpose, exactly as
       * R-ARCH-15 is: the register's known gap, made visible where the register is read.
       *
       * MEASURED 2026-09-01 by `measure-hand-edit.js` over 154 evenly-sampled .en files: of 580
       * hand edits to the English, 0 changed the compiled .ts. With the check OFF all 580 were
       * SILENT — the file still compiled and the author's edit was gone. With SDD_DERIVE_CHECK=1
       * the 460 edits on ATOMIC chunks all became loud refusals (0 silent), and the 120 on
       * STRUCTURAL chunks stayed silent because a ▷ chunk has children instead of a payload, so
       * there is nothing to derive a gloss from — a documented boundary of the guard, not a hole.
       * Controls landed in the same run: payload-hole 150/150 and verbatim 4/4 took effect. */
      return FAILS("CUT 1 (detection) shipped; CUT 2 (the edit takes effect) not built — 0 of 580 sampled English edits changed the .ts",
        "with the check off all 580 were SILENT; with it on, 460 atomic became refusals and 120 structural stayed silent (▷ has no payload to derive from). " +
        "Reproduce: node measure-hand-edit.js. Closing it needs the §5E.3.2 grammar parser (§18 Q-1)");
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
