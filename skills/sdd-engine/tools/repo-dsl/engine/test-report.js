"use strict";
/* test-report.js — what a test PRINTS, in English. One owner, so the failure path cannot drift.
 *
 * Amir, 2026-09-04: "Start with editing the tests results to be fully English". The results are the
 * surface he reads. A test whose green line is a slug and whose red line is a stack trace is a test
 * that reports to the author and not to the reader.
 *
 * WHY THIS IS A MODULE AND NOT SIX EDITS. Every test in this tree had copied the same one-line
 * reporter, and every copy printed `e.message` (one of them `e.stack`) as the whole story of a
 * failure. Six copies means six chances for the failure path to rot, and the failure path is the one
 * nobody looks at until the day it matters. It is written once here and shown able to fire.
 *
 * WHAT IT WILL NOT DO. It does not touch what an assertion CHECKS. Renaming is not loosening: every
 * condition that fired before this module existed fires on exactly the same input afterwards. The
 * module only decides how the outcome is worded.
 *
 * THE FOUR THINGS A FAILURE MUST SAY, and they are said before any stack:
 *   what should have happened   from the assertion's own message when it has one
 *   what happened instead       the actual value, described rather than dumped
 *   where                       the line IN THE TEST, not the deepest frame in node internals
 *   the stack                   last, indented, clearly subordinate
 *
 * NO DIALECT CHARACTER REACHES THE TERMINAL. A value being reported may contain the marks -- it is
 * an artifact of the language being tested -- so they are replaced with their English names on the
 * way out (`describe`). The information survives; the glyph does not. This is the one place the
 * marks are spelled, and they are spelled as the KEYS of a table whose values are the words. */
const path = require("path");

/* The dialect, named. Spelled here so no test file has to spell it. */
const MARK_NAMES = new Map([
  ["«", "[chunk opens]"], ["»", "[chunk closes]"],
  ["▶", "[atomic]"], ["▷", "[structural]"],
  ["⟪", "[payload opens]"], ["⟫", "[payload closes]"],
  ["⟨", "[hole]"], ["⟩", "[hole ends]"],
  ["⟦", "[span opens]"], ["⟧", "[span closes]"],
]);
const MARKS_RE = new RegExp("[" + [...MARK_NAMES.keys()].join("") + "]", "g");

/** replace every dialect mark in a string with its English name, and cap runaway values */
function describe(v, limit = 240) {
  let s = typeof v === "string" ? v : require("util").inspect(v, { depth: 2, breakLength: 100 });
  s = s.replace(MARKS_RE, (m) => MARK_NAMES.get(m));
  /* A rendered clause quotes the names it carries in back-ticks. The back-tick is a TypeScript
   * character, so it comes off and the name is printed bare. What can still be left inside a name is
   * whatever the CORPUS called it -- that residue is the finding, not the reporter's doing. */
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/\n/g, "\\n");
  if (s.length > limit) s = s.slice(0, limit) + ` ... (${s.length} characters in all, shown to ${limit})`;
  return s;
}

/** the frame in the TEST file, which is the line the reader can actually go and open */
function whereItFailed(err, testFile) {
  const base = path.basename(testFile);
  for (const line of String(err.stack || "").split("\n").slice(1)) {
    if (!line.includes(base)) continue;
    const at = line.match(/(\d+):\d+\)?\s*$/);
    return at ? `${base}, line ${at[1]}` : base;
  }
  return null;
}

/**
 * A suite reporter.
 * @param {string} testFile  __filename of the caller, so failures can name the line in it
 */
function report(testFile) {
  let passed = 0, failed = 0, pending = 0;
  /* Counts measured INSIDE an assertion are held until its own line has printed, so the evidence
   * reads underneath the claim it supports rather than above it. */
  let inAssertion = false, held = [];
  const flush = () => { for (const l of held) console.log(`            ${l}`); held = []; };

  /** an assertion. `name` must read as a complete sentence stating the property. */
  const ok = (name, fn) => {
    inAssertion = true;
    try {
      fn();
      inAssertion = false;
      passed++;
      console.log(`  ok        ${name}`);
      flush();
    } catch (err) {
      inAssertion = false;
      failed++;
      process.exitCode = 1;
      console.error(`  FAILED    ${name}`);
      /* Node sets generatedMessage=false when the assertion carried its own sentence. That sentence
       * was written to be read, so it becomes the headline; a generated one never is. */
      if (err.generatedMessage === false && err.message) {
        /* A hand-written message may carry a LIST underneath its sentence. Escaping those newlines
         * turned twelve readable findings into one unreadable line, so the first line is the
         * headline and the rest are indented under it, uncapped -- a list of what failed is the
         * whole point of the message and truncating it would hide findings. */
        const [headline, ...rest] = String(err.message).split("\n");
        console.error(`            What should have happened: ${describe(headline, 400)}`);
        for (const l of rest) if (l.trim()) console.error(`              ${describe(l.trim(), 400)}`);
      } else if (err instanceof (require("assert").AssertionError)) {
        console.error(`            Expected: ${describe(err.expected)}`);
        console.error(`            Instead:  ${describe(err.actual)}`);
      } else {
        console.error(`            Nothing was checked: the test itself threw ${err.name}.`);
        console.error(`            It said: ${describe(err.message, 400)}`);
      }
      /* A hand-written message often already contains both halves. The values are added underneath it
       * only when they say something the sentence does not -- assert.ok's expected is the literal
       * `true`, which is noise, so it is left out. */
      if (err.generatedMessage === false && typeof err.expected !== "boolean" && err.expected !== undefined) {
        console.error(`            Expected: ${describe(err.expected)}`);
        console.error(`            Instead:  ${describe(err.actual)}`);
      }
      const where = whereItFailed(err, testFile);
      console.error(`            Where: ${where || "the line could not be recovered from the stack"}.`);
      /* An AssertionError's `stack` BEGINS with its message, so slicing by line number printed the
       * message a second time and called it a stack. Take only real frames. */
      /* The reporter's own frames are never the answer, so they are dropped rather than shown at the
        * top where the reader looks first. */
      const frames = String(err.stack || "").split("\n")
        .filter((l) => /^\s+at /.test(l) && !l.includes("test-report.js")).slice(0, 5);
      if (frames.length) {
        console.error(`            The stack follows, below the English, only if it is needed:`);
        for (const l of frames) console.error(`              ${l.trim()}`);
      }
      flush();
    }
  };

  /** a heading over a group of assertions, in words rather than a row of dashes */
  const section = (title) => console.log(`\n  ${title}`);

  /** the condition-first form, for suites written that way. Same condition, English outcome. */
  const check = (condition, property) => ok(property, () => {
    if (!condition) {
      /* A condition-first assertion has no two values to show, so it says where to look instead of
        * inventing detail it does not have: the count line printed just above it is the evidence. */
      const e = new Error("the property named above did not hold; the line printed just above it says what happened instead");
      e.generatedMessage = false;
      throw e;
    }
  });

  /** the condition-first form that has two values worth printing */
  const checkEqual = (actual, expected, property) => ok(property, () => {
    require("assert").strictEqual(actual, expected,
      `${property} — instead the value was ${describe(actual)} where ${describe(expected)} was required`);
  });

  /** a counted result, in a sentence. Every number stays exactly as measured. */
  const count = (sentence) => { if (inAssertion) held.push(sentence); else console.log(`            ${sentence}`); };

  /** a property that is RED BY DESIGN. Never a pass, never a failure, and it says which. */
  const expectedPending = (name, why) => {
    pending++;
    console.log(`  PENDING   ${name}`);
    console.log(`            This is red on purpose and does not fail the run. ${why}`);
  };

  /** the summary. Says WHAT passed, and keeps expected-pending separate from both other outcomes. */
  const done = (whatTheseCover) => {
    const total = passed + failed;
    const parts = [];
    parts.push(failed === 0
      ? `All ${total} properties hold${whatTheseCover ? " for " + whatTheseCover : ""}.`
      : `${passed} of ${total} properties hold; ${failed} did not${whatTheseCover ? " for " + whatTheseCover : ""}.`);
    parts.push(pending === 0
      ? "Nothing here is expected-pending."
      : `${pending} further ${pending === 1 ? "property is" : "properties are"} expected-pending: red by design, and not counted as either.`);
    console.log("\n" + parts.join(" "));
  };

  /* Work done OUTSIDE an assertion -- building a fixture, say -- can throw, and an uncaught throw
   * kills the process before a single line of English is printed. That is the worst possible
   * failure output, so setup gets the same treatment as an assertion: reported, and still red. */
  const setUp = (what, fn) => {
    try { return fn(); }
    catch (err) {
      failed++;
      process.exitCode = 1;
      console.error(`  FAILED    ${what}`);
      console.error(`            Nothing could be checked past this point: preparing it threw ${err.name}.`);
      console.error(`            It said: ${describe(String(err.message).split("\n")[0], 400)}`);
      const w = whereItFailed(err, testFile);
      console.error(`            Where: ${w || "the line could not be recovered from the stack"}.`);
      return null;
    }
  };

  return { ok, check, checkEqual, section, count, expectedPending, done, setUp, describe };
}

module.exports = { report, describe, MARK_NAMES };
