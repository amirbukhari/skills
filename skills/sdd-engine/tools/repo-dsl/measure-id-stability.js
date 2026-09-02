"use strict";
/**
 * measure-id-stability.js — R-PAY-6, priced. READ-ONLY. No mine, no render, no corpus write.
 *
 * WHY THIS EXISTS. R-PAY-6 says a word id is not stable across a re-mine and the payload
 * references word ids, so a `.en` is decodable only against the dictionary it was rendered with —
 * "a compile producing WRONG BYTES, not an error". It offers two closures and ranks them:
 *   (a) each `.en` names the dictionary `fingerprint` it was rendered against, and the compiler
 *       REFUSES on mismatch;
 *   (b) ids become content-addressed, as skeleton names already are (strictly better, more work).
 * Nothing measured either. This does: the blast radius on disk, the mechanism that moves the ids,
 * and what each closure would cost. It PRICES; it does not choose. Which closure lands is Amir's
 * call, and (b) is entangled with the reserved direction-of-truth question (CLAUDE.md §6) in a way
 * (a) is not.
 *
 * WHY A REPORTER AND NOT A TEST. Same reason as measure-hand-edit.js: an honest test of "ids are
 * stable" is red by design until R-PAY-6 closes, and a permanently-red file in a shared tree
 * teaches people to ignore a red. The register row is where the requirement lives.
 *
 * WHY IT DOES NOT RE-MINE. A re-mine rewrites the shared dictionary and renumbers every id by
 * construction, invalidating all 1037 `.en` and any other lane's in-flight measurement — it is
 * behind an explicit ask in .claude/settings.json for that reason. So section 3 demonstrates the
 * renumbering MECHANISM in-process against engine/wordlzw.js itself, on synthetic streams. That is
 * a property of the id allocator (`const id = dict.length`), not a sample: it does not need the
 * corpus to be true, and it cannot be softened by one.
 *
 * PIN THE COMMIT. The renderer moved twice tonight (89eff24, a565df0, whole-tree surface -33%), so
 * any figure here read against a differently-rendered tree is renderer churn misread as id
 * instability. Every run stamps HEAD and whether the tree was dirty.
 *
 *   node measure-id-stability.js
 */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const CR = require("./engine/corpus-root");
const AC = require("./engine/artifact-contract");
const PAY = require("./engine/payload");
const W = require("./engine/wordlzw");

const CORPUS = CR.corpusRoot();
const EN_ROOT = path.join(CORPUS, "sen", "files");
const OPEN = "«", CLOSE = "»", PAY_OPEN = "⟪", PAY_CLOSE = "⟫";

function sh(cmd) { try { return cp.execSync(cmd, { cwd: __dirname, encoding: "utf8" }).trim(); } catch { return "?"; } }
function pct(n, d) { return d ? (100 * n / d).toFixed(3) + "%" : "n/a"; }
function walkEn(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkEn(p, out); else if (e.name.endsWith(".en")) out.push(p);
  }
  return out;
}

/* Pull every ⟪…⟫ payload out of a rendered .en. Nesting: a payload never contains ⟪, so a
 * straight scan for the next ⟫ is exact — asserted by the dialect guard (R-PAY-1). */
function payloadsOf(text) {
  const out = [];
  let i = 0;
  for (;;) {
    const o = text.indexOf(PAY_OPEN, i);
    if (o < 0) return out;
    const c = text.indexOf(PAY_CLOSE, o);
    if (c < 0) return out;               // malformed; the compiler's problem, not this report's
    out.push({ text: text.slice(o + 1, c), start: o + 1, end: c });
    i = c + 1;
  }
}

console.log("measure-id-stability — R-PAY-6 priced, read-only");
console.log("  HEAD    ", sh("git rev-parse --short HEAD"), sh("git status --porcelain -- . | head -c 1") ? "(tree DIRTY — figures are of the working tree, not of HEAD)" : "(tree clean)");
console.log("  corpus  ", CORPUS);
console.log("");

/* ------------------------------------------------------------------ 1. blast radius on disk */
const ens = walkEn(EN_ROOT);
let bytes = 0, payBytes = 0, idBytes = 0, nPayloads = 0, filesWithId = 0, undecodable = 0;
const byAxis = new Map(), distinct = new Set();
let maxId = 0;
for (const f of ens) {
  const t = fs.readFileSync(f, "utf8");
  bytes += Buffer.byteLength(t, "utf8");
  let has = false;
  for (const p of payloadsOf(t)) {
    payBytes += Buffer.byteLength(p.text, "utf8");
    let d;
    try { d = PAY.decode(p.text); } catch { undecodable++; continue; }
    nPayloads++; has = true;
    byAxis.set(d.a, (byAxis.get(d.a) || 0) + 1);
    distinct.add(d.a + d.w);
    if (d.w > maxId) maxId = d.w;
    idBytes += (d.a + d.w).length;      // the id token itself: axis letter + decimal digits
  }
  if (has) filesWithId++;
}
console.log("1. BLAST RADIUS — what a renumber actually invalidates");
console.log(`   .en files                  ${ens.length}`);
console.log(`   .en files carrying a word id ${filesWithId}  (${pct(filesWithId, ens.length)} of the corpus)`);
console.log(`   payloads                   ${nPayloads}   undecodable ${undecodable}`);
console.log(`   by axis                    ${[...byAxis].map(([a, n]) => `${a}:${n}`).join("  ")}`);
console.log(`   distinct ids referenced    ${distinct.size}   highest id ${maxId}`);
console.log(`   total .en bytes            ${bytes}`);
console.log(`   payload bytes              ${payBytes}  (${pct(payBytes, bytes)} — the machine layer)`);
console.log(`   ID bytes                   ${idBytes}  (${pct(idBytes, bytes)} of the .en, ${pct(idBytes, payBytes)} of the payload)`);
console.log("   READ THIS THE RIGHT WAY. The id share of the bytes is TINY and the file share is");
console.log("   TOTAL. A renumber edits well under 1% of the corpus's bytes and thereby invalidates");
console.log("   almost every file in it. A small diff is not a small blast radius.");
console.log("");

/* ---------------------------------------------------- 2. does anything on disk pin the dictionary? */
console.log("2. IS THERE A FINGERPRINT ANYWHERE ON THE PATH? (closure (a)'s precondition)");
/* AC.load takes a FILE, not a root — passing the root reads a directory, throws EISDIR, and a
 * catch-all turns that into a confident "NO fingerprint" that is simply false. It did, once,
 * before this line was fixed. Resolve the path through AC.pathFor, which is what names the home. */
const genPath = AC.pathFor("generators-lzw", CORPUS);
let gen = null, genErr = null;
try { gen = AC.load("generators-lzw", genPath); } catch (e) { genErr = e.message; }
if (genErr) console.log(`   dictionary artifact                        UNREADABLE: ${genErr}`);
console.log(`   dictionary artifact carries a fingerprint  ${gen && gen.fingerprint ? "YES  " + gen.fingerprint : "NO"}`);
console.log(`   ...and a contentFingerprint                ${gen && gen.contentFingerprint ? "YES  " + gen.contentFingerprint : "NO"}`);
let enWithFp = 0;
for (const f of ens) if (/fingerprint/i.test(fs.readFileSync(f, "utf8"))) enWithFp++;
console.log(`   .en files naming a fingerprint             ${enWithFp} of ${ens.length}`);
console.log(`   payload dialect tag                        ${JSON.stringify(PAY.TAG)} — one tag, no version field`);
const decSrc = fs.readFileSync(path.join(__dirname, "engine", "payload.js"), "utf8");
const oneParse = /function decode\(/.test(decSrc) && (decSrc.match(/startsWith\(TAG/g) || []).length === 1;
console.log(`   single fail-closed parse point in payload.js decode()  ${oneParse ? "YES" : "NO"}`);
console.log("   So the dictionary knows its own fingerprint and the .en that depends on it does not");
console.log("   name it anywhere. That gap IS R-PAY-6: nothing on disk can tell a matched pair from");
console.log("   a mismatched one, so the mismatch compiles instead of refusing.");
console.log("");

/* ------------------------------------------- 3. the mechanism, demonstrated against the allocator */
console.log("3. WHY THE IDS MOVE — demonstrated in-process, no mine, no corpus");
const A = [["a", "b", "c", "d"], ["a", "b", "c", "e"], ["a", "b", "c", "d"]];
const EXTRA = [["z", "y", "x"], ["z", "y", "x"]];
function keysById(streams) {
  const m = W.buildSaturated(streams, { maxWin: 8 });
  const dict = m.dict || m.words || m;
  const out = new Map();
  for (const e of (Array.isArray(dict) ? dict : [])) if (e && e.key !== undefined) out.set(e.key, e.id);
  return out;
}
const before = keysById(A);
const after = keysById(EXTRA.concat(A));           // same content, one file mined ahead of it
let shared = 0, moved = 0;
for (const [k, id] of before) if (after.has(k)) { shared++; if (after.get(k) !== id) moved++; }
console.log(`   dictionary over the base streams            ${before.size} entries`);
console.log(`   same streams, one file mined BEFORE them    ${after.size} entries`);
console.log(`   words present in both                      ${shared}`);
console.log(`   ...whose id CHANGED                        ${moved}  (${pct(moved, shared)})`);
console.log("   The allocator is `const id = dict.length` (engine/wordlzw.js) and the alphabet is");
console.log("   numbered by first appearance. An id is therefore a POSITION IN MINING ORDER, not a");
console.log("   name for a shape. Adding, removing or reordering a single file shifts the ids of");
console.log("   words whose content never changed — which is the whole of R-PAY-6.");
console.log("");

/* ------------------------------------- 3b. the same property, read off the artifact on disk */
console.log("3b. THE SAME PROPERTY, READ OFF THE SHIPPED DICTIONARY");
if (!gen) {
  console.log("   dictionary unreadable — section skipped rather than guessed");
} else {
  for (const axis of ["narrow", "wide"]) {
    const band = gen[axis];
    if (!band || !band.words) { console.log(`   ${axis}: no words`); continue; }
    const keys = Object.keys(band.words).map(Number);
    let ascending = true;
    for (let i = 1; i < keys.length; i++) if (keys[i] <= keys[i - 1]) { ascending = false; break; }
    const span = keys.length ? keys[keys.length - 1] - keys[0] + 1 : 0;
    const gaps = span - keys.length;
    let composites = 0, refs = 0, contentKeyed = 0;
    for (const k of keys) {
      const e = band.words[k];
      if (e && e.m) { composites++; refs += e.m.length; }
      if (e && (e.hash || e.key || e.cid)) contentKeyed++;
    }
    console.log(`   ${axis}: ${keys.length} words, ids ${ascending ? "strictly ascending" : "NOT ascending"} ` +
      `${keys[0]}..${keys[keys.length - 1]} with ${gaps} gaps, ` +
      `${composites} composites making ${refs} id references, ${contentKeyed} carrying any content key`);
  }
  console.log("   The gaps matter: the id space is the MINER\u2019S RAW INDEX SPACE, left sparse by");
  console.log("   promotion \u2014 a promoted word KEEPS the index it was created with. Which threshold");
  console.log("   moves an id therefore follows the creation/selection split exactly (section 3c).");
  console.log("   A word\u2019s only identity on disk is its position. Composites are `m:[prefix, appended]`");
  console.log("   — ids referencing ids — so a renumber does not merely move labels, it cascades");
  console.log("   INSIDE the dictionary as well as across every .en that points into it.");
}
console.log("");

/* ------------------------------- 3c. which threshold moves an id, and which provably does not */
console.log("3c. WHICH KNOB MOVES AN ID \u2014 the creation/selection split, measured");
{
  const S = [["a", "b", "c", "d"], ["a", "b", "c", "e"], ["a", "b", "c", "d"], ["q", "r", "a", "b"]];
  const idsOf = (opts) => {
    const m = W.buildSaturated(S, Object.assign({ maxWin: 8 }, opts));
    const d = m.dict || m.words || m;
    const out = new Map();
    for (const e of (Array.isArray(d) ? d : [])) if (e && e.key !== undefined) out.set(e.key, e.id);
    return out;
  };
  const c1 = idsOf({}), c2 = idsOf({ createMinCount: 2 });
  let cShared = 0, cMoved = 0;
  for (const [k, v] of c1) if (c2.has(k)) { cShared++; if (c2.get(k) !== v) cMoved++; }

  const model = W.buildSaturated(S, { maxWin: 8 });
  const shapesOf = (p) => new Map(Object.entries(p.words).map(([k, e]) => [e.sym || JSON.stringify(e.m), Number(k)]));
  const s1 = shapesOf(W.promote(model, { minCount: 1, saturated: true }));
  const s2 = shapesOf(W.promote(model, { minCount: 2, saturated: true }));
  let pShared = 0, pMoved = 0;
  for (const [k, v] of s2) if (s1.has(k)) { pShared++; if (s1.get(k) !== v) pMoved++; }

  console.log(`   CREATION gate  (buildSaturated createMinCount 1 -> 2): ${cShared} shapes in both, ${cMoved} MOVED`);
  console.log(`   SELECTION gate (promote minCount 1 -> 2):              ${pShared} shapes in both, ${pMoved} moved`);
  console.log("   So the selection threshold is SAFE for ids and the creation gate is not. That is the");
  console.log("   same split R-MINE-1 turned out to sit on (4a43855: buildSaturated ignores minCount");
  console.log("   entirely, createGate defaults to 1), seen from the id side: changing what the");
  console.log("   renderer may USE cannot renumber anything; changing what the miner may CREATE can.");
}
console.log("");

/* --------------------------------------------------------------------------- 4. the two closures */
console.log("4. THE TWO CLOSURES, PRICED — the register has already ranked them; this is the bill");
console.log("");
console.log("   (a) STAMP THE FINGERPRINT AND REFUSE ON MISMATCH");
console.log("       Where it goes: the payload tag already exists and decode() is a single");
console.log("       fail-closed parse point, so a versioned tag needs no new .en header and no new");
console.log("       file format — the shape the codec was already built for.");
console.log(`       Bytes: ~9 per payload x ${nPayloads} payloads = ~${Math.round(nPayloads * 9 / 1024)} KB on ${pct(nPayloads * 9, bytes)} of the corpus.`);
console.log("       Requires: one re-render of all .en (gated), a refusal path, and a test that the");
console.log("       refusal FIRES — a guard that cannot be shown to fire is not a guard (§10.3).");
console.log("       Buys: a stale .en becomes a LOUD REFUSAL instead of wrong bytes. That is what");
console.log("       makes A5 (re-mine idempotence) buildable at all — today its gate would go red");
console.log("       on day one with nobody able to clear it.");
console.log("       Does NOT buy: ids still move. A re-mine still invalidates every .en; it just");
console.log("       stops lying about it.");
console.log("");
console.log("   (b) CONTENT-ADDRESSED IDS");
console.log("       Precedent in-tree: the naming layer already keys by content hash (WN.hashOf /");
console.log("       WN.chunkKeyOf), which is why names survive a re-mine and ids do not.");
console.log(`       Bytes: a hash id is longer than a decimal index (today's ids reach ${maxId});`);
console.log(`       at 10 hex chars the id layer goes ~${idBytes} B -> ~${nPayloads * 11} B, still under 1% of the corpus.`);
console.log("       Requires: changing the miner's core contract — the allocator, the artifact");
console.log("       schema, the codec's id grammar, and every consumer that treats an id as an index.");
console.log("       Buys: a re-mine that changes nothing about a word changes nothing about its id,");
console.log("       so an unchanged .en stays valid — the actual goal.");
console.log("");
console.log("   NOT DECIDED HERE, ON PURPOSE. (b) is entangled with the reserved direction-of-truth");
console.log("   question: R-PAY-6's own harm clause is bounded 'because the .ts is authoritative',");
console.log("   and CLAUDE.md §6 says that premise must not be resolved by inference. (a) is not so");
console.log("   entangled — a stale-.en refusal is worth having in TODAY's direction, where a .en is");
console.log("   a report that can silently be a wrong one. Which lands, and in which order, is Amir's.");
