"use strict";
/**
 * author-names.js — generate catalog/word-names.json for the LEAF words of the recursive
 * dictionary, BOTTOM-UP BY FREQUENCY (PRD §2.2: the model may propose NAMES only).
 *
 * THE QUALITY BAR, and why most high-frequency leaves are deliberately left UNNAMED.
 * A leaf skeleton is syntax; the domain content of a statement lives in its HOLES (‹id›, ‹str›,
 * ‹args›), which this pass does not touch. So for a leaf like `const ‹id› = await ‹id›(‹args›);`
 * the only name a static skeleton can carry is "bind the result of an async call" — which is
 * exactly the vacuous gloss ("compute a value", "call a step") this work exists to replace.
 *
 * Worse than vacuous: it would be a REGRESSION. spanProse renders that same statement per-site as
 * "await `invoices` from softDeleteRecordsForRun" — it can quote the real identifier, the real
 * callee, the real throw message. A per-skeleton name provably cannot. So the admission rule is:
 *
 *   NAME a leaf only where spanProse has nothing site-specific to say about it.
 *
 * That is decidable and it is what these rules encode. It admits imports/exports (spanProse emits
 * "run a step" for every one of them), request/response assignments, type and enum declarations,
 * test scaffolding and logging levels. It refuses the whole const/call/return family, and it
 * refuses guard-throws — spanProse already surfaces their actual message as `failing when "…"`,
 * which beats any static name.
 *
 * Names are cosmetic by construction: enfile.compileChunk locates the payload with
 * lastIndexOf(PAY_OPEN) and never reads the label region.
 */
const fs = require("fs");
const path = require("path");
const WN = require("./engine/word-names");

const N = +(process.env.TOP || 250);
const CENSUS = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, "catalog", "word-names.json");

const count = (s, re) => (s.match(re) || []).length;
const num = (n) => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || String(n);
const plural = (n, w) => num(n) + " " + w + (n === 1 ? "" : "s");

/* Each rule returns a sentence, or null to decline. Order matters: first match wins.
 * A rule that cannot say what the statement DOES must return null — an unnamed word falls back
 * to spanProse, which is honest; a vacuous name is noise that looks like progress. */
const RULES = [
  /* ---- module graph. spanProse renders EVERY import/export as "run a step". ---- */
  [/^import‹gap›\{[^}]*\}‹gap›from‹gap›‹str›;$/, (s) => {
    const k = count(s, /‹id›/g), a = count(s, /‹gap›as‹gap›/g);
    if (a) return "import " + plural(k - a, "name") + " from a module, " + (a === 1 ? "one" : num(a)) + " under an alias";
    return "import " + plural(k, "name") + " from a module";
  }],
  [/^import‹gap›‹id›‹gap›from‹gap›‹str›;$/, () => "import a module's default export"],
  [/^import‹gap›\*‹gap›as‹gap›‹id›‹gap›from‹gap›‹str›;$/, () => "import a whole module under one namespace"],
  [/^import‹gap›‹id›,‹gap›\{[^}]*\}‹gap›from‹gap›‹str›;$/, (s) =>
    "import a module's default export plus " + plural(count(s, /‹id›/g) - 1, "name")],
  [/^import‹gap›‹str›;$/, () => "load a module for its side effects only"],
  [/^export‹gap›\*‹gap›from‹gap›‹str›;$/, () => "re-export everything from another module"],
  [/^export‹gap›\{[^}]*\}‹gap›from‹gap›‹str›;$/, (s) => {
    const k = count(s, /‹id›/g), a = count(s, /‹gap›as‹gap›/g);
    if (a) return "re-export " + plural(k - a, "name") + " from another module under " + (a === 1 ? "an alias" : num(a) + " aliases");
    return "re-export " + plural(k, "name") + " from another module";
  }],
  [/^export‹gap›default‹gap›‹id›;$/, () => "make a value this module's default export"],
  [/^export‹gap›default‹gap›‹id›\.‹m›;$/, () => "make one of a value's members this module's default export"],

  /* ---- HTTP request/response. spanProse sees a bare assignment and says "run a step". ---- */
  [/^‹id›\.body = ‹obj›;$/, () => "set the HTTP response body"],
  [/^‹id›\.body = ‹obj› as ‹type›;$/, () => "set the HTTP response body to a typed payload"],
  [/^‹id›\.status = ‹num›;$/, () => "set the HTTP status code"],
  [/^‹id›\.use\(‹args›\);$/, () => "mount a middleware on the app"],

  /* ---- declarations: RETIRED. These were named while spanProse had no production for
   * interfaces, enums or type aliases. It has one now, and it WINS — it can quote the real name
   * and the real members ("list the choices for `EApiValidatorStatus` — `enabled`, `disabled`")
   * where a per-skeleton name is stuck at "declare an enumeration of one case". Keeping them
   * would be a name beating a better per-site rendering, which is the exact thing this pass
   * refuses to do. Retired here rather than left to rot. ---- */

  /* ---- test scaffolding: the domain is testing, and the skeleton names the operation. ---- */
  [/^(test|it)\(‹args›\);$/, () => "declare a test case"],
  [/^describe\(‹args›\);$/, () => "open a group of related tests"],
  [/^(beforeEach|beforeAll)\(‹args›\);$/, () => "run setup before the tests"],
  [/^(afterEach|afterAll)\(‹args›\);$/, () => "run teardown after the tests"],
  [/^expect\(‹args›\)‹chain›;$/, () => "assert an expectation"],
  [/^jest\.‹m›\(‹args›\);$/, () => "configure a test double"],

  /* ---- logging: the fallback says "log a message" for all levels; the level is the content. ---- */
  [/^‹id›\.info\(‹args›\);$/, () => "log an informational message"],
  [/^‹id›\.error\(‹args›\);$/, () => "log an error"],
  [/^‹id›\.warn\(‹args›\);$/, () => "log a warning"],

  /* ---- repo-specific operations whose callee is IN the skeleton, not in a hole. ---- */
  [/^checkHeap\(‹args›\);$/, () => "record a heap-usage checkpoint"],
  [/^showMessage\(‹args›\);$/, () => "show a message to the user"],
  [/^dispatch\(‹args›\);$/, () => "dispatch an action to the store"],

  /* ---- early returns. spanProse says "branch on a condition" and loses the shape. ---- */
  [/^if‹gap›\(!‹id›\)‹gap›\{‹gap›return ‹obj›;‹gap›\}$/, () => "return an error result when a required value is missing"],
  [/^if‹gap›\(!‹id›\.‹m›\)‹gap›\{‹gap›return ‹obj›;‹gap›\}$/, () => "return an error result when a required field is missing"],
  [/^if‹gap›\(!‹id›\)‹gap›\{‹gap›return ‹str›;‹gap›\}$/, () => "return a message when a required value is missing"],
  [/^if‹gap›\(‹id›\.‹m› === ‹num›\)‹gap›\{‹gap›return ‹arr›;‹gap›\}$/, () => "return an empty list when there is nothing to process"],

  /* ---- literal returns. "return the result" is actively WRONG when there is no result. ---- */
  [/^return null;$/, () => "return nothing"],
  [/^return false;$/, () => "return false"],
  [/^return true;$/, () => "return true"],
];

const leaves = JSON.parse(fs.readFileSync(CENSUS, "utf8"));
const today = new Date().toISOString().slice(0, 10);
const names = {};
const skipped = [];
let namedSites = 0, skippedSites = 0;

for (const r of leaves.slice(0, N)) {
  let en = null;
  for (const [re, fn] of RULES) if (re.test(r.sym)) { en = fn(r.sym); break; }
  if (!en) { skipped.push(r); skippedSites += r.sites; continue; }
  const h = WN.hashOf(r.axis, r.sym);
  names[h] = { sym: r.sym, en, sites: r.sites, named: today };
  namedSites += r.sites;
}

const prev = WN.load(OUT);
const out = { schema: "sdd-repo-dsl/word-names/1", generated: today, names, orphans: prev.orphans || {} };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");

const tot = leaves.reduce((s, x) => s + x.sites, 0);
console.log("considered (top by site frequency): " + N);
console.log("NAMED   : " + Object.keys(names).length + "  covering " + namedSites + " leaf sites (" + (100 * namedSites / tot).toFixed(1) + "% of all leaf sites)");
console.log("SKIPPED : " + skipped.length + "  covering " + skippedSites + " leaf sites (" + (100 * skippedSites / tot).toFixed(1) + "%) — no honest name; falls back to spanProse");
if (process.env.SHOW_SKIPS) for (const s of skipped.slice(0, +process.env.SHOW_SKIPS)) console.log("   skip n=" + s.sites + "  " + s.sym.slice(0, 110));
