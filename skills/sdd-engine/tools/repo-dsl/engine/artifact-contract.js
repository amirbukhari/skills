/* engine/artifact-contract.js — THE ARTIFACT CONTRACT, enforced.
 *
 * WHY THIS EXISTS. Six producer/consumer drift incidents landed in a single day (PRD §8B). Every
 * one had the same shape: a producer changed, a consumer kept reading, NOTHING FAILED, and a human
 * eventually noticed a wrong number. The most damning was incident 5 — `word-names.json` went from
 * v0 `{name,hint,tier}` to v1 `{sym,en,sites,named}`, the file ALREADY CARRIED a `schema` field
 * saying so, and not one line of code looked at it. The contract was documentation, so it was not
 * a contract.
 *
 * THE RULE: a consumer that cannot verify what it is reading must REFUSE, loudly, naming what it
 * expected and what it got. `catch { return null }` is the bug class, not the safety net — it
 * converts "your vocabulary is missing" into "your corpus contains no patterns", which reads as a
 * measurement rather than a failure. There is no silent fallback in this module and none is
 * permitted downstream: a fallback that is genuinely correct must be passed explicitly
 * (`{ optional: true }`) and it returns a REASON, never a bare null.
 *
 * THE HEADER. Every artifact this engine writes carries, at the top level:
 *   schema       — versioned identity string, "sdd-repo-dsl/<kind>/<n>". Bump n on ANY shape change.
 *   artifactVersion — the integer n, split out so a consumer can range-check without parsing.
 *   corpus       — absolute path of the tree it was mined from (§8B corpus pinning), where the
 *                  artifact is corpus-derived. Catches incident 3.
 *   generated    — ISO date.
 *   fingerprint  — sha256(canonical body without the header)[0:16]. Catches hand-edits and
 *                  truncated writes; makes "is this the file I measured?" answerable.
 *
 * VALIDATION IS BY DEFAULT. `load(kind, file)` validates; there is no unvalidated read helper in
 * this module. That is deliberate — a new consumer must go OUT of its way to be unsafe, rather
 * than having to remember to be safe. (Requirement 3 of the contract.)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const CR = require("./corpus-root");

/* THE LOCATION RULE (PRD §8B). The engine tree is GENERIC, corpus-agnostic and PUBLISHABLE; it
 * holds engine code and the PRD and NOTHING derived from anyone's corpus. Every artifact resolves
 * from the corpus root the engine was pointed at. An artifact is corpus data, and corpus data lives
 * with the corpus.
 *   home: "tracked" -> <corpus>/sen/catalog/      SOURCE-PROTECTED (§8A): expensive or hand-authored,
 *                                                 must survive a cleanup, so it is TRACKED in the
 *                                                 corpus's own private repo.
 *   home: "cache"   -> <corpus>/.cache/spec-derived/  purely derived and regenerable by one command;
 *                                                 gitignored there by the corpus's own .gitignore.
 * `sen/catalog/` is deliberate: the corpus .gitignore ignores root `catalog/*`, so an artifact put
 * there would be silently untracked — which is exactly how a SOURCE-PROTECTED file gets lost. */
const HOMES = Object.freeze({ tracked: path.join(CR.LAYOUT.sen, "catalog"), cache: path.join(".cache", "spec-derived") });

/* WHERE the corpus is, is not this module's business — engine/corpus-root.js is the single
 * resolver (--corpus > CORPUS env > <engine>/.env > Examples/hydra-source) and this delegates to
 * it verbatim. It used to keep its own `process.env.<VAR> || "<absolute literal>"` chain,
 * which is how one of 38 copies of that chain came to sit in the module every other consumer
 * routes through. Kept as a re-export because callers across the tree already use AC.corpusRoot(). */
function corpusRoot(explicit) {
  return CR.corpusRoot(explicit);
}
/* pathFor(kind, corpusRoot) is the ONLY way to name an artifact's location. Nothing in the engine
 * may join a corpus-derived path against __dirname; engine/artifact-location.test.js fails if it does. */
function pathFor(kind, root) {
  const spec = specOf(kind);
  const home = HOMES[spec.home];
  if (!home) throw new ArtifactContractError(kind, "(registry)", `home to be one of ${Object.keys(HOMES).join(", ")}`,
    `${JSON.stringify(spec.home)} — an artifact with no declared home would be written wherever the caller happened to be`);
  return path.join(corpusRoot(root), home, spec.file);
}

const HEADER_KEYS = ["schema", "artifactVersion", "corpus", "generated", "fingerprint"];

/* THE REGISTRY — the authoritative list. `requires` names the top-level keys a consumer actually
 * reads, so a same-version shape change is caught too, not just a version bump somebody remembered
 * to make. Published in PRD §8B verbatim; Kraken and any other cross-repo consumer reads it there. */
const ARTIFACTS = Object.freeze({
  "generators-lzw": {
    schema: "sdd-repo-dsl/generators-lzw/1", home: "tracked", file: "generators-lzw.json",
    corpusPinned: true, requires: ["wide", "narrow", "gap"],
    role: "the recursive LZW word dictionary — the ONLY generator vocabulary the live .en compiles through",
  },
  "mined-library": {
    schema: "sdd-repo-dsl/mined-library/1", home: "tracked", file: "mined-library.json",
    corpusPinned: true, requires: ["leaves", "composites"],
    role: "the compose-layer composition graph (leaves carry `id`; composites DO NOT — see idOf)",
  },
  "word-names": {
    schema: "sdd-repo-dsl/word-names/1", home: "tracked", file: "word-names.json",
    corpusPinned: false, requires: ["names", "orphans"],
    role: "hand-authored names for canonical skeletons, keyed by sha256(sym)[0:16]; entries are {sym,en,sites,named}",
  },
  "corpus-coverage": {
    schema: "sdd-repo-dsl/corpus-coverage/1", home: "cache", file: "corpus-coverage.json",
    corpusPinned: true, requires: ["rollup", "files"],
    role: "per-file coverage rollup",
  },
  "gate": {
    schema: "sdd-repo-dsl/gate/1", home: "cache", file: "gate.json",
    corpusPinned: false, requires: ["pass", "thresholds"],
    role: "pass/fail verdict against the coverage thresholds",
  },
});

class ArtifactContractError extends Error {
  constructor(kind, file, expected, got) {
    super(`artifact contract REFUSED: ${kind} at ${file}\n  expected: ${expected}\n  got:      ${got}\n` +
          `  (this is a producer/consumer drift guard, PRD §8B — do not catch and continue)`);
    this.name = "ArtifactContractError";
    this.kind = kind; this.file = file; this.expected = expected; this.got = got;
  }
}

/* Canonical body = everything except the header, key-sorted, so the fingerprint is stable across
 * re-stamps and insertion order. */
function canonicalBody(obj) {
  const body = {};
  for (const k of Object.keys(obj).sort()) if (!HEADER_KEYS.includes(k)) body[k] = obj[k];
  return JSON.stringify(body);
}
function fingerprintOf(obj) {
  return crypto.createHash("sha256").update(canonicalBody(obj), "utf8").digest("hex").slice(0, 16);
}

function kindsOf() { return Object.keys(ARTIFACTS); }
function specOf(kind) {
  const s = ARTIFACTS[kind];
  if (!s) throw new ArtifactContractError(kind, "(registry)", `one of ${kindsOf().join(", ")}`, `unregistered kind ${JSON.stringify(kind)}`);
  return s;
}

/* stamp(kind, body, {corpus}) -> the object to write. Producers call this instead of hand-writing
 * a schema string, so the string can never drift from the registry. */
function stamp(kind, body, opts = {}) {
  const spec = specOf(kind);
  for (const k of spec.requires) {
    if (!(k in body)) throw new ArtifactContractError(kind, "(stamp)", `body key ${JSON.stringify(k)} (registry: requires)`, `absent — refusing to publish an artifact its own consumers cannot read`);
  }
  if (spec.corpusPinned && !opts.corpus) {
    throw new ArtifactContractError(kind, "(stamp)", "a corpus path (this kind is corpusPinned)", "none passed");
  }
  const clean = {};
  for (const k of Object.keys(body)) if (!HEADER_KEYS.includes(k)) clean[k] = body[k];
  const head = {
    schema: spec.schema,
    artifactVersion: Number(spec.schema.split("/").pop()),
    generated: opts.generated || new Date().toISOString().slice(0, 10),
  };
  if (spec.corpusPinned) head.corpus = opts.corpus;
  head.fingerprint = fingerprintOf(clean);
  return Object.assign(head, clean);
}

/* validate(kind, obj, file, {corpus}) -> obj, or throws. Pure; used by load and by the suite. */
function validate(kind, obj, file, opts = {}) {
  const spec = specOf(kind);
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new ArtifactContractError(kind, file, "a JSON object", Object.prototype.toString.call(obj));
  if (obj.schema !== spec.schema) throw new ArtifactContractError(kind, file, `schema ${spec.schema}`, `schema ${JSON.stringify(obj.schema)}`);
  const missing = spec.requires.filter((k) => !(k in obj));
  if (missing.length) throw new ArtifactContractError(kind, file, `top-level keys ${spec.requires.join(", ")}`, `missing ${missing.join(", ")} — same schema string, different shape`);
  if (spec.corpusPinned) {
    if (!obj.corpus) throw new ArtifactContractError(kind, file, "a `corpus` field (this kind is corpusPinned)", "none");
    if (opts.corpus && obj.corpus !== opts.corpus) throw new ArtifactContractError(kind, file, `corpus ${opts.corpus}`, `corpus ${obj.corpus} — mined from a different tree`);
  }
  if ("fingerprint" in obj) {
    const fp = fingerprintOf(obj);
    if (fp !== obj.fingerprint) throw new ArtifactContractError(kind, file, `fingerprint ${obj.fingerprint}`, `${fp} — the body changed after it was stamped`);
  } else if (!opts.allowUnstamped) {
    throw new ArtifactContractError(kind, file, "a `fingerprint` field", "none — re-stamp with `node stamp-artifacts.js`");
  }
  return obj;
}

/* load(kind, file, {corpus, optional}) — the ONLY read path. With `optional: true` a MISSING FILE
 * is tolerated and reported as { ok:false, reason }, so the caller must handle it explicitly and
 * can log it; a file that EXISTS but fails the contract still throws, always. That asymmetry is the
 * point: "not installed" is a state, "installed and wrong" is a bug. */
function load(kind, file, opts = {}) {
  const spec = specOf(kind);
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (e) {
    if (opts.optional) return { ok: false, reason: `${kind}: not present at ${file} (${e.code}) — ${spec.role}`, value: null };
    throw new ArtifactContractError(kind, file, "a readable file", `${e.code}`);
  }
  let j;
  try { j = JSON.parse(raw); }
  catch (e) { throw new ArtifactContractError(kind, file, "parseable JSON", e.message); }
  validate(kind, j, file, opts);
  return opts.optional ? { ok: true, reason: null, value: j } : j;
}

/* mined-library composites identify by NAME, not id — see PRD §8B "the composite id contract".
 * Consumers key on this, never on `.id`, which is undefined for all 1,063 composites. */
function idOf(rec) {
  if (rec && typeof rec.id === "string") return rec.id;            // leaves: p_<8hex>
  if (rec && typeof rec.name === "string") return rec.name;        // composites: g_<len>_<6hex>
  return null;
}

module.exports = { ARTIFACTS, HEADER_KEYS, HOMES, ArtifactContractError, stamp, validate, load, fingerprintOf, kindsOf, specOf, idOf, corpusRoot, pathFor };
