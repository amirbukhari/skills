"use strict";
/**
 * The deterministic generator library for the SDD CODE stage.
 *
 * Two tiers, per the concept:
 *   LEAVES     — OPAQUE ids (p_xxxxxxxx). Each emits one mined structural brick
 *                as REAL native code. Params are small + typed ONLY: identifier,
 *                typeName, moduleSpecifier, identifierList, or enumChoice. There
 *                is deliberately NO free-text param kind — a leaf that would need
 *                one is a mining failure, not a generator.
 *   COMPOSITES — READABLE names (makeX / wireY). They emit NO raw code; they
 *                return a tree of child generator nodes (leaves and smaller
 *                composites). Readable names are the LLM's vocabulary; they
 *                expand into trees of opaque-id leaves.
 *
 * Every leaf/composite that corresponds to a mined pattern carries `patternId`
 * = the id the miner assigned that skeleton, so coverage checking can prove the
 * generator is backed by an actually-recurring pattern (not invented). A few
 * purely-structural bricks (function open/close braces) and trivia (the canned
 * NOTE comment, which is not an AST node) carry `patternId: null` and are marked
 * `structural` / `trivia` — reported separately so the metric stays honest.
 *
 * A node is one of:
 *   { leaf: "p_xxxx", params }           -> emit one brick
 *   { composite: "makeX", params }       -> expand a subtree
 *   { gap: n }                           -> n blank lines (whitespace, not code)
 *   { indent: n, children: [...] }       -> indent a subtree by n levels
 */

/* ----------------------------- LEAVES ------------------------------------- */

const LEAVES = {
  // import { NAME } from 'FROM';
  p_2c6b9735: {
    patternId: "p_2c6b9735",
    label: "named-import (single specifier)",
    params: { name: "identifier", from: "moduleSpecifier" },
    emit: ({ name, from }) => `import { ${name} } from ${from};`,
  },

  // const NAME = VALUE;
  p_57073579: {
    patternId: "p_57073579",
    label: "const-assign identifier",
    params: { name: "identifier", value: "identifier" },
    emit: ({ name, value }) => `const ${name} = ${value};`,
  },

  // const RESULT: ELEM[] = SOURCE.filter((P) => P.FIELD === RHS);
  p_bcbbcc46: {
    patternId: "p_bcbbcc46",
    label: "filter-by-field assignment",
    params: {
      resultVar: "identifier", elemType: "typeName", sourceVar: "identifier",
      paramName: "identifier", field: "identifier", rhs: "identifier",
    },
    emit: ({ resultVar, elemType, sourceVar, paramName, field, rhs }) =>
      `const ${resultVar}: ${elemType}[] = ${sourceVar}.filter((${paramName}) => ${paramName}.${field} === ${rhs});`,
  },

  // const RESULT: ELEM[] = FN(ARGS...);
  p_bad2f718: {
    patternId: "p_bad2f718",
    label: "delegate-call assignment",
    params: { resultVar: "identifier", elemType: "typeName", fn: "identifier", args: "identifierList" },
    emit: ({ resultVar, elemType, fn, args }) =>
      `const ${resultVar}: ${elemType}[] = ${fn}(${args.join(", ")});`,
  },

  // return NAME;
  p_e8dacf98: {
    patternId: "p_e8dacf98",
    label: "return identifier",
    params: { name: "identifier" },
    emit: ({ name }) => `return ${name};`,
  },

  // export const NAME = (\n  P: PT[],\n): RT[] => FN(ARGS...);   (whole delegating arrow)
  p_8af7a739: {
    patternId: "p_8af7a739",
    label: "export delegating-arrow declaration",
    params: {
      name: "identifier", paramName: "identifier", paramType: "typeName",
      returnType: "typeName", delegateFn: "identifier", args: "identifierList",
    },
    emit: ({ name, paramName, paramType, returnType, delegateFn, args }) =>
      `export const ${name} = (\n  ${paramName}: ${paramType}[],\n): ${returnType}[] => ${delegateFn}(${args.join(", ")});`,
  },

  // --- structural bricks (container syntax; not business logic, no mined id) ---
  struct_func_open: {
    patternId: null, structural: true,
    label: "export function header",
    params: { name: "identifier", paramName: "identifier", paramType: "typeName", returnType: "typeName" },
    emit: ({ name, paramName, paramType, returnType }) =>
      `export function ${name}(${paramName}: ${paramType}[]): ${returnType}[] {`,
  },
  struct_func_close: {
    patternId: null, structural: true,
    label: "function close brace",
    params: {},
    emit: () => `}`,
  },

  // --- trivia (a canned comment; comments are not AST nodes -> enumerable set) ---
  trivia_note: {
    patternId: null, trivia: true,
    label: "canned NOTE comment",
    params: { choice: "enumChoice" },
    enum: {
      filteredForBillingType: "// NOTE: We're assuming the incoming data will already be filtered for billingTypeId",
    },
    emit: ({ choice }) => LEAVES.trivia_note.enum[choice],
  },
};

/* --------------------------- COMPOSITES ----------------------------------- */

const COMPOSITES = {
  /**
   * makeVolumeCostingCalculatorFn — a whole "filter by billingTypeId, then hand
   * off to a shared volume-costing helper" calculator module. Backed by mined
   * composite p_c9fc5db5 (the function shape) + p_57073579 (the const). Composed
   * purely of leaves; emits no raw code itself.
   */
  makeVolumeCostingCalculatorFn: {
    patternId: "p_c9fc5db5",
    label: "volume-costing calculator module (filter -> shared helper)",
    params: {
      exportName: "identifier", billingTypeConst: "identifier",
      elemType: "typeName", costType: "typeName", sharedFn: "identifier",
      importElemFrom: "moduleSpecifier", importCostFrom: "moduleSpecifier",
      importBillingFrom: "moduleSpecifier", importSharedFrom: "moduleSpecifier",
    },
    build: (p) => [
      { leaf: "p_2c6b9735", params: { name: p.billingTypeConst, from: p.importBillingFrom } },
      { leaf: "p_2c6b9735", params: { name: p.elemType, from: p.importElemFrom } },
      { leaf: "p_2c6b9735", params: { name: p.costType, from: p.importCostFrom } },
      { leaf: "p_2c6b9735", params: { name: p.sharedFn, from: p.importSharedFrom } },
      { gap: 1 },
      { leaf: "p_57073579", params: { name: "billingTypeId", value: p.billingTypeConst } },
      { gap: 1 },
      // The function container (structural) wraps a MID composite — NOT a flat
      // run of leaves. This is the small -> mid -> large hierarchy: the LARGE
      // composite (p_c9fc5db5) is built out of the MID composite volumeCostingBody
      // (p_16906662), which is built out of leaves.
      { leaf: "struct_func_open", params: { name: p.exportName, paramName: "usages", paramType: p.elemType, returnType: p.costType } },
      { indent: 1, children: [
        { composite: "volumeCostingBody", params: { elemType: p.elemType, costType: p.costType, sharedFn: p.sharedFn } },
      ] },
      { leaf: "struct_func_close", params: {} },
    ],
  },

  /**
   * volumeCostingBody — MID-tier composite (mined block p_16906662, recurs across
   * the 2 volume calculators). Sits between the large calculator composite and the
   * primitive leaves: it is built out of leaves and is itself a child of the large
   * composite. This is the middle level that made the earlier library two-tier.
   */
  volumeCostingBody: {
    patternId: "p_16906662", tier: "mid",
    label: "volume-costing function body (filter -> shared helper -> return)",
    params: { elemType: "typeName", costType: "typeName", sharedFn: "identifier" },
    build: (p) => [
      { leaf: "trivia_note", params: { choice: "filteredForBillingType" } },
      { leaf: "p_bcbbcc46", params: { resultVar: "subscriptions", elemType: p.elemType, sourceVar: "usages", paramName: "s", field: "billingTypeId", rhs: "billingTypeId" } },
      { gap: 1 },
      { leaf: "p_bad2f718", params: { resultVar: "result", elemType: p.costType, fn: p.sharedFn, args: ["subscriptions", "billingTypeId"] } },
      { leaf: "p_e8dacf98", params: { name: "result" } },
    ],
  },

  /**
   * makeDelegatingCostCalculatorFn — the tiny "just delegate to a shared
   * building-billing-type helper" calculator. Backed by mined composite
   * p_8af7a739. Imports + one delegating-arrow leaf.
   */
  makeDelegatingCostCalculatorFn: {
    patternId: "p_8af7a739",
    label: "delegating cost calculator (arrow -> shared helper)",
    params: {
      exportName: "identifier", billingTypeConst: "identifier", delegateFn: "identifier",
      elemType: "typeName", costType: "typeName",
      importBillingFrom: "moduleSpecifier", importCostFrom: "moduleSpecifier",
      importElemFrom: "moduleSpecifier", importSharedFrom: "moduleSpecifier",
    },
    build: (p) => [
      { leaf: "p_2c6b9735", params: { name: p.billingTypeConst, from: p.importBillingFrom } },
      { leaf: "p_2c6b9735", params: { name: p.costType, from: p.importCostFrom } },
      { leaf: "p_2c6b9735", params: { name: p.elemType, from: p.importElemFrom } },
      { leaf: "p_2c6b9735", params: { name: p.delegateFn, from: p.importSharedFrom } },
      { gap: 1 },
      { leaf: "p_8af7a739", params: { name: p.exportName, paramName: "usages", paramType: p.elemType, returnType: p.costType, delegateFn: p.delegateFn, args: ["usages", p.billingTypeConst] } },
    ],
  },
};

module.exports = { LEAVES, COMPOSITES };
