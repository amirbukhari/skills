#!/usr/bin/env node
/**
 * Deterministic spec -> code generator for the money-cart example.
 *
 * Reads every spec/modules/<m>/spec.md `spec-codegen` block plus that module's
 * constants.md, and emits one generated/<m>.js per module. The output is a PURE
 * FUNCTION of the spec: same spec/ in => byte-identical generated/ out, every
 * run. There is no clock, no randomness, and no ambient state — that is what
 * makes `spec = source, code = build output` a literal claim, not a metaphor.
 *
 * It is a renderer of exactly the standards C4 value grammar and C5 intrinsic
 * catalogue — nothing else. An unknown node shape or intrinsic is a hard error,
 * never a silent guess.
 *
 * Usage:  node tools/generate.js [outputDir]     (default outputDir: generated/)
 * Run from anywhere; paths resolve relative to this example's root.
 */

const fs = require("fs");
const path = require("path");
const lib = require("./lib.js");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const SPEC_DIR = path.join(EXAMPLE_ROOT, "spec");
const MODULES_DIR = path.join(SPEC_DIR, "modules");

function die(msg) {
  console.error("generate: " + msg);
  process.exit(1);
}

function extractFence(md, tag) {
  const re = new RegExp("```" + tag + "\\n([\\s\\S]*?)\\n```");
  const m = md.match(re);
  return m ? m[1] : null;
}

function readModuleSpec(name) {
  const specPath = path.join(MODULES_DIR, name, "spec.md");
  const constPath = path.join(MODULES_DIR, name, "constants.md");
  const codegenRaw = extractFence(fs.readFileSync(specPath, "utf8"), "spec-codegen");
  if (!codegenRaw) die(`no spec-codegen block in ${specPath}`);
  let codegen;
  try {
    codegen = JSON.parse(codegenRaw);
  } catch (e) {
    die(`spec-codegen block in ${specPath} is not valid JSON: ${e.message}`);
  }
  let constants = {};
  if (fs.existsSync(constPath)) {
    const cjson = extractFence(fs.readFileSync(constPath, "utf8"), "json");
    if (cjson) {
      try {
        constants = JSON.parse(cjson);
      } catch (e) {
        die(`constants block in ${constPath} is not valid JSON: ${e.message}`);
      }
    }
  }
  return { codegen, constants };
}

// ---- the intrinsic catalogue (standards C5): canned, deterministic helpers ----
// Keyed by intrinsic name -> { helper: <emitted source>, call: (rendered args) => expr }
const INTRINSICS = {
  round_half_even: {
    helperName: "__roundHalfEven",
    helper: [
      "function __roundHalfEven(value) {",
      "  const floor = Math.floor(value);",
      "  const diff = value - floor;",
      "  if (diff < 0.5) return floor;",
      "  if (diff > 0.5) return floor + 1;",
      "  return floor % 2 === 0 ? floor : floor + 1;", // exact .5 tie -> even
      "}",
    ].join("\n"),
  },
  format_currency: {
    helperName: "__formatCurrency",
    helper: [
      "function __formatCurrency(cents, symbol, decimals) {",
      '  const sign = cents < 0 ? "-" : "";',
      "  const abs = Math.abs(cents);",
      "  const divisor = Math.pow(10, decimals);",
      "  const whole = Math.floor(abs / divisor);",
      "  const frac = abs % divisor;",
      '  const fracStr = String(frac).padStart(decimals, "0");',
      '  return sign + symbol + whole + "." + fracStr;',
      "}",
    ].join("\n"),
  },
  sum_line_items: {
    helperName: "__sumLineItems",
    helper: [
      "function __sumLineItems(items) {",
      "  let sum = 0;",
      "  for (let i = 0; i < items.length; i++) {",
      "    sum += items[i].unitPrice * items[i].quantity;",
      "  }",
      "  return sum;",
      "}",
    ].join("\n"),
  },
};

const OPS = new Set(["+", "-", "*", "/"]);

/**
 * Render one value node (standards C4) to a JS expression string.
 * Records used intrinsics and cross-module deps into `ctx`.
 */
function renderNode(node, ctx) {
  if (node == null || typeof node !== "object") {
    die(`invalid value node: ${JSON.stringify(node)}`);
  }
  if ("param" in node) return node.param;
  if ("lit" in node) return String(node.lit);
  if ("const" in node) {
    if (!(node.const in ctx.constants)) {
      die(`module ${ctx.module} references undefined constant "${node.const}"`);
    }
    return JSON.stringify(ctx.constants[node.const]);
  }
  if ("op" in node) {
    if (!OPS.has(node.op)) die(`unknown op "${node.op}" in module ${ctx.module}`);
    if (!Array.isArray(node.args) || node.args.length !== 2) {
      die(`op "${node.op}" needs exactly 2 args in module ${ctx.module}`);
    }
    const a = renderNode(node.args[0], ctx);
    const b = renderNode(node.args[1], ctx);
    return `(${a} ${node.op} ${b})`;
  }
  if ("call" in node) {
    const args = (node.args || []).map((n) => renderNode(n, ctx)).join(", ");
    if (node.call.module) {
      if (!ctx.dependsOn.includes(node.call.module)) {
        die(
          `module ${ctx.module} calls ${node.call.module}.${node.call.fn} but does not declare it in dependsOn`
        );
      }
      ctx.usedDeps.add(node.call.module);
      return `${node.call.module}.${node.call.fn}(${args})`;
    }
    return `${node.call.fn}(${args})`;
  }
  if ("intrinsic" in node) {
    const spec = INTRINSICS[node.intrinsic];
    if (!spec) die(`unknown intrinsic "${node.intrinsic}" in module ${ctx.module}`);
    ctx.usedIntrinsics.add(node.intrinsic);
    if (node.intrinsic === "format_currency") {
      return `${spec.helperName}(${renderNode(node.arg, ctx)}, ${renderNode(
        node.symbol,
        ctx
      )}, ${renderNode(node.decimals, ctx)})`;
    }
    return `${spec.helperName}(${renderNode(node.arg, ctx)})`;
  }
  die(`unrecognised value node: ${JSON.stringify(node)}`);
}

function generateModule(name) {
  const { codegen, constants } = readModuleSpec(name);
  const ctx = {
    module: name,
    constants,
    dependsOn: Array.isArray(codegen.dependsOn) ? codegen.dependsOn : [],
    usedIntrinsics: new Set(),
    usedDeps: new Set(),
  };

  const fnSources = codegen.functions.map((fn) => {
    const body = renderNode(fn.body, ctx);
    return `function ${fn.name}(${fn.params.join(", ")}) {\n  return ${body};\n}`;
  });

  // Assemble in a fixed order so output is byte-stable across runs.
  const parts = [];
  parts.push(
    `// GENERATED from spec/modules/${name}/ — do not edit by hand.\n` +
      `// Source of truth is the spec; regenerate with tools/generate.js.`
  );
  for (const dep of [...ctx.usedDeps].sort()) {
    parts.push(`const ${dep} = require("./${dep}.js");`);
  }
  for (const intr of Object.keys(INTRINSICS).filter((k) => ctx.usedIntrinsics.has(k))) {
    parts.push(INTRINSICS[intr].helper);
  }
  parts.push(...fnSources);
  const exportNames = codegen.functions.map((f) => f.name);
  parts.push(`module.exports = { ${exportNames.join(", ")} };`);

  return parts.join("\n\n") + "\n";
}

/**
 * Drift check (--check): compare the committed build against the manifest.
 * Detects the three failures that make "spec = source" unsafe:
 *   - STALE:    a spec input changed but the code was not regenerated
 *   - DIVERGED: a generated artifact was hand-edited away from generator output
 *   - ORPHAN:   a file under generated/ that no manifest artifact claims
 *   - UNBUILT:  a module in spec/ with no artifact (never generated)
 *   - MISSING:  a manifest artifact whose file is gone
 * Exit 0 = clean; exit 1 = drift, each finding named.
 */
function checkDrift() {
  const manifest = lib.readManifest();
  if (!manifest) {
    console.error("check: no .provenance.json — run `node tools/generate.js` first");
    process.exit(1);
  }
  const findings = [];
  const claimed = new Set();

  for (const art of manifest.artifacts) {
    claimed.add(art.path);
    const abs = path.join(EXAMPLE_ROOT, art.path);

    if (!fs.existsSync(abs)) {
      findings.push(`MISSING   ${art.path} — artifact in manifest but file is gone`);
      continue;
    }
    if (lib.hashFile(abs) !== art.outputHash) {
      findings.push(
        `DIVERGED  ${art.path} — artifact was hand-edited away from generator output (regenerate to restore)`
      );
    }
    const current = lib.specInputsFor(art.module);
    const prev = art.specInputs || {};
    const changed = [];
    for (const p of Object.keys({ ...current, ...prev })) {
      if (current[p] !== prev[p]) changed.push(p);
    }
    if (changed.length > 0) {
      findings.push(
        `STALE     ${art.path} — spec input(s) changed since build, not regenerated: ${changed.join(", ")}`
      );
    }
  }

  // UNBUILT: a spec module with no manifest artifact.
  const builtModules = new Set(manifest.artifacts.map((a) => a.module));
  for (const name of lib.listModules()) {
    if (!builtModules.has(name)) {
      findings.push(`UNBUILT   spec/modules/${name} — module has no generated artifact`);
    }
  }

  // ORPHAN: any file under generated/ not claimed by the manifest.
  if (fs.existsSync(lib.DEFAULT_GEN_DIR)) {
    for (const f of fs.readdirSync(lib.DEFAULT_GEN_DIR).sort()) {
      const relPath = lib.rel(path.join(lib.DEFAULT_GEN_DIR, f));
      if (!claimed.has(relPath)) {
        findings.push(
          `ORPHAN    ${relPath} — under generated/ but claimed by no module (regeneration would drop or diverge it)`
        );
      }
    }
  }

  if (findings.length === 0) {
    console.log("check: CLEAN — every artifact matches the manifest; no stale, diverged, orphan, or unbuilt paths");
    process.exit(0);
  }
  console.error(`check: DRIFT DETECTED — ${findings.length} finding(s):`);
  for (const f of findings) console.error("  " + f);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check")) return checkDrift();

  const outArg = args.find((a) => !a.startsWith("--"));
  const isDefault = !outArg;
  const outDir = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.join(EXAMPLE_ROOT, "generated");

  const moduleNames = fs
    .readdirSync(MODULES_DIR)
    .filter((d) => fs.statSync(path.join(MODULES_DIR, d)).isDirectory())
    .sort();

  fs.mkdirSync(outDir, { recursive: true });
  const artifacts = [];
  for (const name of moduleNames) {
    const code = generateModule(name);
    const outPath = path.join(outDir, `${name}.js`);
    fs.writeFileSync(outPath, code);
    artifacts.push({ module: name, absPath: outPath });
  }
  console.log(
    `generate: wrote ${artifacts.length} module(s) to ${path.relative(process.cwd(), outDir) || "."}/`
  );
  for (const a of artifacts) console.log(`  ${path.relative(process.cwd(), a.absPath)}`);

  // Record provenance only for the canonical build, not for temp/determinism runs.
  if (isDefault) {
    lib.writeManifest(lib.buildManifest(artifacts));
    console.log(`generate: wrote provenance manifest ${path.relative(process.cwd(), lib.MANIFEST_PATH)}`);
  }
}

main();
