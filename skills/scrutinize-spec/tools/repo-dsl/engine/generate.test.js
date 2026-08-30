"use strict";
/**
 * generate.test.js — runnable node test (exits non-zero on failure). Proves the
 * FORWARD compiler: DSL -> slots -> TypeScript, the round-trip assemble is
 * byte-lossless, and emitted code is syntactically valid + structurally an entity.
 */
const G = require("./generate.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* ---- DSL parses to the structured slot schema ---- */
{
  const dsl = `entity RefundRequest table "refund_requests" {
  column id pk
  column amount_minor_units int not-null
  column reason varchar nullable
  column status enum(ERefundStatus) not-null
  relation invoice ManyToOne(Invoice) join("invoice_id")
}`;
  const m = G.parseEntityDSL(dsl);
  eq(m.className, "RefundRequest", "dsl: className");
  eq(m.table, "refund_requests", "dsl: table");
  eq(m.members.length, 5, "dsl: 5 members");
  const cAmt = m.members[1];
  eq(cAmt.prop, "amountMinorUnits", "dsl: snake -> camel prop");
  eq(cAmt.name, "amount_minor_units", "dsl: db name kept");
  eq(cAmt.tsType, "number", "dsl: int -> number");
  eq(cAmt.nullable, false, "dsl: not-null");
  eq(m.members[2].nullable, true, "dsl: nullable flag");
  eq(m.members[3].tsType, "ERefundStatus", "dsl: enum type -> tsType");
  const rel = m.members[4];
  eq(rel.decorator, "ManyToOne", "dsl: relation decorator");
  eq(rel.target, "Invoice", "dsl: relation target");
  eq(rel.join, "invoice_id", "dsl: relation join column");
}

/* ---- canonical renderer emits the expected TypeScript ---- */
{
  const m = G.parseEntityDSL(`entity Widget table "widgets" {
  column id pk
  column label varchar not-null
}`);
  const src = G.emitEntityCanonical(m);
  ok(/@Entity\('widgets'\)/.test(src), "emit: @Entity(table)");
  ok(/export class Widget \{/.test(src), "emit: class decl");
  ok(/@PrimaryGeneratedColumn\(\)\n  id!: number;/.test(src), "emit: pk column");
  ok(/@Column\(\{ type: 'varchar', nullable: false \}\)\n  label!: string;/.test(src), "emit: plain column");
  ok(/import \{ Entity, Column, PrimaryGeneratedColumn \} from 'typeorm';/.test(src), "emit: typeorm imports");
  eq(G.parseValidity(src).ok, true, "emit: syntactically valid TS");
  const st = G.structuralEntityCheck(src);
  ok(st.ok && st.columns === 2 && st.className === "Widget", "emit: structurally a valid entity");
}

/* ---- round-trip: tile an existing source and assemble byte-identical ---- */
{
  const src = `import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { Client } from './Client';

@Entity('billing_accounts')
export class BillingAccount {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column({ name: 'client_type', type: 'enum', enum: EClientType, nullable: false })
  clientType!: EClientType;

  @ManyToOne(() => Client, (c) => c.accounts)
  client!: Client;
}
`;
  const t = G.tileEntity(src);
  ok(t.ok, "tile: ok");
  eq(t.className, "BillingAccount", "tile: className");
  eq(t.table, "billing_accounts", "tile: table");
  eq(G.assemble(t.segments), src, "tile: assemble is byte-identical");
  const cols = t.segments.filter((s) => s.kind === "column");
  const rels = t.segments.filter((s) => s.kind === "relation");
  eq(cols.length, 2, "tile: 2 column slots");
  eq(rels.length, 1, "tile: 1 relation slot");
  eq(cols[1].structured.prop, "clientType", "tile: parsed prop");
  eq(cols[1].structured.enum, "EClientType", "tile: parsed enum from @Column");
  eq(cols[1].structured.tsType, "EClientType", "tile: parsed TS property type");
}

/* ---- relation shapes render ---- */
{
  const m = G.parseEntityDSL(`entity Order table "orders" {
  column id pk
  relation lines OneToMany(OrderLine, "order")
}`);
  const src = G.emitEntityCanonical(m);
  ok(/@OneToMany\(\(\) => OrderLine, \(orderLine\) => orderLine\.order\)\n  lines!: OrderLine\[\];/.test(src), "emit: OneToMany with inverse");
  eq(G.parseValidity(src).ok, true, "emit: OneToMany valid TS");
}

/* ---- RouterModule (basic) ---- */
{
  const m = G.parseRouterDSL(`router invoiceRouter prefix "/invoices" {
  get "/:id"
  post "/"
}`);
  eq(m.prefix, "/invoices", "router: prefix");
  eq(m.routes.length, 2, "router: 2 routes");
  const src = G.emitRouterCanonical(m);
  ok(/new Router\(\{ prefix: '\/invoices' \}\)/.test(src), "router: emit prefix");
  ok(/invoiceRouter\.get\('\/:id', async \(ctx\) => \{/.test(src), "router: emit get route");
  eq(G.parseValidity(src).ok, true, "router: emit valid TS");
}

console.log(`generate.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
