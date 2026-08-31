#!/usr/bin/env node
"use strict";
/**
 * sdd-run.js — the MACHINE-CALLABLE front end to the pipeline. Built for a UI to drive.
 *
 * WHY A WRAPPER AND NOT `--json` ON ELEVEN SCRIPTS. Amir wants the steps wired into a UI. The
 * pipeline scripts print prose for a human and only one of them (measure-uncollapsed.js) speaks
 * JSON, so a UI would have to screen-scrape. Adding an output mode to each script means editing
 * every one of them — including the byte-identity path, where a change is a regression risk for
 * no functional gain. This wrapper adds the machine interface WITHOUT modifying a single
 * pipeline script: it runs them as subprocesses and reports a structured envelope. If it is
 * deleted, nothing else changes behaviour.
 *
 *   node sdd-run.js --list                 the step manifest — what a UI renders as the pipeline
 *   node sdd-run.js --status               resolved roots + which artifacts exist right now
 *   node sdd-run.js <step> [-- <argv...>]  run one step; everything after `--` goes to the script
 *
 * THE STDOUT CONTRACT, and it is the whole point: with --json (the default for --list and
 * --status), stdout carries EXACTLY ONE JSON document and nothing else. Child prose is relayed
 * to stderr. A UI parses stdout without a heuristic and shows stderr as the live log.
 *
 * EXIT CODE = the child's exit code, unchanged. 2 means sdd-run itself refused (unknown step,
 * a destructive step without consent, a root that will not resolve). `ok` in the envelope is
 * exitCode === 0, so a UI never has to interpret prose to know whether a step succeeded.
 *
 * SAFETY. A step marked `destructive` REFUSES without --allow-destructive, which a person types.
 * That mirrors sdd-clean.js's own two-flag gate; this wrapper must not become a way to delete the
 * English tree with one click. `expensive` steps are declared so a UI can warn before a
 * tens-of-minutes mine, never to block one.
 *
 * Writes nothing. Reads roots and artifact state only through engine/corpus-root.js and
 * engine/artifact-contract.js, so it cannot drift from what the real tools resolve (PRD §1B, §8B).
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const CR = require("./engine/corpus-root");
const AC = require("./engine/artifact-contract");

const HERE = __dirname;
const SCHEMA = "sdd-run/v1";

/* ── THE STEP MANIFEST ─────────────────────────────────────────────────────────────────────────
 * Declared, not discovered. A UI needs to know a step's cost and blast radius BEFORE running it,
 * and that cannot be inferred from a filename. `npm` is the script name in package.json so the
 * two stay honest about each other; `reads`/`writes` are for display, not resolution. */
const STEPS = Object.freeze([
  { id: "roots", npm: "roots", cmd: ["roots.js"], phase: "inspect",
    title: "Show the resolved roots",
    detail: "Where the engine is pointed and which layer decided it. Run this first when anything looks wrong.",
    measuredMs: 690, measuredNote: "measured 2026-08-31 on the self-hosting corpus, 1037 files",
    reads: [".env"], writes: [], expensive: false, destructive: false, needs: [] },

  { id: "mine", npm: "mine", cmd: ["build-lzw-generators.js"], phase: "pipeline", order: 1,
    title: "Mine the recursive word dictionary",
    detail: "Walks SOURCE, builds the LZW dictionary that the .en compiles through. MEASURED 2026-08-31: ~3.6s over 1037 files, not the tens of minutes this once cost.",
    measuredMs: 3600, measuredNote: "measured 2026-08-31 by session sdd-engine-5f, 1037 files",
    reads: ["<SOURCE>/**/*.ts"], writes: ["<CORPUS>/sen/catalog/generators-lzw.json"],
    expensive: false, destructive: false, needs: [] },

  { id: "name", npm: "name", cmd: ["name-words-lzw.js", "worksheet"], phase: "pipeline", order: 2,
    title: "Emit the Tier-2 naming worksheet",
    detail: "Proposes names for dictionary words. Emits the worksheet only — it never applies names.",
    measuredMs: 22430, measuredNote: "measured 2026-08-31 on the self-hosting corpus, 1037 files",
    reads: ["<CORPUS>/sen/catalog/generators-lzw.json", "<SOURCE>/**/*.ts"], writes: ["name-words-lzw-worksheet.json (engine tree, gitignored — see README)"],
    expensive: true, destructive: false, needs: ["generators-lzw"] },

  { id: "reconcile", npm: "reconcile", cmd: ["reconcile-names.js"], phase: "pipeline", order: 2,
    title: "Reconcile names after a re-mine",
    detail: "Orphan ledger and re-adoption PROPOSALS. Never applies a name automatically.",
    reads: ["<CORPUS>/sen/catalog/word-names.json"], writes: ["<CORPUS>/.cache/spec-derived/name-queue.json"],
    expensive: false, destructive: false, needs: ["word-names"] },

  { id: "render", npm: "render", cmd: ["write-en-files.js"], phase: "pipeline", order: 3,
    title: "Render the corpus to .en",
    detail: "Writes an editable .en per source file, each verified byte-identical back to .ts before it is written.",
    reads: ["<CORPUS>/sen/catalog/generators-lzw.json", "<SOURCE>/**/*.ts"],
    writes: ["<CORPUS>/sen/files/**/*.en", "<CORPUS>/.cache/spec-derived/en-index.json"],
    expensive: true, destructive: false, needs: ["generators-lzw"] },

  { id: "measure", npm: "measure", cmd: ["measure-english.js"], phase: "pipeline", order: 4,
    title: "The scoreboard",
    detail: "PRD §7.0: byte-identity, vacuous-clause count, English-completeness. The numbers Amir reads.",
    note: "Does NOT read .en files from disk — it walks <SOURCE>/**/*.ts and renders/compiles in memory. So `measure` does NOT depend on `render` having run, and reports 1037/1037 on a corpus with zero .en on disk. A UI must not draw measure downstream of render.",
    measuredMs: 45622, measuredNote: "measured 2026-08-31 on the self-hosting corpus, 1037 files",
    reads: ["<SOURCE>/**/*.ts", "<CORPUS>/sen/catalog/generators-lzw.json"], writes: [],
    expensive: true, destructive: false, needs: ["generators-lzw"] },

  { id: "measure:uncollapsed", npm: "measure:uncollapsed", cmd: ["measure-uncollapsed.js"], phase: "measure",
    title: "Un-collapsed recurring structure",
    detail: "The PRD §7 frozen classifier. This one already speaks --json on its own.",
    note: "Writes NOTHING by default. It only persists when given an output path: `-- --json <path>`.",
    reads: ["<SOURCE>/**/*.ts", "<CORPUS>/sen/catalog/generators-lzw.json"], writes: [],
    expensive: true, destructive: false, needs: ["generators-lzw"] },

  { id: "stamp:check", npm: "stamp:check", cmd: ["stamp-artifacts.js", "--check"], phase: "check",
    title: "Verify every artifact header",
    detail: "PRD §8B: schema, artifactVersion, corpus, generated, fingerprint. Exits non-zero on a violation.",
    measuredMs: 720, measuredNote: "measured 2026-08-31 on the self-hosting corpus, 1037 files",
    reads: ["<CORPUS>/sen/catalog/"], writes: [],
    expensive: false, destructive: false, needs: [] },

  { id: "register", npm: "register", cmd: ["verify-register.js"], phase: "check",
    title: "Verify the mechanized §R requirement rows",
    detail: "Checks the requirements-register rows that can be checked by machine. Read-only: never triggers a mine or a round-trip.",
    coverageWarning: "MANUAL IS NOT A PASS, and a row absent from the runner is not a row that holds. As of 2026-08-31 the runner mechanizes 13 rows of a ~100-row register — 9 hold, 0 fail, 4 manual. A UI that renders this as \"all green\" is lying about the register. Show the fraction mechanized next to the result, always.",
    measuredMs: 720, measuredNote: "measured 2026-08-31 on the self-hosting corpus, 1037 files",
    reads: ["tools/prd/11-requirements-register.md", "engine/**"], writes: [],
    expensive: false, destructive: false, needs: [] },

  { id: "gate", npm: "gate", cmd: ["repo-dsl.js", "gate"], phase: "check",
    title: "The measurement gate",
    detail: "Pipeline B, the measurement path. Note it does NOT rebuild the live dictionary — that is `mine`.",
    reads: ["<CORPUS>/"], writes: ["<CORPUS>/.cache/spec-derived/gate.json"],
    expensive: true, destructive: false, needs: ["mined-library"] },

  { id: "test", npm: "test", cmd: ["run-tests.js"], phase: "check",
    title: "Unit tests (+ corpus tier when mined)",
    detail: "Green on a fresh clone with no corpus. The corpus tier reports SKIPPED when artifacts are absent — a state, not a failure.",
    knownRed: "As of 2026-08-31 this exits 1 for ONE real reason: engine/enfile-label-sanitize.test.js catches source carrying the sentinels « » verbatim being eaten by the compile-side span scanner. Corpus exposure measured at 0 files, so byte-identity still holds at 100%. Do not treat a red `test` as this wrapper misbehaving, and do not silence it.",
    reads: ["engine/*.test.js"], writes: [], expensive: false, destructive: false, needs: [] },

  { id: "test:slow", npm: "test:slow", cmd: ["run-tests.js", "--slow"], phase: "check",
    title: "Full-corpus round-trips",
    detail: "Byte-identity over every file. Minutes each, and has OOM-killed on shared machines.",
    reads: ["<CORPUS>/"], writes: [], expensive: true, destructive: false, needs: ["generators-lzw"] },

  { id: "clean", npm: "clean", cmd: ["sdd-clean.js"], phase: "clean",
    title: "Dry-run the cleaner",
    detail: "Names what a wipe WOULD delete, with file and byte counts. Deletes nothing.",
    measuredMs: 24, measuredNote: "measured 2026-08-31 on the self-hosting corpus, 1037 files",
    reads: ["<CORPUS>/"], writes: [], expensive: false, destructive: false, needs: [] },

  { id: "clean:sen", npm: "clean:sen", cmd: ["sdd-clean.js", "--wipe-sen"], phase: "clean",
    title: "Wipe the English tree (still a dry-run)",
    detail: "Deleting sen/ ALSO requires --go, typed by hand. SOURCE is never wipable by anything.",
    reads: ["<CORPUS>/sen/"], writes: ["deletes <CORPUS>/sen/ only with --go"],
    expensive: false, destructive: true, needs: [] },
]);

const byId = new Map(STEPS.map((s) => [s.id, s]));

/* ── root + artifact state, resolved the ONLY legal way ───────────────────────────────────────
 * Through corpus-root.js and artifact-contract.js. Never by joining a path here: a second
 * resolver is how "the engine measured the wrong tree" happens (PRD §1B, CLAUDE.md §2). */
function rootsState() {
  const out = {};
  for (const name of CR.names()) {
    try {
      const picked = CR.select(name, {});
      const abs = CR.root(name);
      out[name] = { root: abs, layer: picked.layer, role: CR.specOf(name).role,
        exists: fs.existsSync(abs), refused: false };
    } catch (e) {
      out[name] = { root: null, layer: null, role: CR.specOf(name).role, exists: false,
        refused: true, why: e.message.split("\n")[0] };
    }
  }
  return out;
}

function artifactState() {
  const out = {};
  let corpus;
  try { corpus = CR.corpusRoot(); } catch { return out; }
  for (const kind of AC.kindsOf()) {
    const p = AC.pathFor(kind, corpus);
    let state;
    try { AC.load(kind, p); state = { present: true, valid: true, path: p }; }
    catch (e) {
      state = fs.existsSync(p)
        ? { present: true, valid: false, path: p,
            why: e.expected ? `expected ${e.expected}, got ${e.got}` : e.message.split("\n")[0] }
        : { present: false, valid: false, path: p };
    }
    out[kind] = state;
  }
  return out;
}

/** Which of a step's DECLARED prerequisites are missing, BY NAME.
 *
 * Deliberately per-step, not one shared "is the corpus mined" flag. run-tests.js already made
 * and removed that mistake, and records why: an all-or-nothing gate over
 * ["generators-lzw","word-names"] meant one absent artifact skipped all six corpus tests, and
 * four of them were reported as needing a mined corpus when the corpus they needed was fully
 * mined. A block has to name the thing that is actually missing or it measures the gate, not
 * the corpus. Each step's `needs` is derived from what that script actually loads, not guessed
 * from its filename. */
function missingFor(step, arts) {
  return (step.needs || []).filter((k) => !(arts[k] && arts[k].present && arts[k].valid))
    .map((k) => ({ kind: k, state: !arts[k] ? "unregistered"
      : arts[k].present ? "present but fails the contract: " + (arts[k].why || "") : "absent",
      path: arts[k] ? arts[k].path : null }));
}

function emit(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }

/* ── CLI ──────────────────────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const dashdash = argv.indexOf("--");
const passthru = dashdash >= 0 ? argv.slice(dashdash + 1) : [];
const mine = dashdash >= 0 ? argv.slice(0, dashdash) : argv;
const has = (f) => mine.includes(f);
const wantsHuman = has("--human");
const allowDestructive = has("--allow-destructive");
const positional = mine.filter((a) => !a.startsWith("-"));

if (has("--help") || (!positional.length && !has("--list") && !has("--status"))) {
  process.stdout.write([
    "sdd-run — the machine-callable front end to the pipeline.",
    "",
    "  node sdd-run.js --list                  the step manifest (JSON)",
    "  node sdd-run.js --status                resolved roots + artifact state (JSON)",
    "  node sdd-run.js <step> [-- <argv...>]   run one step",
    "",
    "  --human              human-readable output instead of JSON",
    "  --allow-destructive  required for a step marked destructive",
    "",
    "stdout is exactly one JSON document; child prose goes to stderr.",
    "Exit code is the child's, unchanged. 2 means sdd-run refused.",
    "",
    "steps: " + STEPS.map((s) => s.id).join(", "),
    "",
  ].join("\n"));
  process.exit(0);
}

if (has("--list")) {
  if (wantsHuman) {
    for (const s of STEPS) {
      const tags = [s.expensive && "EXPENSIVE", s.destructive && "DESTRUCTIVE",
        (s.needs || []).length && "needs " + s.needs.join(" + ")].filter(Boolean);
      process.stdout.write(`  ${s.id.padEnd(20)} ${s.title}${tags.length ? "   [" + tags.join(", ") + "]" : ""}\n`);
    }
  } else emit({ schema: SCHEMA, kind: "manifest", steps: STEPS });
  process.exit(0);
}

if (has("--status")) {
  const roots = rootsState();
  const artifacts = artifactState();
  const payload = { schema: SCHEMA, kind: "status", generated: new Date().toISOString(),
    roots, sen: roots.corpus && roots.corpus.root ? path.join(roots.corpus.root, CR.LAYOUT.sen) : null,
    artifacts };
  if (wantsHuman) {
    for (const [n, r] of Object.entries(roots)) {
      process.stdout.write(`  ${n.toUpperCase().padEnd(7)} ${r.refused ? "REFUSED — " + r.why : r.root}\n` +
        (r.refused ? "" : `          set by: ${r.layer}\n`));
    }
    for (const [k, a] of Object.entries(artifacts)) {
      process.stdout.write(`    ${k.padEnd(17)} ${a.present ? (a.valid ? "ok" : "PRESENT but INVALID: " + a.why) : "ABSENT"}\n`);
    }
    process.stdout.write(`\n  (readiness is per-step — see the \`needs\` field in --list)\n`);
  } else emit(payload);
  process.exit(Object.values(roots).some((r) => r.refused) ? 2 : 0);
}

/* ── run one step ─────────────────────────────────────────────────────────────────────────── */
const id = positional[0];
const step = byId.get(id);
if (!step) {
  emit({ schema: SCHEMA, kind: "error", error: "unknown-step", step: id,
    known: STEPS.map((s) => s.id),
    hint: "run --list for the manifest" });
  process.exit(2);
}

if (step.destructive && !allowDestructive) {
  emit({ schema: SCHEMA, kind: "error", error: "refused-destructive", step: id,
    why: `step ${JSON.stringify(id)} is marked destructive and requires --allow-destructive`,
    note: "sdd-clean.js additionally requires --go before it deletes anything; this flag does not supply it." });
  process.exit(2);
}

const roots = rootsState();
const refused = Object.entries(roots).filter(([, r]) => r.refused);
if (refused.length) {
  emit({ schema: SCHEMA, kind: "error", error: "root-refused", step: id,
    roots, why: refused.map(([n, r]) => `${n}: ${r.why}`) });
  process.exit(2);
}

const before = artifactState();
const missing = missingFor(step, before);
if (missing.length) {
  /* Not an error — absent is a STATE, the same asymmetry run-tests.js draws. A UI shows this as
   * "not ready" and names the artifact, never a blanket "the corpus is not mined". */
  emit({ schema: SCHEMA, kind: "not-ready", step: id, roots, artifacts: before, missing,
    why: `step ${JSON.stringify(id)} needs ${missing.map((m) => `${m.kind} (${m.state})`).join(", ")}`,
    remedy: missing.some((m) => m.kind === "generators-lzw") ? "node sdd-run.js mine"
      : missing.some((m) => m.kind === "word-names") ? "word-names is hand-authored and a re-mine cannot rebuild it — see PRD §8A"
      : "node sdd-run.js --status" });
  process.exit(2);
}

const cmd = [path.join(HERE, step.cmd[0]), ...step.cmd.slice(1), ...passthru];
const startedAt = new Date().toISOString();
const t0 = Date.now();
/* Child prose is relayed to stderr so stdout stays exactly one JSON document. */
const r = spawnSync(process.execPath, cmd, { cwd: HERE, encoding: "utf8", maxBuffer: 1 << 28 });
const durationMs = Date.now() - t0;
if (r.stdout) process.stderr.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);

const exitCode = r.status === null ? 1 : r.status;
const envelope = {
  schema: SCHEMA, kind: "run", step: id, title: step.title,
  command: ["node", ...cmd.map((c) => path.relative(HERE, c) || c)],
  cwd: HERE, startedAt, durationMs,
  exitCode, ok: exitCode === 0,
  signal: r.signal || null,
  stdout: r.stdout || "", stderr: r.stderr || "",
  roots,
  artifactsBefore: before,
  artifactsAfter: artifactState(),
};
if (r.error) envelope.spawnError = r.error.message;

if (wantsHuman) process.stderr.write(`\n${envelope.ok ? "OK" : "FAILED"} — ${id} in ${durationMs}ms (exit ${exitCode})\n`);
else emit(envelope);
process.exit(exitCode);
