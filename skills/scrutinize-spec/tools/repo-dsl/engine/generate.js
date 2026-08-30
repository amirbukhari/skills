"use strict";
/**
 * generate.js — the FORWARD compiler for the archetype DSL ("SQL for the repo").
 *
 * The archetype extractors run BACKWARD: source -> (scaffold + typed slots).
 * This module runs the SAME fill/template path FORWARD: slots -> TypeScript.
 *
 * Two slot modes, one generator:
 *   (1) VERBATIM slots  — each member carries its exact source text. Assembling
 *       scaffold + ordered member texts reproduces the file byte-identical. This
 *       is the round-trip proof that the fill-forward ASSEMBLY is lossless.
 *   (2) STRUCTURED slots — a member is {prop, type, nullable, enum, ...}. The
 *       canonical renderer emits clean TypeScript from those fields alone. This
 *       is how a BRAND-NEW entity (no source) is authored and compiled out.
 *
 * Zero model calls. Pure, deterministic.
 */
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const os = require("os");

const COLUMN_DECS = new Set(["Column", "PrimaryGeneratedColumn", "PrimaryColumn", "CreateDateColumn", "UpdateDateColumn", "DeleteDateColumn", "VersionColumn", "ObjectIdColumn"]);
const RELATION_DECS = new Set(["ManyToOne", "OneToMany", "ManyToMany", "OneToOne", "JoinColumn", "JoinTable", "RelationId"]);

/* ------------------------------------------------------------------ helpers */
function parse(src, name = "x.ts") { return ts.createSourceFile(name, src, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS); }
function decoratorsOf(node) { const m = (ts.canHaveDecorators && ts.canHaveDecorators(node)) ? ts.getDecorators(node) : node.decorators; return m ? [...m] : []; }
function decName(d) { const e = d.expression; return ts.isCallExpression(e) ? e.expression.getText() : e.getText(); }
function camel(snake) { return snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()); }
function lowerFirst(s) { return s ? s[0].toLowerCase() + s.slice(1) : s; }

/* --------------------------------------------------- BACKWARD: tile a source */
/**
 * tileEntity(src) -> { ok, className, table, base, segments } where segments tile
 * [0, src.length) exactly. Member segments carry BOTH verbatim text and parsed
 * structured fields. assemble(segments) === src by construction.
 */
function tileEntity(src, fileName = "x.ts") {
  const sf = parse(src, fileName);
  const classes = sf.statements.filter((st) => ts.isClassDeclaration(st) && decoratorsOf(st).some((d) => decName(d) === "Entity"));
  if (classes.length !== 1) return { ok: false, reason: `expected 1 @Entity class, found ${classes.length}` };
  const cls = classes[0];
  const className = cls.name ? cls.name.getText() : null;
  const entDec = decoratorsOf(cls).find((d) => decName(d) === "Entity");
  let table = null;
  if (entDec && ts.isCallExpression(entDec.expression) && entDec.expression.arguments[0]) { const t = entDec.expression.arguments[0]; table = ts.isStringLiteral(t) ? t.text : t.getText(); }
  let base = null;
  if (cls.heritageClauses) for (const h of cls.heritageClauses) if (h.token === ts.SyntaxKind.ExtendsKeyword) base = h.types[0].getText();

  const segs = [];
  const len = src.length;
  const firstStart = cls.members.length ? cls.members[0].getStart() : cls.getEnd();
  segs.push({ kind: "scaffold", text: src.slice(0, firstStart) }); // imports + preamble + @Entity + `class X {`
  let cur = firstStart;
  for (const mem of cls.members) {
    const ma = mem.getStart(), mb = mem.getEnd();
    if (ma > cur) segs.push({ kind: "scaffold", text: src.slice(cur, ma) }); // glue (blank lines, indent, comments)
    const decs = decoratorsOf(mem).map(decName);
    const text = src.slice(ma, mb);
    let kind = "otherMember", structured = null;
    if (ts.isPropertyDeclaration(mem)) {
      if (decs.some((n) => RELATION_DECS.has(n))) { kind = "relation"; structured = parseRelationMember(mem, text); }
      else if (decs.some((n) => COLUMN_DECS.has(n))) { kind = "column"; structured = parseColumnMember(mem, text); }
    }
    segs.push({ kind, text, structured });
    cur = mb;
  }
  if (cur < len) segs.push({ kind: "scaffold", text: src.slice(cur, len) }); // `}` + trailing
  return { ok: true, className, table, base, segments: segs };
}

function tsTypeOf(mem, text) {
  if (mem.type) return mem.type.getText();
  // fall back: parse `prop!: TYPE;` out of the member text
  const m = text.match(/[^\n]*[!?]?\s*:\s*([^;=]+?)\s*[;=]/);
  return m ? m[1].trim() : null;
}
function parseColumnMember(mem, text) {
  const cd = decoratorsOf(mem).find((d) => COLUMN_DECS.has(decName(d)));
  const dn = decName(cd);
  const out = { prop: mem.name.getText(), decorator: dn, pk: dn === "PrimaryGeneratedColumn" || dn === "PrimaryColumn", tsType: tsTypeOf(mem, text) };
  const e = cd.expression;
  if (ts.isCallExpression(e)) {
    const arg0 = e.arguments[0];
    if (arg0 && ts.isStringLiteral(arg0)) out.name = arg0.text;
    const obj = e.arguments.find((x) => ts.isObjectLiteralExpression(x));
    if (obj) for (const p of obj.properties) if (ts.isPropertyAssignment(p) && p.name) {
      const k = p.name.getText(); const v = p.initializer.getText();
      // name/type are string literals -> keep inner text (we re-quote on render);
      // enum/default/transformer/etc. are expressions -> keep verbatim (quotes are significant)
      if (["name", "type"].includes(k)) out[k] = v.replace(/^['"]|['"]$/g, "");
      else if (["nullable", "enum", "default", "unique", "length", "unsigned", "transformer"].includes(k)) out[k] = v;
    }
  }
  return out;
}
function parseRelationMember(mem, text) {
  const rd = decoratorsOf(mem).find((d) => RELATION_DECS.has(decName(d)));
  return { prop: mem.name.getText(), decorator: decName(rd), args: rd.expression.getText(), tsType: tsTypeOf(mem, text) };
}

/** assemble(segments) -> string. The forward fill: just join the ordered slots. */
function assemble(segments) { return segments.map((s) => s.text).join(""); }

/* ----------------------------------------------- DSL: parse authoring source */
/**
 * Grammar (line-oriented, deliberately SQL-like):
 *
 *   entity <Class> table "<table>" [extends <Base>] {
 *     column <name> pk
 *     column <name> <type> [not-null|nullable] [enum(<E>)] [db(<dbname>)] [ts(<TsType>)]
 *     relation <prop> <Decorator>(<Target>[, "<inverse>"]) [join("<col>")]
 *   }
 *
 * <name> may be snake_case (=> db column name, prop = camelCase) or a bare prop.
 */
const TYPE_TS = { int: "number", integer: "number", tinyint: "number", smallint: "number", bigint: "number", float: "number", double: "number", decimal: "string", numeric: "string", bit: "boolean", bool: "boolean", boolean: "boolean", varchar: "string", char: "string", text: "string", timestamp: "Date", datetime: "Date", date: "Date" };

function parseEntityDSL(textIn) {
  const lines = textIn.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  const head = lines[0] || "";
  const hm = head.match(/^entity\s+([A-Za-z_$][\w$]*)\s+table\s+"([^"]+)"(?:\s+extends\s+([A-Za-z_$][\w$]*))?\s*\{$/);
  if (!hm) throw new Error(`bad entity header: ${JSON.stringify(head)}`);
  const out = { className: hm[1], table: hm[2], base: hm[3] || null, members: [] };
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i];
    if (L === "}") break;
    if (L.startsWith("column ")) out.members.push(parseColumnLine(L));
    else if (L.startsWith("relation ")) out.members.push(parseRelationLine(L));
    else throw new Error(`unknown DSL line: ${JSON.stringify(L)}`);
  }
  return out;
}
function parseColumnLine(L) {
  const toks = L.split(/\s+/);
  toks.shift(); // 'column'
  const name = toks.shift();
  const col = { role: "column", src: name, prop: name.includes("_") ? camel(name) : name };
  if (name.includes("_")) col.name = name;
  if (toks[0] === "pk") { col.pk = true; col.tsType = "number"; return col; }
  const type = toks.shift();
  const tm = type.match(/^(\w+)\(([^)]*)\)$/); // e.g. enum(ERefundStatus) — type carries its param
  if (tm) { col.colType = tm[1]; col[tm[1]] = tm[2].replace(/^['"]|['"]$/g, ""); }
  else col.colType = type;
  col.nullable = false;
  for (const t of toks) {
    if (t === "nullable") col.nullable = true;
    else if (t === "not-null") col.nullable = false;
    else { const m = t.match(/^(\w+)\(([^)]*)\)$/); if (m) col[m[1]] = m[2].replace(/^['"]|['"]$/g, ""); }
  }
  if (col.db) { col.name = col.db; delete col.db; }
  col.tsType = col.ts || col.enum || TYPE_TS[col.colType] || "string";
  delete col.ts;
  return col;
}
function parseRelationLine(L) {
  const m = L.match(/^relation\s+([A-Za-z_$][\w$]*)\s+([A-Za-z]+)\(([^)]*)\)(.*)$/);
  if (!m) throw new Error(`bad relation line: ${JSON.stringify(L)}`);
  const rel = { role: "relation", prop: m[1], decorator: m[2] };
  const inner = m[3].split(",").map((s) => s.trim()).filter(Boolean);
  rel.target = inner[0];
  if (inner[1]) rel.inverse = inner[1].replace(/^['"]|['"]$/g, "");
  const rest = m[4] || "";
  const jm = rest.match(/join\("([^"]+)"\)/); if (jm) rel.join = jm[1];
  return rel;
}

/* ------------------------------------- FORWARD: canonical structured renderer */
function renderColumn(c) {
  if (c.pk) return `  @PrimaryGeneratedColumn()\n  ${c.prop}!: number;\n`;
  const T = (v) => v === true || v === "true";
  const opts = [];
  if (c.name) opts.push(`name: '${c.name}'`);
  if (c.colType) opts.push(`type: '${c.colType}'`);
  if (c.enum) opts.push(`enum: ${c.enum}`);
  if (c.length != null) opts.push(`length: ${c.length}`);
  if (T(c.unsigned)) opts.push(`unsigned: true`);
  if (T(c.unique)) opts.push(`unique: true`);
  if (c.default != null) opts.push(`default: ${c.default}`);
  opts.push(`nullable: ${c.nullable ? "true" : "false"}`);
  if (c.transformer) opts.push(`transformer: ${c.transformer}`);
  return `  @Column({ ${opts.join(", ")} })\n  ${c.prop}!: ${c.tsType};\n`;
}
function renderRelation(r) {
  const p = lowerFirst(r.target);
  let dec, tsType = r.target;
  if (r.decorator === "OneToMany") { dec = `  @OneToMany(() => ${r.target}${r.inverse ? `, (${p}) => ${p}.${r.inverse}` : ""})\n`; tsType = `${r.target}[]`; }
  else if (r.decorator === "ManyToMany") { dec = `  @ManyToMany(() => ${r.target}${r.inverse ? `, (${p}) => ${p}.${r.inverse}` : ""})\n`; tsType = `${r.target}[]`; }
  else { dec = `  @${r.decorator}(() => ${r.target}${r.inverse ? `, (${p}) => ${p}.${r.inverse}` : ""})\n`; }
  if (r.join) dec += `  @JoinColumn([{ name: '${r.join}', referencedColumnName: 'id' }])\n`;
  return `${dec}  ${r.prop}!: ${tsType};\n`;
}
function collectImports(model, opts = {}) {
  const deco = new Set(["Entity"]);
  const targets = new Set(), enums = new Set();
  for (const m of model.members) {
    if (m.role === "column") {
      if (m.pk) deco.add("PrimaryGeneratedColumn"); else deco.add("Column");
      if (m.enum) enums.add(m.enum);
    } else {
      deco.add(m.decorator);
      if (m.join) deco.add("JoinColumn");
      targets.add(m.target);
    }
  }
  const order = ["Entity", "Column", "PrimaryGeneratedColumn", "PrimaryColumn", "OneToMany", "ManyToOne", "OneToOne", "ManyToMany", "JoinColumn"];
  const decoList = order.filter((d) => deco.has(d));
  const lines = [`import { ${decoList.join(", ")} } from 'typeorm';`];
  for (const e of enums) lines.push(`import { ${e} } from '${opts.enumModule || "./enums"}';`);
  for (const t of targets) lines.push(`import { ${t} } from '${(opts.targetModule ? opts.targetModule(t) : `./${t}`)}';`);
  return lines.join("\n");
}
function emitEntityCanonical(model, opts = {}) {
  const body = model.members.map((m) => (m.role === "column" ? renderColumn(m) : renderRelation(m))).join("");
  const ext = model.base ? ` extends ${model.base}` : "";
  return `${collectImports(model, opts)}\n\n@Entity('${model.table}')\nexport class ${model.className}${ext} {\n${body}}\n`;
}

/* ------------------------------------------------------- RouterModule (basic) */
function parseRouterDSL(textIn) {
  const lines = textIn.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  const hm = (lines[0] || "").match(/^router\s+([A-Za-z_$][\w$]*)\s+prefix\s+"([^"]+)"\s*\{$/);
  if (!hm) throw new Error(`bad router header: ${JSON.stringify(lines[0])}`);
  const out = { varName: hm[1], prefix: hm[2], routes: [] };
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i]; if (L === "}") break;
    const m = L.match(/^(get|post|put|patch|delete)\s+"([^"]+)"/i);
    if (!m) throw new Error(`bad route line: ${JSON.stringify(L)}`);
    out.routes.push({ method: m[1].toLowerCase(), path: m[2] });
  }
  return out;
}
function emitRouterCanonical(model) {
  const head = `import Router from 'koa-router';\n\nexport const ${model.varName} = new Router({ prefix: '${model.prefix}' });\n\n`;
  const routes = model.routes.map((r) => `${model.varName}.${r.method}('${r.path}', async (ctx) => {\n  // TODO: implement ${r.method.toUpperCase()} ${r.path}\n  ctx.body = {};\n});\n`).join("\n");
  return head + routes;
}

/* ------------------------------------------------------- ReduxModule (basic) */
function parseReduxDSL(textIn) {
  const lines = textIn.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
  const hm = (lines[0] || "").match(/^slice\s+([A-Za-z_$][\w$]*)\s*\{$/);
  if (!hm) throw new Error(`bad slice header: ${JSON.stringify(lines[0])}`);
  const out = { name: hm[1], reducers: [] };
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i]; if (L === "}") break;
    const m = L.match(/^reducer\s+([A-Za-z_$][\w$]*)$/);
    if (!m) throw new Error(`bad reducer line: ${JSON.stringify(L)}`);
    out.reducers.push(m[1]);
  }
  return out;
}
function emitReduxCanonical(model) {
  const varName = `${model.name}Slice`;
  const reducers = model.reducers.map((r) => `    ${r}: (state, action) => {\n      // TODO: implement ${r}\n    },`).join("\n");
  const actions = model.reducers.join(", ");
  return `import { createSlice } from '@reduxjs/toolkit';\n\nconst initialState = {};\n\n`
    + `export const ${varName} = createSlice({\n  name: '${model.name}',\n  initialState,\n  reducers: {\n${reducers}\n  },\n});\n\n`
    + `export const { ${actions} } = ${varName}.actions;\nexport default ${varName}.reducer;\n`;
}

/* --------------------------------------------- entity type-check (real tsc) */
const TYPEORM_SHIM = ["Entity(n?:string):ClassDecorator", "Column(o?:any):PropertyDecorator", "PrimaryGeneratedColumn():PropertyDecorator", "PrimaryColumn(o?:any):PropertyDecorator", "CreateDateColumn(o?:any):PropertyDecorator", "UpdateDateColumn(o?:any):PropertyDecorator", "ManyToOne(...a:any[]):PropertyDecorator", "OneToMany(...a:any[]):PropertyDecorator", "OneToOne(...a:any[]):PropertyDecorator", "ManyToMany(...a:any[]):PropertyDecorator", "JoinColumn(...a:any[]):PropertyDecorator", "JoinTable(...a:any[]):PropertyDecorator"]
  .map((sig) => { const name = sig.slice(0, sig.indexOf("(")); return `export const ${name} = (${sig.slice(sig.indexOf("(") + 1, sig.lastIndexOf(")"))}) => (() => {}) as any;`; }).join("\n");

/** typecheckEntitySource(src) -> {ok, errors}. Real `tsc` (compiler API) over the
 *  emitted file + a typeorm shim + stub modules for its relative imports. Uses a
 *  throwaway dir under tmpRoot (default: this engine dir), cleaned up after. */
function typecheckEntitySource(src, tmpRoot) {
  const dir = fs.mkdtempSync(path.join(tmpRoot || os.tmpdir(), "sdd-tc-"));
  try {
    const rewritten = src.replace(/from 'typeorm'/g, "from './typeorm'");
    fs.writeFileSync(path.join(dir, "gen.ts"), rewritten);
    fs.writeFileSync(path.join(dir, "typeorm.ts"), TYPEORM_SHIM + "\n");
    const written = new Set(["typeorm"]);
    const importRe = /import\s*\{([^}]*)\}\s*from\s*'\.\/([^']+)'/g;
    let m;
    while ((m = importRe.exec(rewritten))) {
      const mod = m[2]; if (written.has(mod)) continue; written.add(mod);
      const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      fs.writeFileSync(path.join(dir, mod + ".ts"), names.map((n) => `export class ${n} {}`).join("\n") + "\n");
    }
    const files = [...written].map((x) => path.join(dir, x + ".ts")).concat([path.join(dir, "gen.ts")]);
    const options = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, experimentalDecorators: true, emitDecoratorMetadata: false, strict: true, skipLibCheck: true, noEmit: true };
    const program = ts.createProgram(files, options);
    const diags = ts.getPreEmitDiagnostics(program).filter((d) => !/Cannot find (type definition|global) /.test(ts.flattenDiagnosticMessageText(d.messageText, "\n")));
    return { ok: diags.length === 0, errors: diags.map((d) => `${d.file ? path.basename(d.file.fileName) : "?"}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`) };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ } }
}

/* --------------------------------------------------------- TS validity check */
/** parseValidity(src) -> {ok, errors} : syntactic validity via the TS parser. */
function parseValidity(src, name = "gen.ts") {
  const sf = parse(src, name);
  const diags = sf.parseDiagnostics || [];
  return { ok: diags.length === 0, errors: diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")) };
}
/** structuralEntityCheck(src) -> {ok, ...} : is it a valid TypeORM entity shape? */
function structuralEntityCheck(src) {
  const r = tileEntity(src);
  if (!r.ok) return { ok: false, reason: r.reason };
  const cols = r.segments.filter((s) => s.kind === "column").length;
  const rels = r.segments.filter((s) => s.kind === "relation").length;
  return { ok: !!(r.className && r.table), className: r.className, table: r.table, columns: cols, relations: rels };
}

module.exports = {
  tileEntity, assemble, parseColumnMember, parseRelationMember,
  parseEntityDSL, emitEntityCanonical, renderColumn, renderRelation, collectImports,
  parseRouterDSL, emitRouterCanonical,
  parseReduxDSL, emitReduxCanonical,
  parseValidity, structuralEntityCheck, typecheckEntitySource, camel, lowerFirst,
};
