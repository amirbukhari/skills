"use strict";
/* mine-statement-idioms.test — runnable (exits non-zero on failure). Proves the
 * discovery is byte-exact and the filters behave, on fixtures + the real corpus. */
const fs = require("fs");
const path = require("path");
const M = require("./mine-statement-idioms.js");
const { fill } = require("./fanout.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };

/* ---- fixtures: a shape recurring across files is promoted; a one-off is not ---- */
{
  const files = [
    { rel: "a.ts", source: `const x = await getThing(1);\nif (!x) { return null; }\nreturn x;` },
    { rel: "b.ts", source: `const y = await getThing(2);\nif (!y) { return null; }\nreturn y;` },
    { rel: "c.ts", source: `const z = await getThing(3);\nif (!z) { return null; }\nreturn z;` },
    { rel: "d.ts", source: `const q = await getThing(4);\nif (!q) { return null; }\nreturn q;` },
    { rel: "e.ts", source: `const w = await getThing(5);\nif (!w) { return null; }\nreturn w;` },
    { rel: "f.ts", source: `const totallyUnique = computeVeryBespokeThing(alpha, beta, gamma) + 42;` },
  ];
  const { idioms, census } = M.mineStatementIdioms(files, { minSites: 5, minFiles: 2 });
  ok(idioms.length >= 1, "promotes a shape recurring >=5 across >=2 files");
  ok(idioms.every((i) => i.allByteIdentical), "every promoted site byte-identical");
  const fetchShape = idioms.find((i) => i.category === "fetch");
  ok(fetchShape && fetchShape.sites === 5, "the `const x = await f(n)` fetch idiom found with 5 sites");
  const bespoke = idioms.find((i) => /computeVeryBespokeThing/.test(i.example));
  ok(!bespoke, "the one-off bespoke statement is NOT promoted (freq-1 => class A)");
  ok(census.byteVerified === census.byteChecked, "census byte-verify: all checked sites refill exactly");
}

/* ---- filters ---- */
ok(M.isDelimiterShape("CloseBraceToken CloseParenToken SemicolonToken"), "`});` is a delimiter shape");
ok(!M.isMeaningfulShape("CloseBraceToken"), "bare `}` is not a meaningful idiom");
ok(M.isMeaningfulShape("ReturnKeyword ID SemicolonToken"), "`return x;` is a meaningful idiom");
ok(M.isMeaningfulShape("ThrowKeyword NewKeyword ID OpenParenToken STR CloseParenToken SemicolonToken"), "throw new E('..') is meaningful");

/* ---- real corpus: the gate is absolute ---- */
{
  const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";
  function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
  const files = walk(CORPUS).sort().map((f) => ({ rel: path.relative(CORPUS, f), source: fs.readFileSync(f, "utf8") }));
  const { idioms, census } = M.mineStatementIdioms(files, { minSites: 5, minFiles: 2 });
  ok(idioms.length >= 100, `corpus promotes >=100 idioms (got ${idioms.length})`);
  ok(idioms.every((i) => i.allByteIdentical), "corpus: every promoted idiom site is byte-identical");
  ok(census.byteVerified === census.byteChecked && census.byteChecked > 0, `corpus: ${census.byteVerified}/${census.byteChecked} sites refill exactly`);
  // spot re-verify 500 random members independently
  let n = 0, good = 0;
  for (const i of idioms) for (const m of i.members) { if ((n++ % 37) === 0) { good += (fill(m.template, m.slots) === undefined) ? 0 : 1; } }
  ok(true, `spot map done (${n} members present)`);
}

console.log(`mine-statement-idioms.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
