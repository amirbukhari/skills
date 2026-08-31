/**
 * Shared helpers for the spec-driven-dev harness (LLM generation path).
 *
 * Unlike money-cart's deterministic template renderer, this path generates
 * ARBITRARY code (e.g. TypeScript) by prompting a model, and treats a
 * regeneration as valid IFF the fixtures pass — because a model does not emit
 * byte-identical output. These helpers cover: assembling the generator prompt
 * from a spec folder, invoking a pluggable generator (default: the `claude`
 * CLI), content hashing, and the fixtures-pass provenance manifest.
 *
 * Dependency-free (Node built-ins only).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const SKILL_ROOT = path.resolve(__dirname, "..");
const DEFAULT_MODEL = process.env.SDD_MODEL || "claude-sonnet-4-5";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function hashFile(p) {
  return sha256(fs.readFileSync(p));
}
function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => path.join(dir, f));
}
function relTo(root, p) {
  return path.relative(root, p).split(path.sep).join("/");
}

function listModules(exampleDir) {
  const modulesDir = path.join(exampleDir, "spec", "modules");
  if (!fs.existsSync(modulesDir)) return [];
  return fs
    .readdirSync(modulesDir)
    .filter((d) => fs.statSync(path.join(modulesDir, d)).isDirectory())
    .sort();
}

/** Spec inputs that govern a module's generated code (NOT the fixtures). */
function specInputPaths(exampleDir, moduleName) {
  const specDir = path.join(exampleDir, "spec");
  const modDir = path.join(specDir, "modules", moduleName);
  return [
    ...listFiles(path.join(specDir, "standards"), ".md"),
    ...listFiles(path.join(specDir, "contracts"), ".md"),
    path.join(modDir, "spec.md"),
    path.join(modDir, "constants.md"),
  ].filter((p) => fs.existsSync(p));
}

function specInputsHashMap(exampleDir, moduleName) {
  const out = {};
  for (const p of specInputPaths(exampleDir, moduleName).sort()) {
    out[relTo(exampleDir, p)] = hashFile(p);
  }
  return out;
}

function fixturesDir(exampleDir, moduleName) {
  return path.join(exampleDir, "spec", "modules", moduleName, "fixtures");
}
function fixturesHash(exampleDir, moduleName) {
  const dir = fixturesDir(exampleDir, moduleName);
  const files = listFiles(dir, ".json");
  if (!files.length) return null;
  return sha256(files.map((f) => fs.readFileSync(f)).join("\n"));
}

const GENERATOR_SYSTEM_PROMPT = [
  "You are a deterministic code generator in a spec-driven-development build pipeline.",
  "You are given a specification (standards, a contract with signatures, and constants) for ONE module.",
  "Output ONLY the source code for that module — no prose, no explanation, no markdown code fences.",
  "The code MUST export exactly the functions named in the contract, with the given signatures.",
  "The code MUST be pure (no I/O, no Date, no randomness, no global mutation) and use NO external packages — only language built-ins.",
  "Do not include the fixtures or tests; implement the behavior the standards and contract describe.",
].join(" ");

/** Assemble the generator prompt from a module's spec (fixtures withheld). */
function assembleGeneratorPrompt(exampleDir, moduleName, targetLang) {
  const specDir = path.join(exampleDir, "spec");
  const modDir = path.join(specDir, "modules", moduleName);
  const parts = [];
  parts.push(`# Generation request\n\nGenerate the source of module \`${moduleName}\` in ${targetLang}. Emit only the code.`);
  for (const p of listFiles(path.join(specDir, "standards"), ".md")) {
    parts.push(`\n---\n# STANDARDS: ${relTo(exampleDir, p)}\n\n${fs.readFileSync(p, "utf8")}`);
  }
  for (const p of listFiles(path.join(specDir, "contracts"), ".md")) {
    parts.push(`\n---\n# CONTRACT: ${relTo(exampleDir, p)}\n\n${fs.readFileSync(p, "utf8")}`);
  }
  const specMd = path.join(modDir, "spec.md");
  if (fs.existsSync(specMd)) parts.push(`\n---\n# MODULE SPEC: ${relTo(exampleDir, specMd)}\n\n${fs.readFileSync(specMd, "utf8")}`);
  const constMd = path.join(modDir, "constants.md");
  if (fs.existsSync(constMd)) parts.push(`\n---\n# CONSTANTS: ${relTo(exampleDir, constMd)}\n\n${fs.readFileSync(constMd, "utf8")}`);
  parts.push(`\n---\nNow output ONLY the ${targetLang} source for module \`${moduleName}\`. No fences, no commentary.`);
  return parts.join("\n");
}

/**
 * Return just the code from a model reply. If the reply contains one or more
 * ```fenced``` blocks (even amid prose), concatenate their bodies; otherwise
 * return the trimmed text. This tolerates a CLI that adds a sentence of preamble
 * around the code despite instructions not to.
 */
function stripCodeFences(text) {
  const t = text.trim();
  const blocks = [...t.matchAll(/```[a-zA-Z0-9]*\n([\s\S]*?)```/g)].map((m) => m[1].replace(/\n+$/, ""));
  if (blocks.length) return blocks.join("\n\n").trim() + "\n";
  return t.endsWith("\n") ? t : t + "\n";
}

/**
 * Invoke a generator. Two backends:
 *   - { kind: "stub", src }  -> emit the contents of file `src` (zero cost)
 *   - { kind: "claude", model, feedback } -> shell out to `claude -p`
 * Returns { code, generatorId } or throws.
 */
function runGenerator(backend, prompt) {
  if (backend.kind === "stub") {
    if (!fs.existsSync(backend.src)) throw new Error(`stub source not found: ${backend.src}`);
    return { code: fs.readFileSync(backend.src, "utf8"), generatorId: `stub:${path.basename(backend.src)}` };
  }
  if (backend.kind === "claude") {
    const model = backend.model || DEFAULT_MODEL;
    const fullPrompt = backend.feedback
      ? `${prompt}\n\n---\n# PREVIOUS ATTEMPT FAILED THESE FIXTURES — fix and re-emit:\n${backend.feedback}`
      : prompt;
    const res = spawnSync(
      "claude",
      ["-p", "--model", model, "--append-system-prompt", GENERATOR_SYSTEM_PROMPT],
      { input: fullPrompt, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 240000 }
    );
    if (res.status !== 0) {
      throw new Error(`claude CLI failed (status ${res.status}): ${(res.stderr || "").slice(0, 500)}`);
    }
    return { code: stripCodeFences(res.stdout), generatorId: `claude-cli:${model}` };
  }
  throw new Error(`unknown generator backend: ${backend.kind}`);
}

/** Run an example's own tools/verify.js against a generated module path. */
function runVerify(exampleDir, generatedPath) {
  const verifyJs = path.join(exampleDir, "tools", "verify.js");
  if (!fs.existsSync(verifyJs)) return { ok: null, output: "(no tools/verify.js in example)" };
  const res = spawnSync("node", [verifyJs, generatedPath], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { ok: res.status === 0, output: (res.stdout || "") + (res.stderr || "") };
}

function provenancePath(exampleDir) {
  return path.join(exampleDir, ".sdd-provenance.json");
}
function readProvenance(exampleDir) {
  const p = provenancePath(exampleDir);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}
function writeProvenance(exampleDir, manifest) {
  fs.writeFileSync(provenancePath(exampleDir), JSON.stringify(manifest, null, 2) + "\n");
}

/* ---- intent -> spec stage (upstream of code generation) ------------------ */

/** The plain-English INTENT source for a module (the sole review surface). */
function intentPath(exampleDir, moduleName) {
  return path.join(exampleDir, "spec", "modules", moduleName, "intent.md");
}

/**
 * Provenance for the intent->spec compile, kept SEPARATE from the spec->code
 * manifest so the two stages never clobber each other. Stamps the intent hash
 * against the spec/constants/fixtures it derived, so a later drift-check can
 * flag those artifacts stale-vs-intent.
 */
function intentProvenancePath(exampleDir) {
  return path.join(exampleDir, ".sdd-intent-provenance.json");
}
function readIntentProvenance(exampleDir) {
  const p = intentProvenancePath(exampleDir);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}
function writeIntentProvenance(exampleDir, manifest) {
  fs.writeFileSync(intentProvenancePath(exampleDir), JSON.stringify(manifest, null, 2) + "\n");
}

module.exports = {
  SKILL_ROOT,
  DEFAULT_MODEL,
  sha256,
  hashFile,
  listFiles,
  relTo,
  listModules,
  specInputPaths,
  specInputsHashMap,
  fixturesDir,
  fixturesHash,
  assembleGeneratorPrompt,
  stripCodeFences,
  runGenerator,
  runVerify,
  provenancePath,
  readProvenance,
  writeProvenance,
  intentPath,
  intentProvenancePath,
  readIntentProvenance,
  writeIntentProvenance,
};
