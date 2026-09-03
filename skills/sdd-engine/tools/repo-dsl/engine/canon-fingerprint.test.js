/* canon-fingerprint.test.js — THE CANON GATE, AND PROOF THAT IT FIRES.
 *
 * §10.3: a guard that cannot be shown to fire is not a guard. This one exists because of a failure
 * that ran for a day with every check green, so it is held to that standard in both directions —
 * it must FIRE on a canon change and must STAY SILENT on a mining-parameter change.
 *
 * THE FAILURE, for the record. `SDD_BODY_SLOT` shipped default-on in 2d83452, changing what a
 * statement canonicalizes to. Every catalog on disk had been mined under the old canon, so every
 * skeleton lookup missed. The corpus rendered at 3,527 top / 23,935 tree against a 1,582 / 20,999
 * baseline and NOTHING said so, because:
 *   - byte-identity read 1037/1037 throughout (a missed lookup falls through to verbatim, which is
 *     correct by construction) — and byte-identity is the floor every other test asserts first;
 *   - an mtime staleness edge cannot see it, because no ARTIFACT moved. The code moved underneath an
 *     artifact whose mtime is honestly unchanged. It is not stale with respect to any file.
 *
 * WHY THE FINGERPRINT IS BEHAVIOURAL. Hashing the canon's source files would fire on every comment
 * edit, and a guard that cries wolf gets switched off. This one hashes what the canon PRODUCES for a
 * frozen probe set, so it moves exactly when two builds would key the dictionary differently.
 *
 * SUBPROCESSES, NOT `process.env` MUTATION. The dials are read at module load, so setting them in
 * this process after the fact would test nothing — the classic vacuous-guard shape. Each case spawns
 * a real node with a real environment.
 */
const { execFileSync } = require("child_process");
const path = require("path");
const CANON = require("./canon-fingerprint");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
const ne = (a, b, m) => ok(a !== b, m + "  (both were " + JSON.stringify(a) + ")");

const ENGINE = __dirname;
/* the fingerprint AS COMPUTED BY A FRESH PROCESS under `env` — the only honest way to vary a dial
 * that is read once at require time. */
const fpUnder = (env) => execFileSync(process.execPath,
  ["-e", "console.log(require(" + JSON.stringify(path.join(ENGINE, "canon-fingerprint.js")) + ").fingerprint())"],
  { env: Object.assign({}, process.env, env), encoding: "utf8" }).trim();

/* ---- 1. it is a function of the canon, and stable ---------------------------------------------- */
const base = CANON.fingerprint();
eq(typeof base, "string", "fingerprint() returns a string");
eq(base.length, 16, "fingerprint() is 16 hex chars");
eq(CANON.fingerprint(), base, "fingerprint() is stable across calls in one process");
eq(fpUnder({}), base, "a fresh process with the same environment agrees");

/* ---- 2. IT FIRES: every canon dial moves it ---------------------------------------------------- */
const bodyOff = fpUnder({ SDD_BODY_SLOT: "0" });
const exprOn = fpUnder({ SDD_EXPR_SLOT: "1" });
const both = fpUnder({ SDD_BODY_SLOT: "0", SDD_EXPR_SLOT: "1" });
ne(bodyOff, base, "SDD_BODY_SLOT changes the canon fingerprint (the 2d83452 failure)");
ne(exprOn, base, "SDD_EXPR_SLOT changes the canon fingerprint");
ne(both, bodyOff, "the two dials are distinguishable from each other, not just from the default");
ne(both, exprOn, "the two dials compose into a third distinct canon");
eq(new Set([base, bodyOff, exprOn, both]).size, 4, "all four canon combinations are distinct");

/* ---- 3. IT DOES NOT OVER-FIRE: mining parameters are not canon --------------------------------- */
/* §10 (10-language-and-grammar.md:42), read and not relayed: because names key on the canonical
 * skeleton and NEVER on the word id, "retuning MAXWIN, MIN_COUNT or MIN_SKEL cannot orphan a name".
 * Those dials change WHICH words get promoted, never what a statement canonicalizes TO. If this
 * assertion ever fails, either the fingerprint has started hashing the wrong thing or §10's property
 * has been broken — and both are worth stopping for. */
/* PROBE A NON-DEFAULT VALUE. This read `MIN_SKEL: "1"` until 2026-09-03, when R-MINE-3 amended the
 * default from 8 to 1 -- at which point it was setting the dial to what it already was and asserting
 * that nothing changed. A tautology, and it would have stayed green through any breakage. Same defect
 * class as the header-prose `indexOf` in orphan-ledger.test.js: a guard that cannot fire (§3, §16).
 * If the default moves again, move these. */
eq(fpUnder({ MIN_SKEL: "8" }), base, "MIN_SKEL does not change the canon (it is a mining parameter, §10:42)");
eq(fpUnder({ MIN_COUNT: "2" }), base, "MIN_COUNT does not change the canon (§10:42)");
eq(fpUnder({ MAXWIN: "64" }), base, "MAXWIN does not change the canon (§10:42)");

/* ---- 4. the probes actually exercise the canon ------------------------------------------------- */
/* A fingerprint over probes that all canonicalize to "(none)" would be perfectly stable and
 * perfectly useless — it would hash twenty failures. */
const table = CANON.describe();
eq(table.length, CANON.PROBES.length, "describe() reports one row per probe");
const inert = table.filter((r) => r.skeletons.every((s) => /=\(none\)$|=\(threw/.test(s)));
eq(inert.length, 0, "every probe produces at least one real skeleton (none are inert or throwing)");
const holed = table.filter((r) => r.skeletons.some((s) => /‹\w+›/.test(s)));
ok(holed.length >= CANON.PROBES.length - 2, "nearly every probe produces holes, i.e. it reached the canonicalizer"
  + "  (" + holed.length + " of " + CANON.PROBES.length + ")");

console.log("\n  CANON FINGERPRINTS");
console.log("    default (BODY_SLOT on, EXPR_SLOT off)  " + base);
console.log("    SDD_BODY_SLOT=0                        " + bodyOff);
console.log("    SDD_EXPR_SLOT=1                        " + exprOn);
console.log("    both flipped                           " + both);
console.log("    MIN_SKEL / MIN_COUNT / MAXWIN          " + base + "   (unchanged, correctly)");
/* §10:42 says retuning these "cannot orphan a name". Measured 2026-09-03 at corpus scale, and it
 * holds for CHUNK names too, which was not obvious -- a chunk key hashes the ordered LEAF LIST of a
 * composite, and mining parameters do change which words get promoted. MIN_SKEL 8 -> 1 orphaned 0
 * chunk names and re-resolved 19. SDD_EXPR_SLOT, which IS a canon change, orphaned 299. */

console.log("\n" + pass + " passed, " + fail + " failed");
