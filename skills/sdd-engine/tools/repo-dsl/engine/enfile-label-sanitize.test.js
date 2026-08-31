"use strict";
// A composed-span label is embedded between the scanner sentinels « » ⟪ ⟫ (and a chunk starts
// with ▶). The label is display-only, but a throw MESSAGE could contain any of those characters,
// which would corrupt the span scan or the payload parse. This test proves every sentinel is
// stripped from the label, and that a file whose code carries a sentinel-laden throw still
// round-trips byte-identical.
const fs = require("fs");
const os = require("os");
const path = require("path");
const EN = require("./enfile");

let passed = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } passed++; console.log("  ok:", m); };
const SENTINELS = ["«", "»", "⟪", "⟫", "▶"];
const hasAny = (s) => SENTINELS.some((ch) => s.includes(ch));

/* 1. sanitizeLabel removes every sentinel */
const dirty = "start «a» then ⟪b⟫ and ▶c end";
const clean = EN.sanitizeLabel(dirty);
ok(!hasAny(clean), "sanitizeLabel strips all of « » ⟪ ⟫ ▶");
for (const ch of SENTINELS) ok(!clean.includes(ch), `sanitizeLabel removed "${ch}"`);

/* 2. genLabel over a slice whose throw message contains EVERY sentinel comes out clean */
const slice = [
  "const partner = getPartner(subs);",
  "if (!partner) {",
  '  throw new Error("bad « » ⟪ ⟫ ▶ input on this invoice");',
  "}",
  "await sync(subs);",
].join("\n");
const label = EN.genLabel(0, slice.length, slice, 3);
ok(typeof label === "string" && label.length > 0, "genLabel produced a label");
ok(!hasAny(label), "genLabel label contains NO sentinel even though the throw message had all five");
ok(/failing when/.test(label), "genLabel surfaced the guard as a 'failing when' clause");
console.log("  label:", label);

/* 3. a file whose code carries a sentinel-laden throw still round-trips byte-identical */
/* An EMPTY index on purpose: no gen spans, so this exercises the verbatim pipeline. It used to
 * ask for "/definitely/no/corpus/here", which worked only while a missing root fell back silently.
 * Under §8B a set-but-missing root REFUSES by design, so the fixture now uses a real EMPTY dir --
 * same empty index, no reliance on the failure mode the contract exists to remove. */
const EMPTY_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "enfile-empty-"));
const index = EN.loadIndex(EMPTY_ROOT);
const src = [
  "export async function run(subs) {",
  "  const partner = getPartner(subs);",
  '  if (!partner) { throw new Error("bad « » ⟪ ⟫ ▶ input"); }',
  "  return partner;",
  "}",
  "",
].join("\n");
const r = EN.renderFileEn(src, index);
const back = EN.compileFileEn(r.en, index);
ok(back === src, "file with a sentinel-laden throw round-trips byte-identical (.en -> .ts === source)");

/* 4. the MECHANISM, not just the outcome. Assertion 3 passed for two years' worth of corpus purely
 * because no .ts contained a sentinel; it went red the moment a fixture did. So assert the property
 * that makes it hold BY CONSTRUCTION: an escaped verbatim region emits no raw OPEN/CLOSE, and the
 * codec is a true round-trip over input that is adversarial about the escape marker itself. */
const nasty = "a«b»c⟡d⟡0e«»⟡«";
ok(EN.unescapeVerbatim(EN.escapeVerbatim(nasty)) === nasty,
   "escapeVerbatim/unescapeVerbatim round-trips text laden with sentinels AND the escape marker");
ok(!/[«»]/.test(EN.escapeVerbatim(nasty)),
   "escaped verbatim text contains no raw « or », so the span scanner cannot mis-open on it");
ok(EN.escapeVerbatim("plain code") === "plain code",
   "text with no sentinel is returned unchanged (no .en byte moves on the real corpus)");

/* 5. FAIL-CLOSED, matching PAY.decode. A hand-edited .en with a stray ⟡ is a question for the
 * author; guessing at it is how wrong bytes ship. */
let threw = null;
try { EN.compileFileEn("code ⟡Z more", index); } catch (e) { threw = e.message; }
ok(threw && /unknown escape/.test(threw), `compileFileEn refuses an unrecognised escape (${threw || "NO THROW"})`);

console.log(`\nPASS ${passed} assertions — labels are sentinel-safe and round-trip holds.`);
