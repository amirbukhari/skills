"use strict";
/* DRIFT GUARD: the miner and the renderer must walk the SAME file set.
 *
 * build-lzw-generators.js mines the dictionary; write-en-files.js renders the .en against it. If
 * their SKIP sets diverge, the dictionary is mined over one corpus and applied to another, and
 * every recurring body in an excluded directory has no word BY CONSTRUCTION — silently, with no
 * error and no failing gate. That is exactly what happened: the miner excluded "tests" while the
 * renderer did not, and 696 of 937 un-collapsed bodies traced to that single mismatch.
 *
 * §10.4: this pins an INVENTORY, not an answer. If the sets legitimately change, this test fails,
 * someone decides, and the pin moves in the same commit with a reason. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const R = path.join(__dirname, "..");
const skipOf = (file) => {
  const src = fs.readFileSync(path.join(R, file), "utf8");
  const m = src.match(/const SKIP = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, `no SKIP set found in ${file}`);
  return new Set(m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
};

ok("miner and renderer SKIP sets are identical", () => {
  const miner = skipOf("build-lzw-generators.js");
  const renderer = skipOf("write-en-files.js");
  const only = (a, b) => [...a].filter((x) => !b.has(x));
  assert.deepStrictEqual(
    { minerOnly: only(miner, renderer).sort(), rendererOnly: only(renderer, miner).sort() },
    { minerOnly: [], rendererOnly: [] },
    "miner and renderer walk different file sets — the dictionary would be mined over one corpus and applied to another");
});

ok("the shared SKIP set is the expected inventory", () => {
  assert.deepStrictEqual([...skipOf("build-lzw-generators.js")].sort(),
    [".cache", ".git", ".worktrees", "build", "catalog", "coined-demo", "coverage", "demo", "dist", "node_modules", "sen", "spec"].sort());
});

console.log(`\nPASS ${pass} assertions — miner and renderer walk the same corpus.`);
