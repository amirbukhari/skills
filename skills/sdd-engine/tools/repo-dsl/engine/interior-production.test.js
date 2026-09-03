"use strict";
/* interior-production.test.js — THE SPIKE, made executable.
 *
 * THE CLAIM, and it was mine: "nothing new needs inventing; the existing hole mechanism needs
 * lifting to interior nodes." s1's framing was that the scaffolding around a rendered body —
 * `linksRouter.get(\n  '/path',\n  validate<…>(…),\n  async (ctx) => {` — can never be covered,
 * because `renderVerbatim` English-ifies only leaf spans (complete AST nodes) and the scaffolding is
 * a FRAGMENT that no node's text equals. Both halves of that are true. The inference is not.
 *
 * `if (cond) {}` IS a complete node. The scaffolding is a fragment only because the renderer
 * descends INTO the node to expose its body as children, so those bytes are a complete node MINUS
 * the extents its children cover — a set difference computable from data `renderStatement` already
 * holds (`st`, and `innerRunRanges(st, sf)`).
 *
 * THE PREDICTION I GOT WRONG, kept because it is the useful half: I expected indentation to defeat
 * this — that reproducing a closing brace's exact indent would degenerate into storing the bytes
 * with extra steps. It does not, and the reason is worth more than the result. **Indent does not
 * have to be DERIVED, only SEPARATED.** A simple if-block is exactly
 *
 *     `if` ws1 `(` ws2 <cond> ws3 `)` ws4 `{` ws5 <body> ws6 `}`
 *
 * and all six whitespace runs are computable from node positions. The fixed tokens come from the
 * dictionary; the whitespace rides as whitespace-only holes, carrying ZERO constructs in any of
 * `the-goal.test.js`'s eight buckets; the body is the slot the child chunks occupy.
 *
 * THIS TEST IS CORPUS-WIDE and takes a few seconds. It is NOT part of any suite sweep — run it on
 * purpose. It asserts the MECHANISM, not a ratchet: it does not render, does not write, and does
 * not touch `renderStatement`, `compileSpan` or the payload format. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const CR = require("./corpus-root.js");
const EL = require("./enlzw.js");
const EN = require("./enfile.js");

const SRC = CR.sourceRoot();
const index = EN.loadIndex();
assert.ok(index && index._lzw, "no lzw catalog loaded — this test would measure nothing (§16 class 1)");
const cat = index._lzw;

const SKIP = new Set(["node_modules", ".git", "sen", "spec", "catalog", ".cache", "dist", "build"]);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(p);
  }
})(SRC);
assert.ok(files.length > 500, "walked " + files.length + " files — SOURCE root is wrong");

/* the goal test's construct definitions, BY REFERENCE. The strip list is frozen and this file does
 * not touch it; these are only used to price what moves, and any drift between the two is a reason
 * to re-read `the-goal.test.js`, never to edit it from here. */
const KINDS = [["payload-spill", /⟪lzw/g], ["brace-block", /[{}]/g], ["arrow-fn", /=>/g],
  ["call-paren", /[A-Za-z0-9_$]\(/g], ["semicolon", /;/g], ["bracket", /[[\]]/g],
  ["straight-quote-string", /'[^']*'|"[^"]*"/g], ["template-interp", /\$\{/g]];
function constructs(s) {
  let n = 0;
  for (const [, re] of KINDS) { const m = String(s).match(new RegExp(re.source, "g")); n += m ? m.length : 0; }
  return n;
}

const R = { simple: 0, exact: 0, noWord: 0, commentGap: 0, wrongBytes: 0,
  wsBytes: 0, before: 0, after: 0 };

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  (function walk(node) {
    if (node.kind === ts.SyntaxKind.IfStatement && !node.elseStatement
        && node.thenStatement && node.thenStatement.kind === ts.SyntaxKind.Block
        && node.thenStatement.statements.length) {
      R.simple++;
      const blk = node.thenStatement, st = blk.statements;
      const a = node.getStart(sf), b = node.getEnd();
      const condA = node.expression.getStart(sf), condB = node.expression.getEnd();
      const blkA = blk.getStart(sf), bodyA = st[0].getStart(sf), bodyB = st[st.length - 1].getEnd();
      const lp = src.indexOf("(", a + 2), rp = src.lastIndexOf(")", blkA);
      if (lp >= 0 && rp >= condB) {
        const gaps = [src.slice(a + 2, lp), src.slice(lp + 1, condA), src.slice(condB, rp),
          src.slice(rp + 1, blkA), src.slice(blkA + 1, bodyA), src.slice(bodyB, b - 1)];
        if (gaps.some((g) => /\S/.test(g))) R.commentGap++;   /* a comment in the scaffolding */
        else {
          const cond = src.slice(condA, condB);
          const synth = "if (" + cond + ") {}";
          const ssf = ts.createSourceFile("s.ts", synth, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
          let w = null;
          try { w = EL.runWord([...ssf.statements], ssf, synth, cat); } catch (_) { w = null; }
          if (!w || !w.payload) R.noWord++;
          else {
            let back = null;
            try { back = EL.compileSpan(w.payload, cat); } catch (_) { back = null; }
            if (back !== synth) R.wrongBytes++;
            else {
              const body = src.slice(bodyA, bodyB);
              const rebuilt = "if" + gaps[0] + "(" + gaps[1] + cond + gaps[2] + ")" + gaps[3]
                + "{" + gaps[4] + body + gaps[5] + "}";
              if (rebuilt !== src.slice(a, b)) R.wrongBytes++;
              else {
                R.exact++;
                R.wsBytes += gaps.reduce((s, g) => s + g.length, 0);
                R.before += constructs(src.slice(a, bodyA) + src.slice(bodyB, b));
                R.after += constructs("⟪lzw1 nX" + cond + gaps.join("") + "⟫");
              }
            }
          }
        }
      }
    }
    node.forEachChild(walk);
  })(sf);
}

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log("ok  - " + name); pass++; }
  catch (e) { console.log("FAIL- " + name + "\n      " + (e && e.message)); fail++; }
}

console.log("  simple if-blocks ............ " + R.simple);
console.log("  reconstructed BYTE-EXACT .... " + R.exact + "  (" + (R.exact / R.simple * 100).toFixed(1) + "%)");
console.log("  no word in the dictionary ... " + R.noWord);
console.log("  a comment inside the gap .... " + R.commentGap);
console.log("  WRONG BYTES ................. " + R.wrongBytes);
console.log("  whitespace-only hole bytes .. " + R.wsBytes + "  (0 goal-test constructs)");
console.log("  constructs  now -> after .... " + R.before + " -> " + R.after
  + "   NET " + (R.after - R.before));

ok("the dictionary ALREADY generates interior scaffolding — no miner change", () => {
  /* This is the whole finding. `if (cond) {}` is matched by the same skeletons the leaves use, so
   * interior productions do not need the miner to learn a new kind of span. */
  assert.ok(R.exact >= 1800, "only " + R.exact + " of " + R.simple + " reconstructed");
});

ok("ZERO wrong bytes — the hard floor holds for every site it fires on", () => {
  assert.strictEqual(R.wrongBytes, 0);
});

ok("indent is SEPARATED, not derived — every gap is whitespace-only", () => {
  /* the superseded prediction, kept per §9 so it cannot be re-derived:
   * >   "MY PREDICTED FAILURE MODE: indentation. The closing `}` carries the source's leading
   * >   whitespace, and a generator that reconstructs `if (…) {` … `}` has to reproduce the exact
   * >   indent of a brace several lines down. If that has to become its own hole, the production
   * >   degenerates into storing the bytes with extra steps."
   * It does not, because the whitespace is separable from the syntax by AST position. */
  assert.ok(R.wsBytes > 0, "no whitespace measured — the gap computation is not running");
  assert.strictEqual(constructs(" ".repeat(10) + "\n\t"), 0, "whitespace must carry no constructs");
});

ok("the price is a REDUCTION, not a transfer — measured, sign not assumed", () => {
  /* s1's warning was right that the win partly moves into their column: `payload-spill` is
   * `/⟪lzw/g` and fires on a payload attached to a structural chunk. The sign is still favourable
   * and it is measured rather than argued: brace-block collapses by ~3,600 while payload-spill
   * gains one mark per site. */
  assert.ok(R.after < R.before, "net was " + (R.after - R.before) + " — a wash or worse");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
