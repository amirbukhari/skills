#!/usr/bin/env node
"use strict";
/**
 * name-words-lzw.js — Tier-2 WORKSHEET for the RECURSIVE WORD DICTIONARY
 * (catalog/generators-lzw.json), the recursive counterpart of name-generators.js.
 *
 * Tier 1 (shipped) renders a composed span's label deterministically from the code at that site.
 * Tier 2 wants a STABLE domain name per catalog WORD, authored once by Amir and reused at every
 * site the word appears. This tool emits the WORKSHEET only — it does NOT apply names. The apply
 * step (a `name` field on catalog words, render preferring `word.name` over Tier-1 prose) is a
 * separate, deliberate pass: a generated name Amir did not choose is worse than no name at all.
 *
 * A recursive span's payload is {a:axis, w:wordId, h:holes}; the span covers exactly wordId's
 * statement window, so that span's Tier-1 label IS the word's current rendered prose. For every
 * DISTINCT top-level emitted word we record: axis+id, depth, occurrence count (how many emitted
 * spans have this word as their top word), the Tier-1 prose it renders as, a real source snippet
 * from its first site, and a PROPOSED name (a suggestion for Amir to edit, with a confidence tag).
 * Rows are ordered by occurrence desc so the highest-leverage names sit at the top.
 *
 *   node name-words-lzw.js worksheet [--top N]
 *       -> writes <corpus>/.cache/spec-derived/name-words-lzw-worksheet.json
 * Deterministic; zero model calls. Corpus is read-only. The naming itself is Amir's pass.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./engine/enfile");
const EL = require("./engine/enlzw");
const CR = require("./engine/corpus-root");
const AC = require("./engine/artifact-contract");

const CORPUS = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root: the .ts tree
/* PRD §8B / R-ART-1: this worksheet is CORPUS-DERIVED — its rows carry verbatim identifiers and
 * source snippets mined out of SOURCE — so it lives with the corpus, never in the engine tree,
 * whose remote is public. It was `path.join(__dirname, ...)` until 2026-09-01 and sat here at
 * 2.2 MB carrying 2,989 "hydra" / 731 "rentsync" / 400 "jamesgmarks" occurrences; only a
 * hand-written .gitignore line kept it off the remote, and §9.4 is explicit that documenting a
 * risk is not a control. It is purely derived (a re-run rebuilds it), so it takes the `cache`
 * home. The layout string comes from AC.HOMES — a second spelling of it is how one kind ends up
 * written to two places (repo-dsl.js:56). */
const WORKSHEET = path.join(CORPUS, AC.HOMES.cache, "name-words-lzw-worksheet.json");
const { SKIP } = require("./engine/walk-skip");   // the ONE canonical corpus walk-skip set
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; };

// Generic filler the label uses when the code carries no domain signal — a word whose whole label
// is built only from these cannot be named from its code, so it is flagged "unsure".
const GENERIC = /^(log a message|compute|get a local|set a local|call a step|await a step|run a step|return the result|then|and|await|define|get|set|call)$/i;

/** Pull the strongest domain signal out of a Tier-1 label: a "failing when" rule, else the most
 *  specific non-generic clause. Returns { name, confidence, basis } — a SUGGESTION Amir edits. */
function proposeName(label) {
  const ruleMatch = label.match(/failing when “([^”]+)”/); // first throw message states the rule
  if (ruleMatch) {
    const rule = ruleMatch[1].trim().replace(/\s+/g, " ");
    const short = rule.split(/[,.;]/)[0].toLowerCase().split(/\s+/).slice(0, 9).join(" ");
    return { name: "reject-when: " + short, confidence: "confident", basis: "throw-rule" };
  }
  // clauses split on commas / "then"; drop generic filler, keep the first specific one.
  const clauses = label.split(/,|\bthen\b/).map((c) => c.trim()).filter(Boolean);
  const specific = clauses.find((c) => {
    const core = c.replace(/`/g, "").replace(/^(get|set|compute|await|call|log)\s+/i, "").trim();
    return core && !GENERIC.test(c.replace(/`/g, "").trim()) && /[a-z]/i.test(core) && core.split(/\s+/).length <= 8;
  });
  if (specific) {
    const core = specific.replace(/`/g, "").replace(/\s+/g, " ").trim();
    return { name: core.toLowerCase(), confidence: "confident", basis: "domain-clause" };
  }
  return { name: label.replace(/`/g, "").replace(/\s+/g, " ").trim().slice(0, 60), confidence: "unsure", basis: "generic-only" };
}

function worksheet(args) {
  const topIx = args.indexOf("--top");
  const top = topIx >= 0 ? parseInt(args[topIx + 1], 10) : Infinity;
  const index = EN.loadIndex(CORPUS);
  const cat = index._lzw;
  if (!cat) { console.error("no recursive catalog (index._lzw missing)"); process.exit(2); }

  const byWord = new Map(); // "axis:id" -> { axis, id, depth, count, snippet, label, file }
  let totalSpans = 0;
  for (const abs of walk(SRC)) {
    let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
    const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true);
    let spans; try { spans = EL.genSpans(sf, source, cat); } catch (_) { continue; }
    for (const s of spans) {
      totalSpans++;
      const key = s.payload.a + ":" + s.payload.w;
      let row = byWord.get(key);
      if (!row) {
        const label = EN.sanitizeLabel(EN.genLabel(s.start, s.end, source, s.stmts));
        const snippet = source.slice(s.start, s.end).replace(/\s+/g, " ").trim().slice(0, 200);
        row = { axis: s.payload.a, id: s.payload.w, depth: s.depth, count: 0, tier1: label, snippet, firstFile: path.relative(SRC, abs) };
        byWord.set(key, row);
      }
      row.count++;
    }
  }

  const rows = [...byWord.values()].sort((a, b) => (b.count - a.count) || (b.depth - a.depth));
  const withNames = rows.map((r) => { const p = proposeName(r.tier1); return { ...r, proposedName: p.name, confidence: p.confidence, basis: p.basis }; });
  const chosen = withNames.slice(0, top);

  const confident = withNames.filter((r) => r.confidence === "confident").length;
  const unsure = withNames.length - confident;
  const totOcc = withNames.reduce((s, r) => s + r.count, 0);
  const cum = (n) => withNames.slice(0, n).reduce((s, r) => s + r.count, 0);
  const pct = (n) => +(100 * cum(n) / totOcc).toFixed(1);

  const out = {
    corpus: path.basename(SRC),
    builtFrom: "catalog/generators-lzw.json",
    emittedSpans: totalSpans,
    distinctWords: withNames.length,
    proposedConfident: confident,
    proposedUnsure: unsure,
    concentration: { totalOccurrences: totOcc, top10Pct: pct(10), top50Pct: pct(50), top100Pct: pct(100), top200Pct: pct(200) },
    note: "PROPOSED names are suggestions for Amir to edit — DO NOT apply as-is. Names are display-only (label); byte-identity gate is untouched by any name. Ordered by occurrence desc (highest leverage first).",
    columns: ["axis", "id", "depth", "count", "confidence", "proposedName", "tier1", "snippet", "firstFile"],
    rows: chosen,
  };
  fs.mkdirSync(path.dirname(WORKSHEET), { recursive: true });   // the cache home is gitignored, so it may not exist yet
  fs.writeFileSync(WORKSHEET, JSON.stringify(out, null, 1));
  console.log(`worksheet: ${withNames.length} distinct emitted words; wrote ${chosen.length} rows -> ${WORKSHEET}`);
  console.log(`  confident proposals: ${confident}   unsure: ${unsure}`);
  console.log(`  concentration: top10 ${pct(10)}%  top50 ${pct(50)}%  top100 ${pct(100)}%  top200 ${pct(200)}%  of ${totOcc} occurrences`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "worksheet") worksheet(rest);
else { console.error("usage: name-words-lzw.js worksheet [--top N]"); process.exit(2); }
