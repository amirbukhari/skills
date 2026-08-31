"use strict";
/**
 * archetypes.test.js — runnable node test (exits non-zero on failure). Proves the
 * generative extractors tile a file into archetype scaffold + typed slots that
 * reconstruct byte-identical, extract the right slot schema, and honestly flag
 * NON-conforming files (residual top-level code) rather than absorbing them.
 */
const { extractEntity, extractRouter, extractRedux, extractBuilder, classifyFile, analyzeFile } = require("./archetypes.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* ---- ENTITY: byte-identical + typed columns/relations, conforms ---- */
{
  const src = `import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { Client } from './Client';

@Entity('billing_accounts')
export class BillingAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'client_type', type: 'enum', nullable: false })
  clientType!: string;

  @ManyToOne(() => Client, (c) => c.accounts)
  client!: Client;
}
`;
  const r = extractEntity(src, "BillingAccount.ts");
  ok(r.byteIdentical, "entity: reconstructs byte-identical");
  ok(r.conforms, "entity: conforms (no residual)");
  eq(r.slots.table, "billing_accounts", "entity: table name slot");
  eq(r.slots.className, "BillingAccount", "entity: class name slot");
  eq(r.counts.columns, 2, "entity: 2 column slots (id + clientType)");
  eq(r.counts.relations, 1, "entity: 1 relation slot");
  eq(r.slots.columns[1].parsed.name, "client_type", "entity: parsed column db-name");
  eq(r.slots.columns[1].parsed.type, "enum", "entity: parsed column type");
  eq(r.slots.relations[0].decorator, "ManyToOne", "entity: relation decorator kind");
}

/* ---- ENTITY: the PRD §5D.1 REFERENCE CASE — every fill the sentence needs must be extractable.
 * This is the regression guard for a defect byte-identity could not see: the join column name was
 * dropped from the relation slot, so re-mining a compiled entity could not reproduce the sentence
 * *"It belongs to a BillingAccount (join account_id)"* while byte-identity stayed green. The
 * assertions below are one per CLAUSE of the reference sentence, so a future change that silently
 * drops a fill fails here by name rather than showing up as an unexplained .en diff. ---- */
{
  const src = `import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';

@Entity('payment_plans')
export class PaymentPlan {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', nullable: false })
  accountId!: number;

  @Column({ type: 'decimal', nullable: false })
  amount!: string;

  @Column({ type: 'varchar', nullable: true })
  note?: string;

  @Column({ type: 'enum', enum: EPaymentPlanStatus, nullable: false })
  status!: EPaymentPlanStatus;

  @ManyToOne(() => BillingAccount)
  @JoinColumn({ name: 'account_id' })
  account!: BillingAccount;

  @OneToMany(() => Installment, (i) => i.paymentPlan)
  installments!: Installment[];
}
`;
  const r = extractEntity(src, "PaymentPlan.ts");
  ok(r.byteIdentical, "ref case: reconstructs byte-identical");
  ok(r.conforms, "ref case: conforms");
  // "PaymentPlan is an entity stored in payment_plans."
  eq(r.slots.className, "PaymentPlan", "ref: className fill");
  eq(r.slots.table, "payment_plans", "ref: table fill");
  // the panel's own report: "entity PaymentPlan, 5 cols, 2 rels"
  eq(r.counts.columns, 5, "ref: 5 column slots");
  eq(r.counts.relations, 2, "ref: 2 relation slots");
  // "an auto-generated id" — the alternative that carries NO type and NO nullability
  eq(r.slots.columns[0].decorator, "PrimaryGeneratedColumn", "ref: auto-generated id alternative");
  ok(r.slots.columns[0].parsed.type === undefined, "ref: auto-generated id carries no type fill");
  // "a required amount (decimal)" / "an optional note (varchar)"
  eq(r.slots.columns[2].parsed.type, "decimal", "ref: amount type fill");
  eq(r.slots.columns[2].parsed.nullable, "false", "ref: amount is required");
  eq(r.slots.columns[3].parsed.nullable, "true", "ref: note is optional");
  // "a required status (enum EPaymentPlanStatus)"
  eq(r.slots.columns[4].parsed.enum, "EPaymentPlanStatus", "ref: status enum fill");
  // "It belongs to a BillingAccount (join account_id)." — the fill that used to be DROPPED
  eq(r.slots.relations[0].parsed.kind, "ManyToOne", "ref: belongs-to alternative");
  eq(r.slots.relations[0].parsed.target, "BillingAccount", "ref: belongs-to target fill");
  eq(r.slots.relations[0].parsed.join, "account_id", "ref: JOIN COLUMN fill (the dropped one)");
  // "It has many Installments."
  eq(r.slots.relations[1].parsed.kind, "OneToMany", "ref: has-many alternative");
  eq(r.slots.relations[1].parsed.target, "Installment", "ref: has-many target fill");
  // a bare @JoinTable() means "present, name implied" — distinguishable from no join at all
  const mm = extractEntity(`import { Entity, ManyToMany, JoinTable } from 'typeorm';
@Entity('t') export class T {
  @ManyToMany(() => Tag)
  @JoinTable()
  tags!: Tag[];
}
`, "T.ts");
  eq(mm.slots.relations[0].parsed.join, true, "implied join name is `true`, not absent");
  ok(mm.slots.relations[0].parsed.joinDecorator === "JoinTable", "JoinTable is named as the join decorator");
}

/* ---- ENTITY: non-conforming when a helper fn sits alongside the entity ---- */
{
  const src = `import { Entity, Column } from 'typeorm';
@Entity('t') export class T { @Column() a!: string; }
export function helper() { return 1; }
`;
  const r = extractEntity(src, "T.ts");
  ok(r.byteIdentical, "entity+helper: still tiles byte-identical (residual absorbed, not lost)");
  ok(!r.conforms, "entity+helper: flagged NON-conforming");
  ok(/residual/.test(r.reason || ""), "entity+helper: reason names residual code");
}

/* ---- ENTITY: co-located enum is a TYPED preamble slot, still conforms ---- */
{
  const src = `import { Entity, Column } from 'typeorm';

export enum EStatus { A = 'a', B = 'b' }

@Entity('things')
export class Thing {
  @Column({ type: 'enum', enum: EStatus })
  status!: EStatus;
}
`;
  const r = extractEntity(src, "Thing.ts");
  ok(r.byteIdentical, "entity+enum: byte-identical");
  ok(r.conforms, "entity+enum: conforms (enum is a typed preambleType slot, not residual)");
  eq(r.counts.preambleTypes, 1, "entity+enum: 1 preamble type slot");
  eq(r.slots.preambleTypes[0].name, "EStatus", "entity+enum: preamble type name captured");
}

/* ---- ENTITY: a runtime helper fn is STILL residual (not loosened) ---- */
{
  const src = `import { Entity, Column } from 'typeorm';
export enum E { A }
@Entity('t') export class T { @Column() a!: string; }
export function helper() { return 1; }
`;
  const r = extractEntity(src, "T2.ts");
  ok(!r.conforms, "entity+enum+fn: still NON-conforming (runtime helper is residual)");
  ok(/residual/.test(r.reason || "") && /Function/.test(r.reason || ""), "entity+enum+fn: reason names the function residual, not the enum");
}

/* ---- ROUTER: prefix + route slots, byte-identical, conforms ---- */
{
  const src = `import Router from 'koa-router';
export const invoiceRouter = new Router({ prefix: '/invoices' });
invoiceRouter.get('/:id', async (ctx) => { ctx.body = 1; });
invoiceRouter.post('/', async (ctx) => { ctx.body = 2; });
`;
  const r = extractRouter(src, "invoices.ts");
  ok(r.byteIdentical, "router: reconstructs byte-identical");
  ok(r.conforms, "router: conforms");
  eq(r.slots.prefix, "/invoices", "router: prefix slot");
  eq(r.counts.routes, 2, "router: 2 route slots");
  eq(r.slots.routes[0].method, "get", "router: route0 method");
  eq(r.slots.routes[0].path, "/:id", "router: route0 path");
  ok(r.slots.routes[0].hasHandler, "router: route0 has handler body slot");
}

/* ---- ROUTER: non-conforming with top-level helper code ---- */
{
  const src = `import Router from 'koa-router';
const r = new Router();
r.get('/', (ctx) => {});
const helper = () => { doStuff(); };
helper();
`;
  const r = extractRouter(src, "x.ts");
  ok(!r.conforms, "router+topcode: NON-conforming");
  ok(r.byteIdentical, "router+topcode: still byte-identical");
}

/* ---- REDUX: slice name + reducer case slots ---- */
{
  const src = `import { createSlice } from '@reduxjs/toolkit';
export const accountsSlice = createSlice({
  name: 'accounts',
  initialState: { list: [] },
  reducers: { received(s, a) { s.list = a.payload; }, cleared(s) { s.list = []; } },
});
`;
  const r = extractRedux(src, "accountsSlice.ts");
  ok(r.conforms, "redux: conforms");
  eq(r.slots.name, "accounts", "redux: slice name slot");
  eq(r.counts.reducers, 2, "redux: 2 case-reducer slots");
  ok(r.slots.hasInitialState, "redux: initialState detected");
}

/* ---- BUILDER: chain methods + build ---- */
{
  const src = `export class QueryBuilder {
  private parts: string[] = [];
  where(x: string) { this.parts.push(x); return this; }
  limit(n: number) { this.parts.push(String(n)); return this; }
  build() { return this.parts.join(' '); }
}
`;
  const r = extractBuilder(src, "QueryBuilder.ts");
  ok(r.byteIdentical, "builder: byte-identical");
  ok(r.conforms, "builder: conforms");
  eq(r.counts.chainMethods, 2, "builder: 2 chain methods");
  eq(r.counts.buildMethods, 1, "builder: 1 build method");
}

/* ---- classifyFile routes the shapes to the right archetype ---- */
{
  eq(classifyFile(analyzeFile("BillingAccount.ts", "import {Entity,Column} from 'typeorm';\n@Entity('t') export class T { @Column() a!:string; }")), "Entity", "classify: Entity");
  eq(classifyFile(analyzeFile("s.ts", "import {createSlice} from '@reduxjs/toolkit';\nexport const s = createSlice({name:'x',reducers:{}});")), "ReduxModule", "classify: ReduxModule");
}

console.log(`archetypes.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
