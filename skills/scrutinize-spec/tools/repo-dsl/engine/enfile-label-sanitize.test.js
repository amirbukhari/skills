"use strict";
// A composed-span label is embedded between the scanner sentinels « » ⟪ ⟫ (and a chunk starts
// with ▶). The label is display-only, but a throw MESSAGE could contain any of those characters,
// which would corrupt the span scan or the payload parse. This test proves every sentinel is
// stripped from the label, and that a file whose code carries a sentinel-laden throw still
// round-trips byte-identical.
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
const index = EN.loadIndex("/definitely/no/corpus/here"); // empty index: no gen spans, exercises the pipeline
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

console.log(`\nPASS ${passed} assertions — labels are sentinel-safe and round-trip holds.`);
