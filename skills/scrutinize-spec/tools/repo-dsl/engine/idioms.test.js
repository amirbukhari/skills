"use strict";
// Guardrail: fetchAndValidate must byte-verify and collapse variants to one word.
const { findFetchAndValidate, fill } = require("./idioms");
let passed = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } passed++; console.log("  ok:", m); };

const SRC = `import { Invoice, Payment } from './e';
async function a(manager, id) {
  const invoice = await manager.findOne(Invoice, { where: { id } });
  if (!invoice) { throw new Error('no invoice'); }
  return invoice;
}
async function b(getManager, pid) {
  const payment = await getManager('hydra').findOne(Payment, { where: { pid } });
  if (!payment) {
    return null;
  }
  return payment;
}
function c(rows, x) {
  const row = rows.find((r) => r.id === x);
  if (!row) throw new Error('missing');
  return row;
}
`;

const inst = findFetchAndValidate(SRC, "s.ts");
ok(inst.length === 3, `found all 3 fetch-and-validate sites (got ${inst.length})`);
ok(inst.every((i) => i.byteIdentical), "every member byte-identical (fill(template,params) === source span)");
ok(inst.every((i) => fill(i.template, Object.entries(i.params).map(([name, text]) => ({ name, text }))) !== undefined), "templates fillable");
// they differ by receiver / selector / opts / guard / action but share ONE normalized shape
ok(new Set(inst.map((i) => i.normShape)).size === 1, "all members collapse to ONE normalized shape (the single word)");
ok(inst[0].params.recv === "manager" && inst[1].params.recv === "getManager('hydra')" && inst[2].params.recv === "rows",
  "receiver chain captured as a slot (manager / getManager('hydra') / rows)");
ok(inst[0].selector === "findOne" && inst[2].selector === "find", "find-variant captured as a slot");
ok(inst[0].actionKind === "throw" && inst[1].actionKind === "return", "guard action (throw/return) captured");
ok(inst[2].braced === false && inst[0].braced === true, "braced and single-line guards both matched byte-exact");

ok(inst[0].byteIdentical, "span reproduced byte-for-byte (byteIdentical flag)");

console.log(`\nALL ${passed} assertions passed.`);
