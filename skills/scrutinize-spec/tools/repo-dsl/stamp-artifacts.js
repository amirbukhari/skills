#!/usr/bin/env node
/* stamp-artifacts.js — bring every registered artifact under the contract (PRD §8B).
 *
 * Re-stamps in place: adds/refreshes the header (schema, artifactVersion, corpus, generated,
 * fingerprint) WITHOUT touching the body. Idempotent — a second run is a no-op, which is the
 * property that lets it sit in CI. Run after any producer writes an artifact by hand.
 *
 *   node stamp-artifacts.js            # stamp
 *   node stamp-artifacts.js --check    # verify only; exit 1 on any refusal (CI mode)
 */
"use strict";
const fs = require("fs"), path = require("path");
const AC = require("./engine/artifact-contract");
const CORPUS = process.env.HYDRA_CORPUS || "/home/amir/Documents/Rentsync/delonix/hydra-source";
const CHECK = process.argv.includes("--check");

let bad = 0, done = 0, absent = 0;
for (const kind of AC.kindsOf()) {
  const spec = AC.specOf(kind);
  const file = AC.pathFor(kind, CORPUS);
  if (!fs.existsSync(file)) { console.log(`  --  ${kind.padEnd(17)} not present (${file})`); absent++; continue; }
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  if (CHECK) {
    try { AC.validate(kind, j, file, { corpus: spec.corpusPinned ? (j.corpus || CORPUS) : undefined }); console.log(`  OK  ${kind.padEnd(17)} ${j.fingerprint}`); }
    catch (e) { bad++; console.log(`  XX  ${kind.padEnd(17)} ${e.message.split("\n").slice(0, 3).join("\n      ")}`); }
    continue;
  }
  const before = j.fingerprint;
  const out = AC.stamp(kind, j, { corpus: j.corpus || CORPUS, generated: j.generated || j.minedAt });
  const pretty = spec.file === "generators-lzw.json" ? JSON.stringify(out) : JSON.stringify(out, null, 1) + "\n";
  fs.writeFileSync(file, pretty);
  console.log(`  ${before === out.fingerprint ? "==" : "->"}  ${kind.padEnd(17)} ${out.fingerprint}${before && before !== out.fingerprint ? "  (was " + before + ")" : ""}`);
  done++;
}
console.log(CHECK ? `\n${bad ? "REFUSED " + bad : "all registered artifacts honour the contract"} (${absent} absent)`
                  : `\nstamped ${done} artifact(s), ${absent} absent`);
process.exit(CHECK && bad ? 1 : 0);
