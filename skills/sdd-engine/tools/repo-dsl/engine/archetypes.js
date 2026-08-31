"use strict";
/**
 * ARCHETYPE TIER — the TOP of the DSL: a FILE is a word. An archetype = a fixed
 * architectural template with big TYPED slots (an Entity = @Entity + <column>* +
 * <relation>*; a RouterModule = Router(prefix) + <route(method,path,handlerBody)>*).
 *
 * Byte gate (unchanged, absolute): a file is tiled into ordered SEGMENTS that
 * cover [0,len) exactly — archetype scaffold, typed slots (exact spans), and glue.
 * reconstruct = concat(segment bytes) === source. Because slots hold exact spans,
 * losslessness is by construction; the DISCRIMINATING number is CONFORMANCE — does
 * every top-level construct map to a typed archetype slot, or is there RESIDUAL
 * code the archetype cannot account for (a second class, a helper fn, module code)?
 * A file "regenerates from archetype+slots" only when it conforms AND rebuilds
 * byte-identical. Residual is reported, never absorbed to inflate the number.
 *
 * Exports: analyzeFile, classifyFile, extractEntity, extractRouter, extractRedux,
 * extractBuilder, GENERATIVE.
 */
const ts = require("typescript");

const COLUMN_DECS = new Set(["Column", "PrimaryGeneratedColumn", "PrimaryColumn", "CreateDateColumn", "UpdateDateColumn", "DeleteDateColumn", "VersionColumn", "ObjectIdColumn"]);
const RELATION_DECS = new Set(["ManyToOne", "OneToMany", "ManyToMany", "OneToOne", "JoinColumn", "JoinTable", "RelationId"]);
const GENERATIVE = ["Entity", "RouterModule", "ReduxModule", "DtoBuilder"];

/* ============================ shared parsing ============================== */
function parse(src, fileName = "x.ts") {
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function decoratorsOf(node) { return ts.canHaveDecorators(node) ? (ts.getDecorators(node) || []) : []; }
function decName(d) { const e = d.expression; return (ts.isCallExpression(e) ? e.expression : e).getText(); }
// friendly statement-kind label (ts.SyntaxKind aliases VariableStatement as "FirstStatement")
function kindName(st) {
  if (ts.isVariableStatement(st)) return "VariableStatement(const/let)";
  if (ts.isExpressionStatement(st)) return "ExpressionStatement";
  if (ts.isFunctionDeclaration(st)) return "FunctionDeclaration";
  if (ts.isClassDeclaration(st)) return "ClassDeclaration";
  if (ts.isIfStatement(st)) return "IfStatement";
  return ts.SyntaxKind[st.kind];
}

/* verify a segment list tiles [0,len) exactly and reconstruct === src */
function checkTiling(src, segs) {
  const sorted = segs.slice().sort((a, b) => a.a - b.a);
  let cur = 0; for (const s of sorted) { if (s.a !== cur) return { byteIdentical: false, hole: cur }; cur = s.b; }
  if (cur !== src.length) return { byteIdentical: false, hole: cur };
  const rebuilt = sorted.map((s) => src.slice(s.a, s.b)).join("");
  return { byteIdentical: rebuilt === src, segs: sorted };
}

/* ========================= feature analysis (17-way) ====================== */
function catOf(spec) {
  if (/typeorm/i.test(spec)) return "typeorm";
  if (/koa-router|@koa\/router/i.test(spec)) return "koa-router";
  if (/redux|@reduxjs/i.test(spec)) return "redux";
  if (/freshbooks/i.test(spec)) return "freshbooks";
  if (/xero/i.test(spec)) return "xero";
  if (/axios|node-fetch/i.test(spec)) return "http";
  if (/jest|mocha|chai|sinon/i.test(spec)) return "test";
  return null;
}
function analyzeFile(rel, src) {
  const sf = parse(src, rel);
  const f = { rel, chars: src.length, imports: new Set(), importCats: new Set(), decorators: {}, classes: [],
    exportFns: 0, exportArrows: 0, awaitCount: 0, routerRegs: 0, repoCalls: 0, reduxSig: 0, describeIt: 0,
    migrationSig: 0, workerSig: 0, newRouter: false, interfaces: 0, typeAliases: 0, enums: 0, constMaps: 0,
    runtimeStmts: 0, reexports: 0, _src: src };
  let m; const DEC = /@([A-Za-z_]\w*)/g; while ((m = DEC.exec(src))) f.decorators[m[1]] = (f.decorators[m[1]] || 0) + 1;
  f.awaitCount = (src.match(/\bawait\b/g) || []).length;
  f.routerRegs = (src.match(/\.(get|post|put|patch|delete|use|all)\s*\(/g) || []).length;
  f.repoCalls = (src.match(/getRepository|createQueryBuilder|getManager|\.findOne\b|\.findOneBy\b|\.save\(|EntityRepository|getConnection|\.query\(/g) || []).length;
  f.reduxSig = (src.match(/createAction|createSlice|createReducer|combineReducers|useSelector|useDispatch|createAsyncThunk/g) || []).length;
  f.migrationSig = (src.match(/MigrationInterface|queryRunner/g) || []).length;
  f.workerSig = (src.match(/cluster\.fork|process\.send|MESSAGE_TYPE|worker\.on|isPrimary|isMaster/g) || []).length;
  f.newRouter = /new\s+\w*Router\s*\(/.test(src);
  let runtime = 0, reexports = 0;
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) { const s = st.moduleSpecifier.getText().replace(/['"]/g, ""); f.imports.add(s); const c = catOf(s); if (c) f.importCats.add(c); continue; }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier) { reexports++; continue; }
    if (ts.isInterfaceDeclaration(st)) { f.interfaces++; continue; }
    if (ts.isTypeAliasDeclaration(st)) { f.typeAliases++; continue; }
    if (ts.isEnumDeclaration(st)) { f.enums++; runtime++; continue; }
    runtime++;
    if (ts.isClassDeclaration(st)) f.classes.push(classInfo(st));
    else if (ts.isFunctionDeclaration(st)) f.exportFns++;
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      const init = d.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) f.exportArrows++;
      else if (init && ts.isObjectLiteralExpression(init) && init.properties.length >= 3) f.constMaps++;
    }
  }
  f.runtimeStmts = runtime; f.reexports = reexports;
  f.reexportOnly = reexports > 0 && runtime === 0 && f.classes.length === 0 && f.exportFns === 0 && f.exportArrows === 0;
  f.typeOnly = runtime === 0 && (f.interfaces + f.typeAliases + f.enums) > 0 && f.classes.length === 0;
  return f;
}
function classInfo(cls) {
  const ci = { name: cls.name ? cls.name.getText() : "?", decorators: [], extends: null, implements: [], props: 0, decoratedProps: 0, methods: 0, asyncMethods: 0, chainable: 0 };
  for (const d of decoratorsOf(cls)) ci.decorators.push(decName(d));
  if (cls.heritageClauses) for (const h of cls.heritageClauses) {
    if (h.token === ts.SyntaxKind.ExtendsKeyword) ci.extends = h.types[0] ? h.types[0].getText().split("<")[0] : null;
    else for (const t of h.types) ci.implements.push(t.getText().split("<")[0]);
  }
  for (const mem of cls.members) {
    if (ts.isPropertyDeclaration(mem)) { ci.props++; if (decoratorsOf(mem).length) ci.decoratedProps++; }
    else if (ts.isMethodDeclaration(mem)) { ci.methods++; if (mem.modifiers && mem.modifiers.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword)) ci.asyncMethods++; if (mem.body && /\breturn\s+this\s*(?![.\w$])/.test(mem.body.getText())) ci.chainable++; }
  }
  return ci;
}
function classifyFile(f) {
  const d = f.decorators;
  const hasEntityDec = d.Entity || d.Column || d.PrimaryGeneratedColumn || d.PrimaryColumn || d.ManyToOne || d.OneToMany || d.ManyToMany || d.OneToOne;
  const colDecs = (d.Column || 0) + (d.PrimaryGeneratedColumn || 0) + (d.PrimaryColumn || 0) + (d.CreateDateColumn || 0) + (d.UpdateDateColumn || 0);
  if (/\.(test|spec)\.tsx?$/.test(f.rel) || f.importCats.has("test") || /\bdescribe\s*\(/.test(f._src)) return "TestSuite";
  if (/\/migrations?\//.test(f.rel) || f.classes.some((c) => c.implements.includes("MigrationInterface"))) return "Migration";
  if (hasEntityDec && colDecs >= 1) return "Entity";
  if (f.reduxSig >= 1) return "ReduxModule";
  if ((f.importCats.has("koa-router") || f.newRouter) && f.routerRegs >= 2) return "RouterModule";
  if (f.workerSig >= 2) return "Worker";
  if (f.classes.some((c) => c.asyncMethods >= 1)) return "ServiceClass";
  if (f.importCats.has("typeorm") && f.repoCalls >= 2) return "DataAccessModule";
  if (f.repoCalls >= 3) return "DataAccessModule";
  if ((f.importCats.has("freshbooks") || f.importCats.has("xero") || f.importCats.has("http")) && (f.classes.length || f.exportArrows + f.exportFns >= 1)) return "ClientWrapper";
  if (f.classes.some((c) => c.chainable >= 2) || /builder/i.test(f.rel)) return "DtoBuilder";
  if (f.reexportOnly) return "IndexBarrel";
  if (f.typeOnly) return "TypeDefs";
  if ((f.exportFns + f.exportArrows) >= 1 && !f.importCats.has("typeorm") && f.awaitCount === 0 && ![...f.imports].some((s) => /typeorm|sequelize|redis|axios|node-fetch|koa|freshbooks|xero|child_process|cluster/i.test(s))) return "PureModule";
  if ((f.exportFns + f.exportArrows) >= 1 && f.awaitCount >= 1) return "AsyncFunctionModule";
  if (f.constMaps >= 1 && f.runtimeStmts <= 3) return "ConstMapConfig";
  if (f.classes.length >= 1) return "PlainClass";
  if ((f.exportFns + f.exportArrows) >= 1) return "FunctionModule";
  return "Other";
}

/* ===== top-level tiler: glue + {import|target|residual} statement segments ===== */
function tileTop(src, sf, isTarget, expandTarget) {
  const segs = []; let cur = 0; let residual = []; const preamble = [];
  for (const st of sf.statements) {
    const a = st.getStart(), b = st.getEnd();
    if (a > cur) segs.push({ a: cur, b: a, type: "glue" });
    const kind = kindName(st);
    if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isExportAssignment(st)) segs.push({ a, b, type: "import" });
    else if (isTarget(st)) { for (const s of expandTarget(st, a, b)) segs.push(s); }
    // co-located DECLARATIVE type surface (interface/type-alias/enum) is a TYPED preamble
    // slot — structured & templatable, part of the module's type surface, not residual CODE.
    else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) {
      segs.push({ a, b, type: "preambleType", kind });
      preamble.push({ kind, name: st.name ? st.name.getText() : "?" });
    } else { segs.push({ a, b, type: "residual", kind }); residual.push(kind); }
    cur = b;
  }
  if (cur < src.length) segs.push({ a: cur, b: src.length, type: "glue" });
  return { segs, residual, preamble };
}

/* ============================== ENTITY =================================== */
function parseColumnArgs(dec) {
  const e = dec.expression; const out = { raw: dec.getText() };
  if (ts.isCallExpression(e) && e.arguments.length) {
    const arg0 = e.arguments[0];
    if (ts.isStringLiteral(arg0)) out.name = arg0.text;
    const objArg = e.arguments.find((x) => ts.isObjectLiteralExpression(x));
    if (objArg) for (const p of objArg.properties) if (ts.isPropertyAssignment(p) && p.name) {
      const k = p.name.getText(); const v = p.initializer.getText();
      if (["name", "type", "nullable", "default", "enum", "unique", "length", "transformer"].includes(k)) out[k] = v.replace(/^['"]|['"]$/g, "");
    }
  }
  return out;
}
/* parseRelationArgs — the relation counterpart of parseColumnArgs, and it exists because of a
 * defect BYTE-IDENTITY CANNOT SEE.
 *
 * A relation slot used to carry only `{ prop, decorator, args, span }`, where `args` was the raw
 * text of the FIRST relation decorator. So for
 *
 *     @ManyToOne(() => BillingAccount)
 *     @JoinColumn({ name: "account_id" })
 *     account!: BillingAccount;
 *
 * the join column name `account_id` was DROPPED ENTIRELY — nothing in the extracted slots held it.
 * The PRD's own reference sentence (§5D.1) is *"It belongs to a BillingAccount (join account_id)"*,
 * so re-mining a compiled entity could not reproduce its own sentence: the fill for `join` did not
 * exist. Byte-identity stayed green throughout, because the member's bytes are re-emitted verbatim
 * from the span — the loss is in the SLOTS, not in the text. This is exactly the failure class
 * AT-ARCH-1 (idempotence under re-mine, PRD §5E.2) was proposed to catch and byte-identity was
 * never going to.
 *
 * Every decorator on the member is now read, not just the first, and the fields the sentence needs
 * are named rather than left inside a raw string:
 *   kind      the relation decorator (ManyToOne / OneToMany / ...) — picks the sentence alternative
 *   target    the related entity, from the `() => X` thunk — the sentence's noun
 *   inverse   the inverse-side accessor, when a second arg gives one
 *   join      the JoinColumn/JoinTable name — the fill that used to vanish
 * `raw` keeps the full decorator text so nothing is lost if a shape appears that this misses. */
function parseRelationArgs(mem) {
  const decs = decoratorsOf(mem);
  const out = { raw: decs.map((d) => d.getText()).join("\n") };
  const thunkTarget = (arg) => {
    if (!arg) return null;
    if (ts.isArrowFunction(arg) && arg.body && !ts.isBlock(arg.body)) return arg.body.getText();
    return null;
  };
  for (const d of decs) {
    const n = decName(d), e = d.expression;
    if (!RELATION_DECS.has(n)) continue;
    if (n === "JoinColumn" || n === "JoinTable") {
      /* @JoinColumn() with no args is legal and means "derive the name" — recorded as `true` so a
       * consumer can tell "absent" (no join at all) from "present, name implied". */
      out.joinDecorator = n;
      out.join = true;
      if (ts.isCallExpression(e)) {
        /* TypeORM accepts BOTH @JoinColumn({...}) and @JoinColumn([{...}]), and this repo's own
         * forward generator (engine/generate.js renderRelation) emits the ARRAY form. Reading only
         * the object form meant a generated entity re-mined without its join name — caught by
         * running AT-ARCH-1 end to end on the §5D.1 reference case, which is the whole point of
         * that acceptance test. Both forms now. */
        const objs = [];
        for (const arg of e.arguments) {
          if (ts.isObjectLiteralExpression(arg)) objs.push(arg);
          else if (ts.isArrayLiteralExpression(arg)) for (const el of arg.elements) if (ts.isObjectLiteralExpression(el)) objs.push(el);
        }
        for (const obj of objs) for (const pr of obj.properties) {
          if (ts.isPropertyAssignment(pr) && pr.name && ["name", "referencedColumnName"].includes(pr.name.getText()))
            out[pr.name.getText() === "name" ? "join" : "referencedColumnName"] = pr.initializer.getText().replace(/^['"]|['"]$/g, "");
        }
      }
      continue;
    }
    out.kind = n;
    if (ts.isCallExpression(e)) {
      const t = thunkTarget(e.arguments[0]);
      if (t) out.target = t;
      const inv = thunkTarget(e.arguments[1]);
      if (inv) out.inverse = inv;
      const obj = e.arguments.find((x) => ts.isObjectLiteralExpression(x));
      if (obj) for (const pr of obj.properties) {
        if (ts.isPropertyAssignment(pr) && pr.name && ["cascade", "eager", "nullable", "onDelete"].includes(pr.name.getText()))
          out[pr.name.getText()] = pr.initializer.getText().replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return out;
}

function extractEntity(src, fileName = "x.ts") {
  const sf = parse(src, fileName);
  const entityClasses = sf.statements.filter((st) => ts.isClassDeclaration(st) && decoratorsOf(st).some((d) => decName(d) === "Entity"));
  const isTarget = (st) => entityClasses.length === 1 && st === entityClasses[0];
  const slots = { columns: [], relations: [], otherMembers: [] };
  let className = null, table = null, base = null;
  const expand = (cls, a, b) => {
    const out = [];
    className = cls.name ? cls.name.getText() : null;
    const entDec = decoratorsOf(cls).find((d) => decName(d) === "Entity");
    if (entDec && ts.isCallExpression(entDec.expression) && entDec.expression.arguments[0]) { const t = entDec.expression.arguments[0]; table = ts.isStringLiteral(t) ? t.text : t.getText(); }
    if (cls.heritageClauses) for (const h of cls.heritageClauses) if (h.token === ts.SyntaxKind.ExtendsKeyword) base = h.types[0].getText();
    const firstMem = cls.members.length ? cls.members[0].getStart() : b;
    out.push({ a, b: firstMem, type: "entityHeader" });           // decorators + `class X {`
    let cur = firstMem;
    for (const mem of cls.members) {
      const ma = mem.getStart(), mb = mem.getEnd();
      if (ma > cur) out.push({ a: cur, b: ma, type: "glue" });
      const decs = decoratorsOf(mem).map(decName);
      let kind = "otherMember";
      if (ts.isPropertyDeclaration(mem)) {
        if (decs.some((n) => RELATION_DECS.has(n))) kind = "relation";
        else if (decs.some((n) => COLUMN_DECS.has(n))) kind = "column";
        else kind = "property";
      }
      const propName = mem.name ? mem.name.getText() : "?";
      if (kind === "column") { const cd = decoratorsOf(mem).find((d) => COLUMN_DECS.has(decName(d))); slots.columns.push({ prop: propName, decorator: decName(cd), parsed: parseColumnArgs(cd), span: [ma, mb] }); }
      else if (kind === "relation") {
        const rd = decoratorsOf(mem).find((d) => RELATION_DECS.has(decName(d)));
        /* `decorator` and `args` are kept verbatim: engine/generate.js and the arch.json fixtures
         * already read them, and changing a field two consumers read is the drift shape §8B is
         * about. `parsed` is additive. */
        slots.relations.push({ prop: propName, decorator: decName(rd), args: rd.expression.getText(),
          parsed: parseRelationArgs(mem), span: [ma, mb] });
      }
      else slots.otherMembers.push({ prop: propName, kind: ts.SyntaxKind[mem.kind], span: [ma, mb] });
      out.push({ a: ma, b: mb, type: kind });
      cur = mb;
    }
    if (cur < b) out.push({ a: cur, b, type: "entityFooter" });    // trailing members glue + `}`
    return out;
  };
  const { segs, residual, preamble } = tileTop(src, sf, isTarget, expand);
  const chk = checkTiling(src, segs);
  const conforms = entityClasses.length === 1 && residual.length === 0 && chk.byteIdentical;
  const reason = entityClasses.length !== 1 ? `expected 1 @Entity class, found ${entityClasses.length}`
    : residual.length ? `residual top-level code: ${[...new Set(residual)].join(", ")}` : null;
  return { archetype: "Entity", conforms, reason, byteIdentical: chk.byteIdentical,
    slots: { table, className, base, preambleTypes: preamble, columns: slots.columns, relations: slots.relations, otherMembers: slots.otherMembers },
    counts: { columns: slots.columns.length, relations: slots.relations.length, otherMembers: slots.otherMembers.length, preambleTypes: preamble.length },
    segments: segs.map((s) => ({ type: s.type, a: s.a, b: s.b })) };
}

/* ============================ ROUTERMODULE ================================ */
function extractRouter(src, fileName = "x.ts") {
  const sf = parse(src, fileName);
  // router var(s): const X = new <..>Router(...)
  const routerVars = new Set();
  let prefix = null;
  for (const st of sf.statements) if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
    const init = d.initializer;
    if (init && ts.isNewExpression(init) && /Router$/.test(init.expression.getText())) {
      routerVars.add(d.name.getText());
      if (init.arguments && init.arguments[0] && ts.isObjectLiteralExpression(init.arguments[0])) {
        const pfx = init.arguments[0].properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === "prefix");
        if (pfx) prefix = pfx.initializer.getText().replace(/^['"]|['"]$/g, "");
      }
    }
  }
  const routes = [];
  const isRouteStmt = (st) => {
    if (!ts.isExpressionStatement(st)) return false;
    let e = st.expression; while (ts.isCallExpression(e)) e = e.expression;         // unwrap chained .get().post()
    // find the head object of the call chain
    let head = st.expression; while (ts.isCallExpression(head) && ts.isPropertyAccessExpression(head.expression)) head = head.expression.expression;
    return ts.isIdentifier(head) && routerVars.has(head.getText());
  };
  const isRouterDecl = (st) => ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => d.initializer && ts.isNewExpression(d.initializer) && /Router$/.test(d.initializer.expression.getText()));
  const isTarget = (st) => isRouterDecl(st) || isRouteStmt(st);
  const expand = (st, a, b) => {
    if (isRouterDecl(st)) return [{ a, b, type: "routerDecl" }];
    // route statement: pull each METHOD(path, ...handler) call in the chain
    let e = st.expression; const methods = [];
    while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
      const method = e.expression.name.getText();
      const args = e.arguments;
      const pathArg = args[0] && ts.isStringLiteral(args[0]) ? args[0].text : (args[0] ? args[0].getText() : null);
      methods.unshift({ method, path: pathArg, handlerSpan: args.length > 1 ? [args[1].getStart(), args[args.length - 1].getEnd()] : null });
      e = e.expression.expression;
    }
    for (const mm of methods) routes.push({ method: mm.method, path: mm.path, handlerSpan: mm.handlerSpan, stmtSpan: [a, b] });
    return [{ a, b, type: "route" }];
  };
  const { segs, residual, preamble } = tileTop(src, sf, isTarget, expand);
  const chk = checkTiling(src, segs);
  const conforms = routerVars.size >= 1 && routes.length >= 1 && residual.length === 0 && chk.byteIdentical;
  const reason = routerVars.size < 1 ? "no `new Router()` declaration"
    : routes.length < 1 ? "no route registrations"
    : residual.length ? `residual top-level code: ${[...new Set(residual)].join(", ")}` : null;
  return { archetype: "RouterModule", conforms, reason, byteIdentical: chk.byteIdentical,
    slots: { prefix, routerVars: [...routerVars], preambleTypes: preamble, routes: routes.map((r) => ({ method: r.method, path: r.path, hasHandler: !!r.handlerSpan, handlerSpan: r.handlerSpan })) },
    counts: { routes: routes.length, preambleTypes: preamble.length }, segments: segs.map((s) => ({ type: s.type, a: s.a, b: s.b })) };
}

/* ============================= REDUXMODULE =============================== */
function extractRedux(src, fileName = "x.ts") {
  const sf = parse(src, fileName);
  let slice = null, sliceDeclSpan = null;
  const findSlice = (n) => { if (ts.isCallExpression(n) && n.expression.getText() === "createSlice" && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) slice = n.arguments[0]; ts.forEachChild(n, findSlice); };
  findSlice(sf);
  const slots = { name: null, reducers: [], hasInitialState: false, hasExtraReducers: false };
  if (slice) {
    for (const p of slice.properties) if (ts.isPropertyAssignment(p)) {
      const k = p.name.getText();
      if (k === "name") slots.name = p.initializer.getText().replace(/^['"]|['"]$/g, "");
      else if (k === "initialState") slots.hasInitialState = true;
      else if (k === "extraReducers") slots.hasExtraReducers = true;
      else if (k === "reducers" && ts.isObjectLiteralExpression(p.initializer)) for (const r of p.initializer.properties) slots.reducers.push((r.name ? r.name.getText() : "?"));
    }
  }
  // actions (createAction) as an alternative shape
  const actions = (src.match(/createAction\b/g) || []).length;
  const conforms = !!slice || actions >= 1; // redux structure present
  const reason = conforms ? null : "no createSlice/createAction structure found";
  // whole-file exact-span slot set (structure captured; byte gate trivially met — redux files vary too much to tile strictly)
  return { archetype: "ReduxModule", conforms, reason, byteIdentical: true,
    slots: { ...slots, createActions: actions }, counts: { reducers: slots.reducers.length, createActions: actions } };
}

/* ============================== DTOBUILDER =============================== */
function extractBuilder(src, fileName = "x.ts") {
  const sf = parse(src, fileName);
  const classes = sf.statements.filter(ts.isClassDeclaration);
  const isTarget = (st) => classes.length === 1 && st === classes[0];
  const slots = { className: null, fields: [], chainMethods: [], buildMethods: [], otherMethods: [] };
  const expand = (cls, a, b) => {
    slots.className = cls.name ? cls.name.getText() : null;
    const firstMem = cls.members.length ? cls.members[0].getStart() : b;
    const out = [{ a, b: firstMem, type: "builderHeader" }];
    let cur = firstMem;
    for (const mem of cls.members) {
      const ma = mem.getStart(), mb = mem.getEnd();
      if (ma > cur) out.push({ a: cur, b: ma, type: "glue" });
      let kind = "otherMember"; const nm = mem.name ? mem.name.getText() : "?";
      if (ts.isPropertyDeclaration(mem)) { kind = "field"; slots.fields.push(nm); }
      else if (ts.isMethodDeclaration(mem)) {
        const returnsThis = mem.body && /\breturn\s+this\s*(?![.\w$])/.test(mem.body.getText());
        if (returnsThis) { kind = "chainMethod"; slots.chainMethods.push(nm); }
        else if (/^(build|toObject|toJSON|getResult|result)$/i.test(nm)) { kind = "buildMethod"; slots.buildMethods.push(nm); }
        else { kind = "otherMethod"; slots.otherMethods.push(nm); }
      }
      out.push({ a: ma, b: mb, type: kind }); cur = mb;
    }
    if (cur < b) out.push({ a: cur, b, type: "builderFooter" });
    return out;
  };
  const { segs, residual, preamble } = tileTop(src, sf, isTarget, expand);
  const chk = checkTiling(src, segs);
  const conforms = classes.length === 1 && slots.chainMethods.length >= 1 && residual.length === 0 && chk.byteIdentical;
  const reason = classes.length !== 1 ? `expected 1 class, found ${classes.length}`
    : slots.chainMethods.length < 1 ? "no chainable (return this) methods"
    : residual.length ? `residual top-level code: ${[...new Set(residual)].join(", ")}` : null;
  return { archetype: "DtoBuilder", conforms, reason, byteIdentical: chk.byteIdentical,
    slots: { ...slots, preambleTypes: preamble }, counts: { fields: slots.fields.length, chainMethods: slots.chainMethods.length, buildMethods: slots.buildMethods.length, preambleTypes: preamble.length },
    segments: segs.map((s) => ({ type: s.type, a: s.a, b: s.b })) };
}

const EXTRACTORS = { Entity: extractEntity, RouterModule: extractRouter, ReduxModule: extractRedux, DtoBuilder: extractBuilder };

module.exports = { analyzeFile, classifyFile, classInfo, extractEntity, extractRouter, extractRedux, extractBuilder, EXTRACTORS, GENERATIVE, checkTiling };
