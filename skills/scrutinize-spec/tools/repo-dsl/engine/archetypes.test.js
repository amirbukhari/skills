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
