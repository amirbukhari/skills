"use strict";
/**
 * name-statement-idioms — the NAMING overlay (the only place a model is involved).
 * Mining + coverage math were fully deterministic (statement-idioms.json,
 * modelCalls:0). Here the top idioms get human/domain names assigned by the LLM
 * (assistant), one naming pass; every remaining idiom gets a DETERMINISTIC
 * structural name from its shape. No shape, site, or coverage number is changed —
 * names are metadata only. Also trims the catalog to a panel-sane size.
 *
 *   node name-statement-idioms.js
 */
const fs = require("fs");
const path = require("path");
const PROJECT = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const catPath = path.join(PROJECT, "catalog", "statement-idioms.json");
const cat = JSON.parse(fs.readFileSync(catPath, "utf8"));

/* LLM-assigned names for the top idioms, keyed by structural id. Names describe
 * the SHAPE (one shape = many concrete statements); the example illustrates. */
const LLM_NAMES = {
  si_000: ["namedImport1", "import one named binding from a module"],
  si_001: ["describeBlock", "a Jest `describe('...', () => {` suite opener"],
  si_002: ["namedImport2", "import two named bindings from a module"],
  si_003: ["returnValue", "return a single identifier"],
  si_004: ["guardMissingOpen", "open an `if (!x) {` missing-value guard"],
  si_005: ["throwErrorLiteral", "throw new Error with a string message (== the hand-authored throwError)"],
  si_006: ["namedImport3", "import three named bindings from a module"],
  si_007: ["awaitCall1", "await a one-arg call and bind it (fetch-one-by-arg)"],
  si_008: ["methodCallStr", "call obj.method('...') for side effect (e.g. console.info)"],
  si_009: ["deriveValue1", "bind a value derived from a one-arg call"],
  si_010: ["defaultImport", "import a module's default binding"],
  si_011: ["catchOpen", "open a `} catch (error) {` handler"],
  si_012: ["constNumber", "bind a numeric constant"],
  si_013: ["deriveValueStr", "bind a value from a call with a string arg (e.g. getManager('hydra'))"],
  si_014: ["truthyGuardOpen", "open an `if (x) {` truthy guard"],
  si_015: ["throwErrorTemplate", "throw new Error with a template-literal message"],
  si_016: ["assignMemberFromEnum", "assign a member from an enum member (e.g. ctx.status = HttpStatusCode.Ok)"],
  si_017: ["importOpen1", "open a multi-line named import (one binding on the head line)"],
  si_018: ["deriveFromPath", "bind a value from a call on a nested property path"],
  si_019: ["awaitMethod0", "await a no-arg method and bind it (e.g. query.getMany())"],
  si_020: ["asyncMethodOpen", "class async-method opener emitted at a body boundary"],
  si_021: ["importOpen2", "open a multi-line named import (two bindings on the head)"],
  si_022: ["expectCalledTimes", "Jest expect(x).toBeCalledTimes(n) assertion"],
  si_023: ["exportConstFromMethod", "export a const bound from obj.method(arg) (e.g. ajv.compile)"],
  si_024: ["deriveValue2", "bind a value from a two-arg call"],
  si_025: ["guardMissingPropOpen", "open an `if (!x.prop) {` missing-property guard"],
  si_026: ["namedImport4", "import four named bindings from a module"],
  si_027: ["deriveFromProp", "bind a value from a call on a property (e.g. floatVal(a.maxValue))"],
  si_028: ["constString", "bind a string/template constant"],
  si_029: ["expectLength", "Jest expect(x.prop).toHaveLength(n) assertion"],
  si_030: ["mapProjectProp", "bind xs.map((y) => y.prop) — project a property over a list"],
  si_031: ["callbackOpen", "open a `f(() => {` no-arg callback (e.g. setTimeout)"],
  si_032: ["methodCallArg", "call obj.method(arg) for side effect (e.g. app.use(mw))"],
  si_033: ["destructureConst1", "destructure one property into a const"],
  si_034: ["importOpen3", "open a multi-line named import (three bindings on the head)"],
  si_035: ["guardGreaterThan", "open an `if (x.prop > n) {` threshold guard"],
  si_036: ["reexportNamed", "re-export a named binding from another module"],
  si_037: ["awaitCall2", "await a two-arg call and bind it (fetch-by-two-args)"],
  si_038: ["namedImport5", "import five named bindings from a module"],
  si_039: ["testBlockAsync", "a Jest `test('...', async () => {` async case opener"],
};

/* Deterministic structural name for every other idiom, from its shape tokens.
 * Readable + stable; never calls a model. */
const ABBR = { ImportKeyword: "import", ConstKeyword: "const", LetKeyword: "let", ReturnKeyword: "return",
  IfKeyword: "if", ForKeyword: "for", WhileKeyword: "while", ThrowKeyword: "throw", NewKeyword: "new",
  AwaitKeyword: "await", ExportKeyword: "export", TryKeyword: "try", CatchKeyword: "catch",
  AsyncKeyword: "async", ExclamationToken: "not", EqualsGreaterThanToken: "arrow" };
function structuralName(shape, category, idx) {
  const toks = shape.split(" ").filter(Boolean);
  const ids = toks.filter((t) => t === "ID").length;
  const strs = toks.filter((t) => t === "STR").length;
  const nums = toks.filter((t) => t === "NUM").length;
  const kw = toks.filter((t) => ABBR[t]).map((t) => ABBR[t]);
  const head = kw.slice(0, 3).join("_") || category;
  const arity = `${ids}i${strs ? strs + "s" : ""}${nums ? nums + "n" : ""}`;
  return `${head}_${arity}#${idx}`;
}

let named = 0;
cat.idioms.forEach((i, idx) => {
  if (LLM_NAMES[i.id]) { i.name = LLM_NAMES[i.id][0]; i.gloss = LLM_NAMES[i.id][1]; i.nameSource = "llm"; named++; }
  else { i.name = structuralName(i.shape, i.category, idx); i.gloss = null; i.nameSource = "deterministic-structural"; }
  // TRIM: keep full per-site templates (self-expanding) only for the top 60; the
  // rest keep a capped sample of sites (rel:line) — byte-verify already recorded.
  if (idx >= 20 && i.membersFull) delete i.membersFull;
  if (i.members && i.members.length > 15) i.members = i.members.slice(0, 15);
});

cat.naming = {
  method: "top 40 idioms named by LLM (assistant), one naming pass; remaining named by deterministic structural rule",
  llmNamedCount: named,
  namingModelCalls: 1,
  miningModelCalls: 0,
  note: "Naming is metadata only. No shape, site count, byte-verify, or coverage number was produced or altered by a model.",
};

fs.writeFileSync(catPath, JSON.stringify(cat, null, 1));
console.log(`named ${named} idioms via LLM + ${cat.idioms.length - named} via deterministic structural rule`);
console.log(`catalog trimmed to ${(fs.statSync(catPath).size / 1024).toFixed(0)} KB`);
console.log(`top 12 named idioms:`);
for (const i of cat.idioms.slice(0, 12)) console.log(`  ${i.name.padEnd(20)} ${String(i.sites).padStart(4)}x ${String(i.files).padStart(3)}f  — ${i.gloss || ""}`);
