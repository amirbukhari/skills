"use strict";
/**
 * prose.js — the PLAIN-LANGUAGE renderer. Deterministic, zero model calls.
 *
 * Walks the 4 tiers we already built (archetype -> skeleton -> idiom -> leaf) and
 * reads the PERSISTED slots/words to narrate a real file in English. Uses the
 * names we already have (archetype names; idiom names throwError / assertOrThrow /
 * fetchAndValidate; skeleton control-flow) plus deterministic humanization.
 *
 * HONESTY RULE: a body with no named skeleton is reported as "custom logic
 * (N statements)" — never invented prose. Every render reports the % of the file
 * that got a named/word description vs. bespoke custom logic.
 */

/* -------------------------------------------------- deterministic humanization */
function words(id) {
  return String(id)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")   // camelCase -> camel Case
    .replace(/[_-]+/g, " ")                     // snake/kebab -> spaces
    .replace(/\s+/g, " ").trim().toLowerCase();
}
function list(arr, conj = "and") {
  arr = arr.filter(Boolean);
  if (arr.length === 0) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} ${conj} ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, ${conj} ${arr[arr.length - 1]}`;
}
function byteToLine(src, off) { let l = 1; for (let i = 0; i < off && i < src.length; i++) if (src[i] === "\n") l++; return l; }
function a(noun) { return (/^[aeiou]/i.test(noun) ? "an " : "a ") + noun; }

/* --------------------------------------------------------- KIND / idiom lexicon */
const KIND_VERB = {
  ASSIGN: "assigns a value", FETCH: "fetches a record", GUARD: "checks a condition",
  GUARD_THROW: "validates an input (throwing if invalid)", THROW: "throws an error",
  CALL: "calls a helper", AWAIT: "awaits an async call", RETURN: "returns the result",
  IF: "branches on a condition", LOOP: "iterates", TRY: "runs a try/catch",
  SWITCH: "switches on a value", DECLARE: "declares a variable", JUMP: "breaks out",
  EXPR: "evaluates an expression", BLOCK: "runs a block", OTHER: "runs a statement",
};
const IDIOM_PHRASE = {
  fetchAndValidate: "fetches a record and validates it exists",
  throwError: "throws an error",
  assertOrThrow: "asserts a condition (throwing if it fails)",
};
// Feed the LLM-named idiom catalog (english-idioms.json) back into the summaries: for
// every idiom the model gave a real English gloss, key it by the machine name the
// skeleton fills use (oldName) so a matching fill reads as its domain phrase instead of
// the generic KIND verb. Best-effort + non-fatal — the deterministic phrases above are
// the fallback. (Reach is naturally small: most named idioms are import/type-surface
// shapes that never appear as function-body fills; see the report's reach measurement.)
(function mergeNamedIdioms() {
  const roots = [process.env.REPO_DSL_CATALOG,
    require("path").join("/home/amir/Documents/Rentsync/delonix/hydra-source", "catalog", "english-idioms.json")];
  for (const p of roots) {
    if (!p) continue;
    try {
      const cat = JSON.parse(require("fs").readFileSync(p, "utf8"));
      for (const it of cat.idioms || []) {
        if (it.source === "model" && it.oldName && it.gloss && !IDIOM_PHRASE[it.oldName]) IDIOM_PHRASE[it.oldName] = it.gloss;
      }
      break;
    } catch (_) { /* catalog absent — keep the built-in fallbacks */ }
  }
})();
const IDIOMS = new Set(Object.keys(IDIOM_PHRASE));

/** A body's fills -> one English clause. Idiom fills use their named phrase. */
function skeletonToWords(body) {
  const parts = (body.fills || []).map((f) => IDIOM_PHRASE[f.fill] || KIND_VERB[f.kind] || "runs a statement");
  if (parts.length === 0) return "does nothing";
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const lead = parts.slice(0, -1).join(", ");
  return `${lead}, then ${last}`;
}

/* ------------------------------------------------------- per-file coverage math */
/**
 * coverage(bodies) -> how much of the file's runtime code got a named/word
 * description vs bespoke custom logic. Chars come straight from the skeleton tier.
 */
function coverage(bodies) {
  let described = 0, custom = 0, namedBodies = 0, customBodies = 0, idiomStmts = 0;
  for (const b of bodies || []) {
    const bodyChars = (b.scaffoldChars || 0) + (b.slotChars || 0) + (b.bespokeChars || 0);
    if (b.named) { described += (b.scaffoldChars || 0) + (b.slotChars || 0); custom += (b.bespokeChars || 0); namedBodies++; }
    else { custom += bodyChars; customBodies++; }
    for (const f of b.fills || []) if (IDIOMS.has(f.fill)) idiomStmts++;
  }
  const total = described + custom;
  return { describedPct: total ? +(100 * described / total).toFixed(1) : 100, described, custom, namedBodies, customBodies, totalBodies: (bodies || []).length, idiomStmts };
}
function coverageLine(cov) {
  const custom = (100 - cov.describedPct).toFixed(1);
  return `— coverage: ${cov.describedPct}% named/word-described, ${custom}% custom logic `
    + `(${cov.namedBodies}/${cov.totalBodies} bodies match a named skeleton; ${cov.customBodies} fully-bespoke; `
    + `custom % = fully-bespoke bodies + bespoke expression interiors of named bodies; ${cov.idiomStmts} idiom statements)`;
}

/* ------------------------------------------------------------------- ENTITY ---- */
function columnPhrase(col) {
  const name = words(col.prop);
  const p = col.parsed || {};
  if (col.decorator === "PrimaryGeneratedColumn" || /PrimaryGenerated/.test(p.raw || "")) return `an auto-generated ${name}`;
  const type = p.type || "value";
  const req = p.nullable === "true" ? "optional" : "required";
  return a(`${name} (${type}, ${req})`);
}
function relationTarget(rel) { const m = (rel.args || "").match(/=>\s*([A-Za-z_$][\w$]*)/); return m ? m[1] : (rel.decorator || "record"); }
function describeEntity(arch, bodies) {
  const s = arch.slots;
  const out = [];
  out.push(`\`${s.className}\` is an entity stored in \`${arch.table || s.table}\`.`);
  const cols = (s.columns || []).map(columnPhrase);
  if (cols.length) out.push(`It has ${cols.length} field${cols.length === 1 ? "" : "s"}: ${list(cols)}.`);
  const belongs = [], many = [];
  for (const r of s.relations || []) {
    if (r.decorator === "JoinColumn" || r.decorator === "JoinTable") continue;
    if (r.decorator === "ManyToOne" || r.decorator === "OneToOne") belongs.push(relationTarget(r));
    else many.push(words(r.prop));
  }
  const rel = [];
  if (belongs.length) rel.push(`belongs to ${list(belongs.map((t) => a(t)))}`);
  if (many.length) rel.push(`has many ${list(many)}`);
  if (rel.length) out.push(`It ${list(rel)}.`);
  if ((s.preambleTypes || []).length) out.push(`It also defines ${s.preambleTypes.length} local type${s.preambleTypes.length === 1 ? "" : "s"} (${list(s.preambleTypes.map((t) => `\`${t.name}\``))}).`);
  const cov = coverage(bodies);
  return out.join(" ") + "\n" + coverageLine(cov);
}

/* ------------------------------------------------------------------- ROUTER ---- */
function describeRouter(arch, bodies, src) {
  const s = arch.slots;
  const out = [];
  const routes = s.routes || [];
  out.push(`The \`${(s.routerVars || ["router"])[0]}\` router exposes ${routes.length} route${routes.length === 1 ? "" : "s"} under \`${s.prefix || "/"}\`.`);
  // index arrow bodies by line for handler lookup
  const arrows = (bodies || []).filter((b) => b.ownerKind === "arrow").slice().sort((a, b) => a.line - b.line);
  for (const rt of routes) {
    let desc = "runs custom logic";
    if (rt.handlerSpan && src) {
      const lo = byteToLine(src, rt.handlerSpan[0]), hi = byteToLine(src, rt.handlerSpan[1]);
      const inSpan = arrows.filter((b) => b.line >= lo && b.line <= hi);
      const handler = inSpan.sort((a, b) => (b.stmtCount || 0) - (a.stmtCount || 0))[0]; // the real handler = most statements
      if (handler && handler.named) desc = skeletonToWords(handler);
      else if (handler) desc = `runs custom logic (${handler.stmtCount} statements)`;
    }
    out.push(`- ${rt.method.toUpperCase()} ${rt.path} — ${desc}.`);
  }
  const cov = coverage(bodies);
  return out.join("\n") + "\n" + coverageLine(cov);
}

/* -------------------------------------------------------------------- REDUX ---- */
function describeRedux(arch, bodies) {
  const s = arch.slots;
  const out = [];
  const reducers = s.reducers || [];
  out.push(`The \`${s.name}\` slice holds its own state with ${reducers.length} reducer${reducers.length === 1 ? "" : "s"}: ${list(reducers.map((r) => `${words(r)} (\`${r}\`)`))}.`);
  if (s.hasInitialState) out.push(`It defines an initial state.`);
  if (s.hasExtraReducers) out.push(`It also handles extra reducers (responses to other slices' actions).`);
  if ((s.createActions || []).length) out.push(`It creates ${s.createActions.length} standalone action${s.createActions.length === 1 ? "" : "s"}.`);
  const cov = coverage(bodies);
  return out.join(" ") + "\n" + coverageLine(cov);
}

/* ------------------------------------------------------------- INDEXBARREL ---- */
/**
 * Re-export barrels: files that are ONLY `export * from './x'` / `export { A, B }
 * from './x'`. Deterministic parse of the export declarations (regex over the
 * fixed re-export grammar), de-slug each module path into readable words. Zero
 * model calls. A barrel has no runtime bodies — it is pure surface structure, so
 * it is 100% narratable by construction (nothing bespoke to hide).
 */
function barrelReexports(src) {
  const out = [];
  // export [type] * [as ns] from '<mod>';   |   export [type] { a, b as c } from '<mod>';
  const re = /export\s+(type\s+)?(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{([^}]*)\})\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const mod = m[3];
    const star = !m[2];
    const names = star ? "*" : m[2].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    out.push({ module: mod, names, typeOnly: !!m[1] });
  }
  return out;
}
function moduleWords(mod) {
  const base = String(mod).replace(/\.[tj]sx?$/, "").replace(/\/index$/, "").split("/").filter(Boolean).pop() || mod;
  return words(base);
}
function describeBarrel(arch, bodies, src) {
  const reex = barrelReexports(src || "");
  if (!reex.length) return `This module re-exports nothing recognizable (empty barrel).`;
  const stars = reex.filter((r) => r.names === "*");
  const named = reex.filter((r) => r.names !== "*");
  const out = [];
  const n = reex.length;
  out.push(`This module is a re-export barrel — it has no logic of its own; it re-groups ${n} module${n === 1 ? "" : "s"} into one import surface.`);
  if (stars.length) {
    const labels = stars.map((r) => (r.typeOnly ? moduleWords(r.module) + " (types)" : moduleWords(r.module)));
    out.push(`It re-exports everything from: ${list(labels)}.`);
  }
  for (const r of named) {
    const bindings = list(r.names.map((x) => `\`${x}\``));
    out.push(`It re-exports ${bindings} from ${moduleWords(r.module)}${r.typeOnly ? " (types)" : ""}.`);
  }
  out.push(`— coverage: 100% named/word-described (pure re-export surface; ${n} module reference${n === 1 ? "" : "s"}, 0 runtime statements, nothing bespoke).`);
  return out.join(" ").replace(/\. —/, ".\n—");
}

/* --------------------------------------------------- PURE-SURFACE SHAPES ------ */
/**
 * Files with no runtime bodies — pure declared surface. Three shapes, all narrated
 * deterministically from the AST (zero model calls). A pure-surface file has no
 * function/arrow BODY, so there is nothing bespoke to hide: the narrator covers the
 * full declared surface, 100% by construction.
 *   - types  : only interface/type-alias declarations (no enums, no runtime)
 *   - constEnum : enum declarations (+ optional plain consts), nothing callable
 *   - config : top-level object-literal const map(s), nothing callable
 */
const ts = require("typescript");
function unquote(s) { return String(s).replace(/^['"`]|['"`]$/g, ""); }
/** Deterministic AST surface of a file: types, enums, top-level consts. */
function fileSurface(src) {
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = { interfaces: [], typeAliases: [], enums: [], consts: [], callables: 0 };
  const countCallables = (n) => { if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) out.callables++; ts.forEachChild(n, countCallables); };
  countCallables(sf);
  for (const st of sf.statements) {
    if (ts.isInterfaceDeclaration(st)) out.interfaces.push(st.name.getText());
    else if (ts.isTypeAliasDeclaration(st)) out.typeAliases.push(st.name.getText());
    else if (ts.isEnumDeclaration(st)) {
      out.enums.push({ name: st.name.getText(), members: st.members.map((m) => ({ name: unquote(m.name.getText()), value: m.initializer ? unquote(m.initializer.getText()) : null })) });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const name = d.name.getText(); const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) continue;
        let kind = "value", keys = [];
        if (init && ts.isObjectLiteralExpression(init)) { kind = "map"; keys = init.properties.map((p) => p.name ? unquote(p.name.getText()) : "?").filter((k) => k !== "?"); }
        else if (init && ts.isArrayLiteralExpression(init)) kind = "array";
        out.consts.push({ name, kind, keys });
      }
    }
  }
  return out;
}
function pureSurfaceCoverage(callables, note) {
  const resid = callables > 0 ? ` (${callables} embedded callable${callables === 1 ? "" : "s"} in value positions are delivered by the skeleton tier)` : "";
  return `— coverage: 100% named/word-described (${note}; 0 bespoke residual${resid}).`;
}
function named(n) { return `${words(n)} (\`${n}\`)`; }

function describeTypeDefs(facts, src) {
  const s = fileSurface(src);
  const total = s.interfaces.length + s.typeAliases.length;
  const out = [];
  out.push(`This module is a pure type module — it defines ${total} type${total === 1 ? "" : "s"} and no runtime code.`);
  if (s.interfaces.length) out.push(`Interface${s.interfaces.length === 1 ? "" : "s"}: ${list(s.interfaces.map(named))}.`);
  if (s.typeAliases.length) out.push(`Type alias${s.typeAliases.length === 1 ? "" : "es"}: ${list(s.typeAliases.map(named))}.`);
  out.push(pureSurfaceCoverage(s.callables, "pure declared type surface"));
  return out.join(" ").replace(/\. —/, ".\n—");
}
function describeConstEnum(facts, src) {
  const s = fileSurface(src);
  const out = [];
  const nE = s.enums.length, plainConsts = s.consts.filter((c) => c.kind !== "map");
  const bits = [];
  if (nE) bits.push(`${nE} enum${nE === 1 ? "" : "s"}`);
  if (plainConsts.length) bits.push(`${plainConsts.length} constant${plainConsts.length === 1 ? "" : "s"}`);
  out.push(`This module defines ${list(bits) || "named values"} and contains no function bodies.`);
  for (const e of s.enums) {
    const vals = e.members.map((m) => words(m.name));
    out.push(`The enum \`${e.name}\` (${words(e.name)}) has value${e.members.length === 1 ? "" : "s"}: ${list(vals)}.`);
  }
  if (plainConsts.length) out.push(`Constant${plainConsts.length === 1 ? "" : "s"}: ${list(plainConsts.map((c) => named(c.name)))}.`);
  out.push(pureSurfaceCoverage(s.callables, "pure declared constant/enum surface"));
  return out.join(" ").replace(/\. —/, ".\n—");
}
function describeConfigMap(facts, src) {
  const s = fileSurface(src);
  const maps = s.consts.filter((c) => c.kind === "map");
  const others = s.consts.filter((c) => c.kind !== "map");
  const out = [];
  out.push(`This module is a configuration module — it defines ${maps.length} config object${maps.length === 1 ? "" : "s"} and contains no function bodies.`);
  for (const m of maps) {
    const keys = m.keys.slice(0, 12).map(words);
    const more = m.keys.length > 12 ? `, and ${m.keys.length - 12} more` : "";
    out.push(`The map \`${m.name}\` has ${m.keys.length} setting${m.keys.length === 1 ? "" : "s"}: ${list(keys)}${more}.`);
  }
  if (s.interfaces.length) out.push(`It also declares the shape${s.interfaces.length === 1 ? "" : "s"} ${list(s.interfaces.map((n) => `\`${n}\``))}.`);
  if (others.length) out.push(`Exported value${others.length === 1 ? "" : "s"}: ${list(others.map((c) => `\`${c.name}\``))}.`);
  out.push(pureSurfaceCoverage(s.callables, "pure declared config surface"));
  return out.join(" ").replace(/\. —/, ".\n—");
}
const SHAPE_RENDERERS = { types: describeTypeDefs, constEnum: describeConstEnum, config: describeConfigMap };
/**
 * Structural shape of a pure-surface file. When `src` is given, ALSO require zero
 * embedded function bodies — a pure-surface narrator only fires on files with
 * nothing bespoke to hide, which makes the "0 bespoke residual" guarantee true by
 * construction (and keeps e.g. a `.test.ts` full of arrow callbacks out of the
 * "config" bucket even if its top-level shape looks like a const map).
 */
function pureSurfaceShape(f, src) {
  if (!f || f.reexportOnly) return null; // barrels handled by describeBarrel
  if (src != null && fileSurface(src).callables > 0) return null; // has function bodies -> not pure surface
  const typeDecls = f.interfaces + f.typeAliases;
  if (f.runtimeStmts === 0 && typeDecls > 0 && f.enums === 0 && f.classes.length === 0) return "types";
  if (f.enums > 0 && f.exportFns === 0 && f.exportArrows === 0 && f.classes.length === 0) return "constEnum";
  if (f.constMaps >= 1 && (f.exportFns + f.exportArrows) === 0 && f.classes.length === 0) return "config";
  return null;
}

/* -------------------------------------------------- LOGIC-FILE SUMMARY -------- */
/**
 * FUNCTION-LEVEL plain-English SUMMARY for real-logic files (AsyncFunctionModule,
 * PureModule, DataAccessModule, ServiceClass, FunctionModule, ...). NOT a line-by-
 * line translation — one honest sentence per function saying what it does at the
 * function grain. Deterministic, zero model calls.
 *
 * Two grounded signals, combined:
 *   1. the byte-verified skeleton KIND backbone (body.fills: ASSIGN/CALL/FETCH/
 *      GUARD/RETURN/... + the named idioms fetchAndValidate/assertOrThrow/...), and
 *   2. LITERAL source-pattern detection scoped to the function's own text
 *      (.map/.filter/.reduce/.find/.sort, await, try/catch, throw, object build).
 * The detectors only report operations the code literally contains — no invented
 * semantics (we say "maps each item", never "maps it to a DTO").
 */
function parseFunctions(src) {
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ln = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const out = [];
  const push = (name, kind, node, isAsync) => out.push({ name, kind, startLine: ln(node.getStart()), endLine: ln(node.getEnd()), isAsync });
  const isAsyncFn = (n) => !!(n.modifiers && n.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword));
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) push(st.name.getText(), "function", st, isAsyncFn(st));
    else if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      const init = d.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body) push(d.name.getText(), "arrow", d, isAsyncFn(init)); // block OR concise-expression body
    } else if (ts.isClassDeclaration(st)) {
      const cn = st.name ? st.name.getText() : "";
      for (const m of st.members) if ((ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m)) && m.body) push((cn ? cn + "." : "") + (m.name ? m.name.getText() : "constructor"), "method", m, isAsyncFn(m));
    }
  }
  return out;
}
function firstCallee(text) {
  const m = text.replace(/^[^{]*\{/, "").match(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/);
  const bad = new Set(["if", "for", "while", "switch", "catch", "return", "map", "filter", "reduce", "forEach", "find"]);
  return m && !bad.has(m[1]) ? m[1] : null;
}
const QTY = (n) => n <= 1 ? "" : n === 2 ? "a couple of " : n <= 4 ? "a few " : "several ";
/** One honest sentence for a single function, from its skeleton fills + source span. */
function summarizeFunction(fn, body, fnText) {
  const fills = (body && body.fills) || [];
  const kinds = {}; for (const f of fills) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
  const idioms = fills.map((f) => f.fill).filter((x) => IDIOMS.has(x));
  const T = fnText || "";
  const has = (re) => re.test(T);
  const clauses = [];

  // 1. input validation
  if (idioms.includes("assertOrThrow") || kinds.GUARD_THROW) clauses.push("validates its input");
  else if (kinds.GUARD || kinds["FETCH+GUARD"]) clauses.push("checks a precondition");

  // 2. data acquisition
  if (idioms.includes("fetchAndValidate")) clauses.push("fetches a record and confirms it exists");
  else if (kinds.FETCH || kinds["FETCH+GUARD"]) clauses.push((has(/\bawait\b/) ? "fetches a record" : "looks up data"));

  // 3. the dominant transform (pick ONE, most specific first)
  let core = null;
  if (has(/\.reduce\s*\(/)) core = "reduces them into a single result";
  else if (has(/\.map\s*\(/) && has(/\.filter\s*\(/)) core = "filters and transforms the items";
  else if (has(/\.flatMap\s*\(/)) core = "expands each item into several";
  else if (has(/\.map\s*\(/)) core = "transforms each item";
  else if (has(/\.filter\s*\(/)) core = "filters the items";
  else if (has(/\.find\s*\(/)) core = "finds a matching item";
  else if (has(/\.sort\s*\(/)) core = "sorts the items";
  else if (has(/\.forEach\s*\(/) || kinds.LOOP) core = "iterates over a collection";
  if (core) clauses.push(core);

  // 4. delegation / coordination (only when there was no transform)
  if (!core) {
    const nCall = (kinds.CALL || 0) + (kinds.AWAIT || 0);
    if (nCall === 1 && (body ? body.stmtCount <= 2 : true)) { const c = firstCallee(T); clauses.push(c ? `delegates to \`${c}\`` : "delegates to a single helper"); }
    else if (nCall >= 2) clauses.push(`coordinates ${QTY(nCall)}operations`);
    else if (kinds.ASSIGN && !kinds.RETURN && !kinds.FETCH) clauses.push(`computes ${kinds.ASSIGN <= 1 ? "a value" : QTY(kinds.ASSIGN) + "values"}`);
  }

  // 5. result assembly / branching flavor
  if (has(/return\s*\{/) || has(/:\s*I[A-Z]\w+\s*=>/)) clauses.push("assembles a result object");
  else if ((kinds.IF || 0) >= 2 && !core) clauses.push("branches on several conditions");

  // 6. error handling (a trailing modifier, not a coordinate clause)
  const mods = [];
  if (kinds.TRY || has(/\btry\s*\{/)) mods.push("within a try/catch");
  if ((kinds.THROW || idioms.includes("throwError")) && !clauses.some((c) => /validat|precondition/.test(c))) mods.push("raising an error on failure");

  // 7. return — only when nothing already implies the produced result (avoids
  // "reduces them into a single result, and returns the result").
  const returns = kinds.RETURN || has(/\breturn\s+[^;]/);
  const resulty = clauses.some((c) => /result|transforms each|filters|finds a|sorts|expands|reduces|delegates|branches/.test(c));
  if (returns && !resulty) clauses.push("returns the result");

  // fallback when no shape matched: use the function's own nature, not "a step".
  if (!clauses.length) {
    if (/^(is|has|should|can|are|was|match|equals|includes|contains)/.test(fn.name.replace(/^.*\./, ""))) clauses.push("tests a condition and returns a boolean");
    else if (returns || fn.kind === "arrow") clauses.push("computes a value from its inputs and returns it");
    else clauses.push("performs a small operation");
  }

  // compose. dedupe consecutive repeats, join with natural 1/2/n grammar.
  const uniq = clauses.filter((c, i) => c !== clauses[i - 1]);
  let sentence = uniq.length === 1 ? uniq[0]
    : uniq.length === 2 ? `${uniq[0]} and ${uniq[1]}`
    : uniq.slice(0, -1).join(", ") + ", and " + uniq[uniq.length - 1];
  if (mods.length) sentence += " " + mods.join(", ");
  sentence = (fn.isAsync ? "asynchronously " : "") + sentence;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}
function describeLogicFile(arch, bodies, src) {
  if (src == null) return null;
  const fns = parseFunctions(src);
  if (!fns.length) return null;
  const srcLines = src.split("\n");
  const bodyList = (bodies || []).slice();
  const out = [];
  out.push(`This module defines ${fns.length} function${fns.length === 1 ? "" : "s"}. Plain-language summary of each — what it does at the function grain (from its control-flow shape, NOT a line-by-line translation):`);
  let summarized = 0;
  for (const fn of fns) {
    // outer body = the persisted skeleton body with the smallest line inside the function span
    const inSpan = bodyList.filter((b) => b.line >= fn.startLine && b.line <= fn.endLine).sort((a, b) => a.line - b.line);
    const body = inSpan[0] || null;
    const fnText = srcLines.slice(fn.startLine - 1, fn.endLine).join("\n");
    if (body) summarized++;
    out.push(`- \`${fn.name}\` ${summarizeFunction(fn, body, fnText)}`);
  }
  out.push(`— summary grain: function-level (${summarized}/${fns.length} backed by a byte-verified skeleton shape); operations named are ones the code literally contains; this is a SUMMARY, not a line-by-line English rendering.`);
  return out.join("\n");
}

/* -------------------------------------------------------------- entry point ---- */
const RENDERERS = { Entity: describeEntity, RouterModule: describeRouter, ReduxModule: describeRedux, IndexBarrel: describeBarrel };
const { analyzeFile } = require("./archetypes.js");
/** renderProse(arch, {bodies, src}) -> English narrative for a supported archetype. */
function renderProse(arch, opts = {}) {
  const r = RENDERERS[arch.archetype];
  if (r) return r(arch, opts.bodies || [], opts.src);
  // No archetype-level renderer — try a pure-surface SHAPE narrator (types/enums/config).
  if (opts.src != null) {
    const facts = opts.facts || analyzeFile(arch.rel || "x.ts", opts.src);
    const shape = pureSurfaceShape(facts, opts.src);
    if (shape) return SHAPE_RENDERERS[shape](facts, opts.src);
    // real-logic file: fall through to the function-level plain-English SUMMARY.
    const logic = describeLogicFile(arch, opts.bodies || [], opts.src);
    if (logic) return logic;
  }
  return `(${arch.archetype}: no prose renderer — described by lower tiers)`;
}

/* Where the LLM naming pass would upgrade the prose (structural -> domain phrases). */
const LLM_UPGRADE_NOTE =
  "LLM-upgrade points (NOT invoked here): structural skeleton names like `assignAssignReturn` / "
  + "`assignFetchAssign` would become domain phrases (e.g. \"loads the account and returns its costs\"); "
  + "anonymous `c_`-hash statement words would get intention-revealing names; the enum/type names "
  + "(e.g. `EBillingAccountClientType`) would read as \"the client type\". Everything above is derived "
  + "deterministically from the persisted tiers with no model call.";

module.exports = { renderProse, describeEntity, describeRouter, describeRedux, describeBarrel, barrelReexports, moduleWords, describeTypeDefs, describeConstEnum, describeConfigMap, fileSurface, pureSurfaceShape, SHAPE_RENDERERS, describeLogicFile, summarizeFunction, parseFunctions, skeletonToWords, coverage, coverageLine, words, list, a, byteToLine, KIND_VERB, IDIOM_PHRASE, LLM_UPGRADE_NOTE };
