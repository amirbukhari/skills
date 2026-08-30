"use strict";
/**
 * author.test.js — runnable node test (exits non-zero on failure). Proves the
 * controlled-English parser maps sentences to the generator's slot schema, is
 * STRICT (rejects non-grammar), round-trips slots via render->parse, and that
 * English -> generate emits valid TypeScript.
 */
const Au = require("./author.js");
const G = require("./generate.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* ---- parse: full entity ---- */
{
  const en = `PaymentPlan is an entity stored in payment_plans. It has an auto-generated id, a required account id (int), a required monthly amount (decimal), an optional start date (datetime), and a required status (enum PaymentPlanStatus). It belongs to a BillingAccount (join account_id). It has many Installment.`;
  const m = Au.parseEntityCNL(en);
  eq(m.className, "PaymentPlan", "parse: className");
  eq(m.table, "payment_plans", "parse: table");
  const cols = m.members.filter((x) => x.role === "column");
  const rels = m.members.filter((x) => x.role === "relation");
  eq(cols.length, 5, "parse: 5 columns");
  eq(cols[0].pk, true, "parse: pk column");
  eq(cols[1].prop, "accountId", "parse: prop camelCase");
  eq(cols[1].name, "account_id", "parse: db name snake");
  eq(cols[1].colType, "int", "parse: type");
  eq(cols[1].nullable, false, "parse: required -> not null");
  eq(cols[2].tsType, "string", "parse: decimal -> string tsType");
  eq(cols[3].nullable, true, "parse: optional -> nullable");
  eq(cols[3].tsType, "Date", "parse: datetime -> Date");
  eq(cols[4].colType, "enum", "parse: enum type");
  eq(cols[4].enum, "PaymentPlanStatus", "parse: enum name");
  eq(rels.length, 2, "parse: 2 relations");
  const bo = rels.find((r) => r.decorator === "ManyToOne");
  eq(bo.target, "BillingAccount", "parse: belongs-to target");
  eq(bo.join, "account_id", "parse: join column");
  eq(rels.find((r) => r.decorator === "OneToMany").target, "Installment", "parse: has-many target");
}

/* ---- strictness: reject non-grammar, point at the phrase ---- */
{
  let threw = false; try { Au.parseEntityCNL("PaymentPlan holds some payments."); } catch (e) { threw = /opening sentence/.test(e.message); }
  ok(threw, "strict: rejects bad opening sentence");
  threw = false; try { Au.parseEntityCNL("X is an entity stored in xs. It has a shiny account id (int)."); } catch (e) { threw = /cannot parse field phrase/.test(e.message) && /shiny/.test(e.message); }
  ok(threw, "strict: rejects unknown field phrase and names it");
  threw = false; try { Au.parseEntityCNL("X is an entity stored in xs. It wobbles a lot."); } catch (e) { threw = /unrecognized sentence/.test(e.message); }
  ok(threw, "strict: rejects unrecognized sentence");
}

/* ---- render -> parse round-trip is slot-identical ---- */
{
  const norm = {
    className: "Order", table: "orders",
    columns: [
      { prop: "id", pk: true, nullable: false, type: null, enum: null, name: null },
      { prop: "customerName", pk: false, nullable: false, type: "varchar", enum: null, name: "customer_name" },
      { prop: "shippedAt", pk: false, nullable: true, type: "timestamp", enum: null, name: "shipped_at" },
      { prop: "state", pk: false, nullable: false, type: "enum", enum: "EOrderState", name: "state" },
    ],
    relations: [
      { decorator: "ManyToOne", target: "Customer" },
      { decorator: "OneToMany", target: "OrderLine" },
      { decorator: "OneToMany", target: "Payment" },
    ],
  };
  const english = Au.renderEntityCNL(norm);
  ok(/Order is an entity stored in orders\./.test(english), "render: opener");
  ok(/an auto-generated id/.test(english), "render: pk");
  ok(/a required customer name \(varchar\)/.test(english), "render: column");
  ok(/a required state \(enum EOrderState\)/.test(english), "render: enum column");
  ok(/It belongs to a Customer\./.test(english), "render: belongs-to");
  ok(/It has many OrderLine and Payment\./.test(english), "render: has-many list");
  const m = Au.parseEntityCNL(english);
  const round = { columns: Au.normColumnsFromModel(m), relations: Au.normRelationsFromModel(m) };
  const cmp = Au.slotsEqual({ columns: norm.columns, relations: norm.relations }, round);
  ok(cmp.equal, `round-trip: slot-identical (${cmp.why || ""})`);
}

/* ---- English -> generate emits valid TypeScript ---- */
{
  const m = Au.parseEntityCNL("Widget is an entity stored in widgets. It has an auto-generated id, and a required label (varchar).");
  const code = G.emitEntityCanonical(m);
  ok(/@Entity\('widgets'\)/.test(code), "emit: @Entity");
  ok(/@Column\(\{ name: 'label', type: 'varchar', nullable: false \}\)\n  label!: string;/.test(code), "emit: column");
  eq(G.parseValidity(code).ok, true, "emit: valid TS");
}

console.log(`author.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
