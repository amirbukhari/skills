"use strict";
/**
 * HYDRA-DSL — the editable concrete syntax over hydra-source's mined WHOLE-FILE
 * words, plus the fetchAndValidate idiom word. This is the surface the panel's
 * Author step edits and the loop expands + byte-verifies. Deterministic, no LLM.
 *
 * A module's composition.calc is a single whole-file WORD CALL:
 *
 *     w_08_d4192b {
 *       exportName = housingTypeCostCalculator
 *       elemType   = ISubscriptionUsage
 *       ...
 *     }
 *
 * Each `name = value` is one typed param (value is the raw single-line token
 * text). Expanding fills the word's baked template with these params, byte-for-
 * byte. The word definitions (items/tokenPlans/bakedGaps) are persisted in
 * dsl-words.json, so expansion never re-mines the corpus.
 */
const { expandWord } = require("./wholefile.js");

// A value is written BARE when it is a clean single-line token (identifier, type
// name, dotted path, simple call) with no newline / no leading-trailing space and
// nothing that would confuse the line parser. Otherwise it is JSON-encoded after
// an `@json ` marker so quotes, commas, braces and newlines survive round-trip.
const BARE_OK = /^[A-Za-z_$][\w$.<>\[\], '"`():-]*$/;
function encodeValue(v) {
  if (typeof v === "string" && !v.includes("\n") && v === v.trim() && BARE_OK.test(v)) return v;
  return "@json " + JSON.stringify(v);
}
function decodeValue(raw) {
  if (raw.startsWith("@json ")) return JSON.parse(raw.slice(6));
  return raw;
}

/** Render a whole-file word call (the editable .calc surface). */
function printCalc(wordName, paramsMap) {
  const lines = [`${wordName} {`];
  for (const [k, v] of Object.entries(paramsMap)) lines.push(`  ${k} = ${encodeValue(v)}`);
  lines.push("}");
  return lines.join("\n") + "\n";
}

/** Parse a .calc word call -> { word, params:{name:value} }. */
function parseCalc(text) {
  const lines = text.split("\n");
  let word = null;
  const params = {};
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const open = line.match(/^(\S+)\s*\{\s*$/);
    if (open) { word = open[1]; continue; }
    if (line.trim() === "}") continue;
    const eq = line.indexOf(" = ");
    if (eq === -1) continue;
    const name = line.slice(0, eq).trim();
    const value = decodeValue(line.slice(eq + 3)); // bare token or `@json <JSON>`
    params[name] = value;
  }
  if (!word) throw new Error("no word call found in .calc");
  return { word, params };
}

/** Expand a parsed call against the persisted word index -> source code. */
function expandCalc(wordIndex, calcText) {
  const { word, params } = parseCalc(calcText);
  const def = wordIndex[word];
  if (!def) throw new Error(`unknown word: ${word}`);
  // order params per the word's declared param list; every param must be present
  const missing = def.params.filter((p) => !(p.name in params)).map((p) => p.name);
  if (missing.length) throw new Error(`missing params for ${word}: ${missing.join(", ")}`);
  return expandWord(def, params);
}

/* ----------------------------- idiom (fetchAndValidate) ------------------------------ */

// Canonical authoring template for a NEW fetchAndValidate instance (standard form).
// Existing sites are byte-verified against their OWN stored templates; this is the
// shape the word produces when you compose a fresh one.
const IDIOM_CANONICAL = {
  name: "fetchAndValidate",
  params: ["var", "recv", "selector", "entity", "opts", "guardExpr", "action"],
  template: (p) =>
    `const ${p.var} = await ${p.recv}.${p.selector}(${p.entity}${p.opts ? `, ${p.opts}` : ""});\n` +
    `  if (!${p.guardExpr}) {\n    ${p.action}\n  }`,
};

function expandIdiomCanonical(paramsMap) {
  return IDIOM_CANONICAL.template({
    var: paramsMap.var || "row", recv: paramsMap.recv, selector: paramsMap.selector || "findOne",
    entity: paramsMap.entity, opts: paramsMap.opts || "", guardExpr: paramsMap.guardExpr || (paramsMap.var || "row"),
    action: paramsMap.action || "throw new Error('not found');",
  });
}

module.exports = { printCalc, parseCalc, expandCalc, IDIOM_CANONICAL, expandIdiomCanonical };
