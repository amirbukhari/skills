/* engine/sdd-clean.test.js — the ONE DESTRUCTIVE TOOL IN THE TREE, tested at last.
 *
 * `sdd-clean.js` had no test. Every claim about it in CLAUDE.md §4 was verified by hand in
 * throwaway directories on 2026-08-31 and then left unpinned, which is exactly the shape §9.4
 * warns about: "Documenting a risk is not a control." One of those hand checks had in fact gone
 * stale, and it cost the hole this file now guards.
 *
 * THE HOLE, MEASURED 2026-09-01. `--wipe-sen --go` planned `sen/` as ONE target and rmSync'd it
 * recursively, so it deleted `sen/catalog/word-names.json` — which §8A states is "hand-authored and
 * NOT reproducible by a re-mine" and which carries the `orphans` ledger. `git ls-files sen/catalog`
 * returned ZERO files (the corpus is gitignored one scope up), so the loss was unrecoverable rather
 * than expensive. R-CFG-12 ("never deleted in any cleanup") and R-CFG-7 ("sen/ is wipable")
 * contradict, and the code followed R-CFG-7 in silence.
 *
 * EVERY CASE RUNS AGAINST A THROWAWAY TREE IN os.tmpdir(). Nothing here touches the real corpus,
 * and the corpus root is passed with --corpus so the resolver never falls through to a default.
 * The one thing this file must never do is what it is testing, so it asserts on the tmp tree only.
 *
 * Deterministic; needs no corpus; exits non-zero on failure.
 */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), assert = require("assert");
const { execFileSync } = require("child_process");

const CLEAN = path.resolve(__dirname, "..", "sdd-clean.js");
let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; } };

/* A corpus with the shape that matters: source dirs, the legacy catalog, a derived cache, and a
 * sen/ tree whose catalog holds an artifact with AUTHORED names in it. */
function makeCorpus() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-clean-test-"));
  const w = (rel, body) => { fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body); };
  w("src/a.ts", "export const a = 1;\n");
  w("catalog/coined-words.json", '{"hand":"curated"}\n');          /* legacy STEP-4, out of scope */
  w(".cache/spec-derived/en-index.json", '{"derived":true}\n');
  w("sen/files/src/a.ts.en", "«some english»\n");
  w("sen/catalog/generators-lzw.json", '{"mined":true}\n');
  w("sen/catalog/word-names.json", JSON.stringify({
    names: { "n:deadbeefdeadbeef": { sym: "x;", en: "do the thing" } }, chunks: {}, orphans: {},
  }) + "\n");
  return root;
}
const has = (root, rel) => fs.existsSync(path.join(root, rel));

/* Runs the cleaner and returns { code, out }. It exits 3 on a decline, which is not a crash, so a
 * non-zero status is captured rather than thrown. */
function run(root, args) {
  try {
    const out = execFileSync(process.execPath, [CLEAN, "--corpus", root, ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

/* (a) THE REGRESSION. --wipe-sen --go must take sen/files/ and LEAVE the catalog. This is the
 * assertion the hole would have failed: before the fix, word-names.json was gone here. */
ok("--wipe-sen --go removes sen/files/ and LEAVES sen/catalog/ intact", () => {
  const root = makeCorpus();
  const r = run(root, ["--wipe-sen", "--go"]);
  assert.strictEqual(has(root, "sen/files/src/a.ts.en"), false, "sen/files/ should be gone");
  assert.ok(has(root, "sen/catalog/word-names.json"), "AUTHORED NAMES DELETED — this is the hole");
  assert.ok(has(root, "sen/catalog/generators-lzw.json"), "sen/catalog/ should be untouched entirely");
  assert.ok(/REFUSING to touch .*catalog/.test(r.out), "the decline must be printed, not silent");
});

/* (b) The refusal PRICES the loss in authored names — the number a re-mine cannot rebuild. A
 * refusal that says only "N files, M MB" prices an unrecoverable artifact like a cache. */
ok("the catalog refusal names the authored-name count, not just files and bytes", () => {
  const root = makeCorpus();
  const out = run(root, ["--wipe-sen", "--go"]).out;
  assert.ok(/1 authored name\(s\)/.test(out), `expected an authored-name count, got:\n${out}`);
  assert.ok(/NOT reproducible by a re-mine/.test(out), "expected the §8A reason, not just a count");
});

/* (c) The escape hatch works. Amir's words name the catalog as wipable — "the SEN folder with the
 * catalog is supposed to be wipable" — so the token must actually reach it. A guard that cannot be
 * released is a different requirement from the one that was asked for. */
ok("--wipe-sen --wipe-catalog --go DOES remove sen/catalog/", () => {
  const root = makeCorpus();
  run(root, ["--wipe-sen", "--wipe-catalog", "--go"]);
  assert.strictEqual(has(root, "sen/catalog/word-names.json"), false, "the token must release the guard");
  assert.strictEqual(has(root, "sen"), false, "sen/ should be empty or gone");
});

/* (d) NEITHER TOKEN IS A DEFAULT, and a dry run deletes nothing. R-CFG-7/R-CFG-8. */
ok("no flags: refuses sen/ entirely, deletes nothing, exits 3", () => {
  const root = makeCorpus();
  const r = run(root, []);
  assert.strictEqual(r.code, 3, "a decline must not look like an action");
  assert.ok(has(root, "sen/files/src/a.ts.en") && has(root, "sen/catalog/word-names.json"));
  assert.ok(has(root, ".cache/spec-derived/en-index.json"), "a dry run removes nothing at all");
});
ok("--wipe-sen without --go lists sen/ and still deletes nothing", () => {
  const root = makeCorpus();
  run(root, ["--wipe-sen"]);
  assert.ok(has(root, "sen/files/src/a.ts.en"), "no --go means no deletion");
  assert.ok(has(root, "sen/catalog/word-names.json"));
});

/* (e) The legacy catalog stays out of scope under every flag (R-CFG-10, §1B.4). It is a DIFFERENT
 * tree from sen/catalog/ and the two are easy to conflate — which is why both are asserted here. */
ok("<corpus>/catalog/ survives --wipe-sen --wipe-catalog --go", () => {
  const root = makeCorpus();
  run(root, ["--wipe-sen", "--wipe-catalog", "--go"]);
  assert.ok(has(root, "catalog/coined-words.json"), "the legacy STEP-4 tree is never in scope");
  assert.ok(has(root, "src/a.ts"), "source is never in scope");
});

/* (f) --wipe-catalog ALONE must say it did nothing. Silence would read as "the catalog was in
 * scope" to the one caller most entitled to be certain it was not. */
ok("--wipe-catalog without --wipe-sen says it does nothing", () => {
  const root = makeCorpus();
  const r = run(root, ["--wipe-catalog", "--go"]);
  assert.ok(/does nothing without --wipe-sen/.test(r.out), `expected the note, got:\n${r.out}`);
  assert.ok(has(root, "sen/catalog/word-names.json"));
});

/* (g) THE ANCESTOR CASE, pinned as a SOURCE property — and labelled as one.
 *
 * The hole was not a missing name in a list; it was one rmSync over a directory nobody enumerated,
 * i.e. an ANCESTOR of the guarded path. The behavioural cases above can no longer construct that
 * shape, because scope 2 now enumerates children — which is the fix working, and which also means
 * there is no CLI invocation left that exercises it. Rather than add a test-only flag to the one
 * destructive tool in the tree, this is a DRIFT GUARD on the two lines that make the ancestor case
 * unreachable (R-TEST-4: pinning an inventory is legitimate; a failure here is a decision point,
 * and it is updated in the same commit with a reason).
 *
 * Stated plainly so nobody reads it as stronger than it is: this asserts the CODE still has the
 * shape, not that a running ancestor delete was refused. */
ok("DRIFT GUARD: scope 2 enumerates children, and the guard tests containment both ways", () => {
  const src = fs.readFileSync(CLEAN, "utf8");
  const scope2 = src.slice(src.indexOf("/* scope 2"));
  assert.ok(!/\bplan\(SEN\)/.test(scope2),
    "scope 2 plans sen/ WHOLESALE again — that is the exact hole: one rmSync, no enumeration");
  assert.ok(/inside\(gabs,\s*abs\)/.test(src),
    "the guarded-subtree check no longer tests whether the TARGET CONTAINS the guarded path");
  assert.ok(/--wipe-catalog/.test(src) && /GUARDED/.test(src),
    "the guarded-subtree mechanism is gone");
});

console.log(`\n${pass} assertions passed`);
