"use strict";
/* TIER 2 — DOES THE RECURSION PAY? ALL THREE PROPERTIES, over the holes the PAGE carries.
 *
 * The other lane measured that the wide canon "reaches into" 21,781 holes / 85,099 constructs
 * (91.2%) of the inside term, and fenced it correctly and unprompted: canon-reachable is NECESSARY
 * AND NOT SUFFICIENT — it does not say a dictionary word exists, does not say the word refills
 * byte-exact, does not say the result reads as English. My if-block spike established all three;
 * that established one. This establishes all three, corpus-wide, before anything is built on it.
 *
 * THE ANSWER IS NO, AND THE REASON IS NOT A LOW PASS RATE. Where the canon genuinely decomposes a
 * hole it is FLAWLESS: 2,936 of 2,936 `expr` holes have a word and refill BYTE-EXACT, 100%, zero
 * wrong bytes. The problem is the other two properties:
 *
 *   1. 75.7% of tier-2 holes are FIXED POINTS. The canon reaches in and hands back ONE hole of the
 *      SAME TYPE carrying the SAME TEXT. `(‹obj›)`, `(‹arr›)`, `(‹fn›)`, `(‹str›)`, `f(‹args›)` —
 *      the decomposition is the IDENTITY. Recursing on it yields the same hole forever. This is
 *      not a shortfall in the 91.2%; it is INSIDE it. "The canon yields literals and holes" is
 *      true of `(‹obj›);` — it has two literals and a hole — and it changes nothing.
 *   2. Where it does decompose, the reduction is ZERO and the payload mark makes it NEGATIVE:
 *      before 19,879 -> after 22,815, NET +2,936, which is exactly +1 per hole. The sub-holes
 *      carry the same constructs the original text did; only a `⟪lzw` mark is added.
 *
 * SO THE THIRD "NECESSARY AND NOT SUFFICIENT" PROPERTY IS THE ONE THAT KILLS IT, and it is the one
 * nobody had a name for: a decomposition can be byte-exact, have a word, and still be a no-op.
 *
 * WHAT THIS DOES NOT SAY, because the constructive half matters as much. It does NOT say obj/arr/str
 * are hopeless — the other lane's tier 1 already took 26,182 constructs off exactly those holes, by
 * writing the hole's CONTENT as English rather than by asking the canon to decompose it. That is
 * why tier 1 worked: it never depended on canon reach. The finding is that RECURSION is the wrong
 * tool for the residue, not that the residue is unreachable.
 *
 * MEASUREMENT HONESTY, since this is the number that will get quoted:
 *  - Priced in the goal test's frozen KINDS, by reference, on the hole texts the PAGE carries.
 *  - `after` counts EVERY non-gap sub-hole, including any that reproduces the input. I priced a
 *    model of a measurement once tonight by excluding a hole I expected to be empty; not again.
 *  - `chain` (1,864), `type` (1,436), `bind` (732) and `body` (34) are NOT MEASURED, not
 *    unreachable: my probe wraps a fragment to make it parseable and I have no honest wrapper for
 *    these. 4,066 holes, reported as unmeasured. The other lane measured `chain` as 0-parseable
 *    independently; the rest are open.
 *  - The wrapper is an artifact of the probe. `f(` contributes an `id` hole carrying "f", which is
 *    excluded by name; the `(` … `);` literals are skeleton and never reach a page either way.
 */
const assert = require("assert");
const fs = require("fs"), path = require("path"), ts = require("typescript");
const CR=require("./corpus-root");
const G=require("./generators");
const EL=require("./enlzw");
const EN=require("./enfile");
const PAY=require("./payload");
const index=EN.loadIndex(), cat=index._lzw;
const OPEN="«",CLOSE="»",GEN="▶",GEN_NEST="▷",PAY_OPEN="⟪",PAY_CLOSE="⟫";
function mc(en,o){let d=0;for(let k=o;k<en.length;k++){const c=en[k];if(c===OPEN)d++;else if(c===CLOSE){d--;if(d===0)return k;}}return -1;}
function holeTypes(p){const ax=p.a==="n"?cat.narrow:cat.wide;return (String(EL.expandKey(ax,p.w)).match(/‹(\w+)›/g)||[]).map(t=>t.slice(1,-1));}

/* the goal test's KINDS, BY REFERENCE -- strip list frozen */
const KINDS=[[/⟪lzw/g],[/[{}]/g],[/=>/g],[/[A-Za-z0-9_$]\(/g],[/;/g],[/[[\]]/g],[/'[^']*'|"[^"]*"/g],[/\$\{/g]];
function C(t){let n=0;for(const[re]of KINDS){const m=String(t).match(re);n+=m?m.length:0;}return n;}

const TIER2=new Set(["args","expr","obj","arr","fn","chain","str","bind","type","body"]);
const WRAP={expr:"(",obj:"(",arr:"(",str:"(",num:"(",id:"(",fn:"(",args:"f(",bind:null,type:null,chain:null,body:null};
const R={};
function rec(t){return R[t]=R[t]||{n:0,bytes:0,unparse:0,noWrap:0,noSym:0,fixed:0,decomp:0,word:0,exact:0,before:0,after:0,subFixed:0};}

function analyse(type,text){
  const r=rec(type); r.n++; r.bytes+=text.length;
  const w=WRAP[type];
  /* NO WRAPPER IS NOT THE SAME FACT AS UNPARSEABLE, and my first version counted them
   * together -- which my own assertion below caught as a 14-hole gap. "I have no honest way to
   * parse this fragment" is a limit of the PROBE; "this fragment does not parse" is a fact about
   * the CONTENT. One counter over two properties is the defect this file is about. */
  if(w===null||w===undefined){ r.noWrap++; return; }
  const src=w+text+");";
  const sf=ts.createSourceFile("s.ts",src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  if((sf.parseDiagnostics||[]).length||!sf.statements[0]){ r.unparse++; return; }
  const st=sf.statements[0];
  let parts=G.generalStmtParts(st,sf,true) || G.generalStmtParts(st,sf,false);
  if(!parts){ r.noSym++; return; }
  let holes=parts.filter(p=>p.hole);
  if(type==="args") holes=holes.filter(h=>!(h.type==="id"&&h.text==="f"));  /* my wrapper's own hole */
  /* FIXED POINT: one hole, same type, same text -> reached in, changed nothing */
  if(holes.length===1 && holes[0].type===type && String(holes[0].text)===text){ r.fixed++; return; }
  if(holes.length===1 && String(holes[0].text)===text){ r.fixed++; return; }
  r.decomp++;
  let word=null,back=null;
  try{ word=EL.runWord([st],sf,src,cat);}catch(_){}
  if(word&&word.payload){ r.word++; try{back=EL.compileSpan(word.payload,cat);}catch(_){} }
  if(back===src) r.exact++; else return;
  /* PRICE WHAT THE PAGE CARRIES: before = the raw hole text; after = 1 payload mark + sub-hole texts */
  r.before+=C(text);
  let after=1;
  const wt=holeTypes(word.payload), wh=word.payload.h||[];
  for(let i=0;i<wt.length;i++){ if(wt[i]==="gap") continue; after+=C(wh[i]); if(String(wh[i])===text) r.subFixed++; }
  r.after+=after;
}

const root=path.join(CR.senDir(),"files");
const files=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const q=path.join(d,e.name);if(e.isDirectory())w(q);else if(e.name.endsWith(".en"))files.push(q);}})(root);
function walk(en){
  let i=0;
  while(i<en.length){
    const o=en.indexOf(OPEN,i); if(o<0)break; const c=mc(en,o); if(c<0)break;
    const chunk=en.slice(o+1,c);
    const pa=chunk.lastIndexOf(PAY_OPEN), pb=chunk.lastIndexOf(PAY_CLOSE);
    if(chunk[0]===GEN&&pa>=0&&pb>pa){
      let p=null; try{p=PAY.decode(chunk.slice(pa+1,pb));}catch(_){}
      if(p){ const t=holeTypes(p), h=p.h||[];
        for(let k=0;k<t.length;k++) if(TIER2.has(t[k])) analyse(t[k],String(h[k]===undefined?"":h[k])); }
    }
    if(chunk[0]===GEN_NEST){const bo=chunk.indexOf("⟨"),bc=chunk.lastIndexOf("⟩");if(bo>=0&&bc>bo)walk(chunk.slice(bo+1,bc));}
    i=c+1;
  }
}
for(const f of files) walk(fs.readFileSync(f,"utf8"));
console.log("\n  TIER 2 -- ALL THREE PROPERTIES, over the holes the PAGE carries");
console.log("  type      holes   unparse  noSym   FIXED  decomp    word   exact |  before   after     NET");
const ord=Object.keys(R).sort((a,b)=>R[b].n-R[a].n);
let T={n:0,fixed:0,decomp:0,exact:0,before:0,after:0,unparse:0,noWrap:0};
for(const k of ord){const r=R[k];
  console.log("  "+k.padEnd(8)+String(r.n).padStart(7)+String(r.noWrap+r.unparse).padStart(10)+String(r.noSym).padStart(7)
    +String(r.fixed).padStart(8)+String(r.decomp).padStart(8)+String(r.word).padStart(8)+String(r.exact).padStart(8)
    +" |"+String(r.before).padStart(8)+String(r.after).padStart(8)+String(r.after-r.before).padStart(8));
  T.n+=r.n;T.fixed+=r.fixed;T.decomp+=r.decomp;T.exact+=r.exact;T.before+=r.before;T.after+=r.after;T.unparse+=r.unparse;T.noWrap+=r.noWrap;}
console.log("  "+"TOTAL".padEnd(8)+String(T.n).padStart(7)+String(T.unparse).padStart(10)+"".padStart(7)
  +String(T.fixed).padStart(8)+String(T.decomp).padStart(8)+"".padStart(8)+String(T.exact).padStart(8)
  +" |"+String(T.before).padStart(8)+String(T.after).padStart(8)+String(T.after-T.before).padStart(8));
console.log("\n  FIXED POINTS = the canon reaches in and hands back the SAME hole: "
  +T.fixed+" of "+T.n+"  ("+(T.fixed/T.n*100).toFixed(1)+"%)");

/* ---- ASSERTIONS ------------------------------------------------------------------------------- */
let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log("ok  - " + name); pass++; }
  catch (e) { console.log("FAIL: " + name + "\n      " + (e && e.message)); fail++; }
}

console.log("");
ok("where the canon DOES decompose, it is byte-exact — 100%, zero wrong bytes", () => {
  /* the one property that holds perfectly, and it is why the mechanism is not the problem */
  assert.ok(T.decomp > 2000, "the decomposing population vanished (" + T.decomp + ") — re-read this");
  assert.strictEqual(T.exact, T.decomp,
    (T.decomp - T.exact) + " of " + T.decomp + " decompositions did NOT refill byte-exact");
});

ok("MOST OF TIER 2 IS A FIXED POINT — the canon hands back the hole it was given", () => {
  /* THE FINDING. Guarded from both sides so it cannot rot into a slogan: if the fixed-point share
   * collapses, the canon has learned to decompose these and this must be RE-PRICED, not re-read. */
  const share = T.fixed / T.n;
  assert.ok(share > 0.5, "fixed points fell to " + (share * 100).toFixed(1) + "% — RE-PRICE tier 2");
  for (const t of ["args", "str", "obj", "arr", "fn"]) {
    assert.ok(R[t] && R[t].decomp === 0,
      "`" + t + "` now decomposes (" + (R[t] && R[t].decomp) + ") — that is good news, re-price it");
  }
});

ok("AND THE RECURSION LOSES — a decomposition can be byte-exact and still a no-op", () => {
  assert.ok(T.after > T.before,
    "net is now " + (T.after - T.before) + " — it PAYS, which is good news: update this test");
  assert.strictEqual(T.after - T.before, T.decomp,
    "the net is no longer exactly one payload mark per hole (" + (T.after - T.before)
    + " over " + T.decomp + ") — the sub-holes have started carrying different content, re-price");
});

ok("the unmeasured population is REPORTED, not folded into a pass rate", () => {
  /* class 7: a summary that cannot report the bad case. `chain`/`type`/`bind`/`body` have no honest
   * wrapper here, so they are named and counted rather than scored. */
  const unmeasured = ["chain", "type", "bind", "body"].reduce((n, t) => n + (R[t] ? R[t].n : 0), 0);
  assert.ok(unmeasured > 4000, "the unmeasured population moved (" + unmeasured + ") — restate it");
  assert.strictEqual(T.noWrap, unmeasured,
    "no-wrapper " + T.noWrap + " no longer equals the unmeasured types " + unmeasured
    + " — something measurable is being counted as unmeasured");
  /* and the genuinely-unparseable are reported on their own, never merged into the above */
  console.log("     unmeasured (no honest wrapper) " + T.noWrap
    + "  ·  genuinely unparseable " + T.unparse);
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
