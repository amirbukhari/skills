/* english-complete.test.js — §7's ENGLISH-COMPLETENESS PREDICATE, AS A CORPUS-WIDE GATE. RED.
 *
 * §7 already publishes an English-completeness figure, and it reads 99.9%. That number is a share
 * of CLAUSES, and a clause-level share is the flattering denominator: it counts only text the
 * renderer chose to speak about, so every statement the engine said NOTHING about — raw TypeScript
 * sitting between the chunks — is invisible to it. A file can be 99.9% English-complete by clause
 * and still be mostly code on the page.
 *
 * THIS GATE USES THE WHOLE FILE AS THE DENOMINATOR. Strip what is deliberately verbatim
 * (`identifiers`, “literals”) and the derived payloads, and assert that nothing which looks like
 * TypeScript survives anywhere in what a reader reads. Same predicate as §7 (clause-quality.js,
 * unchanged and not weakened), honest denominator.
 *
 * EXPECTED RED. It is the §7 criterion stated as a requirement instead of a score.
 */
const fs = require("fs");
const path = require("path");
const EN = require("./enfile");
const CR = require("./corpus-root");
const Q = require("./clause-quality");
const P = require("./en-prose");
const { SKIP } = require("./walk-skip");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
  }
  return o;
};

const SRC = CR.sourceRoot(), CORPUS = CR.corpusRoot();
const index = EN.loadIndex(CORPUS);
const files = walk(SRC);

let byteExact = 0, clean = 0, clauses = 0, clausesComplete = 0;
const offenders = [];   // { rel, lines, sample }

for (const abs of files) {
  const rel = path.relative(SRC, abs);
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let r, back;
  try { r = EN.renderFileEn(source, index); back = EN.compileFileEn(r.en, index); }
  catch (e) { offenders.push({ rel, lines: Infinity, sample: "THREW: " + e.message }); continue; }
  if (back === source) byteExact++;

  /* the clause-level reading, kept beside the file-level one so the two denominators are visible
   * together and nobody has to take "99.9%" and "mostly code" as a contradiction. */
  for (const L of P.labelsOf(r.en)) for (const c of Q.clausesOf(L)) { clauses++; if (Q.isEnglishComplete(c)) clausesComplete++; }

  const residue = Q.residueOf(P.readable(r.en, EN.unescapeVerbatim));
  const hits = residue.split("\n").map((l) => l.trim()).filter((l) => l && Q.TS_SYNTAX.test(l));
  if (!hits.length) clean++;
  else offenders.push({ rel, lines: hits.length, sample: hits[0].slice(0, 100) });
}

/* THE FLOOR FIRST. Prose is never bought with bytes. */
eq(byteExact, files.length, "byte-identity holds for every file while this is measured");

const pct = (n, d) => (d ? (100 * n / d).toFixed(1) : "0.0") + "%";
console.log("");
console.log("  files                     " + files.length);
console.log("  fully English (file-level)" + String(clean).padStart(6) + "   " + pct(clean, files.length));
console.log("  clauses English-complete  " + String(clausesComplete).padStart(6) + " of " + clauses + "   " + pct(clausesComplete, clauses) + "   <- what §7 publishes");
console.log("");
offenders.sort((a, b) => b.lines - a.lines || a.rel.localeCompare(b.rel));
console.log("  WORST OFFENDERS (lines of surviving TypeScript)");
for (const o of offenders.slice(0, 15)) console.log("    " + String(o.lines).padStart(5) + "  " + o.rel + "\n           | " + o.sample);
console.log("");

eq(offenders.length, 0, "every file's prose surface is free of TypeScript outside `identifiers` and “literals”");

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\nRED ON PURPOSE: this is §7's own predicate with the honest denominator.");
