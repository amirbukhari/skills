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
  "test-gen-roundtrip.js", "test-lzw-roundtrip.js", path.join("engine", "pipeline.js"),
  path.join("engine", "uncollapsed-density.test.js"), path.join("engine", "data-english.test.js")];

/* THE TWO ROUND-TRIP WALKERS ARE NOW IN THE LIST. They sat below in a comment reading "add these
 * two when that lane commits"; measured 2026-09-04, both require the shared set on disk and at
 * HEAD, so the TODO is discharged rather than left to rot. The list exists to shrink.
 *
 * `engine/pipeline.js` IS THE THIRD ADDITION, and it is why the assertion below exists at all —
 * see it. */

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

/* THE ASSERTION ABOVE COULD NOT FIRE ON THE SHAPE THAT ACTUALLY OCCURRED, and this one exists
 * because of it. `skipOf` detects a walker that reintroduces a LOCAL set; `engine/pipeline.js` had
 * NO set — it walked everything — so `skipOf` returned null and it would have read as CLEAN even
 * had it been listed, which it was not. A walker with no skip set is the *worse* of the two shapes
 * and was the invisible one. Measured 2026-09-04: `walkDir` returned 1038 files against the enfile
 * layer's 1037, the extra being `coined-demo/syncWhenProd.ts`, a generated demo artifact.
 *
 * §3, one layer up, and in the reassuring direction: a detector that answers "did anyone write a
 * WRONG set" cannot answer "did anyone write NO set". So the pin is now the positive requirement —
 * every live walker REQUIRES the shared module — which is decidable and has no third state. */
ok("every live corpus walker REQUIRES the shared set — a walker with NO skip set is the invisible shape", () => {
  const missing = WALKERS.filter((f) => {
    const src = fs.readFileSync(path.join(R, f), "utf8");
    return !/require\(["'][^"']*walk-skip(?:\.js)?["']\)/.test(src);
  });
  assert.deepStrictEqual(missing, [],
    `these walk a corpus without the shared SKIP set:\n    ${missing.join("\n    ")}\n` +
    `  engine/pipeline.js did exactly this and mined a generated demo file as corpus source.`);
});

/* AND THE BEHAVIOURAL PIN, because requiring the module is not the same as USING it. Built in a
 * throwaway tree so it does not depend on what this corpus happens to contain: one .ts under every
 * skipped name plus one that must survive. Against the pre-fix `walkDir` this fails with 13 files
 * where 1 is right. */
ok("pipeline.walkDir actually applies the set (synthetic tree, every skipped name populated)", () => {
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "walkskip-"));
  fs.writeFileSync(path.join(root, "keep.ts"), "export const a = 1;\n");
  for (const name of SKIP) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, "generated.ts"), "export const b = 2;\n");
  }
  const { walkDir } = require("./pipeline");
  const got = walkDir(root).map((f) => path.relative(root, f)).sort();
  fs.rmSync(root, { recursive: true, force: true });
  assert.deepStrictEqual(got, ["keep.ts"],
    "walkDir walked into a skipped directory: " + got.join(", "));
});

/* THE ORIGINAL DRIFT, PINNED AS A COUNT. The header's promise is "the miner and the renderer walk
 * the SAME file set"; until 2026-09-04 that was FALSE for `pipeline.js` by exactly one file. This
 * asserts the two walks are identical over the live corpus — the paths, not just the totals, so a
 * fix that dropped one file and added another could not pass. */
ok("pipeline.walkDir and the shared-set walk return the SAME corpus files", () => {
  const CR = require("./corpus-root");
  const SRC = CR.sourceRoot();
  const walkShared = (d, o = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkShared(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
    }
    return o;
  };
  const { walkDir } = require("./pipeline");
  const a = walkDir(SRC).sort(), b = walkShared(SRC).sort();
  const onlyA = a.filter((f) => !b.includes(f)).map((f) => path.relative(SRC, f));
  const onlyB = b.filter((f) => !a.includes(f)).map((f) => path.relative(SRC, f));
  assert.deepStrictEqual(onlyA, [], "pipeline.walkDir mines files the renderer never sees: " + onlyA.join(", "));
  assert.deepStrictEqual(onlyB, [], "pipeline.walkDir misses files the renderer renders: " + onlyB.join(", "));
  assert.equal(a.length, b.length);
  console.log(`      (both walks: ${a.length} files)`);
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
