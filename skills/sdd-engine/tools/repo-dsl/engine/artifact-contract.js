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
  /* import-resolution.json sat in sen/catalog/ — the TRACKED §8B home — with a schema string typed
   * by hand, no fingerprint, and no entry here, so `validate` could never run on it and a shape
   * change was silent on BOTH sides: resolve-imports.js hand-joined the path to write it and
   * dsl.js hand-joined the same path to read it. Same shape as the name-queue incident above and
   * as repo-dsl.js publishing mined-library unstamped. `requires` is what dsl.js actually reads. */
  "import-resolution": {
    schema: "sdd-repo-dsl/import-resolution/1", home: "tracked", file: "import-resolution.json",
    corpusPinned: true, requires: ["symbols"],
    role: "the mined import map — which module a bare symbol canonically comes from (dsl.js canonicalModule)",
  },
  "word-names": {
    schema: "sdd-repo-dsl/word-names/1", home: "tracked", file: "word-names.json",
    corpusPinned: false, requires: ["names", "orphans", "chunks"],
    role: "hand-authored names, keyed by content hash and never by word id. `names` names ONE leaf skeleton (key w:/n: + sha256(sym)[0:16], entries {sym,en,sites,named}); `chunks` names a WHOLE multi-statement word as one clause (key wc:/nc: + sha256 of its ordered leaf skeletons, entries {en,len,note}) per PRD §5D.3D / R-LANG-19",
  },
  /* naming-plan.json is the DETERMINISTIC input to stage 2 (PRD §5D.2): which words are asked
   * about, in what order, with what evidence. It is regenerable by one sweep, so `cache`. It is
   * registered rather than hand-written because it publishes the R-LANG-20 order and the R-LANG-22
   * target figures, and a consumer reading an unversioned plan is the incident-5 shape again. */
  "naming-plan": {
    schema: "sdd-repo-dsl/naming-plan/1", home: "cache", file: "naming-plan.json",
    corpusPinned: true, requires: ["tiers", "summary", "order"],
    role: "the bottom-up naming work order — tiers ascending from d=0 with per-row evidence and the content key each name will be written under (R-LANG-20/21/22)",
  },
  "corpus-coverage": {
    schema: "sdd-repo-dsl/corpus-coverage/1", home: "cache", file: "corpus-coverage.json",
    corpusPinned: true, requires: ["rollup", "files"],
    role: "per-file coverage rollup",
  },
  /* en-index.json PUBLISHES THREE GATES (byte-identity, R-COMP-6's composition counts, and the
   * R-ARCH-16 review surface) and was written by a hand-built path.join with no header at all —
   * no schema, no fingerprint, no corpus pin. That is the incident-5 shape exactly: a producer
   * publishing numbers a consumer reads, with nothing to verify what it is reading. Registered so
   * `pathFor` names it and `stamp` headers it. `home: "cache"` because it is regenerable by one
   * render. `requires` lists what a consumer actually reads today: the byte-identity gate, the
   * generator counts R-COMP-6/7 read, and the review-surface block §7.3 froze. */
  "en-index": {
    schema: "sdd-repo-dsl/en-index/1", home: "cache", file: "en-index.json",
    corpusPinned: true, requires: ["gate", "generators", "reviewSurface"],
    role: "the render manifest — byte-identity, composition counts, and the review-surface metric (§7.3)",
  },
  /* name-queue.json was hand-stamped at reconcile-names.js: a schema STRING written by hand, no
   * fingerprint, and the kind absent from this registry — so `validate` could never have been
   * called on it and a shape change would have been silent. The exact landmine CLAUDE.md §8 warns
   * about, in the module whose whole job is reconciliation. */
  "name-queue": {
    schema: "sdd-repo-dsl/name-queue/1", home: "cache", file: "name-queue.json",
    corpusPinned: false, requires: ["queue", "queueLength", "orphans"],
    role: "re-adoption PROPOSALS for orphaned names, scored by edit distance; a human is the consumer (R-LANG-7)",
  },
  /* language.json is the VOCABULARY AND GRAMMAR published for a cross-repo consumer (the Kraken
   * SDD panel's Syntax/Grammar tabs). It is registered for the reason every other kind here is:
   * so the schema string is read from this table instead of typed by hand at the producer. The
   * neighbouring `explain` dump does hand-write its own `sdd-repo-dsl/explain/1` string and is NOT
   * registered — the same shape as the incidents above, noted rather than fixed here because that
   * dump is per-composition, not per-corpus.
   *
   * `home: "cache"` — it is regenerated in full by one command and derives from engine source, so
   * it is never hand-edited and never needs tracking. `corpusPinned` because the dump carries the
   * import-resolution state of ONE corpus alongside the corpus-independent grammar; unpinned, dir
   * A's resolution figures could be read as dir B's. */
  "language": {
    schema: "sdd-repo-dsl/language/1", home: "cache", file: "language.json",
    corpusPinned: true, requires: ["vocabulary", "grammar", "resolution"],
    role: "the published DSL vocabulary (leaf primitives + composite words) and the auto-derived positional grammar, both read live from generators.js/dsl.js — `repo-dsl language <dir> --json`",
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

/* VOLATILE — fields that differ between two runs that produced THE SAME CONTENT. Declared as a
 * list, not guessed at by name shape, so adding one is a decision somebody makes on purpose.
 *   minedAt / generatedAt / builtAt / timestamp   wall-clock
 *   node                                          the interpreter that ran, not what it produced
 *   regenerate                                    the command line, which embeds ABSOLUTE paths and
 *                                                 so differs between two machines byte for byte
 * Everything else is content. */
const VOLATILE = Object.freeze(["minedAt", "generatedAt", "builtAt", "timestamp", "node", "regenerate"]);

/* WHY THIS EXISTS, measured 2026-08-31. Re-mining the same corpus at the same settings produced a
 * DIFFERENT `fingerprint` — counts identical to the entry, `minedAt` and the seal over it the only
 * two fields that moved. So the fingerprint could not answer the one question that matters for
 * drift: "is this artifact what the current code and corpus would produce?" It answers only "has
 * anyone edited this file since it was written", because a wall-clock value inside the seal makes
 * every honest re-run look like a change.
 *
 * That is not academic. An hour before this was written, R-MEAS-2 read as a live FAILURE against a
 * manifest that was merely STALE — written before a fix, by code that was already correct. Nothing
 * on the artifact could distinguish "stale" from "wrong", and the only way to find out was to
 * re-render and look.
 *
 * So: `fingerprint` stays exactly as it was — the tamper seal over everything, and existing
 * artifacts keep validating. `contentFingerprint` is the comparable one. Two runs that produced
 * the same content agree on it, on any machine, at any time. Additive on purpose: artifacts stamped
 * before today simply do not carry it, and are reported as not comparable rather than as equal. */
function contentFingerprintOf(obj) {
  const body = {};
  for (const k of Object.keys(obj).sort()) if (!HEADER_KEYS.includes(k) && !VOLATILE.includes(k) && k !== "contentFingerprint") body[k] = obj[k];
  return crypto.createHash("sha256").update(JSON.stringify(body), "utf8").digest("hex").slice(0, 16);
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
  /* R-MECH-4 MADE RUNNABLE, 2026-08-31. The register's check used to read `foldModelCalls === 0
   * and buildModelCalls === 0 in every published catalog` — fields that exist only in `archive/`,
   * so the single most load-bearing requirement in the PRD ("zero model calls") could not be
   * checked against anything on disk. Measured: of the four registered artifacts present in the
   * corpus, exactly ONE carried a model-call field at all.
   *
   * Every stamped artifact now declares `modelCalls`, DEFAULTING TO 0 — because deterministic is
   * not merely the common case here, it is the requirement (§2 P1), and a producer that spends a
   * model call has to say so on purpose. A non-numeric value is refused rather than coerced: an
   * unparseable claim about model calls is worse than none, since it reads as a zero to a scanner.
   *
   * It stays in the fingerprinted body rather than joining HEADER_KEYS on purpose. Making it a
   * header key would exclude it from the fingerprint, so a later hand-edit flipping a 0 to a 12
   * would not disturb the seal — the one edit the field exists to catch. */
  const clean = {};
  for (const k of Object.keys(body)) if (!HEADER_KEYS.includes(k)) clean[k] = body[k];
  if (clean.modelCalls === undefined) clean.modelCalls = 0;
  if (typeof clean.modelCalls !== "number" || !Number.isFinite(clean.modelCalls) || clean.modelCalls < 0) {
    throw new ArtifactContractError(kind, "(stamp)", "modelCalls: a finite count >= 0 (omit it to declare 0)", JSON.stringify(clean.modelCalls));
  }
  /* CONSTANTS PROVENANCE (§8B). A mine run with MIN_COUNT/MIN_SKEL/MAXWIN overridden produces a
   * different artifact from a default run, and until now the artifact could not say so — a swept
   * value looked exactly like the settled one, which is how a tuning experiment gets mistaken for
   * the corpus's own numbers.
   *
   * EMITTED ONLY WHEN SOMETHING IS ACTUALLY OVERRIDDEN. This is the whole reason the field is safe
   * to add now: a default run's body is unchanged, so no existing fingerprint moves and no artifact
   * needs re-stamping. The concern that this "would move every fingerprint" is answered by
   * construction rather than by argument — it moves exactly the fingerprints of runs that were not
   * default, which is the point of recording it.
   *
   * IN THE BODY, NOT THE HEADER, for the same reason as `modelCalls` above: a header key is excluded
   * from the fingerprint, so a later hand-edit deleting the override claim would not disturb the
   * seal — and that is precisely the edit this field exists to catch. A provenance note that can be
   * quietly removed is not provenance.
   *
   * FAIL-CLOSED on a malformed claim, again like modelCalls: an unparseable override record reads as
   * "nothing was overridden" to a scanner, which is worse than absent. */
  if (opts.constants !== undefined) {
    const c = opts.constants;
    if (!c || typeof c !== "object" || Array.isArray(c))
      throw new ArtifactContractError(kind, "(stamp)", "constants: an object of { NAME: { value, default } }", Object.prototype.toString.call(c));
    const over = {};
    for (const name of Object.keys(c).sort()) {
      const e = c[name];
      if (!e || typeof e !== "object" || !("value" in e) || !("default" in e))
        throw new ArtifactContractError(kind, "(stamp)", `constants.${name}: { value, default }`, JSON.stringify(e));
      if (e.value !== e.default) over[name] = { value: e.value, default: e.default };
    }
    if (Object.keys(over).length) clean.constantsOverridden = over;
  }
  const head = {
    schema: spec.schema,
    artifactVersion: Number(spec.schema.split("/").pop()),
    generated: opts.generated || new Date().toISOString().slice(0, 10),
  };
  if (spec.corpusPinned) head.corpus = opts.corpus;
  /* Order matters: contentFingerprint goes into the body BEFORE the tamper seal is taken over it,
   * so editing one without the other is caught. It excludes itself from its own computation. */
  clean.contentFingerprint = contentFingerprintOf(clean);
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

module.exports = { ARTIFACTS, HEADER_KEYS, HOMES, VOLATILE, ArtifactContractError, stamp, validate, load, fingerprintOf, contentFingerprintOf, kindsOf, specOf, idOf, corpusRoot, pathFor };
