#!/usr/bin/env node
/**
 * sdd-check — drift detection for the LLM generation path.
 *
 * The deterministic renderer (money-cart) could flag DIVERGED by comparing the
 * output byte-hash, because a spec renders to identical bytes every time. An LLM
 * generator does NOT — so byte-identity is the wrong validity signal here.
 * Instead validity is behavioural: a generated artifact is valid IFF it still
 * passes its fixtures. This tool reports, per module:
 *
 *   OK        spec inputs unchanged since generation AND fixtures pass
 *   STALE     a spec input changed since generation (regenerate)
 *   INVALID   generated artifact currently FAILS its fixtures (broken)
 *   MISSING   provenance claims an artifact that no longer exists
 *   UNBUILT   module has a spec but no provenance entry (never generated)
 *   ORPHAN    a file in generated/ that provenance does not claim
 *
 * (STALE and ORPHAN are carried over from the deterministic checker; DIVERGED is
 * replaced by INVALID, which is fixtures-pass rather than byte-hash.)
 *
 * Exit 0 iff every module is OK and there are no orphans; else exit 1.
 *
 * Usage: node tools/sdd-check.js <exampleDir> [--lang ts]
 */

const fs = require("fs");
const path = require("path");
const lib = require("./sdd-lib");

function parseArgs(argv) {
  const a = { exampleDir: null, lang: "ts" };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--lang") a.lang = rest[++i];
    else if (!a.exampleDir) a.exampleDir = rest[i];
    else throw new Error(`unexpected argument: ${rest[i]}`);
  }
  if (!a.exampleDir) throw new Error("usage: sdd-check.js <exampleDir> [--lang ts]");
  a.exampleDir = path.resolve(process.cwd(), a.exampleDir);
  return a;
}

function sameHashMap(a, b) {
  const ak = Object.keys(a || {}).sort();
  const bk = Object.keys(b || {}).sort();
  if (ak.length !== bk.length || ak.join("|") !== bk.join("|")) return false;
  return ak.every((k) => a[k] === b[k]);
}

function main() {
  const cfg = parseArgs(process.argv);
  const prov = lib.readProvenance(cfg.exampleDir);
  const modules = lib.listModules(cfg.exampleDir);
  const claimed = new Map((prov?.artifacts || []).map((e) => [e.module, e]));
  const results = [];

  for (const m of modules) {
    const entry = claimed.get(m);
    if (!entry) {
      results.push({ module: m, state: "UNBUILT", detail: "no provenance entry" });
      continue;
    }
    const artifactPath = path.join(cfg.exampleDir, entry.path);
    if (!fs.existsSync(artifactPath)) {
      results.push({ module: m, state: "MISSING", detail: entry.path });
      continue;
    }
    const specNow = lib.specInputsHashMap(cfg.exampleDir, m);
    if (!sameHashMap(specNow, entry.specInputs)) {
      results.push({ module: m, state: "STALE", detail: "spec inputs changed since generation" });
      continue;
    }
    const v = lib.runVerify(cfg.exampleDir, artifactPath);
    if (v.ok === false) {
      results.push({ module: m, state: "INVALID", detail: "generated artifact fails fixtures" });
      continue;
    }
    const fxNow = lib.fixturesHash(cfg.exampleDir, m);
    const note = fxNow !== entry.fixturesHash ? " (fixtures changed since gen — re-verified, still pass)" : "";
    results.push({ module: m, state: "OK", detail: `fixtures pass${note}` });
  }

  // Orphans: files in generated/ not claimed by provenance.
  const genDir = path.join(cfg.exampleDir, "generated");
  const claimedFiles = new Set([...claimed.values()].map((e) => path.basename(e.path)));
  if (fs.existsSync(genDir)) {
    for (const f of fs.readdirSync(genDir).sort()) {
      if (f.startsWith(".")) continue;
      if (!f.endsWith(`.${cfg.lang}`)) continue;
      if (!claimedFiles.has(f)) results.push({ module: "-", state: "ORPHAN", detail: `generated/${f}` });
    }
  }

  const label = { OK: "OK     ", STALE: "STALE  ", INVALID: "INVALID", MISSING: "MISSING", UNBUILT: "UNBUILT", ORPHAN: "ORPHAN " };
  console.log(`sdd-check — ${lib.relTo(process.cwd(), cfg.exampleDir)} (validity = fixtures-pass)`);
  for (const r of results) console.log(`  ${label[r.state]}  ${r.module.padEnd(16)} ${r.detail}`);

  const clean = results.every((r) => r.state === "OK");
  console.log(clean ? "  => in sync" : "  => drift detected");
  process.exit(clean ? 0 : 1);
}

main();
