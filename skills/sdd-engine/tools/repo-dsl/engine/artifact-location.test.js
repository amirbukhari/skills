/* engine/artifact-location.test.js — THE GUARD.
 *
 * Amir's rule, made executable: the skills repo is ENGINE CODE + PRD ONLY. It has a PUBLIC remote,
 * and it must never again hold bytes derived from anyone's corpus. This test is what turns that
 * from a promise into a property — it fails if a corpus-derived artifact reappears in the engine
 * tree, or if any engine code names a corpus artifact relative to itself instead of the corpus root.
 *
 * The leak it exists to prevent, measured on 2026-08-31 before the move: catalog/generators-lzw.json
 * held 5,754 skeletons (64.5%) carrying non-keyword Hydra identifiers — 143,891 B of verbatim
 * function and property names — and results/corpus-coverage.json held 1,037 real corpus file paths
 * plus literal source lines. None of it had been pushed. The point of this test is that "none of it
 * had been pushed" stops being luck.
 */
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const AC = require("./artifact-contract");

const ENGINE = path.resolve(__dirname, "..");            // the repo-dsl tree inside the skills repo
let pass = 0;
const ok = (name, fn) => { fn(); console.log("  ok  " + name); pass++; };

/* (a) Every registered artifact resolves OUTSIDE the engine tree, by construction. */
ok("no registered artifact resolves inside the engine tree", () => {
  for (const kind of AC.kindsOf()) {
    const p = path.resolve(AC.pathFor(kind));
    assert.ok(!p.startsWith(ENGINE + path.sep),
      `${kind} resolves to ${p}, which is inside the engine tree — corpus data must live with the corpus (PRD §8B)`);
  }
});

/* (b) Every artifact also lands in the home its protection level demands. A SOURCE-PROTECTED
 *     artifact in a gitignored cache is how a hand-authored file gets destroyed by a cleanup. */
ok("tracked artifacts land in <corpus>/sen/catalog, derived ones in the gitignored cache", () => {
  for (const kind of AC.kindsOf()) {
    const spec = AC.specOf(kind), p = AC.pathFor(kind);
    assert.ok(["tracked", "cache"].includes(spec.home), `${kind}: home must be "tracked" or "cache"`);
    assert.ok(p.includes(AC.HOMES[spec.home]), `${kind} (${spec.home}) does not resolve into ${AC.HOMES[spec.home]}: ${p}`);
  }
});

/* (c) Nothing corpus-derived is sitting on disk in the engine tree RIGHT NOW. Names, not guesses:
 *     the registry's own filenames plus the rendered-source extensions. */
const DERIVED = new Set([...AC.kindsOf().map((k) => AC.specOf(k).file),
  "mined-library.v1.json", "mined-library.v2.json", "name-queue.json", "uncollapsed.json",
  "en-index.json", "archetype-index.json", "files-index.json", "word-library.json", "COVERAGE.json"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);
function sweep(dir, hits = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sweep(p, hits);
    else if (DERIVED.has(e.name) || /\.(en|calc)$/.test(e.name)) hits.push(path.relative(ENGINE, p));
  }
  return hits;
}
ok("the engine tree holds no corpus-derived file on disk", () => {
  const hits = sweep(ENGINE);
  assert.deepStrictEqual(hits, [], `corpus-derived files inside the engine tree:\n    ${hits.join("\n    ")}`);
});

/* (d) The recurrence guard. Finding the files gone is not enough — the bug is code that WRITES
 *     them here, so grep the source for a corpus artifact named relative to the engine itself.
 *     `__dirname` + catalog/results is precisely the shape that produced the leak. */
ok("no engine source names a corpus artifact relative to __dirname", () => {
  const bad = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      if (!p.endsWith(".js") || p.endsWith("artifact-location.test.js")) continue;
      const src = fs.readFileSync(p, "utf8");
      src.split("\n").forEach((line, i) => {
        if (/^\s*[/*]/.test(line)) return;                       // comments describe history; code is the guard
        if (/__dirname\s*,\s*"(catalog|results)"/.test(line) || /path\.join\(__dirname,\s*"\.\.",\s*"catalog"/.test(line)) {
          bad.push(`${path.relative(ENGINE, p)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
  };
  scan(ENGINE);
  assert.deepStrictEqual(bad, [], `engine code writing corpus artifacts into the engine tree:\n    ${bad.join("\n    ")}`);
});

/* (e) Cross-check against the corpus: the artifacts really are where the contract says. */
ok("every registered artifact is readable and contract-valid at its corpus location", () => {
  for (const kind of AC.kindsOf()) {
    const p = AC.pathFor(kind);
    assert.ok(fs.existsSync(p), `${kind} missing at ${p}`);
    AC.load(kind, p);                                             // throws on any drift
  }
});

console.log(`\n${pass} assertions passed`);
