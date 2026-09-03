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

/* HOLE TYPES, read the way `refill` reads them: positional `‹type›` markers in the skeleton.
 * This is what made the first version of this file mis-price its own result. */
function holeTypes(payload) {
  const axis = payload.a === "n" ? cat.narrow : cat.wide;
  return (String(EL.expandKey(axis, payload.w)).match(/‹[a-z]+›/g) || []).map((t) => t.slice(1, -1));
}

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
                /* PRICED OFF THE ACTUAL HOLES, NOT A MODEL OF THEM. The first version of this
                 * file put the whole synthesized node text into one notional hole and reported
                 * NET -1795. That was wrong in BOTH directions at once: too pessimistic here,
                 * because `if (…) {` and `}` are SKELETON and never reach the page — and it hid
                 * the reason arrow functions lose, because their entire signature really is one
                 * `fn` hole. Reading the skeleton's `‹type›` markers gives the true figure, and
                 * for if-blocks it is -2221. A model of a measurement is not a measurement. */
                const types = holeTypes(w.payload), holes = w.payload.h || [];
                let after = 1;                        /* the payload-spill mark */
                for (let i = 0; i < holes.length; i++) {
                  if (types[i] === "gap") continue;   /* s1: 81,314 of 81,390 whitespace-only */
                  if (types[i] === "body") continue;  /* becomes the `child` slot: empty text */
                  after += constructs(holes[i]);
                }
                R.after += after;
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

ok("indent is SEPARATED, not derived — whitespace-only in 1809 of 1822", () => {
  /* THE DENOMINATOR STAYS VISIBLE, at s1's insistence and they are right. `gap` is NOT a
   * whitespace type: measured corpus-wide, 81,314 of 81,390 `gap` holes are whitespace-only and
   * the other 76 are COMMENTED-OUT CODE carrying 87 constructs between them. That population IS
   * this test's 9 "comment inside the gap" sites. So `gap` is itself one name over two properties
   * — "the bytes between two statements" and "whitespace" — and has been since it was coined. The
   * claim this file makes is bounded accordingly: whitespace-only where it fires, not in general. */
  /* the superseded prediction, kept per §9 so it cannot be re-derived:
   * >   "MY PREDICTED FAILURE MODE: indentation. The closing `}` carries the source's leading
   * >   whitespace, and a generator that reconstructs `if (…) {` … `}` has to reproduce the exact
   * >   indent of a brace several lines down. If that has to become its own hole, the production
   * >   degenerates into storing the bytes with extra steps."
   * It does not, because the whitespace is separable from the syntax by AST position. */
  assert.ok(R.wsBytes > 0, "no whitespace measured — the gap computation is not running");
  assert.strictEqual(constructs(" ".repeat(10) + "\n\t"), 0, "whitespace must carry no constructs");
  assert.ok(R.commentGap > 0, "the comment-in-gap population went to zero — re-read s1's 76");
  assert.ok(constructs("// x = { a: 1 };") > 0,
    "a commented-out line DOES carry constructs — this is why `gap` is not 'whitespace'");
});

ok("the price is a REDUCTION, not a transfer — measured, sign not assumed", () => {
  /* s1's warning was right that the win partly moves into their column: `payload-spill` is
   * `/⟪lzw/g` and fires on a payload attached to a structural chunk. The sign is still favourable
   * and it is measured rather than argued: brace-block collapses by ~3,600 while payload-spill
   * gains one mark per site. */
  assert.ok(R.after < R.before, "net was " + (R.after - R.before) + " — a wash or worse");
});

/* ================================================================================================
 * PART 2 — DOES IT GENERALISE? MEASURED, BECAUSE I GUESSED WRONG.
 *
 * Having proved the mechanism on if-blocks I said arrow/function openers were "the next target
 * after if-blocks", on the strength of 3,855 fragments and 333KB of scaffolding. Byte mass turns
 * out to be the WRONG targeting metric, and the reason is visible in one line of skeleton:
 *
 *   if (c) {}                      ->  `if‹gap›(‹id›.progress === ‹num›)‹gap›‹body›`
 *   export const f = (a): T => {}  ->  `export‹gap›const‹gap›‹id›‹gap›=‹gap›‹fn›`
 *
 * In the first, the parens AND braces are SKELETON — they live in the dictionary and never reach
 * the page. In the second the ENTIRE signature, `(`, `)`, `:`, `=>`, `[`, `]`, `{`, `}` and all,
 * is one `fn` hole, so every construct in it stays exactly where it was and the only change is one
 * added payload mark. The dictionary decomposes at the wrong granularity for that kind.
 *
 * WHAT DETERMINES WHETHER A KIND PAYS is therefore not its size but the granularity the EXISTING
 * skeleton already reaches — readable per kind, before building anything. Decomposing INSIDE the
 * `fn` hole is s1's tier 2 (`args` 22,328 / `chain` 7,162 / `fn` 5,169), not this lane. */

const G = {};
function priceKind(key, st, sf, src, blk) {
  const S = G[key] = G[key] || { n: 0, exact: 0, noWord: 0, dirty: 0, wrong: 0, before: 0, after: 0, bodyHole: 0 };
  const stmts = blk.statements;
  if (!stmts.length) return;
  S.n++;
  const a = st.getStart(sf), b = st.getEnd(), blkA = blk.getStart(sf), blkB = blk.getEnd();
  const bodyA = stmts[0].getStart(sf), bodyB = stmts[stmts.length - 1].getEnd();
  const g5 = src.slice(blkA + 1, bodyA), g6 = src.slice(bodyB, blkB - 1);
  if (/\S/.test(g5) || /\S/.test(g6)) { S.dirty++; return; }
  const synth = src.slice(a, blkA + 1) + src.slice(blkB - 1, b);
  const ssf = ts.createSourceFile("s.ts", synth, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ssf.parseDiagnostics.length || ssf.statements.length !== 1) { S.wrong++; return; }
  let w = null;
  try { w = EL.runWord([...ssf.statements], ssf, synth, cat); } catch (_) { w = null; }
  if (!w || !w.payload) { S.noWord++; return; }
  let back = null;
  try { back = EL.compileSpan(w.payload, cat); } catch (_) { back = null; }
  if (back !== synth) { S.wrong++; return; }
  const cut = src.slice(a, blkA + 1).length;
  if (back.slice(0, cut) + g5 + src.slice(bodyA, bodyB) + g6 + back.slice(cut) !== src.slice(a, b)) { S.wrong++; return; }
  S.exact++;
  const types = holeTypes(w.payload), holes = w.payload.h || [];
  if (types.includes("body")) S.bodyHole++;
  let after = 1;
  for (let i = 0; i < holes.length; i++) {
    if (types[i] === "gap" || types[i] === "body") continue;
    after += constructs(holes[i]);
  }
  S.after += after;
  S.before += constructs(src.slice(a, bodyA) + src.slice(bodyB, b));
}

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const st of sf.statements) {
    if (st.kind === ts.SyntaxKind.FunctionDeclaration && st.body) priceKind("function decl", st, sf, src, st.body);
    else if (st.kind === ts.SyntaxKind.VariableStatement) {
      for (const d of st.declarationList.declarations) {
        const i = d.initializer;
        if (i && (i.kind === ts.SyntaxKind.ArrowFunction || i.kind === ts.SyntaxKind.FunctionExpression)
            && i.body && i.body.kind === ts.SyntaxKind.Block) { priceKind("const = arrow/fn", st, sf, src, i.body); break; }
      }
    } else if (st.kind === ts.SyntaxKind.ExpressionStatement) {
      const e = st.expression;
      if (e && e.kind === ts.SyntaxKind.CallExpression && e.arguments && e.arguments.length) {
        const last = e.arguments[e.arguments.length - 1];
        if (last && (last.kind === ts.SyntaxKind.ArrowFunction || last.kind === ts.SyntaxKind.FunctionExpression)
            && last.body && last.body.kind === ts.SyntaxKind.Block) priceKind("call w/ arrow arg", st, sf, src, last.body);
      }
    }
  }
}

console.log("\n  TARGETING — priced off real holes, per node kind");
console.log("  " + "kind".padEnd(20) + "sites".padStart(6) + "exact".padStart(13)
  + "body=skel".padStart(12) + "now".padStart(7) + "after".padStart(7) + "NET".padStart(8));
for (const k in G) {
  const S = G[k], net = S.after - S.before;
  console.log("  " + k.padEnd(20) + String(S.n).padStart(6)
    + (S.exact + " (" + (S.exact / S.n * 100).toFixed(0) + "%)").padStart(13)
    + (S.bodyHole + "/" + S.exact).padStart(12)
    + String(S.before).padStart(7) + String(S.after).padStart(7) + String(net).padStart(8)
    + (net < 0 ? "   PAYS" : "   LOSES"));
}

ok("the mechanism generalises — 3 more kinds, still 0 wrong bytes", () => {
  let n = 0, exact = 0, wrong = 0;
  for (const k in G) { n += G[k].n; exact += G[k].exact; wrong += G[k].wrong; }
  assert.strictEqual(wrong, 0, "wrong bytes appeared on a new node kind");
  assert.ok(exact / n > 0.95, "only " + exact + " of " + n + " reconstructed");
});

ok("BUT arrow/fn openers DO NOT PAY — byte mass is the wrong targeting metric", () => {
  /* THE NEGATIVE RESULT, PINNED. I called this "the next target after if-blocks" off 3,855
   * fragments and 333KB. It reconstructs at 99% with zero wrong bytes and saves NOTHING, because
   * its whole signature is a single `fn` hole. Anyone reading the byte table and targeting this
   * kind will spend the effort and move the number by ~0. */
  const S = G["const = arrow/fn"];
  assert.ok(S && S.exact > 1000, "the arrow/fn population vanished — re-read this test");
  assert.strictEqual(S.bodyHole, 0, "its skeleton now HAS a body hole — re-price it, it may pay now");
  assert.ok(S.after - S.before >= 0, "it now pays (" + (S.after - S.before) + ") — good news, update this");
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
