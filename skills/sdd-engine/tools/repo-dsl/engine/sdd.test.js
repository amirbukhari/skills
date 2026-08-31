"use strict";
/**
 * sdd.test.js — runnable node test (exits non-zero on failure). Exercises the
 * consolidated CLI's generate / render / check on self-contained fixtures written
 * to a throwaway dir under this engine dir (cleaned up after). No model calls.
 */
const fs = require("fs");
const path = require("path");
const S = require("./sdd.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };
const has = (s, sub, m) => ok(s.includes(sub), `${m}\n    in: ${JSON.stringify(s).slice(0, 300)}`);

const tmp = fs.mkdtempSync(path.join(__dirname, "sdd-test-"));
try {
  /* ---------- generate: entity, with typecheck ---------- */
  {
    const spec = `entity RefundRequest table "refund_requests" {
  column id pk
  column amount_minor_units int not-null
  column status enum(ERefundStatus) not-null
  relation invoice ManyToOne(Invoice) join("invoice_id")
}`;
    const r = S.generate({ specText: spec, typecheck: true, tmpRoot: tmp });
    ok(r.kind === "entity", "generate: detects entity");
    ok(r.name === "RefundRequest", "generate: class name");
    has(r.code, "@Entity('refund_requests')", "generate: emits @Entity");
    has(r.code, "@JoinColumn([{ name: 'invoice_id', referencedColumnName: 'id' }])", "generate: join column");
    ok(r.valid === true, "generate: syntactically valid");
    ok(r.typecheck && r.typecheck.ok === true, `generate: tsc clean (got ${JSON.stringify(r.typecheck)})`);
  }
  /* ---------- generate: router + redux ---------- */
  {
    const r = S.generate({ specText: `router refundRouter prefix "/refunds" {\n  get "/:id"\n  post "/"\n}` });
    ok(r.kind === "router" && r.valid, "generate: router valid");
    has(r.code, "new Router({ prefix: '/refunds' })", "generate: router prefix");
    const x = S.generate({ specText: `slice accounts {\n  reducer received\n  reducer cleared\n}` });
    ok(x.kind === "redux" && x.valid, "generate: redux valid");
    has(x.code, "name: 'accounts'", "generate: slice name");
    has(x.code, "export const { received, cleared } = accountsSlice.actions;", "generate: actions export");
  }
  /* ---------- generate: --out writes a file ---------- */
  {
    const outp = path.join(tmp, "Widget.ts");
    S.generate({ specText: `entity Widget table "widgets" {\n  column id pk\n  column label varchar not-null\n}`, out: outp });
    ok(fs.existsSync(outp) && /export class Widget/.test(fs.readFileSync(outp, "utf8")), "generate: --out writes file");
  }

  /* ---------- build a tiny project fixture for render + check ---------- */
  const proj = path.join(tmp, "proj");
  const entSrc = `import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('widgets')
export class Widget {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column({ name: 'label', type: 'varchar', nullable: false })
  label!: string;
}
`;
  fs.mkdirSync(path.join(proj, "src/entities"), { recursive: true });
  fs.writeFileSync(path.join(proj, "src/entities/Widget.ts"), entSrc);
  // persist an arch.json the way `mine` would, so `render` has a tier to read
  const arch = S.checkFile({ projectDir: proj, rel: "src/entities/Widget.ts", src: entSrc });
  const full = require("./archetypes.js").EXTRACTORS.Entity(entSrc, "Widget.ts");
  fs.mkdirSync(path.join(proj, "spec/archetypes/src/entities"), { recursive: true });
  fs.writeFileSync(path.join(proj, "spec/archetypes/src/entities/Widget.ts.arch.json"), JSON.stringify({ rel: "src/entities/Widget.ts", archetype: "Entity", conforms: full.conforms, byteIdentical: full.byteIdentical, table: full.slots.table, slots: full.slots, counts: full.counts }));

  /* ---------- render ---------- */
  {
    const r = S.render({ projectDir: proj, rel: "src/entities/Widget.ts" });
    ok(r.archetype === "Entity", "render: archetype");
    has(r.prose, "`Widget` is an entity stored in `widgets`.", "render: entity opener");
    has(r.prose, "a label (varchar, required)", "render: column phrase");
    has(r.prose, "coverage:", "render: coverage line present");
  }

  /* ---------- check: conforming single file ---------- */
  {
    const r = S.checkFile({ projectDir: proj, rel: "src/entities/Widget.ts", src: entSrc });
    ok(r.archetype === "Entity" && r.generative && r.conforms === true, "check: clean entity conforms");
    ok(r.reason === null, "check: no residual");
  }
  /* ---------- check: the Credit.ts governance finding (runtime code in an entity) ---------- */
  {
    const bad = `import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

const isState = (s: string): boolean => s === 'active';

@Entity('credits')
export class Credit {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column({ type: 'int', nullable: false })
  amount!: number;
}
`;
    const r = S.checkFile({ projectDir: proj, rel: "src/entities/Credit.ts", src: bad });
    ok(r.generative && r.conforms === false, "check: entity+top-level-const NON-conforming");
    has(r.reason, "residual", "check: reports residual runtime code");
  }
  /* ---------- check: whole-dir scan finds the non-conformer ---------- */
  {
    fs.writeFileSync(path.join(proj, "src/entities/Credit.ts"), `import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
const isState = (s: string): boolean => s === 'active';
@Entity('credits') export class Credit { @PrimaryGeneratedColumn() id!: number; @Column() a!: string; }
`);
    const r = S.check({ projectDir: proj });
    ok(r.generative >= 2, "check-dir: found generative files");
    ok(r.nonConformers.some((n) => /Credit\.ts/.test(n.rel)), "check-dir: flags Credit.ts");
  }

  /* ---------- mine: dry-run by default, does not execute ---------- */
  {
    const r = S.mine({ projectDir: proj });
    ok(r.executed === false, "mine: dry-run by default");
    ok(r.plan.some((p) => /build-archetypes\.js/.test(p)) && r.plan.some((p) => /build-skeletons\.js/.test(p)), "mine: plan wires the builders");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`sdd.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
