"use strict";
/* ARCHETYPE PROSE on the round-tripping path (PRD §5 tier 1, rendered rather than generated).
 *
 * engine/archetypes.js holds hand-authored grammars for Entity / RouterModule / ReduxModule /
 * DtoBuilder and is deliberately NOT consumed here: wiring it in would add a second, partial
 * producer beside a total byte-exact one. These productions read the same AST facts and render
 * on the live path instead. The assertions below pin the sentence AND the floor it must not move.
 *
 * §10 compliance: the oracle is source through a round-trip; no mined artifact is an expectation. */
const assert = require("assert");
const ts = require("typescript");
const EN = require("./enfile");
const Q = require("./clause-quality");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const ENTITY = [
  "import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';",
  "",
  "@Entity('payment_plans')",
  "export class PaymentPlan {",
  "  @PrimaryGeneratedColumn()",
  "  id: number;",
  "",
  "  @Column({ type: 'int', nullable: false })",
  "  accountId: number;",
  "",
  "  @Column({ type: 'decimal', nullable: false })",
  "  amount: string;",
  "",
  "  @Column({ type: 'varchar', nullable: true })",
  "  note: string;",
  "",
  "  @ManyToOne(() => BillingAccount)",
  "  @JoinColumn({ name: 'account_id' })",
  "  billingAccount: BillingAccount;",
  "",
  "  @OneToMany(() => Installment, (i) => i.plan)",
  "  installments: Installment[];",
  "}",
  "",
].join("\n");

const ROUTER = [
  "import Router from '@koa/router';",
  "",
  "const planRouter = new Router({ prefix: '/plans' });",
  "planRouter.get('/', handler);",
  "planRouter.post('/:planId', handler);",
  "",
].join("\n");

const idx = EN.loadIndex("");

/* spanProse is the unit under test and is exercised DIRECTLY: a span only forms where the mined
 * dictionary already holds the word, so synthetic source produces no span and a label-scraping
 * test would pass vacuously against an empty list. The round-trip assertion below still goes
 * through renderFileEn, which is where the byte floor actually lives. */
function prose(src) {
  const sf = ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return [...sf.statements].map((st) => EN.spanProse([st], sf)).filter(Boolean);
}
const labelsOf = (src) => prose(src);

/* THE HARD FLOOR comes first: prose is label-region only and must never move a byte. */
ok("entity and router both round-trip byte-identical", () => {
  for (const src of [ENTITY, ROUTER]) assert.strictEqual(EN.compileFileEn(EN.renderFileEn(src, idx).en, idx), src);
});

ok("a decorated persistence class reads like the panel's grammar", () => {
  const lab = labelsOf(ENTITY).join(" ");
  assert.ok(/describe the stored record `PaymentPlan` in `payment_plans`/.test(lab), lab);
  assert.ok(/an auto-generated `id`/.test(lab), lab);
  assert.ok(/a required `accountId` \(int\)/.test(lab), lab);
  assert.ok(/a required `amount` \(decimal\)/.test(lab), lab);
  assert.ok(/an optional `note` \(varchar\)/.test(lab), lab);
});

ok("relations render as belongs-to / has-many with the join column", () => {
  const lab = labelsOf(ENTITY).join(" ");
  assert.ok(/belongs to a `BillingAccount` \(join `account_id`\)/.test(lab), lab);
  assert.ok(/has many `Installment`/.test(lab), lab);
});

ok("route registrations name the method and the path", () => {
  const lab = labelsOf(ROUTER).join(" ");
  assert.ok(/open the route group `planRouter` at `\/plans`/.test(lab), lab);
  assert.ok(/serve GET `\/`/.test(lab), lab);
  assert.ok(/serve POST `\/:planId`/.test(lab), lab);
});

/* The whole point is that this reads as English, so assert it with the METRIC, not by eye. */
ok("every archetype clause is English-complete and none is vacuous", () => {
  for (const src of [ENTITY, ROUTER]) for (const lab of labelsOf(src))
    for (const c of Q.clausesOf(lab)) {
      assert.ok(Q.isEnglishComplete(c), "not English-complete: " + c);
      assert.ok(!Q.isVacuous(c), "vacuous: " + c);
    }
});

/* A parenthesised TYPE WORD is prose; a parenthesised argument list is code. The idiom that lets
 * "(int)" through must not let an argument list through, or the scanner stops guarding. */
ok("the type-word idiom does not admit code", () => {
  assert.strictEqual(Q.isEnglishComplete("a required `amount` (decimal)"), true);
  for (const bad of ["call f(acc, i)", "call f(a.b)", "define (str: unknown) => x", "call h()"])
    assert.strictEqual(Q.isEnglishComplete(bad), false, bad);
});

console.log(`\n${pass} assertions passed`);
