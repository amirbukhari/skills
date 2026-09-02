#!/usr/bin/env node
"use strict";
/**
 * sdd-clean.js — wipe DERIVED content out of CORPUS, leaving the source set intact.
 *
 * WHY IT LIVES IN THE ENGINE AND NOT IN THE CORPUS. It used to be `<corpus>/sdd-clean.js`. On
 * 2026-08-31 Amir wiped the corpus by hand and the cleaner went into the wastebasket along with
 * the tree it existed to clean — a fresh corpus then has no cleaner, and every new corpus would
 * need a copy pasted in. A tool that deletes a tree must not live inside it. It lives here, is
 * corpus-agnostic like the rest of the engine, and resolves CORPUS through the one resolver
 * (engine/corpus-root.js), so repointing it is the same one-line `.env` change as everything else.
 *
 * TWO SCOPES, deliberately separate.
 *
 *   1. DERIVED CACHE + ROOT ROLLUPS — `<corpus>/.cache/` and the derived *.json rollups at the
 *      corpus root. Cheap to regenerate. Wiped by --go alone.
 *
 *   2. THE sen/ TREE — `<corpus>/sen/{files,catalog,skeletons,archetypes}`: the rendered English
 *      AND the mined catalog. Amir: "the SEN folder with the catalog is supposed to be wipable",
 *      and "I shouldnt see any of those files show up again unless I run the command". It is
 *      wipable — but ONLY behind an EXPLICIT flag, never by default and never as a side effect
 *      of scope 1:
 *
 *          node sdd-clean.js --wipe-sen --go
 *
 *      BOTH tokens are required and neither is a default. Without --wipe-sen the script REFUSES
 *      to consider sen/ and prints what it would have deleted, with file and byte counts, so the
 *      cost is visible before it is paid: re-deriving sen/ is a full mine + render (tens of
 *      minutes; generators-lzw.json alone is ~41 MB).
 *
 *      READ THIS BEFORE WIPING (PRD §1B.3): sen/ is safely wipable only because it is entirely
 *      re-derivable from SOURCE — the .en is rendered FROM the .ts, not the reverse. PRD §1A
 *      intends to FLIP that. If the flip happens, sen/ stops being derived and this gate must
 *      harden from "explicit flag" to "refuse".
 *
 *   3. sen/catalog/ — THE §8A SOURCE-PROTECTED ARTIFACT HOME. Its own token, `--wipe-catalog`,
 *      on top of --wipe-sen. Added 2026-09-01 after a measured data-loss hole: `--wipe-sen --go`
 *      planned `sen/` as ONE target and rmSync'd it recursively, so it deleted
 *      `sen/catalog/word-names.json` — which §8A states is *"Hand-authored and NOT reproducible by
 *      a re-mine: the mine rebuilds the words, never their names"*, and which also carries the
 *      `orphans` ledger, the only record of names authored for skeletons that have since drifted.
 *      R-CFG-12 says a SOURCE-PROTECTED artifact MUST NEVER be deleted in any cleanup; R-CFG-7
 *      says sen/ is wipable. Those two rows contradict, and the code followed R-CFG-7 silently.
 *
 *      Measured at the time of the fix: `sen/catalog/word-names.json` held 20 authored names, and
 *      `git ls-files sen/catalog` returned ZERO files — the corpus is gitignored one scope up
 *      (`.gitignore: skills/sdd-engine/Examples/`), so the wipe was unrecoverable, not merely
 *      expensive. That is the difference this scope exists to price.
 *
 *      WHY A THIRD TOKEN RATHER THAN A BLANKET PROTECTION. Amir, verbatim (PRD §1B.3): *"the SEN
 *      folder with the catalog is supposed to be wipable"* — his words name the catalog. Making it
 *      undeletable would contradict him; making it deletable by the same token that clears the
 *      rendered English prices an unrecoverable loss at the same rate as a re-derivable one. So the
 *      catalog stays reachable, behind a token he types, and the refusal names the authored counts
 *      no mine can rebuild. Same shape as the --wipe-sen gate, one level in.
 *
 * NEVER TOUCHED, BY ANY FLAG:
 *   - anything inside SOURCE. It is read-only input, full stop. Enforced STRUCTURALLY below, not
 *     by the cleaner happening to be pointed elsewhere — it must hold in the self-hosting case
 *     where SOURCE === CORPUS, which is the default.
 *   - `<corpus>/catalog/` — the legacy STEP-4 tree, a separate and still-undetermined question,
 *     explicitly out of scope for this wipe (PRD §1B.4). It is NOT sen/catalog/.
 *
 *   node sdd-clean.js                                  # dry-run scope 1; report sen/, refuse it
 *   node sdd-clean.js --go                             # remove scope 1
 *   node sdd-clean.js --wipe-sen                       # dry-run scope 1 + 2 (NOT the catalog)
 *   node sdd-clean.js --wipe-sen --go                  # remove scope 1 + 2 (NOT the catalog)
 *   node sdd-clean.js --wipe-sen --wipe-catalog --go   # remove scope 1 + 2 + 3
 *   node sdd-clean.js --corpus <path>                  # any root override the resolver accepts
 */
const fs = require("fs");
const path = require("path");
const CR = require("./engine/corpus-root");

const argv = process.argv.slice(2);
const GO = argv.includes("--go");
const WIPE_SEN = argv.includes("--wipe-sen");
const WIPE_CATALOG = argv.includes("--wipe-catalog");

const CORPUS = CR.corpusRoot();
const SOURCE = CR.sourceRoot();
const SEN = CR.LAYOUT.sen;            /* spelled once, in the resolver; never re-spelled here */

/* Names that are never removable, whatever flags are passed. src/, packages/ and tests/ are the
 * SOURCE tree: in the default self-hosting case this script is cleaning the directory the source
 * lives in, and that must remain survivable. */
const PROTECTED = new Set(["src", "packages", "tests", "node_modules", "catalog",
  "hydra.sql", "jest.config.js", ".gitignore", "PIPELINE.md", "sdd-clean.js", "sdd-build.js"]);

/* GUARDED SUBTREES — deeper than PROTECTED, which only ever sees a path's FIRST segment and so
 * cannot express "sen/ yes, sen/catalog/ no". Each entry maps a corpus-relative path to the token
 * that unlocks it. A target that IS or CONTAINS a guarded subtree is refused unless its token was
 * passed, so a future edit that goes back to planning `sen/` wholesale FAILS LOUDLY at plan time
 * instead of quietly taking the catalog with it. That is the regression this guard is really for:
 * the hole was not a missing name in a list, it was one rmSync over a directory nobody enumerated. */
const GUARDED = [{ rel: path.join(SEN, "catalog"), token: "--wipe-catalog", allowed: () => WIPE_CATALOG }];

const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

/* THE SOURCE GUARD. Three independent conditions, all structural: the target must be a real
 * descendant of CORPUS, must not be a protected name, and must not lie inside SOURCE. The third
 * is the one that matters when SOURCE !== CORPUS and someone points --corpus at a source tree. */
function assertRemovable(rel) {
  const abs = path.resolve(CORPUS, rel);
  if (!inside(abs, CORPUS) || abs === CORPUS)
    throw new Error(`sdd-clean: REFUSING to remove ${abs}\n  it is not inside CORPUS (${CORPUS})`);
  const first = rel.split(/[\\/]/)[0];
  if (PROTECTED.has(first))
    throw new Error(`sdd-clean: REFUSING to remove ${rel}\n  ${first} is protected — source and the legacy catalog are never wipable`);
  /* When SOURCE is a SEPARATE tree, nothing inside it may be removed, full stop. When SOURCE ===
   * CORPUS (self-hosting, the default) every path is trivially "inside SOURCE", so this test would
   * forbid everything and the cleaner would be useless; there, PROTECTED above is what keeps the
   * source dirs safe. Distinguishing the two cases is the whole point — do not collapse them. */
  if (SOURCE !== CORPUS && inside(abs, SOURCE))
    throw new Error(`sdd-clean: REFUSING to remove ${abs}\n  it lies inside SOURCE (${SOURCE}), which is read-only input, full stop`);
  /* THE GUARDED-SUBTREE CHECK. Both directions matter: the target may BE the guarded path, or it
   * may be an ancestor that would take it along. Checking only the first would leave the original
   * hole open, because the original hole was exactly an ancestor. */
  for (const g of GUARDED) {
    if (g.allowed()) continue;
    const gabs = path.resolve(CORPUS, g.rel);
    if (inside(gabs, abs))
      throw new Error(`sdd-clean: REFUSING to remove ${rel}\n  it is or contains ${g.rel}, the §8A SOURCE-PROTECTED artifact home` +
        `\n  pass ${g.token} as well if that is genuinely what you mean`);
  }
}

function measure(rel) {
  const p = path.join(CORPUS, rel);
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  if (st.isFile()) return { files: 1, bytes: st.size, dir: false };
  let files = 0, bytes = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const q = path.join(d, e.name);
    if (e.isDirectory()) walk(q); else { try { files++; bytes += fs.statSync(q).size; } catch {} }
  } };
  walk(p);
  return { files, bytes, dir: true };
}
const mb = (b) => (b / 1048576).toFixed(2);

const targets = [];
function plan(rel) {
  const m = measure(rel);
  if (!m) return;
  assertRemovable(rel);                       /* throws BEFORE anything is deleted */
  targets.push({ rel, ...m });
}

console.log(`SOURCE  ${SOURCE}   (read-only, never wipable)`);
console.log(`CORPUS  ${CORPUS}`);
console.log("");

/* scope 1 — the derived cache */
plan(".cache");

/* scope 1 — derived rollups at the corpus root */
for (const e of fs.readdirSync(CORPUS, { withFileTypes: true })) {
  if (e.isDirectory() || PROTECTED.has(e.name)) continue;
  plan(e.name);
}

/* AUTHORED CONTENT, COUNTED — so a refusal can price what a re-mine cannot rebuild. §8A: the mine
 * rebuilds the words, never their names. Read defensively: this runs on the path to a REFUSAL, and
 * a cleaner that crashes reading an artifact it is about to decline to delete is worse than one
 * that says "unreadable". */
function authoredCounts() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(CORPUS, SEN, "catalog", "word-names.json"), "utf8"));
    const n = (o) => Object.keys(o || {}).length;
    return { names: n(j.names), chunks: n(j.chunks), orphans: n(j.orphans) };
  } catch { return null; }
}

/* scope 2 — sen/, EXPLICIT FLAG ONLY.
 * Enumerated CHILD BY CHILD rather than planned as one directory. Planning `sen/` wholesale is what
 * deleted the catalog: one target, one recursive rmSync, no enumeration and so nothing to exempt. */
const sen = measure(SEN);
if (WIPE_SEN) {
  const cat = path.join(SEN, "catalog");
  for (const e of fs.readdirSync(path.join(CORPUS, SEN), { withFileTypes: true })) {
    const rel = path.join(SEN, e.name);
    if (rel === cat && !WIPE_CATALOG) continue;   /* declined below, not planned */
    plan(rel);
  }
  const cm = measure(cat);
  if (cm && !WIPE_CATALOG) {
    const a = authoredCounts();
    console.log(`REFUSING to touch ${cat}/ — no --wipe-catalog flag.`);
    console.log(`  it holds ${cm.files} files, ${mb(cm.bytes)} MB: the §8A SOURCE-PROTECTED artifacts.`);
    console.log(a
      ? `  word-names.json carries ${a.names} authored name(s), ${a.chunks} chunk name(s), ${a.orphans} orphan(s) —` +
        `\n  §8A: hand-authored and NOT reproducible by a re-mine. A mine rebuilds the words, never their names.`
      : `  word-names.json could not be read to count its authored names — assume the loss is unrecoverable.`);
    console.log(`  everything else here is a full mine away; these names are not.`);
    console.log(`  to remove it anyway:  node sdd-clean.js --wipe-sen --wipe-catalog --go`);
    console.log("");
  }
} else if (sen) {
  console.log(`REFUSING to touch ${SEN}/ — no --wipe-sen flag.`);
  console.log(`  it holds ${sen.files} files, ${mb(sen.bytes)} MB:`);
  for (const sub of fs.readdirSync(path.join(CORPUS, SEN))) {
    const m = measure(path.join(SEN, sub));
    if (m) console.log(`    ${SEN}/${sub.padEnd(12)} ${String(m.files).padStart(5)} files  ${mb(m.bytes).padStart(8)} MB`);
  }
  /* This line used to read "re-deriving it is a full mine + render (tens of minutes)" full stop,
   * which is true of sen/files/ and FALSE of the authored names in sen/catalog/word-names.json —
   * the refusal understated its own cost for the one thing that cannot be re-derived at all. */
  console.log(`  re-deriving sen/files/ is a full mine + render (tens of minutes).`);
  const a0 = authoredCounts();
  if (a0 && (a0.names || a0.chunks || a0.orphans))
    console.log(`  sen/catalog/ additionally holds ${a0.names} authored name(s), ${a0.chunks} chunk name(s), ` +
      `${a0.orphans} orphan(s), which NO re-mine rebuilds (§8A) — and it needs --wipe-catalog of its own.`);
  console.log(`  to remove it anyway:  node sdd-clean.js --wipe-sen --go`);
  console.log("");
} else {
  console.log(`${SEN}/ is not present — nothing to wipe there.\n`);
}

/* Everything above only PLANNED. Deletion happens here, after every guard has run. */
for (const t of targets) {
  if (GO) fs.rmSync(path.join(CORPUS, t.rel), { recursive: true, force: true });
  console.log(`${GO ? "removed      " : "would remove "}${t.dir ? "dir  " : "file "}${t.rel.padEnd(28)} ${String(t.files).padStart(5)} files  ${mb(t.bytes).padStart(8)} MB`);
}
/* PRUNE THE EMPTY SHELL. Enumerating sen/'s children (rather than removing sen/ itself) leaves the
 * directory behind once they are gone. Amir: "I shouldnt see any of those files show up again unless
 * I run the command" — an empty sen/ holds no files, but leaving it is a behaviour change from the
 * wholesale remove, so it is pruned rather than quietly kept. ONLY when it is genuinely empty: a
 * guarded catalog still sitting inside is exactly what must keep sen/ alive. */
if (GO && WIPE_SEN) {
  const senAbs = path.join(CORPUS, SEN);
  try {
    if (fs.readdirSync(senAbs).length === 0) { assertRemovable(SEN); fs.rmdirSync(senAbs); console.log(`removed      dir  ${SEN} (empty)`); }
  } catch { /* not present, not empty, or guarded — all three mean leave it alone */ }
}

const totFiles = targets.reduce((s, t) => s + t.files, 0);
const totBytes = targets.reduce((s, t) => s + t.bytes, 0);
console.log(`\n${targets.length} entr${targets.length === 1 ? "y" : "ies"} / ${totFiles} files / ${mb(totBytes)} MB ` +
  (GO ? "REMOVED." : "— dry run. Pass --go to remove."));
if (WIPE_SEN && !GO) console.log(`${SEN}/ IS in that list because --wipe-sen was passed.`);
/* A token that cannot do anything must say so rather than look obeyed. --wipe-catalog alone unlocks
 * a subtree that scope 2 never reaches, so silently accepting it would read as "the catalog is in
 * scope" to the one caller most entitled to be sure it is not. */
if (WIPE_CATALOG && !WIPE_SEN)
  console.log(`\nNOTE: --wipe-catalog does nothing without --wipe-sen — ${SEN}/ was never in scope.`);

/* EXIT CODE — a refusal must not look like an action (PRD R-CFG-8).
 * This printed "REFUSING to touch sen/" and then exited 0, so a caller could not tell "refused,
 * nothing deleted" from "deleted" — for the one destructive tool in the tree.
 *
 * 3, deliberately NOT 2: `sdd-run.js` reserves exit 2 for "the wrapper itself refused" and passes
 * a child's code through unchanged, so a 2 from here would be indistinguishable from the wrapper
 * refusing. 0 = did what was asked · 1 = error (the hard refusals above throw) · 3 = declined,
 * nothing deleted.
 *
 * A dry run is NOT a refusal — it is what was asked for, so it stays 0. Only the path where sen/
 * exists and --wipe-sen was withheld exits 3. */
if (!WIPE_SEN && sen) process.exit(3);
