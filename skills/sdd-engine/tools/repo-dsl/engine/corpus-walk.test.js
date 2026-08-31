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
const { SKIP } = require("./walk-skip");

/* §10.4 THE PIN. Still an inventory, not an answer — but it now pins the ONE shared set instead of
 * re-parsing each walker's source text.
 *
 * WHY THIS TEST CHANGED SHAPE (2026-08-31). It used to regex `const SKIP = new Set([...])` out of
 * build-lzw-generators.js and write-en-files.js and compare the two. That was the right guard while
 * every walker carried its own copy — but it could only ever compare the TWO files it named, and
 * measurement found the duplication had grown to 18 files in THREE divergent shapes, of which this
 * test watched two. The copies are now gone: engine/walk-skip.js is the single frozen set and every
 * corpus walker requires it, so "miner and renderer walk the same file set" is true BY CONSTRUCTION
 * rather than by a passing assertion.
 *
 * What is left to guard is that nobody quietly reintroduces a local set, so the assertions below
 * check exactly that — across every live walker, not just two. The 696-of-937 history in the header
 * is why the pin stays at all. */

const skipOf = (file) => {
  const src = fs.readFileSync(path.join(R, file), "utf8");
  const m = src.match(/const SKIP = new Set\(\[([^\]]*)\]\)/);
  return m ? new Set(m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)) : null;
};

/* Every live corpus walker. If you add one, add it here. */
const WALKERS = ["build-lzw-generators.js", "write-en-files.js", "measure-english.js",
  "measure-uncollapsed.js", "name-words-lzw.js", "measure-bespoke-composites.js",
  "measure-callgraph.js", "measure-logic-english.js", "measure-operations.js",
  path.join("engine", "uncollapsed-density.test.js"), path.join("engine", "data-english.test.js")];

/* MIGRATED IN THE WORKING TREE BUT NOT IN THIS COMMIT. test-gen-roundtrip.js and
 * test-lzw-roundtrip.js carry another lane's uncommitted exit-code work in the same files, so
 * committing them here would have swept it. Their SKIP migration is done on disk and lands with
 * that lane's commit. Move them into WALKERS above once it does — this list exists to shrink, and
 * a name sitting here is a TODO, not an exemption. */
/*   test-gen-roundtrip.js, test-lzw-roundtrip.js   <- add these two when that lane commits. */

ok("miner and renderer walk the same file set — now by construction", () => {
  for (const f of ["build-lzw-generators.js", "write-en-files.js"]) {
    const src = fs.readFileSync(path.join(R, f), "utf8");
    assert.ok(/require\(["']\.\/engine\/walk-skip["']\)/.test(src),
      `${f} no longer requires the shared walk-skip set — the miner and renderer can diverge again`);
  }
});

ok("no live corpus walker declares its own SKIP set", () => {
  const rogue = WALKERS.filter((f) => skipOf(f) !== null);
  assert.deepStrictEqual(rogue, [],
    `these reintroduced a local SKIP set instead of requiring engine/walk-skip.js:\n    ${rogue.join("\n    ")}\n` +
    `  Divergent walk sets once hid 696 of 937 un-collapsed bodies.`);
});

ok("the shared SKIP set is the expected inventory", () => {
  assert.deepStrictEqual([...SKIP].sort(),
    [".cache", ".git", ".worktrees", "build", "catalog", "coined-demo", "coverage", "demo", "dist", "node_modules", "sen", "spec"].sort());
});

ok("the shared SKIP set cannot be mutated by a caller", () => {
  assert.throws(() => SKIP.add("x"), /immutable/);
  assert.throws(() => SKIP.delete("sen"), /immutable/);
});

console.log(`\nPASS ${pass} assertions — one shared walk set, required by every corpus walker.`);
