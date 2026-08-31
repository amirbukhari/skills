"use strict";
/**
 * clause-quality.js — the two FROZEN metrics for "does the .en read as English".
 *
 * Both read the EMITTED LABEL REGION only (between ▶ and ⟪). compileChunk locates the payload with
 * lastIndexOf(PAY_OPEN) and never reads a label, so neither metric can touch byte-identity — they
 * measure the artifact, they do not participate in it. Extracted into their own module so they are
 * testable and mutation-checkable without a corpus walk (same shape as uncollapsed-density.js).
 *
 * (i) THE FROZEN VACUOUS CLAUSE SET. These are the exact strings spanProse emits when it has
 *     nothing site-specific to say — "run a step", "compute a value". They are what this whole
 *     effort exists to replace. The metric is a COUNT of emitted clauses that are one of them, and
 *     the target is ZERO. The set is frozen: a production that stops emitting one of these must do
 *     so by saying something true, never by rewording the placeholder. Adding a string here is a
 *     spec change and must be argued, not a convenience.
 *
 * (ii) ENGLISH-COMPLETENESS. A clause is English-complete iff, after removing the parts that are
 *     DELIBERATELY verbatim source — `backticked` identifiers and “curly-quoted” literals — no
 *     TypeScript syntax remains. This is the guard against the failure mode the frozen set cannot
 *     see: a template that quotes a hole so large the sentence is code wearing a sentence's
 *     clothes. `await `rows` from getManager` passes; `compute `x` = rows.map((r) => r.id)` does
 *     not, and should not.
 */

/* (i) FROZEN — do not extend without arguing it. Every string here is a spanProse output that
 * carries no information from the site it describes. */
/* A frozen ARRAY, not a frozen Set: Object.freeze on a Set does NOT stop .add(), so a "frozen"
 * Set would have been a claim the code did not keep. The array is genuinely immutable and the
 * lookup Set is built from it and never exported. */
const VACUOUS = Object.freeze([
  "run a step",
  "call a step",
  "await a step",
  "compute a value",
  "return the result",
  "branch on a condition",
  "loop",
  "run a try/catch",
  "switch on a value",
  "throw an error",
  "log a message",
  "define a value",
  "a check fails",
]);
const VACUOUS_LOOKUP = new Set(VACUOUS);

/* A label is a joined list of clauses; split it back into the clauses the metric counts.
 * spanProse joins with ", " / " then " and appends guards after " — ". */
function clausesOf(label) {
  return String(label)
    .split(/\s+—\s+failing when\s+/)[0]
    .split(/,\s+then\s+|\s+then\s+|,\s+/)
    .map((c) => c.replace(/\s*\(×\d+\)\s*$/, "").trim())
    .filter(Boolean);
}

function isVacuous(clause) { return VACUOUS_LOOKUP.has(String(clause).trim()); }

/* (ii) Strip what is deliberately verbatim, then look for surviving TypeScript.
 * `(×7)` is a prose idiom this renderer emits for a collapsed run of identical clauses — it is
 * not source, so it is removed before the scan rather than counted as a stray parenthesis. */
const VERBATIM = /`[^`]*`|“[^”]*”/g;
/* Prose idioms this renderer emits deliberately, stripped AFTER the verbatim spans so that a
 * parenthesis whose contents were a backticked name is judged on what is left. Both are bounded:
 * `(×7)` is a collapsed run, and `(int)` / `(enum )` is a type word. Neither can admit code — a
 * comma, colon, dot or operator inside the parentheses fails the class and the clause is flagged. */
const IDIOMS = /\(×\d+\)|\([A-Za-z][A-Za-z0-9 ]*\)/g;
/* Every alternation here is LOAD-BEARING, established by dropping each and re-running the suite:
 * the character class, `?.`, and member access each turn it red on their own. `=>` and `::` were
 * removed — `=>` is already caught by `>`, and `::` is not TypeScript syntax at all. A regex with
 * dead alternations reads like more coverage than it has. */
const TS_SYNTAX = /[{}()[\];=<>|&]|\?\.|\w\.\w/;

function residueOf(label) { return String(label).replace(VERBATIM, " ").replace(IDIOMS, " "); }
function isEnglishComplete(label) { return !TS_SYNTAX.test(residueOf(label)); }

module.exports = { VACUOUS, clausesOf, isVacuous, isEnglishComplete, residueOf, TS_SYNTAX, IDIOMS };
