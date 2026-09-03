/* hole-type-order.test.js — THE LAST SHARED ENTRY POINT BETWEEN THE TWO LANES.
 *
 * WHY THIS EXISTS. Two lanes priced the goal metric by hole type all night and cross-checked each
 * other's numbers. Both derived the hole TYPE SEQUENCE the same way: `expandKey(axis, w)` on the
 * word id the payload carries. A defect in that derivation would have produced identical wrong
 * answers in both lanes, and "two independent lanes agree" was the strongest evidence we had.
 * §16: a cross-check verifies independence of DERIVATION; it cannot verify independence of
 * POPULATION, and it cannot verify a helper they both call.
 *
 * WHY BYTE-IDENTITY DOES NOT ALREADY COVER IT — this is the whole point. `refill` substitutes
 * positionally and ignores types:
 *
 *     refill(key, holes) => key.replace(/‹\w+›/g, () => holes[i++])
 *
 * So a key whose hole types are misordered or mislabelled — `‹id›‹args›` where the source is
 * `‹args›‹id›` — still reproduces the exact source bytes, because the TEXTS are in the right order
 * even if the LABELS are not. Byte-identity is 1037/1037 either way. The types are load-bearing
 * for exactly two things, neither of which byte-identity touches: every construct figure attributed
 * per hole type, and `compileSpan`'s child-slot dispatch.
 *
 * THE INDEPENDENT DERIVATION. `expandKey` builds the key from the DICTIONARY, by recursing over
 * LZW pairs. `generators.windowParts` builds it from the SOURCE AST, by canonicalising the actual
 * statements. Nothing in the render path compares them: `genSpans` gates on `wp.fill === source
 * .slice(start, end)`, which is a claim about BYTES and says nothing about labels. This test closes
 * that gap by round-tripping every payload on every page back to its source bytes, re-deriving the
 * key from those bytes through the canon, and asserting the two keys are equal.
 *
 * A FAILURE HERE INVALIDATES EVERY PER-TYPE FIGURE IN §19 AND §16 and does NOT invalidate
 * byte-identity. Read it that way round.
 */
const fs = require("fs");
const path = require("path");
const CR = require("./corpus-root");
const AC = require("./artifact-contract");
const EL = require("./enlzw");
const G = require("./generators");
const PAY = require("./payload");
const ts = require("typescript");

let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("ok  - " + m); } };

const EN_DIR = path.join(CR.senDir(), "files");
const cat = EL.loadLzw(AC.pathFor("generators-lzw"));
const walk = (d, o = []) => {
  if (!fs.existsSync(d)) return o;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o); else if (p.endsWith(".en")) o.push(p);
  }
  return o;
};

const PAYLOAD_RE = /⟪(lzw1 [^⟫]*)⟫/g;
const typesOf = (key) => (key.match(/‹(\w+)›/g) || []).map((s) => s.slice(1, -1));

/* EVERY EXIT PATH IS COUNTED, and that is not tidiness. The first version of this test `continue`d
 * out of two catches -- expandKey throwing, refill throwing -- without incrementing anything, while
 * the report printed re-derivable as `payloads - unparseable`. A payload lost to either catch was
 * therefore counted as re-derivable having been compared to nothing.
 *
 * MEASURED, NOT REASONED: injecting a throw into expandKey for 500 payloads gave keyAgree 9223,
 * keyDiffer 0, unparseable 1, payloads 9724 -- and ALL FIVE ASSERTIONS PASSED while the report line
 * read "re-derivable 9723". A silent shrink of the verified population, in the reassuring direction,
 * inside the test written to close the last unverified channel. The accounting assertion at the
 * bottom is what makes that impossible rather than unlikely. §16: a guard that cannot fire. */
let marks = 0, undecodable = 0, noKey = 0, noRefill = 0;
let payloads = 0, keyAgree = 0, keyDiffer = 0, unparseable = 0, holeAgree = 0, holeDiffer = 0;
let typeAgree = 0, typeDiffer = 0, arityDiffer = 0;
const examples = [];

for (const abs of walk(EN_DIR)) {
  const en = fs.readFileSync(abs, "utf8");
  let m;
  while ((m = PAYLOAD_RE.exec(en)) !== null) {
    let pl = null;
    marks++;
    /* counted BEFORE payloads++, because a mark that will not decode is invisible to every other
     * counter in this file -- it never becomes a "payload" at all. */
    try { pl = PAY.decode(m[1]); } catch (_) { undecodable++; continue; }
    payloads++;
    const axis = pl.a === "n" ? cat.narrow : cat.wide;
    let dictKey = null;
    try { dictKey = EL.expandKey(axis, pl.w); } catch (_) { noKey++; continue; }

    /* THE SOURCE BYTES, from the dictionary key plus the payload's own hole texts. This is the
     * same operation the compiler performs, so if it is wrong the corpus would not compile. */
    let slice = null;
    try { slice = G.refill(dictKey, pl.h); } catch (_) { noRefill++; continue; }

    /* RE-DERIVE THROUGH THE CANON, from those bytes and nothing else.
     *
     * `export {};` IS LOAD-BEARING AND IT IS THE HARNESS'S OWN BUG, FIXED. Without it the slice is
     * a SCRIPT, not a module, and TypeScript then parses top-level `await` as an ordinary
     * identifier: `await (getManager(a)).find(b)` becomes a CallExpression on a function named
     * `await`, with ZERO parse diagnostics, so nothing announces it. The canon then produces
     * `const‹gap›‹id›‹gap›=‹gap›‹id›‹gap›‹expr›;` where the real source gives one `‹expr›`, and this
     * test reported 9 mismatching payloads that were entirely its own doing.
     *
     * It is appended rather than prepended so the real statements keep their original offsets, and
     * it is dropped from the statement list before canonicalisation, so it contributes no hole and
     * no gap. §16, and the reason this comment is long: a measurement whose harness re-parses the
     * artifact must reproduce the artifact's PARSE CONTEXT, not merely its bytes — the same defect
     * as a harness that rewrites the page and never checks the empty case. */
    const sf = ts.createSourceFile("s.ts", slice + "\nexport {};", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (sf.parseDiagnostics && sf.parseDiagnostics.length) { unparseable++; continue; }
    const stmts = [...sf.statements];
    const marker = stmts.pop();   /* the `export {};` we added, never canonicalised */
    if (!marker || !ts.isExportDeclaration(marker)) { unparseable++; continue; }
    let wp = null;
    try { wp = G.windowParts(stmts, sf, pl.a === "w"); } catch (_) { wp = null; }
    if (wp === null) { unparseable++; continue; }

    if (wp.key === dictKey) keyAgree++; else {
      keyDiffer++;
      if (examples.length < 6) examples.push({ w: pl.w, a: pl.a, dict: dictKey, src: wp.key, file: path.relative(EN_DIR, abs) });
    }
    const td = typesOf(dictKey), tsrc = typesOf(wp.key);
    if (td.length !== tsrc.length) arityDiffer++;
    else if (td.join(",") === tsrc.join(",")) typeAgree++; else typeDiffer++;
    if (JSON.stringify(wp.holes) === JSON.stringify(pl.h)) holeAgree++; else holeDiffer++;
  }
}

console.log("\n  HOLE TYPE ORDER — dictionary derivation vs source derivation");
console.log("    payload marks on the page ................... " + marks);
console.log("    marks that would not DECODE ................. " + undecodable);
console.log("    payloads decoded ............................ " + payloads);
console.log("    no dictionary key (expandKey threw) ......... " + noKey);
console.log("    no refill (refill threw) .................... " + noRefill);
/* the compared population, stated as what it IS rather than as a subtraction that can drift */
console.log("    ACTUALLY COMPARED .......................... " + (keyAgree + keyDiffer));
console.log("    not re-derivable in isolation ............... " + unparseable);
console.log("    KEY identical (dictionary === source) ....... " + keyAgree);
console.log("    key differs ................................. " + keyDiffer);
console.log("    TYPE SEQUENCE identical ..................... " + typeAgree);
console.log("    type sequence differs (same arity) .......... " + typeDiffer);
console.log("    hole COUNT differs .......................... " + arityDiffer);
console.log("    hole TEXTS identical ........................ " + holeAgree);
console.log("    hole texts differ ........................... " + holeDiffer);
for (const e of examples) {
  console.log("      word#" + e.w + "@" + e.a + "  " + e.file);
  console.log("        dict   " + JSON.stringify(e.dict).slice(0, 150));
  console.log("        source " + JSON.stringify(e.src).slice(0, 150));
}

/* ---- the assertions ---------------------------------------------------------------------------
 * NOT VACUOUS, and stated first because a guard over an empty population is the defect this whole
 * session has been chasing. If the corpus is unrendered or the walk is wrong, this fires. */
ok(payloads > 9000, "the probe actually reached the corpus (" + payloads + " payloads, expected >9000)");
/* THE ACCOUNTING ASSERTION. Every decoded payload ends in exactly one bucket; if the buckets do not
 * sum to the population, some payload was reported without being checked. This is the assertion
 * whose absence let 500 injected failures pass as a clean run. */
ok(keyAgree + keyDiffer + unparseable + noKey + noRefill === payloads,
  "every decoded payload was actually COMPARED or explicitly accounted for"
  + "  (" + (payloads - keyAgree - keyDiffer - unparseable - noKey - noRefill)
  + " fell through unaccounted; compared " + (keyAgree + keyDiffer)
  + ", unparseable " + unparseable + ", no key " + noKey + ", no refill " + noRefill + ", of " + payloads + ")");
ok(undecodable === 0, "every payload mark on the page decodes  (" + undecodable + " of " + marks + " did not)");
ok(noKey === 0 && noRefill === 0, "no payload was lost to a throwing expandKey or refill"
  + "  (expandKey " + noKey + ", refill " + noRefill + ")");
/* PINNED, NOT ALLOWED AS SLACK. Exactly one payload is not re-derivable, and it is accounted for:
 * src/tools/entityInterfaces/interfaces/hydra/index.ts:61 is genuinely invalid TypeScript --
 *
 *     internalNotes?: INoteComment[], | null;
 *
 * -- so the SOURCE file does not parse, and no re-derivation through the canon is possible for it.
 * The engine renders and compiles that file byte-identically anyway, which is the verbatim fallback
 * behaving correctly. A ceiling of 1 rather than a `<= 5` means a second unparseable file is a
 * failure that names itself, per §16: a ratchet with slack permits the regression it was written to
 * catch. */
ok(unparseable === 1, "exactly one payload is not re-derivable, and it is the known invalid-source file"
  + "  (got " + unparseable + "; the source at entityInterfaces/interfaces/hydra/index.ts:61 is not valid TypeScript)");
ok(keyDiffer === 0, "every payload's DICTIONARY key equals the key re-derived from its own source bytes"
  + "  (" + keyAgree + " agree, " + keyDiffer + " differ)");
ok(typeDiffer === 0 && arityDiffer === 0, "the HOLE TYPE SEQUENCE is the same both ways — so every per-type"
  + " construct figure is attributed to the right type  (" + typeAgree + " agree, " + typeDiffer + " differ, " + arityDiffer + " arity)");
ok(holeDiffer === 0, "the hole TEXTS are the same both ways  (" + holeAgree + " agree, " + holeDiffer + " differ)");

console.log("\n" + pass + " passed, " + fail + " failed");
