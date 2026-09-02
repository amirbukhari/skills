#!/usr/bin/env node
/* audit-rules.js — THE AUDIENCE FOR SILENT RULE MISMATCH.
 *
 * THE PROBLEM. Every rule in this engine is byte-gated. When a rule's catalog entry stops matching
 * current source, the gate declines and the file falls back to raw code. That is fail-safe and it is
 * not detection: nothing counts the refusals, nothing names them, and collapse degrades with no
 * signal at all. 05-architecture.md: "a catalog with no consumer on the byte-exact path is not a
 * layer; it is drift waiting for an audience."
 *
 * THIS IS THAT AUDIENCE. It renders the whole corpus with a refusal sink installed (engine/
 * refusals.js) and reports every rule that declined, on which files and spans, and why — while
 * re-checking byte-identity so a report can never be produced from a broken render.
 *
 * WHY THE DRIFT CHECK IS DIFFERENTIAL AND NOT A ZERO-CHECK. The obvious design is to count refusals
 * that mean "the catalog no longer matches these bytes" and demand zero. Measured, those two
 * counters (`parts-inexact`, `byte-gate`) cannot fire at all — the LZW dictionary is keyed on
 * canonical SYMBOLS and never supplies bytes, so a stale entry cannot produce a wrong file, only
 * fail to match, which surfaces as the ordinary `no-word`. See refusals.js UNREACHABLE for the
 * proof. Gating on them would publish a tautological zero (R-MECH-8) and call it a guard (§10.3).
 *
 * So drift is measured the only way it is observable: AGAINST A BASELINE. A rule whose refusal count
 * ROSE is a rule that used to match this corpus and stopped — which is exactly the silent
 * degradation this check was asked for. A rule whose count FELL is collapse improving, reported and
 * never failed. With no baseline on disk the audit reports and passes, and says so.
 *
 * USAGE
 *   node audit-rules.js                    prose report, compared to the baseline if one exists
 *   node audit-rules.js --json             NDJSON (sdd-progress/v1) on stdout, prose on stderr
 *   node audit-rules.js --write-baseline   record current counts as the baseline
 *   node audit-rules.js --baseline <path>  compare against a specific baseline file
 *   node audit-rules.js --limit 50         first 50 files (a fast smoke pass)
 *   node audit-rules.js --top 15           show 15 rule rows instead of 10
 *   node audit-rules.js --tolerance 5      allow a rule to gain up to 5 refusals before failing
 * EXIT: 0 clean, 1 drift against the baseline, 2 byte-identity broke (the report is not published).
 */
const fs = require("fs");
const path = require("path");
const EN = require("./engine/enfile");
const CR = require("./engine/corpus-root");
const REF = require("./engine/refusals");
const PROGRESS = require("./engine/progress");
const { SKIP } = require("./engine/walk-skip");

const argv = process.argv.slice(2);
const val = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt; };
const num = (flag, dflt) => { const v = val(flag, null); return v == null ? dflt : Number(v); };
const LIMIT = num("--limit", 0);
const TOP = num("--top", 10);
const TOLERANCE = num("--tolerance", 0);
const WRITE_BASELINE = argv.includes("--write-baseline");

const SRC = CR.sourceRoot();
const CORPUS = CR.corpusRoot();
/* The baseline lives under .cache/ (gitignored, regenerable) and is DELIBERATELY not dressed as a
 * registered artifact: hand-stamping a schema header onto an unregistered kind is the exact landmine
 * CLAUDE.md §8 warns about. It carries a plain self-describing note instead. */
const BASELINE = val("--baseline", path.join(CORPUS, ".cache", "spec-derived", "rule-refusals.baseline.json"));

const prog = PROGRESS.open({ step: "audit", argv });
const say = prog.say;

const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
  }
  return o;
};

const index = EN.loadIndex(CORPUS);
let src = walk(SRC);
if (LIMIT > 0) src = src.slice(0, LIMIT);

const col = REF.collector(3);
prog.start({ totalFiles: src.length, corpus: CORPUS, source: SRC, baseline: BASELINE, tolerance: TOLERANCE });

let byteExact = 0;
const broke = [];
/* The sink is installed for the WHOLE walk and removed after, rather than per file: `setFile` is
 * what scopes an event to a file, and a refusal recorded outside any file would be a bug worth
 * seeing as `file: null` rather than one silently dropped. */
const prevSink = REF.setSink(col.sink);
try {
  let seen = 0;
  for (const abs of src) {
    const rel = path.relative(SRC, abs);
    let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
    REF.setFile(rel);
    let r, back;
    try { r = EN.renderFileEn(source, index); back = EN.compileFileEn(r.en, index); }
    catch (e) { broke.push([rel, "THREW: " + e.message]); prog.file({ rel, done: ++seen, total: src.length, byteIdentical: false, why: "THREW", message: e.message }); continue; }
    if (back !== source) { broke.push([rel, "MISMATCH"]); prog.file({ rel, done: ++seen, total: src.length, byteIdentical: false, why: "MISMATCH" }); continue; }
    byteExact++;
    prog.file({ rel, done: ++seen, total: src.length, byteIdentical: true, refusals: col.total });
  }
} finally { REF.setFile(null); REF.setSink(prevSink); }

/* R-REND-1 FIRST. A refusal report derived from a render that does not round-trip describes an
 * engine that is already broken in a louder way; publishing rule counts off it would bury the real
 * failure under a tidy table. So the gate runs before the report and exits 2 if it fails. */
prog.gate({ name: "byte-identity", requirement: "R-REND-1", pass: broke.length === 0,
            files: src.length, byteIdentical: byteExact, failed: broke.length });
if (broke.length) {
  say("BYTE-IDENTITY BROKE — audit not published (" + broke.length + " of " + src.length + " files)");
  for (const [rel, why] of broke.slice(0, 10)) say("  " + rel + "  " + why);
  prog.end({ ok: false, why: "byte-identity" });
  process.exit(2);
}

const rep = col.report();

/* ---- the differential ---------------------------------------------------------------------- */
const keyOf = (r) => r.rule + " " + r.reason;
const counts = {};
for (const r of rep.rules) counts[keyOf(r)] = r.count;

let base = null;
if (!WRITE_BASELINE && fs.existsSync(BASELINE)) {
  try { base = JSON.parse(fs.readFileSync(BASELINE, "utf8")); } catch (e) { say("baseline unreadable (" + e.message + ") — reporting without comparison"); }
}
const worse = [], better = [];
if (base && base.counts) {
  for (const k of new Set([...Object.keys(counts), ...Object.keys(base.counts)])) {
    const now = counts[k] || 0, was = base.counts[k] || 0;
    if (now - was > TOLERANCE) worse.push({ key: k, was, now, delta: now - was });
    else if (now < was) better.push({ key: k, was, now, delta: now - was });
  }
  worse.sort((a, b) => b.delta - a.delta);
  better.sort((a, b) => a.delta - b.delta);
}
const pass = worse.length === 0;

prog.summary({ files: src.length, byteIdentical: byteExact,
               refusals: rep.total, refusalEvents: rep.events,
               baseline: base ? BASELINE : null,
               regressions: worse, improvements: better,
               reasons: rep.reasons.map((r) => ({ reason: r.reason, count: r.count, reachable: r.reachable })),
               rules: rep.rules.slice(0, TOP).map((r) => ({ rule: r.rule, reason: r.reason, count: r.count, files: r.files })),
               topFiles: rep.files.slice(0, TOP) });

say("");
say("RULE-REFUSAL AUDIT — " + src.length + " files, " + byteExact + " byte-identical");
say("  refused spans   " + rep.total + "   (from " + rep.events + " gate consultations)");
say("");
say("BY REASON");
for (const r of rep.reasons) {
  say("  " + String(r.count).padStart(7) + "  " + r.reason.padEnd(14) + (r.reachable ? r.means : "UNREACHABLE BY CONSTRUCTION — " + r.unreachableBecause));
}
say("");
say("BY RULE (top " + TOP + " of " + rep.rules.length + ")");
for (const r of rep.rules.slice(0, TOP)) {
  say("  " + String(r.count).padStart(7) + "  " + r.reason.padEnd(14) + r.rule + "   [" + r.files + " files]");
  for (const s of r.samples) say("            " + (s.file || "?") + ":" + s.start + "-" + s.end + (s.detail ? "  " + s.detail : ""));
}
say("");
say("BY FILE (top " + TOP + " of " + rep.files.length + ")");
for (const f of rep.files.slice(0, TOP)) say("  " + String(f.count).padStart(7) + "  " + f.file);
say("");

if (WRITE_BASELINE) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify({
    note: "Rule-refusal baseline for audit-rules.js. NOT a registered artifact: regenerable, gitignored, no contract header. Rewrite with --write-baseline.",
    recordedAt: new Date().toISOString(), files: src.length, total: rep.total, counts,
  }, null, 2) + "\n");
  say("baseline written  " + BASELINE + "  (" + Object.keys(counts).length + " rule rows, " + rep.total + " refusals)");
  prog.gate({ name: "no-rule-drift", requirement: "R-DRIFT-1", pass: true, note: "baseline written, not compared" });
  prog.end({ ok: true, wroteBaseline: true });
  process.exit(0);
}

if (!base) {
  say("NO BASELINE at " + BASELINE);
  say("  Drift in this layer is only observable as a CHANGE (see the header). Record one with");
  say("  --write-baseline, and this audit starts failing when a rule stops matching.");
  prog.gate({ name: "no-rule-drift", requirement: "R-DRIFT-1", pass: true, note: "no baseline recorded — nothing to compare" });
  prog.end({ ok: true, baseline: null });
  process.exit(0);
}

prog.gate({ name: "no-rule-drift", requirement: "R-DRIFT-1", pass, regressions: worse.length,
            improvements: better.length, tolerance: TOLERANCE });
for (const b of better) say("  improved  " + b.was + " -> " + b.now + "  " + b.key);
if (pass) say("PASS — no rule refuses more than it did at baseline (" + better.length + " improved).");
else {
  say("FAIL — " + worse.length + " rule(s) refuse MORE than at baseline; each used to match this corpus:");
  for (const w of worse) say("  " + w.was + " -> " + w.now + "  (+" + w.delta + ")  " + w.key);
}
prog.end({ ok: pass, regressions: worse.length });
process.exit(pass ? 0 : 1);
