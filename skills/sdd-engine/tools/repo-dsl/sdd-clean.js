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
 * NEVER TOUCHED, BY ANY FLAG:
 *   - anything inside SOURCE. It is read-only input, full stop. Enforced STRUCTURALLY below, not
 *     by the cleaner happening to be pointed elsewhere — it must hold in the self-hosting case
 *     where SOURCE === CORPUS, which is the default.
 *   - `<corpus>/catalog/` — the legacy STEP-4 tree, a separate and still-undetermined question,
 *     explicitly out of scope for this wipe (PRD §1B.4). It is NOT sen/catalog/.
 *
 *   node sdd-clean.js                    # dry-run scope 1; report sen/ and refuse to touch it
 *   node sdd-clean.js --go               # remove scope 1
 *   node sdd-clean.js --wipe-sen         # dry-run scope 1 + 2
 *   node sdd-clean.js --wipe-sen --go    # remove scope 1 + 2
 *   node sdd-clean.js --corpus <path>    # any root override the resolver accepts
 */
const fs = require("fs");
const path = require("path");
const CR = require("./engine/corpus-root");

const argv = process.argv.slice(2);
const GO = argv.includes("--go");
const WIPE_SEN = argv.includes("--wipe-sen");

const CORPUS = CR.corpusRoot();
const SOURCE = CR.sourceRoot();
const SEN = CR.LAYOUT.sen;            /* spelled once, in the resolver; never re-spelled here */

/* Names that are never removable, whatever flags are passed. src/, packages/ and tests/ are the
 * SOURCE tree: in the default self-hosting case this script is cleaning the directory the source
 * lives in, and that must remain survivable. */
const PROTECTED = new Set(["src", "packages", "tests", "node_modules", "catalog",
  "hydra.sql", "jest.config.js", ".gitignore", "PIPELINE.md", "sdd-clean.js", "sdd-build.js"]);

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

/* scope 2 — sen/, EXPLICIT FLAG ONLY */
const sen = measure(SEN);
if (WIPE_SEN) {
  plan(SEN);
} else if (sen) {
  console.log(`REFUSING to touch ${SEN}/ — no --wipe-sen flag.`);
  console.log(`  it holds ${sen.files} files, ${mb(sen.bytes)} MB:`);
  for (const sub of fs.readdirSync(path.join(CORPUS, SEN))) {
    const m = measure(path.join(SEN, sub));
    if (m) console.log(`    ${SEN}/${sub.padEnd(12)} ${String(m.files).padStart(5)} files  ${mb(m.bytes).padStart(8)} MB`);
  }
  console.log(`  re-deriving it is a full mine + render (tens of minutes).`);
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
const totFiles = targets.reduce((s, t) => s + t.files, 0);
const totBytes = targets.reduce((s, t) => s + t.bytes, 0);
console.log(`\n${targets.length} entr${targets.length === 1 ? "y" : "ies"} / ${totFiles} files / ${mb(totBytes)} MB ` +
  (GO ? "REMOVED." : "— dry run. Pass --go to remove."));
if (WIPE_SEN && !GO) console.log(`${SEN}/ IS in that list because --wipe-sen was passed.`);

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
