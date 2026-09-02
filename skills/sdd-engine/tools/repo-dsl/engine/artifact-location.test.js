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

/* (c2) THE SAME CLAIM, WITHOUT AN ALLOWLIST. (c) asks "is this file one of the names we already
 *      know about?" — so it can only ever catch a leak someone has already met. On 2026-09-01 it
 *      printed its green with `name-words-lzw-worksheet.json` sitting in this tree at 2.2 MB,
 *      carrying 2,989 "hydra" / 731 "rentsync" / 400 "jamesgmarks" / 358 "Xero" occurrences. The
 *      file was invisible to (c) for one reason only: nobody had added its name to DERIVED. A guard
 *      that enumerates known leaks does not guard against the next one.
 *
 *      So ask the question the other way round, with no list to fall out of: corpus-derived output
 *      is by definition NOT tracked — that is what makes it dangerous and what makes it gitignored.
 *      Therefore every .json on disk in the engine tree must be tracked by git. Engine config is
 *      tracked; corpus spill is not. Measured when written: this flags exactly the worksheet and
 *      nothing else, and zero files once it moves to the corpus cache.
 *
 *      This is a CONTENT-INDEPENDENT check on purpose. It cannot be fooled by a leak that happens
 *      to carry no identifier we thought to grep for. */
ok("no untracked or ignored .json sits in the engine tree — the check with no allowlist", () => {
  const { execFileSync } = require("child_process");
  /* TWO queries, and it must be two. `--ignored` does not ADD ignored files to the untracked list,
   * it RESTRICTS the listing to only the ignored ones — so the single combined invocation this was
   * first written as reported gitignored spill and silently missed plain-untracked spill. Caught by
   * mutation, not by reading: dropping an un-ignored .json in this tree left the guard green.
   * Both categories are "not tracked", which is the property that matters, so both are asked for.
   * -z because a path may contain a space. */
  const ask = (extra) => {
    try {
      return execFileSync("git", ["ls-files", "-z", "--others", ...extra, "--exclude-standard", "--", "."],
        { cwd: ENGINE, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      /* No git, or not a work tree. Say so and do not pass silently — a guard that cannot run is
       * not a guard that holds, and that is the exact failure mode (c) had. */
      assert.fail(`could not ask git what is untracked here, so this guard did not run: ${e.message}`);
    }
  };
  const out = ask([]) + "\0" + ask(["--ignored"]);
  const spill = [...new Set(out.split("\0").filter(Boolean))]
    .filter((p) => p.endsWith(".json"))
    .filter((p) => !p.startsWith("node_modules/") && !p.includes("/node_modules/"));
  assert.deepStrictEqual(spill, [],
    `untracked/ignored .json inside the engine tree — corpus-derived output must resolve from the ` +
    `corpus root (PRD §8B, R-ART-1), and this repo's remote is PUBLIC:\n    ${spill.join("\n    ")}`);
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
        /* Any .json anchored to __dirname, not just the two directory names the first leak used.
         * `name-words-lzw.js:32` was `path.join(__dirname, "name-words-lzw-worksheet.json")` — a
         * bare filename, so the catalog|results pattern above never saw it. The engine tree holds
         * engine code and PRD; a .json it WRITES next to itself is corpus output in the wrong root.
         * Reads are the same hazard: they mean the file is expected to live here. */
        if (/path\.join\(\s*__dirname\s*,\s*"[^"]*\.json"/.test(line)) {
          bad.push(`${path.relative(ENGINE, p)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
  };
  scan(ENGINE);
  assert.deepStrictEqual(bad, [], `engine code writing corpus artifacts into the engine tree:\n    ${bad.join("\n    ")}`);
});

/* (e) Cross-check against the corpus. SPLIT DELIBERATELY, because the old single assertion
 *     conflated two different kinds of claim and the cheaper one held the stronger one hostage:
 *
 *       "an artifact PRESENT on disk is contract-valid and in its home"  <- a CONTRACT invariant,
 *          always true, always checkable, and the thing this file exists to enforce.
 *       "every registered kind exists right now"                        <- pipeline STATE, which
 *          depends on whether a mine has run, and which the registry cannot know.
 *
 *     Asserting the second turned a missing artifact into a failure of the first, so the runner
 *     gated the WHOLE FILE on `needs: "*"` and (a)-(d) -- the actual leak guard, the reason the
 *     header says "none of it had been pushed stops being luck" -- stopped running at all whenever
 *     any artifact was absent. A guard disabled by an unrelated absence is not a guard.
 *
 *     It also made the registry unextendable: registering a new kind turned this red until someone
 *     produced the file, so §7.0's gates could not be given artifacts. That is a contract guard
 *     preventing the contract from growing.
 *
 *     Existence is still enforced, one layer up and per test: run-tests.js declares each corpus
 *     test's prerequisites and SKIPS it by name when they are absent. A skip is loud and is not a
 *     pass -- which is the right place for a claim about state. */
ok("every artifact PRESENT on disk is contract-valid and in its declared home", () => {
  const checked = [];
  for (const kind of AC.kindsOf()) {
    const p = AC.pathFor(kind);
    if (!fs.existsSync(p)) continue;
    AC.load(kind, p);                                             // throws on any drift
    checked.push(kind);
  }
  assert.ok(checked.length > 0,
    `no registered artifact exists anywhere, so this assertion checked nothing — that is a STATE, ` +
    `not a contract breach, but it means the corpus is empty: run \`npm run mine\``);
  console.log(`      validated ${checked.length} present: ${checked.join(", ")}`);
});

/* (f) Absence is REPORTED, never silently tolerated. Naming the missing kinds is what keeps (e)
 *     from reading as "all clear" when it merely had little to check. */
ok("absent registered artifacts are named, not hidden", () => {
  const absent = AC.kindsOf().filter((k) => !fs.existsSync(AC.pathFor(k)));
  if (absent.length) console.log(`      absent (STATE, not failure): ${absent.join(", ")}`);
  assert.ok(Array.isArray(absent));
});

console.log(`\n${pass} assertions passed`);
