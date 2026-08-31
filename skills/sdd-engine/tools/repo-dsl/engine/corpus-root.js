/* engine/corpus-root.js — THE ONLY THING IN THIS ENGINE THAT KNOWS WHERE ITS FOLDERS ARE.
 *
 * WHY THIS EXISTS. Amir's acceptance test, verbatim: "if you need to make more than 1 file change
 * to alter the directory we are pointing at then we have done this wrong and need to fix it."
 * Before this module there were 38 hardcoded absolute roots across 38 files — 23 with no env
 * override at all, six of them test files that could not be repointed by any means short of an
 * edit. Three separate trees were named, so "the corpus" was not even one place. Repointing was a
 * 38-file refactor, which means in practice it never happened and the roots rotted: every one of
 * them named a directory that no longer exists on this machine.
 *
 * TWO ROOTS, READ AND WRITE. Amir: "One is where we read from and one is where we write too. I
 * need it to be this way because I should be able to copy the contents of one codebase into a new
 * one. and then I should be able to flip the path and then have both env files point at the same
 * corpus for reading and writing."
 *   SOURCE — the READ root. The .ts tree the engine walks and mines. Never written.
 *   CORPUS — the WRITE root. Holds sen/ (the English output + the mined artifacts) and every
 *            derived tree. Never mined for .ts.
 * They are INDEPENDENT: set them to two different directories to render a copied/forked codebase
 * into a fresh tree, or to the SAME directory to self-host (today's behavior, and the default).
 * Neither derives from the other, and both default to the same place so nothing breaks until they
 * are repointed.
 *
 * THE RULE: no file in this engine may name a root. Every site asks here. The ONLY two places a
 * root literal may appear are this registry's defaults and <engine>/.env.
 * engine/corpus-root.test.js greps the tree, per root, and fails if a third appears.
 *
 * PRECEDENCE — per root, highest wins, and the winning layer is always reported by name:
 *   1. --<name> <path> | --<name>=<path>   CLI flag       (layer "--source flag")
 *   2. <ENV>=<path>                        environment    (layer "SOURCE env")
 *   3. <ENV>=<path> in <engine>/.env       the .env file  (layer "SOURCE in …/.env")
 *   4. the registry's engine-relative default             (layer "built-in default")
 * Env beats .env deliberately: .env is the local default, the environment is the per-invocation
 * override, and a flag beats both.
 *
 * NO SILENT FALLBACK (PRD §8B, the same rule artifact-contract.js enforces for artifact headers).
 * A root supplied by ANY layer that does not exist on disk THROWS, naming the path, the ROOT it was
 * resolving, and the layer that supplied it. It does NOT fall through to the next layer: falling
 * through would convert "your SOURCE is a typo" into "your corpus contains no patterns", which
 * reads as a measurement instead of a failure. That is the exact bug class that produced six drift
 * incidents in one day.
 */
"use strict";
const fs = require("fs");
const path = require("path");

/* <engine> = the sdd-engine skill root: engine/ -> repo-dsl -> tools -> sdd-engine.
 * Deliberately NOT a corpus path joined against __dirname — artifact-location.test.js (d) forbids
 * that shape, and rightly. This locates the ENGINE; roots are resolved relative to it. */
const ENGINE_ROOT = path.resolve(__dirname, "..", "..", "..");
const ENV_FILE = path.join(ENGINE_ROOT, ".env");

/* ── THE REGISTRY — the one place root literals live ──────────────────────────────────────────
 * Each entry: env (variable name, in .env and the environment), flag (CLI flag, defaults to
 * --<name>), default (engine-relative, so a checkout works anywhere and the public remote carries
 * nobody's home directory), role (what it is, quoted back in errors).
 * Adding a root is a DATA change: one entry here plus one line in <engine>/.env. Nothing below
 * this registry mentions any particular root. */
const ROOTS = Object.freeze({
  source: Object.freeze({
    env: "SOURCE",
    default: path.join("Examples", "hydra-source"),
    role: "the READ root — the .ts tree the engine walks and mines; never written",
  }),
  corpus: Object.freeze({
    env: "CORPUS",
    default: path.join("Examples", "hydra-source"),
    role: "the WRITE root — holds sen/ (English + mined artifacts) and every derived tree",
  }),
});

/* ── LAYOUT — folder names INSIDE a root ──────────────────────────────────────────────────────
 * `sen` is the English tree, renamed from `spec` on Amir's instruction ("rename that folder SEN",
 * then "lowercase"). It is a folder name, not a configurable root: it always lives inside CORPUS.
 * Named here so renaming it again stays a one-line change, and so the guard test can prove no
 * consumer spells it out. Substructure preserved through the rename: sen/files, sen/catalog,
 * sen/skeletons, sen/archetypes (and sen/modules, referenced in code, absent on disk). */
const LAYOUT = Object.freeze({ sen: "sen" });

function names() { return Object.keys(ROOTS); }
function specOf(name) {
  const s = ROOTS[name];
  if (!s) throw new RootError(name, "(registry)", "(none)",
    `unregistered root ${JSON.stringify(name)} — registered roots are: ${names().join(", ")}`);
  return s;
}
function flagOf(name) { return specOf(name).flag || `--${name}`; }
function envOf(name) { return specOf(name).env; }

class RootError extends Error {
  constructor(name, root, layer, why) {
    const spec = ROOTS[name];
    const pad = (s, n = 24) => String(s) + " ".repeat(Math.max(1, n - String(s).length));
    super(`root REFUSED: ${name}${spec ? ` (${spec.role})` : ""}\n` +
          `  path:        ${root}\n` +
          `  supplied by: ${layer}\n` +
          `  problem:     ${why}\n` +
          `\n` +
          `  This engine resolves each named root in this order:\n` +
          (spec
            ? `    ${pad(`${flagOf(name)} <path>`)}(highest)\n` +
              `    ${pad(`${spec.env}=<path>`)}environment\n` +
              `    ${pad(`${spec.env}=<path>`)}in ${ENV_FILE}\n` +
              `    ${pad(spec.default)}built-in default, relative to ${ENGINE_ROOT}\n`
            : "") +
          `  A root that is SET but absent is an error, never a fall-through to the next layer\n` +
          `  (PRD §8B: no silent fallback — "not configured" is a state, "configured wrong" is a bug).`);
    this.name = "RootError";
    this.rootName = name; this.root = root; this.layer = layer; this.why = why;
  }
}

/* A deliberately minimal .env reader — this engine is dependency-free Node built-ins only, so no
 * dotenv. Supports `KEY=value`, `export KEY=value`, # comments, blank lines, and single/double
 * quoted values. Anything it cannot parse it ignores rather than half-honouring. */
let envFileCache = null;
function readEnvFile(file = ENV_FILE) {
  if (envFileCache && envFileCache.file === file) return envFileCache.vars;
  const vars = {};
  let raw = null;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch { /* absent .env is a LAYER THAT SUPPLIES NOTHING, not an error — see precedence */ }
  if (raw !== null) {
    for (const line of raw.split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, "").trim();          // strip a trailing comment on bare values
      vars[m[1]] = v;
    }
  }
  envFileCache = { file, vars };
  return vars;
}

/* fromArgv(name) — `--<name> <path>` and `--<name>=<path>`. SKILL.md has advertised --corpus all
 * along; until this module, literally nothing in the tree parsed it. */
function fromArgv(name, argv = process.argv) {
  const flag = flagOf(name);
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === flag) {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) throw new RootError(name, "(none)", `${flag} flag`, "the flag was given with no path after it");
      return v;
    }
    if (a.startsWith(flag + "=")) {
      const v = a.slice(flag.length + 1);
      if (!v) throw new RootError(name, "(none)", `${flag} flag`, "the flag was given with an empty path");
      return v;
    }
  }
  return null;
}

/* A RELATIVE root resolves against the layer that supplied it, which is the only reading that is
 * not surprising: a path typed on the command line or exported in a shell is relative to where the
 * human is standing (cwd); a path written in <engine>/.env, or a registry default, is relative to
 * the engine that owns it. `base` records which. */
function select(name, { explicit = null, argv = process.argv, env = process.env } = {}) {
  const spec = specOf(name);
  if (explicit) return { root: explicit, layer: "explicit argument", base: process.cwd() };
  const flag = fromArgv(name, argv);
  if (flag) return { root: flag, layer: `${flagOf(name)} flag`, base: process.cwd() };
  if (env[spec.env]) return { root: env[spec.env], layer: `${spec.env} env`, base: process.cwd() };
  const fileVars = readEnvFile();
  if (fileVars[spec.env]) return { root: fileVars[spec.env], layer: `${spec.env} in ${ENV_FILE}`, base: ENGINE_ROOT };
  return { root: spec.default, layer: "built-in default", base: ENGINE_ROOT };
}

const resolvedCache = new Map();

/**
 * resolveRoot(name, { explicit, argv, env, mustExist }) -> { name, root, layer }
 *   root  absolute, resolved
 *   layer human-readable name of the layer that supplied it
 * With mustExist (the default) a root that is not an existing directory THROWS RootError.
 * Pass mustExist:false only to ASK where a folder would be — e.g. a test that skips itself when
 * the folder is not installed. Never pass it to silence a real misconfiguration.
 */
function resolveRoot(name, opts = {}) {
  const { mustExist = true } = opts;
  const key = `${name}|${opts.explicit || ""}|${mustExist}`;
  if (!opts.argv && !opts.env && resolvedCache.has(key)) return resolvedCache.get(key);

  const picked = select(name, opts);
  const root = path.isAbsolute(picked.root) ? picked.root : path.resolve(picked.base, picked.root);
  const out = Object.freeze({ name, root, layer: picked.layer });

  if (mustExist) {
    let st = null;
    try { st = fs.statSync(root); }
    catch (e) { throw new RootError(name, root, picked.layer, `does not exist (${e.code})`); }
    if (!st.isDirectory()) throw new RootError(name, root, picked.layer, "exists but is not a directory");
  }
  if (!opts.argv && !opts.env) resolvedCache.set(key, out);
  return out;
}

/** root(name, explicit?) -> absolute path. The general accessor. */
function root(name, explicit, opts = {}) {
  return resolveRoot(name, { ...opts, explicit: explicit || opts.explicit || null }).root;
}

/** sourceRoot(explicit?) -> the READ root. Use wherever .ts is walked or read as source. */
function sourceRoot(explicit, opts = {}) { return root("source", explicit, opts); }
/** corpusRoot(explicit?) -> the WRITE root. Use for sen/, catalog/, .cache/ and every artifact. */
function corpusRoot(explicit, opts = {}) { return root("corpus", explicit, opts); }
/** senDir(explicit?) -> <CORPUS>/sen — the English tree. The one place that name is spelled. */
function senDir(explicit, opts = {}) { return path.join(corpusRoot(explicit, opts), LAYOUT.sen); }

/** exists(name, explicit?) -> boolean. For tests that legitimately skip when a folder is absent. */
function exists(name, explicit) {
  return fs.existsSync(resolveRoot(name, { explicit, mustExist: false }).root);
}

/** describe(name, explicit?) -> "…/Examples/hydra-source (CORPUS in …/.env)". For banners/errors. */
function describe(name, explicit) {
  const r = resolveRoot(name, { explicit, mustExist: false });
  return `${r.root} (${r.layer})`;
}

/** all({mustExist}) -> { <name>: {root, layer} } for every registered root. Diagnostics + guard. */
function all(opts = {}) {
  const out = {};
  for (const n of names()) { const r = resolveRoot(n, { mustExist: false, ...opts }); out[n] = { root: r.root, layer: r.layer }; }
  return out;
}

module.exports = {
  ENGINE_ROOT, ENV_FILE, ROOTS, LAYOUT, RootError,
  names, specOf, envOf, flagOf,
  resolveRoot, root, sourceRoot, corpusRoot, senDir, exists, describe, all,
  select, readEnvFile, fromArgv,
};
