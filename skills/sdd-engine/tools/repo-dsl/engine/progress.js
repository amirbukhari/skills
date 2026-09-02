"use strict";
/**
 * progress.js — the NDJSON PROGRESS STREAM (PRD §5D.5, R-UI-1..3).
 *
 * WHY THIS EXISTS ALONGSIDE sdd-run.js, WHICH ARGUES AGAINST IT. sdd-run.js's header says "WHY A
 * WRAPPER AND NOT --json ON ELEVEN SCRIPTS", and that reasoning still holds for what it does: it
 * hands a UI ONE envelope, AFTER a step finishes, without touching a pipeline script. What it
 * cannot do is tell a UI what is happening WHILE a step runs — it spawns a child and reads its
 * output when it exits, so a 5-second render and a 5-minute one look identical until they end.
 *
 * Amir asked for progress (2026-09-01, for Kraken's SDD panel), and progress is a stream, not an
 * envelope. So this is the complement of sdd-run, not a competitor: sdd-run remains the way to ASK
 * for a step and to learn how it ended; this is how a step says what it is doing meanwhile. The two
 * are wired to agree — an `end` event's `ok` is `exitCode === 0`, the same rule sdd-run applies.
 *
 * THE CONTRACT.
 *   • With --json, STDOUT carries ONE JSON DOCUMENT PER LINE and nothing else, and the script's
 *     prose moves to STDERR. That is sdd-run's contract exactly (stdout machine, stderr log), so a
 *     UI parses one stream the same way whichever entry point it used.
 *   • WITHOUT --json, nothing changes AT ALL: not one byte moves, prose stays on stdout, and this
 *     module emits nothing. Existing callers cannot tell it was added. The byte-identity path is
 *     never on the emitting side of anything here — events are written from values the pipeline
 *     already computed, never from values computed for them.
 *   • Every line carries `schema`, `step`, `event` and `seq`. `seq` is monotonic from 0 per
 *     process, so a consumer can detect a dropped or reordered line without timestamps.
 *
 * WHY ONE MODULE AND NOT TWO EMITTERS. Two scripts writing the same shape from two places is the
 * producer/consumer drift shape (PRD §8B) with the UI as the consumer — the event that gains a
 * field in one script and not the other is exactly the bug that shape produces. One definition,
 * imported by both, and one test asserting the shape for both.
 */
const SCHEMA = "sdd-progress/v1";

/* The event vocabulary, closed on purpose. A UI switches on these, and a name invented at a call
 * site is a name no consumer knows. `emit` refuses anything not in this set. */
const EVENTS = Object.freeze([
  "start",     // the step began: what it is about to do, and how much of it there is
  "phase",     // a named stage within the step began or ended (mine: walk, parse, build, write)
  "file",      // one unit of work finished (render: one file; mine: one file parsed)
  "gate",      // a PASS/FAIL judgement — byte-identity is one; a non-empty vocabulary is another
  "summary",   // the step's measured numbers, once, near the end
  "end",       // the step finished; `ok` is exitCode === 0
  "error",     // an unrecoverable failure, emitted before a non-zero exit
]);

function open(opts) {
  const argv = (opts && opts.argv) || process.argv;
  const step = (opts && opts.step) || "step";
  const enabled = argv.includes("--json");
  const t0 = Date.now();
  let seq = 0;

  /* Prose. Identical text either way — only the stream changes, and only under --json. Scripts
   * call this instead of console.log so that "keep the prose working" is enforced by construction
   * rather than by remembering. */
  const say = (...a) => { if (enabled) console.error(...a); else console.log(...a); };

  const emit = (event, body) => {
    if (!enabled) return;
    if (!EVENTS.includes(event)) throw new Error(`progress: unknown event ${JSON.stringify(event)} — the vocabulary is closed (${EVENTS.join(", ")})`);
    const doc = { schema: SCHEMA, step, event, seq: seq++, ms: Date.now() - t0, ...body };
    process.stdout.write(JSON.stringify(doc) + "\n");
  };

  return {
    enabled, say, step, schema: SCHEMA,
    /* EXPOSED so the closed vocabulary is a guard rather than dead code. Reached only through the
     * named helpers below, `emit`'s refusal could never fire and so would not be a guard at all
     * (§10.3). A future step that needs an event adds it to EVENTS and gets a helper; passing a
     * name straight through is how the refusal is exercised, and it is what the test does. */
    emit,
    start: (b) => emit("start", b || {}),
    phase: (b) => emit("phase", b || {}),
    /* PER UNIT, NOT SAMPLED. A UI wants the name of the file it is on, and 1,037 short lines is
     * nothing next to the 4 MB of catalog the same run reads. Sampling would also make the stream
     * lossy in the one case it matters — the file that fails is the file you want named. */
    file: (b) => emit("file", b || {}),
    gate: (b) => emit("gate", b || {}),
    summary: (b) => emit("summary", b || {}),
    error: (b) => emit("error", b || {}),
    end: (b) => emit("end", Object.assign({ ok: !(b && b.exitCode) }, b || {})),
  };
}

module.exports = { open, SCHEMA, EVENTS };
