"use strict";
/**
 * Guardrail test: the lift knob must NEVER break byte-identity. Whatever token
 * classes are lifted to slots, tokens+gaps must still refill the exact source.
 *   node engine/fanout.lift.test.js
 */
const { tokenize, fill } = require("./fanout");

let passed = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } passed++; console.log("  ok:", m); };

const SAMPLE = `import { BILLING_TYPE_X } from '@shared';
const flag: boolean = true;
const nn = null;
export function calc(usages: ISubscriptionUsage[], n: number): ICost[] {
  // NOTE: keep this comment
  const done = false;
  return usages.filter((u) => u.id === 1).map((u) => ({ ...u, ok: true, price: 2.5 }));
}
`;

const LIFTS = [
  ["no lift", undefined],
  ["bool", { bool: true }],
  ["type", { type: true }],
  ["nullc", { nullc: true }],
  ["all", { bool: true, type: true, nullc: true }],
];

for (const [label, lift] of LIFTS) {
  const { tokens, gaps } = tokenize("s.ts", SAMPLE, lift);
  const items = [
    ...tokens.map((t) => ({ s: t.start, txt: fill(t.templateParts, t.slots) })),
    ...gaps.map((g) => ({ s: g.start, txt: g.text })),
  ].sort((a, b) => a.s - b.s);
  ok(items.map((i) => i.txt).join("") === SAMPLE, `byte-identity preserved under lift=[${label}]`);
}

// lifting bool/type/null must actually change the SHAPE (the slots are lifted),
// while keeping refill exact — otherwise the knob is a no-op bug.
const base = tokenize("s.ts", SAMPLE, undefined).tokens.map((t) => t.shape).join("\n");
const all = tokenize("s.ts", SAMPLE, { bool: true, type: true, nullc: true }).tokens.map((t) => t.shape).join("\n");
ok(base !== all, "lift=all changes the shape stream (bool/type/null actually lifted)");
ok(/BOOL/.test(all) && /TYPE/.test(all) && /NULLC/.test(all), "lifted shapes carry BOOL/TYPE/NULLC slot kinds");

console.log(`\nALL ${passed} assertions passed.`);
