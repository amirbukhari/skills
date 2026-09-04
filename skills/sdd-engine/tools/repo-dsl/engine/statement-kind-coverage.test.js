/* statement-kind-coverage.test.js — PER-SITE PRODUCTIONS, PER STATEMENT KIND. RED.
 *
 * §5C: "Productions are the larger and cheaper half, and that is the central finding. Fourteen
 * statement kinds reaches further than the entire nameable-word queue, because a production reads
 * the site and a name cannot. Naming is a background trickle against the queue; productions are the
 * line of work."
 *
 * This file turns that into a work order. For every statement kind in the corpus it asks the
 * renderer what it says about a real site of that kind, and sorts the answer into three buckets:
 *
 *   SITE-SPECIFIC  the clause quotes at least one identifier that is actually IN that statement.
 *                  This is a production doing its job — it read the site.
 *   GENERIC        a clause with no identifier from the site in it. Not in the frozen vacuous set,
 *                  so it does not show up in §7's vacuous count, but it says nothing this statement
 *                  could not have said about any other statement of its kind.
 *   VACUOUS        a clause in the FROZEN set (clause-quality.js). §5C's honesty rule: these are
 *                  legal and they are COUNTED. A production that stops emitting one of these must
 *                  do so by saying something TRUE, never by rewording the placeholder — so the set
 *                  is frozen and this test reads it rather than redefining it.
 *
 * WHY GENERIC IS TRACKED SEPARATELY, and why it is the real finding: the frozen set catches only
 * the thirteen exact strings someone thought to freeze. A production that emits "define the class"
 * for every class in the corpus is just as contentless and is invisible to the vacuous metric. The
 * per-kind GENERIC column is what says which of the fourteen kinds to build first.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./enfile");
const CR = require("./corpus-root");
const Q = require("./clause-quality");
/* A SECOND FIGURE, NEVER A REPLACEMENT. `generic` below is frozen and is computed exactly as it
 * always was; this only counts, alongside it, how many of those generic sites quote the site's own
 * words through the renderer's `…` elision. Nothing here feeds an assertion. */
const EC = require("./elision-credit");
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

const SRC = CR.sourceRoot();
const files = walk(SRC);

/* A clause is SITE-SPECIFIC iff it quotes something that is really in this statement. Checking
 * against the statement's own text rather than against a list of "interesting words" keeps the
 * predicate decidable and impossible to satisfy by writing a longer generic phrase. */
function isSiteSpecific(clause, stmtText) {
  const quoted = clause.match(/`[^`]+`|“[^”]+”/g) || [];
  for (const q of quoted) {
    const bare = q.slice(1, -1).trim();
    if (bare.length >= 2 && stmtText.includes(bare)) return true;
  }
  return false;
}

const kinds = new Map();   // kind -> { sites, specific, generic, vacuous, none, egGeneric, egVacuous }
const bump = (k) => {
  let r = kinds.get(k);
  if (!r) { r = { sites: 0, specific: 0, generic: 0, vacuous: 0, none: 0, elided: 0, egGeneric: null, egVacuous: null }; kinds.set(k, r); }
  return r;
};

for (const abs of files) {
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let sf; try { sf = ts.createSourceFile("f.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); } catch (_) { continue; }

  /* THE SAME UNIVERSE THE RENDERER FOLDS OVER: direct children of a Block or of the SourceFile.
   * That is `countBodyStatements`' denominator and `genSpans`' collection rule, so this measures
   * the statements the engine actually has to speak about — not every node in the tree. */
  const visit = (n) => {
    if ((ts.isBlock(n) || ts.isSourceFile(n)) && n.statements.length) {
      for (const st of n.statements) {
        const kind = ts.SyntaxKind[st.kind];
        const rec = bump(kind);
        rec.sites++;
        let r = null;
        try { r = EN.spanActions([st], sf); } catch (_) { r = null; }
        /* READ BOTH CHANNELS. spanActions returns { actions, guards }, and a guard-shaped `if`
         * reports through `guards` -- so reading `actions` alone counted a whole clause channel as
         * silence. Measured 2026-09-03: all 775 IfStatement sites this file called "no clause" carry
         * a guard clause, and ZERO are genuinely silent. The work order this file exists to produce
         * had IfStatement as its top priority on the strength of that column.
         *
         * This is the measurement-integrity class again, in the direction that costs the most: a
         * check that cannot fire wastes a guard, but a MEASUREMENT that undercounts sends the work
         * somewhere it was not needed. Same night as the header-prose `indexOf` and the MIN_SKEL
         * probe that asserted a dial equals itself (§16). */
        const clause = r && r.actions && r.actions.length ? String(r.actions[0])
          : (r && r.guards && r.guards.length ? String(r.guards[0]) : null);
        if (!clause) { rec.none++; continue; }
        if (Q.isVacuous(clause)) { rec.vacuous++; if (!rec.egVacuous) rec.egVacuous = clause; continue; }
        if (isSiteSpecific(clause, st.getText(sf))) rec.specific++;
        else {
          rec.generic++; if (!rec.egGeneric) rec.egGeneric = clause.slice(0, 72);
          /* counted BESIDE generic, never instead of it */
          if (EC.creditsElision(clause, st.getText(sf))) rec.elided++;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

const rows = [...kinds.entries()].map(([kind, r]) => ({ kind, ...r })).sort((a, b) => b.sites - a.sites);
const totals = rows.reduce((t, r) => ({ sites: t.sites + r.sites, specific: t.specific + r.specific,
  generic: t.generic + r.generic, vacuous: t.vacuous + r.vacuous, none: t.none + r.none,
  elided: t.elided + r.elided }),
  { sites: 0, specific: 0, generic: 0, vacuous: 0, none: 0, elided: 0 });

const pc = (n, d) => (d ? (100 * n / d).toFixed(0) : "0").padStart(3) + "%";
console.log("");
console.log("  STATEMENT KIND                    sites  site-specific   generic   vacuous   no clause");
for (const r of rows) {
  console.log("  " + r.kind.padEnd(30) + String(r.sites).padStart(6)
    + "   " + String(r.specific).padStart(6) + " " + pc(r.specific, r.sites)
    + "   " + String(r.generic).padStart(6) + " " + pc(r.generic, r.sites)
    + "   " + String(r.vacuous).padStart(5)
    + "   " + String(r.none).padStart(6));
  if (r.egGeneric) console.log("      generic e.g.  " + r.egGeneric);
  if (r.egVacuous) console.log("      vacuous e.g.  " + r.egVacuous);
}
console.log("  " + "TOTAL".padEnd(30) + String(totals.sites).padStart(6)
  + "   " + String(totals.specific).padStart(6) + " " + pc(totals.specific, totals.sites)
  + "   " + String(totals.generic).padStart(6) + " " + pc(totals.generic, totals.sites)
  + "   " + String(totals.vacuous).padStart(5)
  + "   " + String(totals.none).padStart(6));
console.log("");
/* THE SECOND FIGURE, PRINTED AFTER THE FROZEN ONE AND NEVER INSTEAD OF IT (R-ARCH-16B's pattern:
 * old number first, always). The frozen `generic` above is the published series and is unchanged.
 * This line says how much of it is the renderer's own `…` elision meeting a predicate that matches
 * verbatim — see engine/elision-credit.js. It feeds NO assertion, by design: whether the definition
 * of mute ever changes is Amir's ruling, in its own pass. */
console.log("  GENERIC, NET OF THE RENDERER'S OWN “…” ELISION (a second figure; the frozen one above stands)");
console.log("    generic (frozen) ................... " + totals.generic);
console.log("    of those, quoting the site through “…” " + totals.elided
  + "   " + (totals.generic ? (100 * totals.elided / totals.generic).toFixed(1) : "0") + "% of generic");
console.log("    generic net of elision ............. " + (totals.generic - totals.elided));
const elidedRows = rows.filter((r) => r.elided > 0).sort((a2, b2) => b2.elided - a2.elided);
for (const r of elidedRows) {
  console.log("      " + r.kind.padEnd(24) + String(r.generic).padStart(6) + " frozen  ->  "
    + String(r.generic - r.elided).padStart(6) + " net   (" + r.elided + " credited)");
}
console.log("");

/* ---- the assertions ---------------------------------------------------------------------------
 * TARGET ZERO on both contentless buckets, per kind, so the failure output names the kind rather
 * than one corpus-wide number nobody can act on. Kinds with fewer than 20 sites are reported but
 * not asserted: a kind with three occurrences is not a production worth building yet, and failing
 * on it would bury the fourteen that matter. */
const MIN_SITES = 20;
const asserted = rows.filter((r) => r.sites >= MIN_SITES);
ok(asserted.length > 0, "there are statement kinds with >= " + MIN_SITES + " sites to assert on (" + asserted.length + ")");

for (const r of asserted) {
  eq(r.vacuous, 0, "no site of " + r.kind + " gets a frozen vacuous clause");
}
for (const r of asserted) {
  eq(r.generic, 0, "every site of " + r.kind + " gets a clause that quotes something from the site");
}
/* SILENCE IS THE LOUDEST FAILURE, so it is asserted last and separately: a site with NO clause is
 * not a weak production, it is source the reader meets as raw TypeScript. 775 of 1,880 IfStatements
 * are in this bucket today, and they are the single largest contributor to the file-level English
 * gap the corpus-wide test measures. */
for (const r of asserted) {
  eq(r.none, 0, "every site of " + r.kind + " produces a clause at all");
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\nRED ON PURPOSE: the failing kinds above ARE the production work order (§5C).");
