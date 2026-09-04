/* sdd-run-declarations.test.js — DOES THE STEP MANIFEST STILL DESCRIBE THE TOOLS?
 *
 * RED ON PURPOSE, like the-goal.test.js. Two assertions fail today against six real drifts. The
 * fix is to correct the MANIFEST in sdd-run.js, never to loosen an assertion here: a green
 * declaration test over a drifted manifest is strictly worse than no test, because it certifies
 * the wrong answer. If a finding is judged acceptable, the declaration should say so in words
 * rather than the check being widened to stop noticing.
 *
 * WHY THIS FILE EXISTS. `sdd-run.js` declares 14 steps, each with `reads`, `writes`, `needs` and
 * sometimes `requiresArgv`. Those declarations are what a UI renders BEFORE it dares run anything:
 * which root a step touches, what it will overwrite, whether it is safe. `sdd-run.test.js` already
 * checks the manifest's STRUCTURE thoroughly — ids unique, scripts exist on disk, npm names exist,
 * `needs` kinds registered, exit codes, the destructive gate. It checks nothing about whether the
 * declarations are TRUE.
 *
 * They had already drifted. Measured 2026-09-03, four of fourteen:
 *
 *   reconcile   `reads` says "census (argv[2], caller-supplied)" and `requiresArgv.why` says
 *               "there is no default and no live producer". Both false now: censusFromPlan()
 *               derives it from the stamped naming-plan, produced by `npm run name:plan`. So
 *               sdd-run REFUSES a step that works, and `needs` names word-names when the hard
 *               dependency is naming-plan.
 *   gate        `reads` says `<CORPUS>/`. repo-dsl.js:53 sets its default corpus to
 *               `CR.sourceRoot()` — it walks the READ root. In a project whose first rule is that
 *               the two roots are distinct, this is the worst possible field to be wrong.
 *   stamp:check `reads` says `<CORPUS>/sen/catalog/`. It iterates EVERY registered kind, so it
 *               also reads `.cache/spec-derived/` — understated scope.
 *   render      writes `<CORPUS>/.gitignore` when absent, and relocates `.calc` files into
 *               `.cache/` with renameSync. Neither is declared.
 *
 * A MANIFEST THAT HAS DRIFTED IS WORSE THAN NO MANIFEST, because a UI built on it renders
 * confident wrong answers about blast radius, and it does so with a schema version attached. That
 * is the producer/consumer drift class this project keeps paying for, one layer up.
 *
 * WHAT THIS TEST DOES NOT DO. It does not attempt general static analysis of what a script
 * touches — that would be fragile and would fail in the flattering direction the first time it
 * could not parse something. It asserts three MECHANICAL properties that need no interpretation,
 * and REPORTS anything it cannot decide instead of scoring it. A finding it prints but does not
 * assert is still a finding; a green assertion over an unparsed file would not be.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const AC = require("./artifact-contract");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };

const HERE = path.join(__dirname, "..");
const RUNNER = path.join(HERE, "sdd-run.js");
if (!fs.existsSync(RUNNER)) { console.error("REFUSING: no sdd-run.js at " + RUNNER); process.exit(3); }

/* THE MANIFEST, TAKEN FROM THE RUNNER'S OWN --list RATHER THAN BY RE-PARSING ITS SOURCE. Re-parsing
 * would test my parser; --list is the contract a UI consumes, so it is the thing that must be true. */
const { spawnSync } = require("child_process");
const r = spawnSync(process.execPath, [RUNNER, "--list"], { cwd: HERE, encoding: "utf8", maxBuffer: 1 << 26 });
let manifest = null;
try { manifest = JSON.parse(r.stdout); } catch (e) {
  console.error("REFUSING: sdd-run.js --list did not emit parseable JSON (exit " + r.status + "): " + e.message);
  process.exit(3);
}
const STEPS = manifest.steps || [];
ok(STEPS.length > 0, "the manifest was obtained from `sdd-run.js --list` (" + STEPS.length + " steps, schema " + manifest.schema + ")");

const srcOf = (step) => {
  const f = path.join(HERE, step.cmd[0]);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
};
/* Comments are stripped before any pattern is applied. Every one of these scripts documents its
 * own history in prose -- `reconcile-names.js` has a paragraph containing the words `argv[2]` and
 * `AC.pathFor` inside a comment about a bug it already fixed -- so matching raw text would read
 * the archaeology as live code and produce findings that are pure noise. */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

/* ---- PROVE THE DETECTORS CAN FIRE ------------------------------------------------------------
 * Three times on 2026-09-03 a check returned a clean zero it could never have returned anything
 * else for. So each matcher below is run once against synthetic text that MUST trip it, before it
 * is trusted to be silent on the real thing. A zero from an assertion that cannot fail is not
 * evidence. */
const usesSourceRoot = (s) => /CR\.sourceRoot\s*\(/.test(s);
const usesCorpusRoot = (s) => /CR\.corpusRoot\s*\(/.test(s);
const kindsUsed = (s) => {
  const out = new Set();
  for (const m of s.matchAll(/AC\.(?:pathFor|load)\s*\(\s*["']([\w-]+)["']/g)) out.add(m[1]);
  return out;
};
const positionalDefault = (s, pos) =>
  new RegExp("process\\.argv\\[" + pos + "\\]\\s*\\|\\|").test(s) ||
  /censusFrom\w+\s*\(/.test(s);
{
  ok(usesSourceRoot("x = CR.sourceRoot();") && !usesSourceRoot("x = CR.corpusRoot();"),
     "the sourceRoot matcher fires on a synthetic positive and stays silent on a negative");
  ok(usesCorpusRoot("CR.corpusRoot()") && !usesCorpusRoot("CR.sourceRoot()"),
     "the corpusRoot matcher fires on a synthetic positive and stays silent on a negative");
  const k = kindsUsed('AC.pathFor("naming-plan"); AC.load("word-names", p);');
  ok(k.has("naming-plan") && k.has("word-names") && k.size === 2,
     "the artifact-kind matcher fires on both pathFor and load (found " + [...k].join(", ") + ")");
  ok(positionalDefault("const F = process.argv[3] || AC.pathFor('word-names');", 3) &&
     !positionalDefault("const C = process.argv[2];", 2),
     "the positional-default matcher distinguishes a defaulted positional from a bare one");
  ok(decomment("/* argv[2] AC.pathFor(\"ghost\") */ real()").indexOf("ghost") < 0,
     "the comment stripper removes prose archaeology — a fixed bug described in a comment must " +
     "not be read as live code");
}

/* ---- 1. ROOT USAGE — REPORTED, NOT ASSERTED, AND THE REASON IS §3 --------------------------
 * The first version of this asserted "a step calling CR.sourceRoot() must declare <SOURCE>". It
 * found six steps and only ONE was a real drift, because RESOLVING a root is not READING a tree
 * rooted there:
 *
 *   clean / clean:sen  resolve sourceRoot() precisely in order to PROTECT it — declaring <SOURCE>
 *                      as something they read would be actively misleading about a wipe tool.
 *   roots / register / test  resolve a root to INSPECT or report it, not to walk it.
 *   gate               is the real one: repo-dsl.js:53 makes CR.sourceRoot() its default walk
 *                      root while the manifest declares `<CORPUS>/`.
 *
 * Five false positives out of six. CLAUDE.md §3: "A guard that cries wolf gets ignored, then
 * removed" — that already happened once here, to the root-literal guard, and it was fixed rather
 * than deleted. I cannot mechanically separate resolve-to-protect from resolve-to-walk with a
 * call-site grep, so this prints for a human and scores nothing. Reporting a signal I cannot make
 * precise is honest; asserting it would train the next reader to ignore the file. */
const rootUse = [];
for (const step of STEPS) {
  const raw = srcOf(step); if (raw === null) continue;
  const s2 = decomment(raw);
  const decl = [...(step.reads || []), ...(step.writes || [])].join(" ");
  const uses = [];
  if (usesSourceRoot(s2)) uses.push("sourceRoot" + (/<SOURCE>/.test(decl) ? "" : " (undeclared)"));
  if (usesCorpusRoot(s2)) uses.push("corpusRoot" + (/<CORPUS>/.test(decl) ? "" : " (undeclared)"));
  if (uses.length) rootUse.push("    " + step.id.padEnd(20) + uses.join(", ") + "   declared: " + JSON.stringify(step.reads || []));
}
console.log("\n  root resolution per step, for review (resolving a root is NOT reading a tree —\n" +
            "  clean resolves SOURCE to protect it, roots/register/test to inspect it):");
rootUse.forEach((l) => console.log(l));

/* ---- 2. ARTIFACT KINDS ------------------------------------------------------------------------
 * TWO WEAKNESSES IN THE FIRST VERSION OF THIS CHECK, both found by reading its output against the
 * scripts rather than trusting its count, and both fixed here:
 *
 *  (a) `needs` was not counted. It is the machine-readable dependency field — a kind named there
 *      IS declared, even if `reads` is a display string. Counting it drops `gate`'s mined-library,
 *      so my own finding went from 4 to 3. A check whose first output flatters its author is the
 *      one to re-read.
 *  (b) The home-directory match was substring-based, so a step declaring ONE cache artifact by
 *      full path (`<CORPUS>/.cache/spec-derived/name-queue.json`) appeared to declare EVERY cache
 *      kind. That hid `reconcile`'s dependency on naming-plan — the exact drift this file was
 *      written for. A home now counts only when a declaration names it AS A DIRECTORY, which is
 *      how `stamp:check` legitimately covers many kinds at once and how a single-file declaration
 *      legitimately does not. */
const registered = new Set(AC.kindsOf());
const declaresHome = (entries, home) => entries.some((e) => {
  const t = String(e).replace(/^<CORPUS>\/?/, "").replace(/\/+$/, "");
  return t === home;                     /* the home itself, not a file that happens to live in it */
});
/* A step whose cmd carries a SUBCOMMAND (`repo-dsl.js gate`) runs one path through a multi-command
 * script. Scanning the file attributes every subcommand's artifacts to this step, so those findings
 * are separated and REPORTED rather than asserted — `gate` does not stop being honest because
 * `repo-dsl.js mine` resolves corpus-coverage. Deciding which subcommand reaches which resolve
 * needs real call-graph analysis, and a fragile assertion that fails in the flattering direction is
 * worse than a labelled report. */
const kindDrift = [], kindUnsure = [];
for (const step of STEPS) {
  const raw = srcOf(step); if (raw === null) continue;
  const s2 = decomment(raw);
  const entries = [...(step.reads || []), ...(step.writes || [])];
  const decl = entries.join(" ");
  const needs = new Set(step.needs || []);
  for (const kind of kindsUsed(s2)) {
    if (!registered.has(kind)) continue;              /* unregistered kinds are sdd-run.test.js's job */
    if (needs.has(kind)) continue;                    /* declared as a dependency, which is the point */
    const spec = AC.specOf(kind);
    const file = spec && spec.file ? spec.file : kind;
    const home = (spec && AC.HOMES[spec.home]) || "";
    if (decl.includes(file) || decl.includes(kind)) continue;
    if (home && declaresHome(entries, home)) continue;
    (step.cmd.length > 1 ? kindUnsure : kindDrift).push(step.id + ": resolves artifact " + JSON.stringify(kind) + " (" + home + "/" + file +
                   ") but it is named in neither reads/writes nor needs");
  }
}
if (kindDrift.length) kindDrift.forEach((d) => console.log("     " + d));
if (kindUnsure.length) {
  console.log("     -- whole-file scan of a MULTI-COMMAND script, not scored (other subcommands" +
              " may own these):");
  kindUnsure.forEach((d) => console.log("        " + d));
}
ok(kindDrift.length === 0,
   "every registered artifact a step resolves is declared in reads/writes or needs (" +
   kindDrift.length + " undeclared) — an undeclared input is a step a UI will offer to run before " +
   "that input exists");

/* ---- 3. requiresArgv, IN BOTH DIRECTIONS ------------------------------------------------------
 * `sdd-run.test.js` asserts: a script reading a defaultless positional MUST declare requiresArgv.
 * It does not assert the converse, and the converse is where `reconcile` drifted — it GREW a
 * default (censusFromPlan) and the declaration kept refusing. A one-directional guard fails
 * silently in whichever direction it does not look, which is the same defect as a detector that
 * cannot fire, one level up. */
const argvDrift = [];
for (const step of STEPS) {
  if (!Array.isArray(step.requiresArgv) || !step.requiresArgv.length) continue;
  const raw = srcOf(step); if (raw === null) continue;
  const s = decomment(raw);
  for (const req of step.requiresArgv) {
    if (positionalDefault(s, req.position))
      argvDrift.push(step.id + ": declares requiresArgv " + JSON.stringify(req.name) + " at position " +
                     req.position + ' saying "' + String(req.why || "").slice(0, 60) +
                     '", but the script now has a default for it — sdd-run REFUSES a step that runs');
  }
}
if (argvDrift.length) argvDrift.forEach((d) => console.log("     " + d));
ok(argvDrift.length === 0,
   "no step refuses on a requiresArgv the script has since given a default (" + argvDrift.length +
   " drifted) — this is the direction sdd-run.test.js does not check");

/* ---- 4. WRITES THIS TEST CANNOT DECIDE — REPORTED, NEVER SCORED -------------------------------
 * Whether a given writeFileSync is reachable, conditional, or env-gated is not decidable by
 * pattern. So these are printed for a human and deliberately NOT asserted: an assertion here
 * would either be flaky or would quietly pass on everything it failed to understand. */
const WRITE = /\b(?:writeFileSync|appendFileSync|renameSync|rmSync|unlinkSync|copyFileSync|createWriteStream)\s*\(/g;
console.log("\n  write sites per step, for review (count only — reachability is not decidable here):");
let envGated = 0;
for (const step of STEPS) {
  const raw = srcOf(step); if (raw === null) continue;
  const s = decomment(raw);
  const n = (s.match(WRITE) || []).length;
  const env = [...s.matchAll(/process\.env\.(\w+)\s*===?\s*["']1["']/g)].map((m) => m[1]);
  if (n === 0 && (step.writes || []).length === 0) continue;
  console.log("    " + step.id.padEnd(20) + n + " write site(s), declared " + (step.writes || []).length +
              (env.length ? "   ENV-GATED MUTATION: " + env.join(", ") : ""));
  if (env.length) envGated++;
}
/* THE ONE THING WORTH ASSERTING HERE, because it is a hole in the SAFETY model rather than in a
 * description: sdd-run's guard is a FLAG a person types (--allow-destructive). A mutation gated on
 * an environment variable is invisible to it, and a UI inherits its own environment. */
console.log("\n  steps with an env-gated mutation the --allow-destructive flag cannot see: " + envGated);
ok(true, "env-gated mutations are reported (" + envGated + ") — sdd-run's consent gate is a flag, " +
   "so an env-gated write bypasses it; recorded rather than asserted because whether that is " +
   "acceptable is Amir's call, not this test's");

console.log("\n" + (fail ? "FAILED " + fail + " / " : "") + pass + " assertions passed");
