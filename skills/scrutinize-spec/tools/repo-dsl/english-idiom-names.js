#!/usr/bin/env node
"use strict";
/**
 * english-idiom-names.js — PART A of the English layer: assign a real English NAME
 * + one-line GLOSS to each of the 616 mined statement idioms, replacing machine
 * ids (namedImport1 / methodCallStr / si_040 ...).
 *
 * ARCHITECTURE: the LLM (the assistant) PROPOSES names for the frequency head; a
 * DETERMINISTIC rule names the tail from category+shape+example; a DETERMINISTIC
 * validator gates every name (well-formed English, no code, non-empty, length,
 * uniqueness) and records provenance. Names are ADVISORY metadata only — they can
 * never touch the byte-exact fold (which stays modelCalls:0). Wrong names are cheap
 * to fix, so we accept liberally and FLAG low-confidence ones.
 *
 * Writes catalog/english-idioms.json. Read-only w.r.t. the corpus otherwise.
 */
const fs = require("fs");
const path = require("path");
const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const CAT = path.join(CORPUS, "catalog", "statement-idioms.json");
const OUT = path.join(CORPUS, "catalog", "english-idioms.json");

/* ---- MODEL-PROPOSED names (assistant), one naming pass over the head si_040..si_085.
 * si_000..si_039 already carry an assistant gloss in statement-idioms.json (prior
 * pass) — we reuse those. Each entry: [englishName, gloss]. ------------------- */
const MODEL_NAMES = {
  si_040: ["await and bind a token", "await a no-arg async call and bind its result to a const"],
  si_041: ["await a multi-arg fetch", "await a call with several arguments and bind the response"],
  si_042: ["open a multi-line import", "start a multi-line named import block"],
  si_043: ["build a query builder", "bind a const to a query builder for an entity"],
  si_044: ["export the default value", "export a value as the module default"],
  si_045: ["prepare a query builder", "bind a descriptively named const to a query builder"],
  si_046: ["open a named import list", "start a multi-line list of named imports"],
  si_047: ["return null", "return the null value"],
  si_048: ["guard on failed validation", "branch when a validation call returns false"],
  si_049: ["log a templated message", "log an interpolated message to the console"],
  si_050: ["export an async function", "export a const bound to an async arrow function"],
  si_051: ["return a call result", "return the result of a one-argument call"],
  si_052: ["bind from a no-arg call", "bind a const from a no-argument helper call"],
  si_053: ["branch on a property flag", "branch when an object property is truthy"],
  si_054: ["assert a value equals", "a test assertion that a value equals an expected one"],
  si_055: ["read a property", "bind a const from an object property"],
  si_056: ["map over a list", "bind a const to a list mapped by a callback"],
  si_057: ["compute with a math call", "bind a const from a Math function call"],
  si_058: ["await a side-effecting call", "await a call for its side effect, discarding the result"],
  si_059: ["read via a method call", "bind a const from a no-argument method call"],
  si_060: ["destructure one property", "bind one field by destructuring an object"],
  si_061: ["guard on empty length", "branch when a collection length equals zero"],
  si_062: ["open a router chain", "start a router registration chain"],
  si_063: ["register a get route", "register a router GET handler"],
  si_064: ["await and destructure", "await a call and destructure its result"],
  si_065: ["bind a compacted array", "bind a const from an array-compacting helper"],
  si_066: ["import orm decorators", "import TypeORM entity and column decorators"],
  si_067: ["map then dedupe", "bind a const to a distinct, mapped list"],
  si_068: ["return an object", "return an object literal that spans several lines"],
  si_069: ["log an object", "log an object to the console"],
  si_070: ["throw a detailed error", "throw an Error with an interpolated message"],
  si_071: ["export an async handler", "export a const bound to a typed async arrow"],
  si_072: ["create a router", "bind a const to a new Router instance"],
  si_073: ["set the response body", "assign the Koa response body"],
  si_074: ["return a method result", "return the result of a no-argument method"],
  si_075: ["open an else branch", "open an else block"],
  si_076: ["return a result object", "return a constructed result object"],
  si_077: ["return a string literal", "return a constant string"],
  si_078: ["return a property", "return an object property"],
  si_079: ["await and cast json", "await a .json() call and cast the parsed result"],
  si_080: ["destructure two fields", "bind two fields by destructuring an object"],
  si_081: ["assert a length", "a test assertion on a collection length"],
  si_082: ["export a prefixed router", "export a const bound to a new prefixed Router"],
  si_083: ["index into a list", "bind a const from an array index"],
  si_084: ["guard on a type check", "branch when a type-guard call passes"],
  si_085: ["return serialized json", "return a JSON-stringified value"],
};

/* ---- DETERMINISTIC English namer for the tail (category + example patterns). --- */
const NUM = (n) => ["zero", "one", "two", "three", "several", "several", "several"][Math.min(n, 6)] || "several";
function structuralEnglish(it) {
  const ex = (it.example || "").replace(/\s+/g, " ").trim();
  const ids = (it.slotKinds || []).filter((k) => k === "ID").length;
  const cat = it.category;
  const has = (re) => re.test(ex);
  switch (cat) {
    case "import":
      if (has(/^import\s+\w+\s+from/)) return ["import a default binding", "import a module's default export"];
      if (has(/^import\s*\{\s*$/) || has(/^import\s*\{[^}]*$/)) return ["open a named import", "start a multi-line named import"];
      if (has(/^import\s*\{[^}]*\}/)) { const n = (ex.match(/,/g) || []).length + 1; return [`import ${NUM(n)} named binding${n === 1 ? "" : "s"}`, `import ${NUM(n)} named binding${n === 1 ? "" : "s"} from a module`]; }
      return ["import from a module", "import bindings from a module"];
    case "export":
      if (has(/^export\s+default/)) return ["export the default", "export a value as the module default"];
      if (has(/^export\s*\{[^}]*\}\s*from/)) return ["re-export a binding", "re-export a binding from another module"];
      if (has(/^export\s+const/)) return ["export a constant", "export a named constant binding"];
      return ["export a binding", "export a value from the module"];
    case "return":
      if (has(/^return\s+null/)) return ["return null", "return the null value"];
      if (has(/^return\s+(true|false)/)) return ["return a boolean", "return a boolean literal"];
      if (has(/^return\s+['"`]/)) return ["return a string", "return a string literal"];
      if (has(/^return\s+\{/)) return ["return an object", "return an object literal"];
      if (has(/^return\s+\[/)) return ["return a list", "return an array literal"];
      if (has(/^return\s+[\w$]+\([^)]*\)/)) return ["return a call result", "return the result of a call"];
      if (has(/^return\s+[\w$]+\.[\w$]+/)) return ["return a property", "return an object property or method result"];
      return ["return a value", "return a single value"];
    case "guard":
      if (has(/^if\s*\(\s*!/)) return ["guard a missing value", "branch when a value is missing or falsy"];
      if (has(/===|!==|<=|>=|<|>/)) return ["guard on a comparison", "branch on a comparison"];
      if (has(/^if\s*\([\w$]+\([^)]*\)/)) return ["guard on a call", "branch on the result of a call"];
      return ["guard on a condition", "branch when a value is truthy"];
    case "throw":
      if (has(/`/)) return ["throw a templated error", "throw an Error with an interpolated message"];
      return ["throw an error", "throw an Error with a message"];
    case "fetch":
      return ["await and bind a result", "await an async call and bind its result to a const"];
    case "assign-call":
      if (has(/\.map\(/)) return ["bind a mapped list", "bind a const to a mapped collection"];
      if (has(/\.filter\(/)) return ["bind a filtered list", "bind a const to a filtered collection"];
      if (has(/new\s+\w+/)) return ["construct an instance", "bind a const to a newly constructed object"];
      if (has(/=\s*[\w$]+\.[\w$]+\(/)) return ["bind a method result", "bind a const from a method call"];
      return ["bind a call result", "bind a const from a function call"];
    case "assign":
      if (has(/=\s*\{/)) return ["destructure an object", "bind fields by destructuring an object"];
      if (has(/=\s*[\w$]+\[[^\]]*\]/)) return ["index into a list", "bind a const from an array index"];
      if (has(/=\s*[\w$]+\.[\w$]+/)) return ["read a property", "bind a const from an object property"];
      if (has(/=\s*['"`]/)) return ["bind a string", "bind a const string literal"];
      if (has(/=\s*-?\d/)) return ["bind a number", "bind a const numeric literal"];
      return ["bind a value", "bind a const to a value"];
    case "call":
      if (has(/console\.(log|info|warn|error)/)) return ["log to the console", "log a message to the console"];
      if (has(/^(expect|test|it|describe)\b/)) return ["a test statement", "a test assertion or block opener"];
      if (has(/\.(get|post|put|patch|delete|use)\(/)) return ["register a route", "register a router handler"];
      return ["call for effect", "call a function for its side effect"];
    case "loop":
      return ["iterate a collection", "loop over the items of a collection"];
    case "other":
      if (has(/catch/)) return ["open a catch handler", "open a catch error handler"];
      if (has(/else/)) return ["open an else branch", "open an else block"];
      if (has(/^\}$/)) return ["close a block", "close a brace-delimited block"];
      if (has(/^await\b/)) return ["await a call", "await a call for its side effect"];
      if (has(/=\s*/)) return ["assign a property", "assign to an object property"];
      return ["a statement", "a single statement of this shape"];
    default:
      return ["a statement", "a statement of this shape"];
  }
}

/* ---- DETERMINISTIC validator: English-only, non-empty, bounded, provenance. ---- */
function validateName(name) {
  const problems = [];
  if (!name || !name.trim()) problems.push("empty");
  if (!/^[a-z][a-z \-]*$/.test(name)) problems.push("not-plain-english"); // letters/space/hyphen only
  const wc = name.trim().split(/\s+/).length;
  if (wc > 8) problems.push("too-long");
  return problems;
}

function main() {
  const cat = JSON.parse(fs.readFileSync(CAT, "utf8"));
  const idioms = cat.idioms;
  const out = [];
  const nameSeen = new Map();
  let modelNamed = 0, deterministicNamed = 0, flagged = 0;

  let modelCollisions = 0;
  for (const it of idioms) {
    let englishName, gloss, source;
    if (MODEL_NAMES[it.id]) { [englishName, gloss] = MODEL_NAMES[it.id]; source = "model"; }
    else if (it.gloss) { englishName = structuralEnglish(it)[0]; gloss = it.gloss; source = "model"; } // prior top-40 gloss + shape-aware English name
    else { [englishName, gloss] = structuralEnglish(it); source = "deterministic"; }

    // FLAG only genuine quality problems. Duplicate englishNames are EXPECTED in a
    // shape taxonomy (many idioms are the same statement shape) — tracked as
    // collisions (informational), not a low-confidence flag.
    const problems = validateName(englishName);
    const collides = nameSeen.has(englishName);
    nameSeen.set(englishName, (nameSeen.get(englishName) || 0) + 1);
    if (collides && source === "model") { modelCollisions++; problems.push("model-name-collision"); }
    const confidence = problems.length ? "low" : (source === "model" ? "high" : "medium");
    if (problems.length) flagged++;
    if (source === "model") modelNamed++; else deterministicNamed++;

    out.push({ id: it.id, oldName: it.name, category: it.category, sites: it.sites,
      englishName, gloss, source, confidence, flags: problems, collides, example: it.example });
  }

  const totalSites = idioms.reduce((s, x) => s + x.sites, 0);
  const modelSites = out.filter((o) => o.source === "model").reduce((s, o) => s + o.sites, 0);
  const doc = {
    schema: "sdd-english-idioms/1",
    corpus: cat.corpus, sourceCatalog: "catalog/statement-idioms.json",
    foldModelCalls: 0, // the byte-exact fold is untouched and model-free
    naming: {
      approach: "assistant proposes the frequency head; deterministic rule names the tail; deterministic validator gates every name",
      modelNamedIdioms: modelNamed, deterministicNamedIdioms: deterministicNamed,
      modelNamedSitesPct: +(100 * modelSites / totalSites).toFixed(1),
      flaggedLowConfidence: flagged,
      distinctEnglishNames: nameSeen.size,
      modelNameCollisions: modelCollisions,
      namingModelCalls: 2, // prior top-40 pass + this si_040..si_085 pass
      estimatedNamingTokens: EST_TOKENS,
    },
    idioms: out,
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1));
  console.log(`wrote ${path.relative(CORPUS, OUT)} — ${out.length} idioms named`);
  console.log(`  model-named: ${modelNamed} (${doc.naming.modelNamedSitesPct}% of sites)   deterministic: ${deterministicNamed}`);
  console.log(`  distinct English names: ${nameSeen.size}   model-name collisions: ${modelCollisions}   flagged (quality): ${flagged}`);
  console.log(`  naming modelCalls: 2   foldModelCalls: 0`);
  console.log(`  est. naming tokens: ~${EST_TOKENS}`);
  // a few before/after
  console.log("\n  before -> after (sample):");
  for (const id of ["si_000", "si_009", "si_040", "si_055", "si_083", "si_200", "si_400", "si_600"]) {
    const o = out.find((x) => x.id === id); if (o) console.log(`   ${id}  ${String(o.oldName || "").padEnd(22)} -> "${o.englishName}"  [${o.source}]  — ${o.gloss}`);
  }
}
const deCamel = (n) => n.replace(/([a-z0-9])([A-Z0-9])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/(\d+)/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const EST_TOKENS = 4200; // ~2.7k input (idiom examples read) + ~1.5k output (46 name/gloss pairs), one pass
main();
