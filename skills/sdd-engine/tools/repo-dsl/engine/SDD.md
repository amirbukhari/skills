# `sdd` — spec-driven-dev CLI

One entry point (`engine/sdd.js`) over the four tiers this engine mines out of a real
TypeScript repo. Deterministic, zero model calls. It **generates** framework
scaffolding from a tiny authoring language, **narrates** existing files in plain
language, and **governs** whether a file still matches its architectural archetype.

```
node engine/sdd.js <command> ...
```

## The four tiers

A file is decomposed top-down, and each tier is byte-verified against source:

1. **archetype** — what *kind* of file it is (Entity, RouterModule, ReduxModule, DtoBuilder, …). Generative archetypes carry a template + typed slots.
2. **skeleton** — a body's control-flow shape as a sequence of statement KINDS (`ASSIGN FETCH RETURN` → `fetchReturn`), with the divergent expressions lifted to slots.
3. **idiom** — named cross-cutting statement words: `throwError`, `assertOrThrow`, `fetchAndValidate`.
4. **leaf** — the atomic statement/expression words the tiers above are built from.

## Commands

### `sdd generate <spec-file> [--out <file>] [--typecheck]`
Parse the SQL-like authoring grammar and **compile out a TypeScript file** (the
fill-forward compiler). `--out` writes the file; otherwise it prints to stdout.
`--typecheck` runs a real `tsc` pass on entities (a typeorm shim + stubs for the
imported targets/enums are synthesized in a throwaway dir); router/redux get a
syntactic check.

Grammar (detected from the first keyword — `entity` / `router` / `slice`):

```
entity RefundRequest table "refund_requests" {
  column id                 pk
  column invoice_id         int not-null
  column amount_minor_units int not-null
  column status             enum(ERefundStatus) not-null
  relation invoice ManyToOne(Invoice) join("invoice_id")
}
```
```
router refundRouter prefix "/refunds" {
  get "/:id"
  post "/"
}
```
```
slice accounts {
  reducer received
  reducer cleared
}
```

Example:
```
$ sdd generate RefundRequest.sdd --typecheck
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ERefundStatus } from './enums';
import { Invoice } from './Invoice';

@Entity('refund_requests')
export class RefundRequest {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column({ name: 'invoice_id', type: 'int', nullable: false })
  invoiceId!: number;
  ...
  @ManyToOne(() => Invoice)
  @JoinColumn([{ name: 'invoice_id', referencedColumnName: 'id' }])
  invoice!: Invoice;
}
# typecheck: CLEAN — 0 errors
```

### `sdd author <english-file> [--out <file>] [--typecheck]`
Author an entity in **controlled English** and compile it down the SAME slots → TypeScript
path as `sdd generate`. This is the inverse of `sdd render` (the prose view): reading and
writing become one language. The grammar is a strict CNL — a sentence that doesn't match is
**rejected with the offending phrase**, never guessed.

```
PaymentPlan is an entity stored in payment_plans. It has an auto-generated id,
a required account id (int), a required monthly amount (decimal), an optional
start date (datetime), and a required status (enum PaymentPlanStatus).
It belongs to a BillingAccount (join account_id). It has many Installment.
```
compiles to a valid TypeORM entity (`--typecheck` → `CLEAN — 0 errors`). Sentence forms:
`"<Class> is an entity stored in <table>."`; `"It has <field>, <field>, and <field>."`
(field = `"an auto-generated <words>"` | `"a required|an optional <words> [(<type>[ <EnumName>])]"`);
`"It belongs to a <Target> [(join <col>)]."` (ManyToOne); `"It has one <Target>."` (OneToOne);
`"It has many <Target>, ..."` (OneToMany); `"It relates to many <Target>, ..."` (ManyToMany).

The controlled form is *lossless* for the fields it carries and honest about the two it
cannot express: a **bespoke DB column name** that isn't the `snake_case` of the property, and
an **anonymous inline enum union** (it names enum *types*). See `../archive/author-roundtrip.js` (retired).

### `sdd render <projectDir> <relpath>`
Read the persisted tiers for a file and emit a **plain-language narrative**. Bespoke
bodies with no named skeleton are reported as "custom logic (N statements)" — never
invented — and each render prints the % that got a named/word description.

```
$ sdd render <proj> src/routers/accounts.ts
The `accountsRouter` router exposes 15 routes under `/accounts`.
- GET /:accountId — assigns a value, fetches a record, then assigns a value.
- PUT /:accountId — runs custom logic (10 statements).
...
— coverage: 13.4% named/word-described, 86.6% custom logic (7/15 bodies match a named skeleton; ...)
```
(Requires catalogs — run `sdd mine` first.)

### `sdd check <projectDir> [relpath]`
**Governance / drift.** Extract a file live and report whether it still conforms to
its archetype, with the residual. With no `relpath`, scan the whole project and list
every non-conformer. This is the "runtime logic snuck into an entity" finding:

```
$ sdd check <proj> src/entities/hydra/Credit.ts
src/entities/hydra/Credit.ts  [Entity]  NON-CONFORMING
  reason: residual top-level code: VariableStatement(const/let)
  slots: {"columns":24,"relations":8,"otherMembers":0,"preambleTypes":3}
```

### `sdd mine <projectDir> [--run]`
Rebuild the catalogs (archetype → skeleton → package). **Dry-run by default** — prints
the plan; pass `--run` to execute (writes into the project's `spec/` + `catalog/`).

## Honest scope

- **Generates** the *declarative* framework archetypes (entity/router/redux) from typed
  slots — the parts that are genuinely "archetype + values". It does **not** generate
  business logic; router handlers and reducer bodies are yours to write.
- **Narrates** structure faithfully and **marks the bespoke gaps** rather than
  inventing descriptions. Declarations read cleanly; handler bodies are mostly bespoke
  expression logic (the structure is known, the expressions are the divergence).
- The optional LLM naming pass (separate, gated, not invoked by these commands) would
  turn structural skeleton names into domain phrases; everything here is deterministic.
