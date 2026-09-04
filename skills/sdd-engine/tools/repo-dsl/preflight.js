#!/usr/bin/env node
"use strict";
/**
 * preflight — ONE table naming every artifact a consumer expects, which of them are absent, and
 * the exact command that writes each. In dependency order.
 *
 *   node preflight.js [--json] [--strict] [--help]        (npm run preflight)
 *
 * WHY THIS EXISTS. On 2026-09-02 two Kraken panel surfaces failed one after the other on a missing
 * corpus-root index (`archetype-index.json`, then `files-index.json`), each with its own bespoke
 * error string, and the sweep that followed found EIGHT more absent artifacts nobody had reported.
 * A surface that invents its own message can only ever report the one artifact it happened to ask
 * for; it cannot say "and nine others", and it cannot name the command that fixes it.
 *
 * THE SHAPE IS BORROWED, NOT INVENTED. `engine/operation-idioms.test.js:30-36` already did this
 * correctly for exactly one artifact: it exits 2, prints where it looked, names the producer, says
 * that producer is archived and hardcodes a forbidden root, and states plainly that
 * "this is a STATE, not a failure". That is the right behaviour. This is that, once, over
 * everything — so a panel can call one command instead of each writing its own version.
 *
 * FOUR STATUSES, and they are not interchangeable — they need different fixes:
 *
 *   PRESENT     on disk.
 *   MISSING     a LIVE producer exists and has not been run. Fix: run the command in the table.
 *   BLOCKED     the producer RUNS but cannot publish — a contract violation, not a missing run.
 *               Running the command again cannot fix it. This is the `name-queue` case.
 *   NO PRODUCER no live producer exists (archived, or hardcoded to a forbidden root). Whether to
 *               revive or retire it is Amir's call, not this tool's. Never reported as a failure.
 *   STALE       PRESENT, but OLDER than an artifact it is derived from — so it describes a corpus
 *               that has since moved. Fix: re-run its producer. This is the one status a file's
 *               existence cannot tell you, and it is the shape that hides best: every count in a
 *               stale artifact is a real number, just a real number about the past.
 *
 * WHAT STALE CANNOT SEE, stated because a check whose limits are unstated gets over-trusted.
 * Derivation-order staleness compares mtimes along declared edges. It catches "rebuilt out of
 * order". It does NOT catch a CANON change: when the code that computes a lookup key changes while
 * the artifact holding those keys does not, the artifact is stale and every mtime is innocent.
 * `generators-lzw.json` carries a `contentFingerprint` and nothing verifies it against a
 * fingerprint of the current canon, so that class stays invisible here — measurable today only by
 * watching review surface move. Raised by session skills-4a on 2026-09-02, recorded rather than
 * quietly half-solved; closing it needs a canon fingerprint that does not exist yet.
 *
 * THE CLASS IS REAL AND HAS NO KNOWN LIVE MEMBER. It briefly had one here, and it was wrong.
 *
 * >>> RETRACTED 2026-09-03. This block used to name BODY_SLOT as a live member and tell the reader
 * >>> not to render. Kept verbatim per CLAUDE.md §9, because the retraction is the useful part:
 * >>>
 * >>>   "AND THAT UNMEASURABLE HALF HAS A KNOWN LIVE MEMBER RIGHT NOW [...]
 * >>>    engine/generators.js:119  const BODY_SLOT = process.env.SDD_BODY_SLOT !== "0"  // DEFAULT ON
 * >>>    shipped in 2d83452, and <CORPUS>/sen/catalog/generators-lzw.json was mined BEFORE it.
 * >>>    Verified by reading both, not by report. [...] The only symptom is review surface —
 * >>>    3,527 top / 23,935 tree against the 1,582 / 20,999 baseline [...]
 * >>>    CONSEQUENCE FOR ANYONE ABOUT TO RENDER: don't, until the catalog is re-mined."
 *
 * ALL OF THAT IS FALSE, AND THE CATALOG IS CURRENT. Re-measured here, behaviourally, rather than
 * taken on report a second time:
 *   - the live catalog holds 25,064 `type:"body"` hole markers and 0 `‹callee›` ones. That marker
 *     IS the body slot — 2d83452 is the commit that introduces `{hole:true, type:"body"}` — so the
 *     catalog was demonstrably mined by body-slot code and its canon matches this tree.
 *   - the timing detail in the retracted text was wrong in BOTH directions and neither mattered:
 *     the catalog's mtime (2026-09-02 22:51:41 -0400) is two minutes BEFORE 2d83452's commit
 *     (22:53:36), i.e. it was mined from an uncommitted working tree. skills-4a said "mined after";
 *     I said "mined before". Both were reading clocks. The hole census settles it, and it is the
 *     only evidence here that could.
 *   - the 3,527 / 23,935 figure was measured by skills-4a at a moment when their own SDD_EXPR_SLOT
 *     change was uncommitted AND default-on, so the renderer was computing expr-slot keys against a
 *     body-slot catalog — a canon mismatch introduced seconds earlier in one working tree, not a
 *     property of the corpus. They retracted it; I verified the retraction before acting on it.
 *
 * SO: RENDERING IS NOT BLOCKED BY THIS. It remains held only because Amir has not ruled on the
 * re-mine, which is a different reason and his to lift. The lesson is the one at the top of
 * CLAUDE.md: BOTH sessions reasoned from timestamps and file-reading and both got it wrong; one
 * behavioural measurement — count the holes — answered it immediately.
 *
 * AND THE CLASS ITSELF IS NOW GUARDED, which is why it needs no named member. skills-4a's
 * engine/canon-fingerprint.js (90ea07b) gives a catalog a behavioural record of the canon it was
 * mined under — 20 frozen probes canonicalized at exact/narrow/wide and hashed — and
 * enfile.js:loadIndex refuses a present-and-different fingerprint. Absent only warns, which every
 * catalog on disk currently triggers, because refusing those would brick the corpus to install a
 * guard (§8B: absent is a state). That is strictly stronger than an mtime edge for this class:
 * it moves when two builds would key the dictionary differently and stays put across MIN_SKEL,
 * MIN_COUNT and MAXWIN retunes, asserted in engine/canon-fingerprint.test.js.
 *
 * EXIT CODES. 0 = every artifact with a live producer is present. 2 = at least one is absent —
 * a STATE, and the default. 1 = preflight itself could not run (roots unresolvable). `--strict`
 * makes a MISSING/BLOCKED artifact exit 1 for a caller that wants a hard gate; NO PRODUCER never
 * exits 1, because a decision Amir has not made is not a build failure. `--soft` always exits 0
 * while printing the same table — that is what `npm run build` uses, so a short build SAYS what it
 * did not produce without the two pipelines being fused into one pass/fail verdict.
 */
const fs = require("fs");
const path = require("path");
const AC = require("./engine/artifact-contract");
const CR = require("./engine/corpus-root");

/* RETIRED 2026-09-02, and deliberately ABSENT from the manifest below. Amir: "If we ain't using it
 * put it in the archive folder." These four were listed for one afternoon as "no live producer,
 * needs Amir"; that question is now answered, and an expected-artifact table that permanently names
 * things nobody will ever produce trains people to ignore the table:
 *
 *   catalog/compose-words.json        archive/build-compositions.js      (also delonix-hardcoded)
 *   catalog/named-idioms.json         archive/supersede-hashes.js
 *   catalog/operation-idioms.json     archive/build-operation-idioms.js  (also delonix-hardcoded)
 *   catalog/function-archetypes.json  archive/build-operation-idioms.js
 *   catalog/mined-library.v5.json     wholefile-mine.js -> archive/ (a documented ONE-OFF, no caller)
 *
 * AND THE WHOLE SKELETON TIER, retired 2026-09-02 by the same ruling — three more rows gone from
 * this manifest, not downgraded:
 *
 *   skeleton-index.json  catalog/skeletons.json  sen/skeletons/     build-skeletons.js -> archive/
 *
 * They were listed BLOCKED for one afternoon. That was already better than MISSING, and still
 * wrong: build-skeletons.js read the retired catalog/compose-words.json unguarded and exited ENOENT
 * before writing anything (measured on two throwaway roots), its producer is archived and
 * delonix-hardcoded, and nothing on the goal path consumes the output. A compose-words replacement
 * was refused as the fix — that is building a tier to feed a tier nobody reads. An artifact nobody
 * will ever produce and nobody reads is not "expected", so it does not get a row.
 *
 * Do not re-add them here. ONE live consumer still asks for a retired artifact and is recorded as a
 * finding rather than a reason to revive anything: engine/operation-idioms.test.js, which already
 * skips honestly with exit 2 (its run-tests.js `needs` text now names the retirement, so an honest
 * skip no longer misdescribes WHY). The other, build-skeletons.js:39, went to archive/ with the
 * tier it belonged to.
 *
 * `catalog/mined-library.v1.json` is NOT retired and not expected either: README.md:60 records it as
 * a HISTORICAL pre-LZW snapshot that is present on disk and regenerated by nothing. Nothing to run,
 * nothing to decide, so it is not a preflight row. */

/* ---------------------------------------------------------------- the manifest
 * `phase` is dependency order: everything in phase N may be read by phase N+1.
 * `rel` is relative to CORPUS. A registry kind carries `kind` and its path is resolved through
 * AC.pathFor, never spelled here — spelling it twice is how the two diverge. */
const MANIFEST = [
  // ---- phase 1: the live / LZW tier (npm run build) ----
  { phase: 1, kind: "generators-lzw", cmd: "npm run mine", consumers: ["render", "gate", "naming"] },
  { phase: 1, kind: "import-resolution", cmd: "node resolve-imports.js", consumers: ["prose"] },
  { phase: 1, kind: "language", cmd: "node language.js", consumers: ["render"] },
  { phase: 2, kind: "naming-plan", cmd: "npm run name:plan", consumers: ["naming", "reconcile (its census)"],
    derivesFrom: "generators-lzw" },
  { phase: 2, kind: "word-names", cmd: "npm run name:tier  (or npm run apply:worksheet-names)",
    consumers: ["render (chunk headings)"], protected: true },
  /* RETRACTED 2026-09-04 — this row used to carry a `blocked:` field asserting that name-queue
   * "has never published" and that "running it again cannot fix this", because reconcile-names.js
   * stamped AC.stamp("word-names", { names, orphans }) against a registry entry whose
   * requires: ["names","orphans","chunks"] refused the body. THAT CLAIM IS NOW FALSE and was
   * misread aloud as current. It is kept here rather than deleted (../../CLAUDE.md §9) so a stale
   * memory cannot re-derive it.
   *
   * WHAT ACTUALLY CLOSED IT, in the order the header of reconcile-names.js records and for the
   * reason it gives: the names went to version control (tools/name-ledger-backup/), chunk records
   * were given the skeletons they name, orphaning/re-adoption was implemented for chunks, and only
   * THEN the stamp was completed. reconcile-names.js:303 now stamps { names, orphans, chunks }.
   * The old refusal was load-bearing while those steps were outstanding; completing the stamp any
   * earlier would have converted a loud refusal into a silent drop of the applied chunk names.
   *
   * SO THERE IS NOTHING BLOCKED HERE ANY MORE. The row is an ordinary derived artifact: if it is
   * absent or STALE, `npm run reconcile` is the fix and it works — MEASURED 2026-09-04, run with
   * no arguments and no APPLY=1 against a name-queue reported STALE, after which preflight read
   * 0 STALE. The `blocked:` KEY is removed, not merely reworded, because status precedence at
   * line ~222 only consults it when the file is ABSENT: leaving it would have told the one person
   * who most needs `npm run reconcile` — someone staring at a missing queue — that running it
   * cannot help.
   *
   * The second edge that field recorded is still TRUE and still worth knowing: the name-queue write
   * at reconcile-names.js:321 sits OUTSIDE the `if (APPLY)` guard, so a REPORT-ONLY run writes
   * this file. If you see its mtime move, that is expected, not evidence that someone applied
   * names. Pinned as an executable assertion in engine/orphan-ledger.test.js. */
  { phase: 2, kind: "name-queue", cmd: "npm run reconcile", derivesFrom: "naming-plan",
    consumers: ["orphan re-adoption (R-LANG-7)"] },
  { phase: 3, kind: "en-index", cmd: "npm run render", consumers: ["files-index", "report", "panels"],
    derivesFrom: "generators-lzw" },
  { phase: 4, kind: "mined-library", cmd: "npm run gate", consumers: ["measurement"], protected: true },
  { phase: 4, kind: "corpus-coverage", cmd: "npm run gate", consumers: ["report", "register"] },
  { phase: 4, kind: "gate", cmd: "npm run gate", consumers: ["register"] },

  // ---- phase 5: the TIER pipeline (npm run tiers) — corpus-root indexes ----
  { phase: 5, rel: "archetype-index.json", cmd: "npm run tiers", producer: "build-archetypes.js:132",
    consumers: ["Kraken SDD panel (drift check)", "package-hydra-source.js:205"] },
  { phase: 5, rel: "catalog/archetypes.json", cmd: "npm run tiers", producer: "build-archetypes.js:111" },
  { phase: 5, rel: "sen/archetypes", dir: true, cmd: "npm run tiers", producer: "build-archetypes.js",
    consumers: ["engine/sdd.js render"] },
  { phase: 7, rel: "COVERAGE.json", cmd: "npm run tiers", producer: "package-hydra-source.js:340" },
  { phase: 7, rel: "catalog/mined-library.v6.json", cmd: "npm run tiers", producer: "package-hydra-source.js:341" },
  { phase: 7, rel: "word-library.json", cmd: "npm run tiers", producer: "package-hydra-source.js:342" },
  { phase: 7, rel: ".sdd-code-provenance.json", cmd: "npm run tiers", producer: "package-hydra-source.js:343" },

  // ---- phase 8: post-render rollups ----
  { phase: 8, rel: "files-index.json", cmd: "npm run files-index", producer: "build-files-index.js",
    consumers: ["Kraken SDD panel (Read — narrate any file)"], derivesFrom: "en-index" },

  // ---- phase 0: hand-authored. Cannot be regenerated by anything. ----
  { phase: 0, rel: "catalog/coined-words.json", hand: "hand-curated vocabulary (CLAUDE.md §5). " +
      "There is no producer and there must not be one — if this is absent it was LOST, not un-run.",
    protected: true },
];

const PHASE_TITLES = {
  0: "hand-authored (no producer by design)",
  1: "live tier — dictionary + inputs",
  2: "live tier — naming",
  3: "live tier — render",
  4: "live tier — measurement + gate",
  5: "tier pipeline — archetypes",
  7: "tier pipeline — package rollups",
  8: "post-render rollups",
  9: "no live producer — needs Amir, NOT a failure",
};

function resolveOne(e, CORPUS) {
  const abs = e.kind ? AC.pathFor(e.kind) : path.join(CORPUS, e.rel);
  const rel = path.relative(CORPUS, abs);
  let exists = false, bytes = null, mtime = null;
  try {
    const st = fs.statSync(abs);
    exists = e.dir ? st.isDirectory() : st.isFile();
    bytes = e.dir ? countTree(abs) : st.size;
    mtime = st.mtime.toISOString();
  } catch (_) { /* absent */ }

  /* The derivation edge. Only compared when BOTH files exist: a missing input is already MISSING on
   * its own row, and calling the output stale for it would report one gap twice. */
  let staleAgainst = null;
  if (exists && e.derivesFrom) {
    try {
      const src = AC.pathFor(e.derivesFrom);
      const sm = fs.statSync(src).mtime;
      if (sm > new Date(mtime)) {
        staleAgainst = { input: e.derivesFrom, inputPath: path.relative(CORPUS, src),
          inputMtime: sm.toISOString(), thisMtime: mtime };
      }
    } catch (_) { /* the input is absent — its own row says so */ }
  }

  let status;
  if (exists && staleAgainst) status = "STALE";
  else if (exists) status = "PRESENT";
  else if (e.blocked) status = "BLOCKED";
  else if (e.noProducer) status = "NO PRODUCER";
  else if (e.hand) status = "LOST";        // hand-authored and absent is a loss, never "un-run"
  else status = "MISSING";

  return {
    id: rel, phase: e.phase, phaseTitle: PHASE_TITLES[e.phase], status,
    path: rel, absolute: abs, isDir: !!e.dir,
    ...(e.kind ? { registryKind: e.kind, home: AC.specOf(e.kind).home } : { registryKind: null }),
    ...(bytes !== null ? (e.dir ? { files: bytes } : { bytes }) : {}),
    producer: e.producer || (e.kind ? "AC.stamp(\"" + e.kind + "\")" : null),
    ...(e.derivesFrom ? { derivesFrom: e.derivesFrom } : {}),
    ...(staleAgainst ? { staleAgainst } : {}),
    fix: staleAgainst
      ? `re-run \`${e.cmd}\` — ${staleAgainst.input} (${staleAgainst.inputMtime}) is NEWER than this ` +
        `artifact (${staleAgainst.thisMtime}), so every number in it describes the earlier corpus`
      : e.hand ? "restore it from a snapshot or by hand — nothing regenerates it"
      : e.blocked ? "the contract, not the command: " + e.blocked
      : e.noProducer ? e.fix
      : e.cmd,
    ...(e.noProducer ? { why: e.noProducer } : {}),
    ...(e.protected ? { sourceProtected: true } : {}),
    consumers: e.consumers || [],
  };
}

function countTree(dir) {
  let n = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) n += countTree(path.join(dir, ent.name));
    else n++;
  }
  return n;
}

function check() {
  const CORPUS = CR.corpusRoot();
  const rows = MANIFEST.map((e) => resolveOne(e, CORPUS)).sort((a, b) => a.phase - b.phase || a.path.localeCompare(b.path));
  const by = (s) => rows.filter((r) => r.status === s);
  return {
    schema: "sdd-repo-dsl/preflight/1",
    corpus: CORPUS, source: CR.sourceRoot(), checkedAt: new Date().toISOString(),
    summary: {
      total: rows.length, present: by("PRESENT").length,
      missing: by("MISSING").length, blocked: by("BLOCKED").length,
      noProducer: by("NO PRODUCER").length, lost: by("LOST").length, stale: by("STALE").length,
    },
    note: "MISSING = a live producer has not been run. BLOCKED = the producer runs but cannot " +
      "publish (a contract violation; re-running cannot fix it). NO PRODUCER = archived or " +
      "forbidden-root producer, revive-or-retire is Amir's call and is NOT a failure. " +
      "LOST = hand-authored and gone, nothing regenerates it. STALE = present but older than an " +
      "artifact it derives from, so its numbers describe a corpus that has moved; mtime edges only, " +
      "which does NOT catch a canon change under a stable artifact.",
    artifacts: rows,
  };
}

function print(r) {
  const MARK = { PRESENT: "  ok ", MISSING: " MISS", BLOCKED: "BLOCK", "NO PRODUCER": " n/a ", LOST: " LOST", STALE: "STALE" };
  console.log("=== PREFLIGHT — what every consumer expects, and what is on disk ===");
  console.log(`CORPUS ${r.corpus}`);
  console.log(`SOURCE ${r.source}\n`);
  let phase = null;
  /* The same BLOCKED reason can cover three artifacts from one producer. Print it once and
   * back-reference it: three copies of a six-line paragraph is how a table gets skimmed. */
  const seen = new Map();
  for (const a of r.artifacts) {
    if (a.phase !== phase) { phase = a.phase; console.log(`-- phase ${phase}: ${a.phaseTitle}`); }
    const size = a.bytes != null ? `${a.bytes} B` : a.files != null ? `${a.files} files` : "";
    console.log(`  [${MARK[a.status]}] ${a.path.padEnd(38)} ${size}`);
    if (a.status !== "PRESENT") {
      console.log(`         producer: ${a.producer || "(none)"}`);
      if (seen.has(a.fix)) {
        console.log(`         fix     : as ${seen.get(a.fix)} above — same cause, same fix`);
      } else {
        seen.set(a.fix, a.path);
        console.log(`         fix     : ${a.fix}`);
        if (a.why) console.log(`         why     : ${a.why}`);
      }
      if (a.consumers.length) console.log(`         read by : ${a.consumers.join("; ")}`);
    }
  }
  const s = r.summary;
  console.log(`\n${s.present}/${s.total} present  |  ${s.stale} STALE (present but out of date)  |  ` +
    `${s.missing} MISSING (run the command)  |  ${s.blocked} BLOCKED (contract, not a run)  |  ` +
    `${s.noProducer} no producer (needs Amir)  |  ${s.lost} lost`);
  console.log("STALE compares mtimes along declared derivation edges. It cannot see a CANON change " +
    "under an artifact whose mtime never moved — see the header.");
  if (s.missing || s.blocked || s.noProducer || s.lost || s.stale) {
    console.log("\nThis is a STATE, not a failure. Nothing here is broken by being absent — but a " +
      "surface that reads an absent artifact must say so, and must never report it as a zero.");
  }
  if (s.missing) {
    const cmds = [...new Set(r.artifacts.filter((a) => a.status === "MISSING").map((a) => a.fix))];
    console.log("\nIn dependency order, the commands that would fill the gaps:");
    for (const c of cmds) console.log("  " + c);
  }
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: node preflight.js [--json] [--strict]\n\n" +
      "  Names every expected artifact, its status, and the command that writes it.\n" +
      "  --json    machine-readable (this is what a panel should call)\n" +
      "  --strict  exit 1 when a live producer has not been run (default is exit 2 — a STATE)\n" +
      "  --soft    always exit 0, still print the table (what `npm run build` ends with)\n\n" +
      "  exit 0 all present   exit 2 something absent   exit 1 preflight itself could not run");
    return 0;
  }
  const bad = argv.filter((a) => a.startsWith("-") && !["--json", "--strict", "--soft"].includes(a));
  if (bad.length) { console.error(`unknown flag: ${bad[0]}  (see --help)`); return 2; }

  let r;
  try { r = check(); }
  catch (e) { console.error("PREFLIGHT COULD NOT RUN: " + e.message); return 1; }

  if (argv.includes("--json")) console.log(JSON.stringify(r, null, 1));
  else print(r);

  const s = r.summary;
  const actionable = s.missing + s.blocked + s.lost + s.stale;
  if (argv.includes("--strict") && actionable) return 1;
  if (argv.includes("--soft")) return 0;
  return (actionable + s.noProducer) > 0 ? 2 : 0;
}
if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { MANIFEST, check, main };
