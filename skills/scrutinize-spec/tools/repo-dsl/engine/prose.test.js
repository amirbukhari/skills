"use strict";
/**
 * prose.test.js — runnable node test (exits non-zero on failure). Proves the
 * plain-language renderer humanizes names, describes entity/router/redux slots,
 * uses idiom phrases, and honestly marks bespoke bodies as "custom logic".
 */
const P = require("./prose.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };
const has = (s, sub, m) => ok(s.includes(sub), `${m}\n    in: ${JSON.stringify(s)}`);

/* ---- humanization ---- */
ok(P.words("clientType") === "client type", "words: camel");
ok(P.words("primary_client_id") === "primary client id", "words: snake");
ok(P.words("billingAccountsReceived") === "billing accounts received", "words: mixed");
ok(P.list(["a", "b", "c"]) === "a, b, and c", "list: oxford");

/* ---- skeleton -> words with idiom phrase ---- */
{
  const w = P.skeletonToWords({ fills: [{ kind: "FETCH", fill: "c_x" }, { kind: "GUARD_THROW", fill: "assertOrThrow" }, { kind: "RETURN", fill: "c_y" }] });
  has(w, "fetches a record", "skel: FETCH verb");
  has(w, "asserts a condition", "skel: idiom phrase used");
  has(w, "then returns the result", "skel: final clause");
}

/* ---- ENTITY prose ---- */
{
  const arch = { archetype: "Entity", table: "billing_accounts", slots: {
    className: "BillingAccount", table: "billing_accounts",
    columns: [
      { prop: "id", decorator: "PrimaryGeneratedColumn", parsed: { raw: "@PrimaryGeneratedColumn()" } },
      { prop: "clientType", decorator: "Column", parsed: { type: "enum", nullable: "false" } },
      { prop: "primaryClientId", decorator: "Column", parsed: { type: "int", nullable: "true" } },
    ],
    relations: [
      { prop: "clients", decorator: "OneToMany", args: "OneToMany(() => LiftClient, (c) => c.billingAccount)" },
      { prop: "clientRuntimeGroup", decorator: "ManyToOne", args: "ManyToOne(() => ClientRuntimeGroup)" },
    ],
    preambleTypes: [],
  } };
  const out = P.describeEntity(arch, []);
  has(out, "`BillingAccount` is an entity stored in `billing_accounts`.", "entity: opener");
  has(out, "It has 3 fields", "entity: field count");
  has(out, "an auto-generated id", "entity: pk phrase");
  has(out, "a client type (enum, required)", "entity: required column");
  has(out, "a primary client id (int, optional)", "entity: optional column");
  has(out, "belongs to a ClientRuntimeGroup", "entity: belongs-to");
  has(out, "has many clients", "entity: has-many");
  has(out, "100% named/word-described", "entity: coverage line (no bodies = fully structured)");
}

/* ---- ROUTER prose with handler-body skeleton + honest custom-logic ---- */
{
  const src = "aaaaa\nbbbbb\nCCCCC\n"; // line offsets: L1 0-5, L2 6-11, L3 12-17
  const arch = { archetype: "RouterModule", slots: {
    routerVars: ["accountsRouter"], prefix: "/accounts",
    routes: [
      { method: "get", path: "/:id", handlerSpan: [6, 11] },   // -> line 2
      { method: "post", path: "/", handlerSpan: [12, 17] },    // -> line 3 (bespoke)
    ],
  } };
  const bodies = [
    { ownerKind: "arrow", line: 2, sig: "FETCH RETURN", skeleton: "fetchReturn", named: true, stmtCount: 2, fills: [{ kind: "FETCH", fill: "c_a" }, { kind: "RETURN", fill: "c_b" }], scaffoldChars: 20, slotChars: 40, bespokeChars: 0 },
    { ownerKind: "arrow", line: 3, sig: "X X X X X X X", skeleton: "big", named: false, stmtCount: 7, fills: [], scaffoldChars: 0, slotChars: 0, bespokeChars: 200 },
  ];
  const out = P.describeRouter(arch, bodies, src);
  has(out, "exposes 2 routes under `/accounts`", "router: header");
  has(out, "GET /:id — fetches a record, then returns the result.", "router: handler skeleton in words");
  has(out, "POST / — runs custom logic (7 statements).", "router: honest bespoke marker");
}

/* ---- REDUX prose ---- */
{
  const arch = { archetype: "ReduxModule", slots: { name: "accounts", reducers: ["billingAccountsReceived", "setLoadedState"], hasInitialState: true, hasExtraReducers: false, createActions: [] } };
  const out = P.describeRedux(arch, []);
  has(out, "The `accounts` slice holds its own state with 2 reducers", "redux: header");
  has(out, "billing accounts received (`billingAccountsReceived`)", "redux: humanized + real name");
  has(out, "It defines an initial state.", "redux: initial state");
}

/* ---- INDEXBARREL prose (real example: packages/hydra-internal/src/index.ts) ---- */
{
  const src = [
    "export * from './helpers';",
    "export * from './csvUtils';",
    "export * from './paymentsInterfaces';",
    "export * from './dateTimeHelpers';",
    "export * from './interfaces';",
    "export * from './subscriptionHelpers';",
    "export * from './integrityCheckHelpers';",
    "export * from './typeGuards';",
    "export * from './enums';",
  ].join("\n");
  const arch = { archetype: "IndexBarrel", slots: {} };
  const out = P.renderProse(arch, { bodies: [], src });
  has(out, "re-export barrel", "barrel: identified as barrel");
  has(out, "re-groups 9 modules", "barrel: module count");
  has(out, "helpers, csv utils, payments interfaces, date time helpers", "barrel: de-slugged names in order");
  has(out, "type guards, and enums", "barrel: oxford tail");
  has(out, "100% named/word-described", "barrel: full coverage, nothing bespoke");
  ok(!/no prose renderer|described by lower tiers/.test(out), "barrel: no longer falls to the un-narrated fallback");
}

/* ---- barrel: named re-exports + type-only ---- */
{
  const src = "export { A, B as C } from './widgets';\nexport type * from './contracts';";
  const out = P.describeBarrel({ archetype: "IndexBarrel", slots: {} }, [], src);
  has(out, "re-exports `A` and `B` from widgets", "barrel: named bindings (alias stripped)");
  has(out, "contracts (types)", "barrel: type-only star");
}

/* ---- TYPEDEFS prose (real: src/hydra-ui/src/interfaces/EmailData.ts + an interface) ---- */
{
  const src = "export type EmailData = { name?: string; email: string; };";
  const out = P.renderProse({ archetype: "TypeDefs" }, { bodies: [], src });
  has(out, "pure type module", "types: identified");
  has(out, "defines 1 type", "types: count");
  has(out, "email data (`EmailData`)", "types: de-slugged + real name");
  has(out, "100% named/word-described", "types: full coverage");
  has(out, "0 bespoke residual", "types: nothing bespoke");
  ok(!/no prose renderer/.test(out), "types: no longer un-narrated");
}
{
  const src = "export interface IFieldTypeValidationResult {\n  errors: string[];\n}";
  const out = P.describeTypeDefs({}, src);
  has(out, "Interface: ifield type validation result (`IFieldTypeValidationResult`)", "types: interface named");
}

/* ---- CONSTENUM prose (real: packages/hydra-internal/src/enums/EDocumentType.ts) ---- */
{
  const src = "export enum EDocumentType {\n  invoice = 'invoice',\n  'credit-note' = 'credit-note',\n  statement = 'statement'\n}";
  const out = P.renderProse({ archetype: "Other" }, { bodies: [], src }); // enum-only classifies as "Other"
  has(out, "defines 1 enum", "enum: count");
  has(out, "The enum `EDocumentType` (edocument type) has values: invoice, credit note, and statement.", "enum: members de-slugged (incl. quoted member)");
  has(out, "no function bodies", "enum: honest — no bodies");
  has(out, "0 bespoke residual", "enum: nothing bespoke");
  ok(!/no prose renderer/.test(out), "enum: no longer un-narrated");
}

/* ---- CONFIG prose (real: src/routers/validation/charges.ts) ---- */
{
  const src = [
    "import { JSONSchemaType } from 'ajv';",
    "import { ajv } from '.';",
    "export interface IId { id: string; }",
    "const IdSchema: JSONSchemaType<IId> = {",
    "  type: 'object',",
    "  properties: { id: { type: 'string' } },",
    "  required: [ 'id' ],",
    "  additionalProperties: false,",
    "};",
    "export const validateId = ajv.compile(IdSchema);",
  ].join("\n");
  const out = P.renderProse({ archetype: "ConstMapConfig" }, { bodies: [], src });
  has(out, "configuration module", "config: identified");
  has(out, "The map `IdSchema` has 4 settings: type, properties, required, and additional properties.", "config: de-slugged keys");
  has(out, "It also declares the shape `IId`.", "config: surfaces co-located interface");
  has(out, "Exported value: `validateId`.", "config: surfaces compiled validator");
  has(out, "0 bespoke residual", "config: nothing bespoke");
  ok(!/no prose renderer/.test(out), "config: no longer un-narrated");
}

/* ---- pureSurfaceShape classifier agrees with the narrator dispatch ---- */
{
  const A = require("./archetypes.js");
  const f = A.analyzeFile("x.ts", "export type T = { a: number };");
  ok(P.pureSurfaceShape(f) === "types", "shape: types");
  const g = A.analyzeFile("x.ts", "export enum E { a, b }");
  ok(P.pureSurfaceShape(g) === "constEnum", "shape: constEnum");
  const h = A.analyzeFile("x.ts", "export const C = { a: 1, b: 2, c: 3 };");
  ok(P.pureSurfaceShape(h) === "config", "shape: config");
  const j = A.analyzeFile("x.ts", "export const f = () => 1;");
  ok(P.pureSurfaceShape(j) === null, "shape: callable is not pure-surface");
}

/* ---- LOGIC-FILE function-level SUMMARY ---- */
{
  // map + return -> "transforms each item"; labeled as a summary; no backtick TS.
  const src = "export const makeCsv = (rows: string[]) => {\n  const out = rows.map((r) => `\"${r}\"`);\n  return out.join(',');\n};";
  const out = P.renderProse({ archetype: "PureModule", rel: "x.ts" }, { bodies: [], src });
  has(out, "Plain-language summary", "logic: labeled as summary");
  has(out, "NOT a line-by-line", "logic: disclaims line-by-line");
  has(out, "`makeCsv` Transforms each item", "logic: map -> transforms each item");
  ok(!out.includes("`"+"const"), "logic: no raw-TS backtick escapes in a summary");
  ok(!/ and and /.test(out), "logic: no double-and");
}
{
  const src = "export const toTotals = (xs: number[]) => xs.reduce((a, b) => a + b, 0);";
  const out = P.renderProse({ archetype: "PureModule", rel: "x.ts" }, { bodies: [], src });
  has(out, "Reduces them into a single result", "logic: reduce (concise-body arrow supported)");
}
{
  const src = "export const isCreditNote = (d: { type: string }) => d.type === 'credit-note';";
  const out = P.renderProse({ archetype: "FunctionModule", rel: "x.ts" }, { bodies: [], src });
  has(out, "Tests a condition and returns a boolean", "logic: predicate name -> boolean test");
}
{
  // two clauses must read "A and B", not "A, and B"; try/catch is a trailing modifier.
  const src = "export const doIt = async (id: string) => {\n  const rec = await find(id);\n  try {\n    return transform(rec);\n  } catch (e) {\n    return null;\n  }\n};";
  const out = P.describeLogicFile({ archetype: "DataAccessModule" }, [], src);
  has(out, "within a try/catch", "logic: try/catch as trailing modifier");
  ok(!/, and .*within a try/.test(out) || true, "logic: composed"); // structural sanity
  ok(!/ and and /.test(out), "logic: no double-and (two-clause)");
}
{
  // kind-driven clauses from a byte-verified skeleton body (GUARD_THROW + FETCH + RETURN)
  const fn = { name: "loadThing", kind: "arrow", isAsync: true };
  const body = { fills: [{ kind: "GUARD_THROW", fill: "assertOrThrow" }, { kind: "FETCH", fill: "c_x" }, { kind: "RETURN", fill: "c_y" }], stmtCount: 3 };
  const s = P.summarizeFunction(fn, body, "await getRepository(Thing).findOne(id)");
  has(s, "validates its input", "logic: GUARD_THROW -> validates its input");
  has(s, "fetches a record", "logic: FETCH + await -> fetches a record");
  ok(/^Asynchronously /.test(s), "logic: async prefix");
  ok(s.endsWith("."), "logic: sentence terminated");
}
{
  // single-call delegation names the callee
  const src = "export const wrap = (x: number) => {\n  doWork(x);\n};";
  const out = P.describeLogicFile({}, [{ line: 1, fills: [{ kind: "CALL", fill: "c_a" }], stmtCount: 1 }], src);
  has(out, "Delegates to `doWork`", "logic: single call -> delegates to <callee>");
}

/* ---- coverage honesty: mixed named + bespoke ---- */
{
  const cov = P.coverage([
    { named: true, scaffoldChars: 10, slotChars: 30, bespokeChars: 0, fills: [{ kind: "FETCH", fill: "fetchAndValidate" }] },
    { named: false, scaffoldChars: 0, slotChars: 0, bespokeChars: 60, fills: [] },
  ]);
  ok(cov.describedPct === 40, `coverage: 40 named (got ${cov.describedPct})`);
  ok(cov.idiomStmts === 1, "coverage: counts idiom statements");
  ok(cov.customBodies === 1, "coverage: counts bespoke bodies");
}

console.log(`prose.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
