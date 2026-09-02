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
    const out = execFileSync(process.execPath, [CLEAN, "--corpus", root, "--source", root, ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
}

/* SELF-HOSTING IS THE SHAPE UNDER TEST. run() passes --source AND --corpus at the same tmp root,
 * which is the default arrangement (SOURCE === CORPUS). Passing only --corpus left SOURCE resolving
 * to the real engine default, and every .en in the tmp tree then looked ORPHANED to the flip gate —
 * which is the gate working, but not the case these cases are about.
 */

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

/* ─── THE FLIP GATE (PRD §1B.3): once the English is authoritative, sen/ is REFUSED, not gated.
 * §1B.3's sentence — "this gate must harden from 'explicit flag' to 'refuse'" — was documentation
 * only until 2026-09-01. These cases are the control. Both signals are asserted, and so is the
 * property that makes it a refusal rather than a fourth token: NO flag releases it. */

/* (h) DECLARED. A corpus-local sen/DIRECTION file, not an engine env var, so a forked corpus
 * carries its own answer instead of inheriting the engine's. */
ok("sen/DIRECTION en-authoritative: --wipe-sen --go is REFUSED and deletes nothing", () => {
  const root = makeCorpus();
  fs.writeFileSync(path.join(root, "sen/DIRECTION"), "# the flip landed\nen-authoritative\n");
  const r = run(root, ["--wipe-sen", "--wipe-catalog", "--go"]);
  assert.strictEqual(r.code, 3, "a refusal must not look like an action");
  assert.ok(has(root, "sen/files/src/a.ts.en"), "AUTHORED ENGLISH DELETED — this is the flip hole");
  assert.ok(has(root, "sen/catalog/word-names.json"));
  assert.ok(has(root, ".cache/spec-derived/en-index.json"),
    "a refused run must not delete scope 1 either — it was refused, not partially obeyed");
  assert.ok(/en-authoritative/.test(r.out) && /do NOT release it/.test(r.out),
    `expected the refusal to name the declaration and say no token releases it, got:\n${r.out}`);
});

/* (i) DETECTED, and this is the one that matters: the flip is likely to arrive in practice before
 * anyone remembers to write a DIRECTION file. A render cannot produce a .en with no source file. */
ok("an .en with no counterpart in SOURCE refuses the wipe even with no DIRECTION file", () => {
  const root = makeCorpus();
  fs.writeFileSync(path.join(root, "sen/files/src/authored-by-hand.ts.en"), "\u00ab hand written \u00bb\n");
  assert.ok(!fs.existsSync(path.join(root, "sen/DIRECTION")), "no declaration — detection only");
  const r = run(root, ["--wipe-sen", "--go"]);
  assert.strictEqual(r.code, 3);
  assert.ok(has(root, "sen/files/src/authored-by-hand.ts.en"), "the orphan must survive");
  assert.ok(has(root, "sen/files/src/a.ts.en"), "and so must everything beside it");
  assert.ok(/1 \.en file\(s\).*NO corresponding/.test(r.out) &&
    /authored-by-hand\.ts\.en/.test(r.out), `expected the orphan named, got:\n${r.out}`);
});

/* (j) The un-flipped tree is UNAFFECTED. Measured against the real corpus the same day: 1037 .en,
 * zero orphans. A gate that fires today would have blocked a wipe Amir is entitled to. */
ok("with every .en backed by a source file the gate is silent and the wipe proceeds", () => {
  const root = makeCorpus();
  const r = run(root, ["--wipe-sen", "--go"]);
  assert.strictEqual(r.code, 0, "no flip, no refusal");
  assert.ok(!/NOT re-derivable/.test(r.out), "the flip gate must not narrate when it does not fire");
  assert.strictEqual(has(root, "sen/files/src/a.ts.en"), false, "the ordinary wipe still works");
});

/* ─── SOURCE SEPARATION (CLAUDE.md §2, §4). Added 2026-09-01 by a second lane.
 *
 * THE GAP THIS FILLS. Every case above calls run(), which passes `--source root --corpus root` —
 * the self-hosting default, where SOURCE === CORPUS. So the third condition in assertRemovable,
 * the one whose own comment says it "is the one that matters when SOURCE !== CORPUS", was never
 * executed by any test. CLAUDE.md §4 records it verified BY HAND on 2026-08-31 and left there,
 * which is the same shape this file's own header calls out: a hand check that was never pinned.
 *
 * It is the most expensive branch in the tool to get wrong — deleting a read-only source tree is
 * unrecoverable — and §4 records that its sibling bug was found only by WRITING the test, never by
 * reading the code: `inside(abs, SOURCE)` is trivially true for every path when SOURCE === CORPUS,
 * so the first version could not have deleted anything at all.
 *
 * These cases pass the two roots SEPARATELY rather than through run().
 */

/* Two trees, arranged by the caller. `nested` puts CORPUS inside SOURCE — the dangerous shape. */
function makeTwoRoots({ nested }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-clean-roots-"));
  const src = path.join(base, "source");
  const cor = nested ? path.join(src, "rendered") : path.join(base, "corpus");
  const w = (root, rel, body) => { fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body); };
  w(src, "src/a.ts", "export const a = 1;\n");
  /* The .en's counterpart MUST exist in SOURCE. Without it the flip gate refuses first and every
   * assertion below would pass for the wrong reason — a refusal, yes, but not this one. */
  w(cor, "sen/files/src/a.ts.en", "«some english»\n");
  w(cor, "sen/catalog/word-names.json", JSON.stringify({ names: {}, chunks: {}, orphans: {} }) + "\n");
  return { src, cor };
}
function runRoots(src, cor, args) {
  try {
    const out = execFileSync(process.execPath, [CLEAN, "--corpus", cor, "--source", src, ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
}

ok("SOURCE separate with CORPUS NESTED INSIDE it: --wipe-sen --go is refused, nothing deleted", () => {
  const { src, cor } = makeTwoRoots({ nested: true });
  const r = runRoots(src, cor, ["--wipe-sen", "--go"]);
  assert.notStrictEqual(r.code, 0, "the wipe must not succeed when the target lies inside SOURCE");
  assert.ok(fs.existsSync(path.join(cor, "sen/files/src/a.ts.en")), "it deleted from a tree inside SOURCE");
  assert.ok(fs.existsSync(path.join(src, "src/a.ts")), "it touched SOURCE itself");
  assert.ok(fs.existsSync(path.join(cor, "sen/catalog/word-names.json")), "it took the authored names");
});

ok("...and it is refused for the RIGHT reason — the SOURCE guard, not the flip gate", () => {
  /* Without this, the case above passes on ANY refusal. Two different gates can decline this tree
   * (the flip gate fires on an .en with no counterpart in SOURCE), and only one of them is the
   * property under test. Twice tonight a guard elsewhere in this repo was green for the wrong
   * reason; asserting the refusal's own words is what separates them. */
  const { src, cor } = makeTwoRoots({ nested: true });
  const r = runRoots(src, cor, ["--wipe-sen", "--go"]);
  assert.match(r.out, /lies inside SOURCE/, `expected the SOURCE guard's refusal, got:\n${r.out}`);
  assert.match(r.out, /read-only input, full stop/, "the refusal must say why SOURCE is untouchable");
  assert.ok(r.out.includes(src), "the refusal must name the SOURCE root it is protecting");
});

ok("the refusal happens at PLAN time, before any removal is attempted", () => {
  /* §4: "refused at plan time, before any `rm` ran". A guard that fires DURING the walk would have
   * deleted whatever it reached first, and the surviving-files assertions above cannot tell the
   * difference on a one-file tree. The stack names the frame. */
  const { src, cor } = makeTwoRoots({ nested: true });
  const r = runRoots(src, cor, ["--wipe-sen", "--go"]);
  assert.match(r.out, /refused at plan time, before any removal/,
    `the refusal did not report itself as plan-time:\n${r.out}`);
  assert.doesNotMatch(r.out, /^removed/m, "something was reported removed before the refusal");
  assert.doesNotMatch(r.out, /PARTIALLY wiped/, "the tool believes it had already deleted something");
});

ok("CONTROL: with the roots DISJOINT the same wipe proceeds, and SOURCE is untouched", () => {
  /* Without this the three cases above are satisfied by a guard that refuses everything — which is
   * safe and useless. This is the case that proves the guard discriminates. */
  const { src, cor } = makeTwoRoots({ nested: false });
  const r = runRoots(src, cor, ["--wipe-sen", "--go"]);
  assert.strictEqual(r.code, 0, `a disjoint corpus should wipe cleanly:\n${r.out}`);
  assert.ok(!fs.existsSync(path.join(cor, "sen/files")), "sen/files should be gone in the disjoint case");
  assert.ok(fs.existsSync(path.join(src, "src/a.ts")), "SOURCE must be untouched by a legitimate wipe");
  assert.ok(fs.existsSync(path.join(cor, "sen/catalog/word-names.json")), "the authored names must survive");
});

ok("a SOURCE refusal exits 3 like every other decline — not 1 with a stack", () => {
  /* FIXED 2026-09-01. This case was written the night before as "NOTED, NOT FIXED", pinning
   * `code === 1` so that whoever fixed it would have to update this deliberately rather than
   * silently. That is what happened; this is the same property, now asserting the fixed side.
   *
   * The inconsistency: the flip gate a few lines below the guard is an equally un-releasable
   * refusal and it printed prose and exited 3, while the SOURCE guard — the most safety-critical
   * refusal this tool has — exited 1 with an uncaught stack. Same event, two presentations, and
   * any caller separating "declined, nothing deleted" from "the cleaner broke" got the wrong
   * answer for the wrong one.
   *
   * sdd-clean.js's own exit-code comment had classified these four guards as "1 = error (the hard
   * refusals above throw)", so this was a documented decision being reversed, not an oversight
   * being swept up. The record of what it used to say is kept in that comment. */
  const { src, cor } = makeTwoRoots({ nested: true });
  const r = runRoots(src, cor, ["--wipe-sen", "--go"]);
  assert.strictEqual(r.code, 3, `a decline must exit 3, not ${r.code}:\n${r.out}`);
  assert.doesNotMatch(r.out, /^\s+at [\w.]+ \(/m, `a decline must not present as a stack trace:\n${r.out}`);
  assert.doesNotMatch(r.out, /^Error: /m, "still formatted as an uncaught Error");
});

ok("...but a GENUINE fault still exits 1 WITH its stack — the narrowing is real", () => {
  /* Without this, "make declines exit 3" is indistinguishable from "swallow every error and exit
   * 3", which would hide real breakage in the one tool that deletes things. A corpus that does not
   * exist is a fault, not a decline: nothing declined it, the tool could not run. */
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-clean-fault-"));
  const r = runRoots(base, path.join(base, "no-such-corpus"), ["--wipe-sen", "--go"]);
  assert.notStrictEqual(r.code, 3, `a missing corpus is not a decline, but it exited 3:\n${r.out}`);
  assert.strictEqual(r.code, 1, `a fault must exit 1, got ${r.code}:\n${r.out}`);
});

console.log(`\n${pass} assertions passed`);
