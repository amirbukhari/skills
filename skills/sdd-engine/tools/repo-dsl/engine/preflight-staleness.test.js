"use strict";
/* preflight-staleness.test.js — the SEVEN tier rows can now read STALE, and read PRESENT when they
 * should. Runnable; exits non-zero on failure.
 *
 * WHAT WAS WRONG, and it is the reason this file exists. `preflight.js` computes STALE only along a
 * declared `derivesFrom` edge, and until 2026-09-04 only FOUR manifest rows declared one — all four
 * pointing at another REGISTRY artifact. The seven phase-5/7 tier rows (`npm run tiers`) declared
 * none, so they could only ever print PRESENT. A COVERAGE.json written before a fortnight of source
 * edits was indistinguishable from one written a minute ago.
 *
 * MEASURED, not argued. Against a fixture whose every tier artifact is dated 2020-01-01 and whose
 * only source file is dated 2030-01-01, `preflight.js` AT HEAD~ printed:
 *
 *     [  ok ] archetype-index.json                   3 B
 *     [  ok ] catalog/archetypes.json                3 B
 *     [  ok ] sen/archetypes                         1 files
 *     [  ok ] .sdd-code-provenance.json              3 B
 *     [  ok ] catalog/mined-library.v6.json          3 B
 *     [  ok ] COVERAGE.json                          3 B
 *     [  ok ] word-library.json                      3 B
 *     8/19 present  |  0 STALE (present but out of date)  |  11 MISSING ...
 *
 * and after the edit, on the same fixture, all seven read [STALE] and the summary reads 7 STALE.
 * That pair is assertion 1 and assertion 2 below.
 *
 * WHY A CHILD PROCESS AND NOT A REQUIRE. preflight resolves its roots at module load through
 * corpus-root.js, so the roots must be set in the ENVIRONMENT of a fresh process. Requiring it here
 * would measure this test's roots — the real corpus — which is both the wrong thing and a write-free
 * but wholly accidental dependency on whatever state the corpus happens to be in today.
 *
 * RED-GREEN, MEASURED BOTH WAYS. Run whole against the pre-edit preflight (a `git show HEAD:` copy
 * in a scratchpad, nothing else changed) this file reads:
 *
 *     FAIL  all seven tier rows read STALE when the SOURCE tree is newer
 *     ok  the same seven read PRESENT when they are newer than the source
 *     FAIL  only COVERAGE.json is stale against a newer archetype-index.json
 *     FAIL  a nested source file, touched, is the input that wins
 *     ok  a .ts under sen/ does not count as source
 *     2 assertions passed
 *
 * 3 red, 2 green; after the edit, 5 green. AND THE TWO THAT WERE ALREADY GREEN PASS BY CONSTRUCTION
 * THERE, which is worth saying out loud: with no edge declared, every tier row reads PRESENT, so
 * "reads PRESENT" and "is not stale" are free. Their real negative control is assertions 1, 3 and 4 —
 * an edge that reported STALE unconditionally would satisfy those and break 2 and 5. Neither half
 * means anything without the other.
 *
 * EVERY FIXTURE IS A THROWAWAY TEMP DIR. Nothing here reads or writes the real corpus. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const PREFLIGHT = path.join(__dirname, "..", "preflight.js");
const TIER_ROWS = ["archetype-index.json", "catalog/archetypes.json", "sen/archetypes",
  "COVERAGE.json", "catalog/mined-library.v6.json", "word-library.json", ".sdd-code-provenance.json"];

const OLD = "2020-01-01T00:00:00Z", NEW = "2030-01-01T00:00:00Z";

/** a corpus that is also its own SOURCE (the self-hosting default), with every tier artifact present */
function fixture() {
  const F = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-stale-"));
  fs.mkdirSync(path.join(F, "src"), { recursive: true });
  fs.mkdirSync(path.join(F, "catalog"), { recursive: true });
  fs.mkdirSync(path.join(F, "sen", "archetypes"), { recursive: true });
  fs.writeFileSync(path.join(F, "src", "a.ts"), "export const a = 1;\n");
  for (const rel of ["archetype-index.json", "COVERAGE.json", "word-library.json",
                     ".sdd-code-provenance.json", "catalog/archetypes.json",
                     "catalog/mined-library.v6.json", "catalog/coined-words.json"])
    fs.writeFileSync(path.join(F, rel), "{}\n");
  fs.writeFileSync(path.join(F, "sen", "archetypes", "x.json"), "{}\n");
  return F;
}
const stamp = (abs, when) => { const t = new Date(when); fs.utimesSync(abs, t, t); };
const stampAll = (F, when) => {
  for (const rel of ["archetype-index.json", "COVERAGE.json", "word-library.json",
                     ".sdd-code-provenance.json", "catalog/archetypes.json",
                     "catalog/mined-library.v6.json", "catalog/coined-words.json",
                     "sen/archetypes/x.json", "sen/archetypes"])
    stamp(path.join(F, rel), when);
};

/** run the REAL preflight in a fresh process against this fixture, and index its rows by id */
function preflight(F) {
  /* EXIT 2 IS THE ORDINARY STATE HERE, not a failure: this fixture has no live-tier artifacts, so
   * eleven rows are honestly MISSING and preflight says so with exit 2. Only exit 1 — "preflight
   * itself could not run" — is a failure of the run, and it is re-thrown with its stderr. */
  let out;
  try {
    out = execFileSync(process.execPath, [PREFLIGHT, "--json"],
      { env: { ...process.env, SOURCE: F, CORPUS: F }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    if (e.status !== 2) throw new Error("preflight exited " + e.status + "\n" + (e.stderr || ""));
    out = e.stdout;
  }
  const r = JSON.parse(out);
  const by = new Map();
  for (const row of r.artifacts) by.set(row.id, row);
  return { r, by, status: (id) => (by.get(id) || {}).status };
}

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

/* 1. THE FIX. Source newer than every tier artifact -> all seven STALE.
 *    This is the assertion that was RED (0 of 7) before the derivesFrom edit. */
ok("all seven tier rows read STALE when the SOURCE tree is newer", () => {
  const F = fixture();
  stampAll(F, OLD);
  stamp(path.join(F, "src", "a.ts"), NEW);
  const { r, status } = preflight(F);
  const stale = TIER_ROWS.filter((id) => status(id) === "STALE");
  assert.equal(stale.length, 7, "STALE tier rows: " + JSON.stringify(TIER_ROWS.map((id) => [id, status(id)])));
  assert.equal(r.summary.stale, 7, JSON.stringify(r.summary));
});

/* 2. THE NEGATIVE CONTROL FOR 1, and the assertion that keeps the fix from being "always stale".
 *    Same fixture, artifacts NEWER than the source -> all seven PRESENT, and the run reports 0 STALE.
 *    Without this, an edge that reported STALE unconditionally would pass assertion 1. */
ok("the same seven read PRESENT when they are newer than the source", () => {
  const F = fixture();
  stamp(path.join(F, "src", "a.ts"), OLD);
  stampAll(F, NEW);
  const { r, status } = preflight(F);
  const present = TIER_ROWS.filter((id) => status(id) === "PRESENT");
  assert.equal(present.length, 7, JSON.stringify(TIER_ROWS.map((id) => [id, status(id)])));
  assert.equal(r.summary.stale, 0, JSON.stringify(r.summary));
});

/* 3. THE ARTIFACT-TO-ARTIFACT EDGE, and the WRONG-EDGE CONTROL in the same assertion.
 *    package-hydra-source.js:224 reads archetype-index.json into `archetypeTier` and uses it at :296
 *    inside the `coverage` object ONLY. So COVERAGE.json takes that edge and the other three phase-7
 *    rows do NOT. With archetype-index.json alone made newer, exactly ONE row may move — and if a
 *    future edit hands that edge to the siblings, this fails on the siblings, by name. */
ok("only COVERAGE.json is stale against a newer archetype-index.json", () => {
  const F = fixture();
  stamp(path.join(F, "src", "a.ts"), OLD);
  stampAll(F, NEW);
  stamp(path.join(F, "archetype-index.json"), "2031-01-01T00:00:00Z");
  const { by, status } = preflight(F);
  assert.equal(status("COVERAGE.json"), "STALE", "COVERAGE.json: " + status("COVERAGE.json"));
  for (const sib of ["catalog/mined-library.v6.json", "word-library.json", ".sdd-code-provenance.json"])
    assert.equal(status(sib), "PRESENT", sib + " must NOT carry the archetype edge, read " + status(sib));
  /* and the message must NAME the input, or a reader cannot act on it */
  assert.ok(/archetype-index\.json/.test(JSON.stringify(by.get("COVERAGE.json"))),
    JSON.stringify(by.get("COVERAGE.json")));
});

/* 4. A TOUCHED SOURCE FILE IS ENOUGH — the edge is the NEWEST .ts under SOURCE, not one named file.
 *    Fails if the walk ever stops at the top level, or starts skipping a real source directory. */
ok("a nested source file, touched, is the input that wins", () => {
  const F = fixture();
  stamp(path.join(F, "src", "a.ts"), OLD);
  stampAll(F, NEW);
  fs.mkdirSync(path.join(F, "src", "deep", "deeper"), { recursive: true });
  const nested = path.join(F, "src", "deep", "deeper", "b.ts");
  fs.writeFileSync(nested, "export const b = 2;\n");
  stamp(nested, "2031-01-01T00:00:00Z");
  const { status } = preflight(F);
  assert.equal(TIER_ROWS.filter((id) => status(id) === "STALE").length, 7,
    JSON.stringify(TIER_ROWS.map((id) => [id, status(id)])));
});

/* 5. THE WALK IS THE CANONICAL ONE. A `.ts` inside `sen/` — the corpus's own output tree, which the
 *    ONE shared SKIP set excludes — must NOT make everything stale, or every render would report the
 *    whole tier pipeline out of date the moment it finished writing. */
ok("a .ts under sen/ does not count as source", () => {
  const F = fixture();
  stamp(path.join(F, "src", "a.ts"), OLD);
  stampAll(F, NEW);
  const inSen = path.join(F, "sen", "junk.ts");
  fs.writeFileSync(inSen, "export const junk = 3;\n");
  stamp(inSen, "2031-01-01T00:00:00Z");
  const { r, status } = preflight(F);
  assert.equal(r.summary.stale, 0, "sen/ must be skipped: " + JSON.stringify(TIER_ROWS.map((id) => [id, status(id)])));
});

console.log(`\n${pass} assertions passed`);
