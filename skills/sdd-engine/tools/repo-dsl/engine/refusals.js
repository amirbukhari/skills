/* REFUSAL RECORDER — making silent rule mismatch VISIBLE (§8B, 05-architecture.md).
 *
 * WHY THIS EXISTS. Every collapse in this engine is byte-gated: a rule may only apply if what it
 * would emit refills to the exact source bytes. That gate is fail-SAFE — when a rule's catalog
 * entry stops matching current source, the rule simply declines and the file falls back to raw
 * code. Nothing is wrong; nothing is reported either. Collapse degrades silently, and the PRD names
 * the shape: "a catalog with no consumer on the byte-exact path is not a layer; it is drift waiting
 * for an audience" (05-architecture.md).
 *
 * This module is that audience. It does NOT change a single decision — it only writes down which
 * rule declined, on which file and span, and why. A refusal is not a failure: most of them are the
 * engine correctly saying "no rule is written for this yet." The point is that the count and the
 * names exist, so a rule that USED to fire and stopped is a visible number and not a mood.
 *
 * OFF BY DEFAULT. The render path calls `record()` on every refusal, which is a null check when no
 * sink is installed. `audit-rules.js` installs one; `write-en-files.js` never does.
 */

/* CLOSED VOCABULARY, same discipline as progress.js — a reason not on this list is a bug in the
 * caller, not a new category invented at a call site. Each entry says what the refusal MEANS, since
 * the whole value of the report is that a reader can tell drift from an unwritten rule. */
const REASONS = Object.freeze({
  "no-symbol":     "a statement in the run has no canonical symbol on this axis — the miner never saw this node shape",
  "no-word":       "the run canonicalizes, but the dictionary holds no word covering it — never mined, or mined below MIN_COUNT",
  "parts-inexact": "a word exists, but the skeleton could not be refilled from this source — the catalog entry no longer matches these bytes (DRIFT)",
  "byte-gate":     "the skeleton refilled, but not to the original bytes — the catalog entry matches shape and not text (DRIFT)",
  "rule-declined": "a node-kind chunk rule matched the kind and then refused the run — an unwritten case, not a mismatch",
  "gloss-refused": "the run has a word, but no sayable English — R-ARCH-17 refuses to name it",
});
const REASON_NAMES = Object.freeze(Object.keys(REASONS));

/* REASONS THAT CANNOT FIRE ON THE CURRENT PATH, and why — stated here rather than discovered again.
 *
 * It is tempting to call `parts-inexact` and `byte-gate` "the drift counters" and gate on them being
 * zero. They are zero, and they are zero BY CONSTRUCTION: `runWord` establishes that every statement
 * canonicalizes before it calls `windowParts` (so windowParts cannot return null), and every part
 * list is self-verified `fillOf === exact source slice` inside `stmtPartsExact` / `genericExact`
 * with gaps carrying literal source trivia (so the refill cannot differ from the slice). A gate on a
 * counter that cannot move is a tautological number, which R-MECH-8 forbids publishing and §10.3
 * calls not-a-guard.
 *
 * The deeper fact they teach: the LZW dictionary is keyed on canonical SYMBOLS and never supplies
 * bytes — the fill always comes from live source. So a stale catalog entry cannot make a wrong file;
 * it can only stop matching, and that shows up as `no-word`. Drift in this layer is therefore not
 * observable in a single run at all. It is observable only DIFFERENTIALLY: a rule whose refusal
 * count ROSE against a recorded baseline is a rule that used to match this corpus and stopped.
 * That is what audit-rules.js gates on; these two stay in the vocabulary, reported as unreachable,
 * so the day someone changes the ordering in runWord the claim is on the page to be falsified. */
const UNREACHABLE = Object.freeze({
  "parts-inexact": "runWord proves every statement canonicalizes before calling windowParts, so it cannot return null",
  "byte-gate": "every part list is self-verified fillOf === exact source slice (stmtPartsExact/genericExact) and gaps are literal trivia, so the refill cannot differ",
});

let SINK = null;
let FILE = null;

/* `setSink(fn)` returns the previous sink so a caller can restore it — audits nest (a test installs
 * one inside a render that installed another) and a plain assignment would strand the outer one. */
function setSink(fn) { const prev = SINK; SINK = fn || null; return prev; }
function setFile(rel) { const prev = FILE; FILE = rel == null ? null : String(rel); return prev; }
function active() { return SINK !== null; }

function record(ev) {
  if (SINK === null) return;
  if (!Object.prototype.hasOwnProperty.call(REASONS, ev.reason)) {
    throw new Error("refusals: unknown reason '" + ev.reason + "' (known: " + REASON_NAMES.join(", ") + ")");
  }
  if (!ev.rule) throw new Error("refusals: every refusal must name a rule (reason '" + ev.reason + "')");
  SINK({ rule: String(ev.rule), reason: ev.reason, file: ev.file == null ? FILE : String(ev.file),
         start: ev.start == null ? null : ev.start | 0, end: ev.end == null ? null : ev.end | 0,
         stmts: ev.stmts == null ? null : ev.stmts | 0,
         axis: ev.axis == null ? null : String(ev.axis), detail: ev.detail == null ? null : String(ev.detail) });
}

/* A collector: counts everything, keeps a bounded sample of spans per (rule, reason) so the report
 * can NAME instances without holding a million objects. `cap` is per bucket, not global. */
function collector(cap = 3) {
  const buckets = new Map(); // key -> {rule, reason, count, files:Set, samples:[]}
  const byReason = new Map();
  const byFile = new Map();
  const seen = new Set();
  let total = 0, events = 0;
  const sink = (ev) => {
    events++;
    /* COUNT SPANS, NOT ATTEMPTS. The renderer asks the same question about the same span many times
     * (every candidate window in the scheduler consults the same gate), so raw event counts measure
     * how hard the scheduler tried, not how much collapse was lost. The published `count` is
     * distinct (rule, reason, file, span); `events` keeps the raw total so the ratio is not hidden. */
    const id = ev.rule + "\u0000" + ev.reason + "\u0000" + ev.file + "\u0000" + ev.start + "\u0000" + ev.end;
    if (seen.has(id)) return null;
    seen.add(id);
    total++;
    const key = ev.rule + " " + ev.reason;
    let b = buckets.get(key);
    if (!b) { b = { rule: ev.rule, reason: ev.reason, count: 0, files: new Set(), samples: [] }; buckets.set(key, b); }
    b.count++;
    if (ev.file) b.files.add(ev.file);
    if (b.samples.length < cap) b.samples.push({ file: ev.file, start: ev.start, end: ev.end, stmts: ev.stmts, axis: ev.axis, detail: ev.detail });
    byReason.set(ev.reason, (byReason.get(ev.reason) || 0) + 1);
    if (ev.file) byFile.set(ev.file, (byFile.get(ev.file) || 0) + 1);
    return b;
  };
  const report = () => {
    const rules = [...buckets.values()]
      .map((b) => ({ rule: b.rule, reason: b.reason, count: b.count, files: b.files.size, samples: b.samples }))
      .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
    /* R-MECH-8: a reason that never fired is published as 0 rather than omitted — an absent row and
     * a zero row read the same to a human, and only one of them proves the counter was wired. */
    const reasons = REASON_NAMES.map((r) => ({ reason: r, count: byReason.get(r) || 0, means: REASONS[r],
                                               reachable: !UNREACHABLE[r], unreachableBecause: UNREACHABLE[r] || null }));
    return { total, events, reasons, rules,
             files: [...byFile.entries()].map(([file, count]) => ({ file, count })).sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)) };
  };
  return { sink, report, get total() { return total; } };
}

module.exports = { REASONS, REASON_NAMES, UNREACHABLE, setSink, setFile, active, record, collector };
