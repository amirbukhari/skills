/**
 * Shared helpers for the money-cart build tools: content hashing and the
 * provenance manifest that ties each generated artifact back to the exact spec
 * inputs that produced it. Dependency-free (Node built-ins only).
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const SPEC_DIR = path.join(EXAMPLE_ROOT, "spec");
const MODULES_DIR = path.join(SPEC_DIR, "modules");
const MANIFEST_PATH = path.join(EXAMPLE_ROOT, ".provenance.json");
const DEFAULT_GEN_DIR = path.join(EXAMPLE_ROOT, "generated");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function hashFile(absPath) {
  return sha256(fs.readFileSync(absPath));
}

/** Path relative to the example root, always forward-slashed, for stable manifests. */
function rel(absPath) {
  return path.relative(EXAMPLE_ROOT, absPath).split(path.sep).join("/");
}

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => path.join(dir, f));
}

function listModules() {
  return fs
    .readdirSync(MODULES_DIR)
    .filter((d) => fs.statSync(path.join(MODULES_DIR, d)).isDirectory())
    .sort();
}

/**
 * The spec inputs that govern a module's generated output. Own spec.md +
 * constants.md, plus every standards and contracts file (per regenerate.md's
 * blast radius: editing standards/ or contracts/ forces a rebuild). Returns a
 * { relPath: hash } map with keys in sorted order for a byte-stable manifest.
 */
function specInputsFor(moduleName) {
  const inputs = [
    path.join(MODULES_DIR, moduleName, "spec.md"),
    path.join(MODULES_DIR, moduleName, "constants.md"),
    ...listFiles(path.join(SPEC_DIR, "standards"), ".md"),
    ...listFiles(path.join(SPEC_DIR, "contracts"), ".md"),
  ].filter((p) => fs.existsSync(p));

  const out = {};
  for (const p of inputs.map(rel).sort()) {
    out[p] = hashFile(path.join(EXAMPLE_ROOT, p));
  }
  return out;
}

/**
 * Build the manifest object for a set of generated artifacts.
 * @param {Array<{module: string, absPath: string}>} artifacts
 */
function buildManifest(artifacts) {
  const entries = artifacts
    .map((a) => ({
      path: rel(a.absPath),
      module: a.module,
      outputHash: hashFile(a.absPath),
      specInputs: specInputsFor(a.module),
    }))
    .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return { generatedRoot: "generated", artifacts: entries };
}

function writeManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

module.exports = {
  EXAMPLE_ROOT,
  SPEC_DIR,
  MODULES_DIR,
  MANIFEST_PATH,
  DEFAULT_GEN_DIR,
  sha256,
  hashFile,
  rel,
  listFiles,
  listModules,
  specInputsFor,
  buildManifest,
  writeManifest,
  readManifest,
};
