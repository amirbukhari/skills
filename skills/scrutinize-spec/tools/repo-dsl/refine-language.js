#!/usr/bin/env node
"use strict";
/**
 * refine-language — the LLM "librarian" pass over the MINED language.
 *
 * The engine mines composites and names them mechanically (`g_<len>_<hash>`).
 * That is honest but unreadable. This pass has a model propose intention-
 * revealing names — and NOTHING ELSE. It is proposal-only and VERIFICATION-GATED:
 * the model touches only names/metadata, never the expansion logic, so a rename
 * is a PURE RELABEL and byte-identity / coverage MUST be invariant under it. The
 * gate re-runs the deterministic checks and proves that invariance; if it ever
 * failed, that would be a bug to surface, not a proposal to accept.
 *
 * HARD GATE (what keeps the LLM out of the code path):
 *   - byte-identity across the whole corpus stays true (39/39 reconstruct), AND
 *   - corpus coverage does not drop (coverageAfter >= coverageBefore), AND
 *   - the refined library differs from the prior one ONLY in composite names +
 *     version metadata (structural inertness — asserted, not assumed).
 *   A proposal that is not a unique, valid, non-colliding identifier is rejected
 *   before it can be applied.
 *
 * VERSIONING: the refined library is written as a NEW version
 * (`catalog/mined-library.v2.json`, `version: "v2"`) and the prior version is
 * kept untouched, so a bad refinement reverts cleanly. Without `--apply` this is
 * a dry run (proposal report only); `--apply` promotes it by writing v2.
 *
 * Extensible: steps live behind the `--only <step>` hook and share this gate, so
 * a later pass can add merge / split / propose-new-composite. Only `naming` is
 * implemented now.
 *
 * Output JSON: { schema, step, version, apply, byteIdentical, coverageBefore,
 *   coverageAfter, gate:{passed,reason}, proposals:[{oldId,newName,rationale,accepted,reason}] }
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const sdd = require("../sdd-lib");
const { mine, walkDir } = require("./engine/pipeline");
const { tokenize } = require("./engine/fanout");
const { segment } = require("./engine/lzw");
const { LEAVES, COMPOSITES } = require("./generators");

const CATALOG = path.join(__dirname, "catalog");
const RESULTS = path.join(__dirname, "results");
const V1 = path.join(CATALOG, "mined-library.json");
const V2 = path.join(CATALOG, "mined-library.v2.json");

const RESERVED = new Set(["do", "if", "in", "for", "let", "new", "try", "var", "case", "else", "enum",
  "eval", "null", "this", "true", "void", "with", "await", "break", "catch", "class", "const", "false",
  "super", "throw", "while", "yield", "delete", "export", "import", "return", "switch", "typeof",
  "default", "extends", "finally", "continue", "function", "instanceof"]);

const IDENT = /^[a-z][A-Za-z0-9]*$/;

/* ------------------------------------------------------------------ evidence */

/** For every mined composite, gather the shape sequence + a few real call-sites. */
function collectEvidence(base) {
  const { model } = base.internals;
  const { shapeOfId } = model;
  const perFile = base.internals.perFile;

  // entryId -> [{rel, line, snippet}] from greedy segmentation of each file.
  const occ = new Map();
  for (const pf of perFile) {
    const segs = segment(pf.tokens.map((t) => t.shape), model);
    for (const s of segs) {
      if (!occ.has(s.entryId)) occ.set(s.entryId, []);
      const list = occ.get(s.entryId);
      if (list.length >= 3) continue;
      const toks = s.tokenIndices.map((i) => pf.tokens[i]);
      const snippet = toks.map((t) => t.text).join("").replace(/\s+/g, " ").trim().slice(0, 160);
      list.push({ rel: pf.rel, line: toks[0].line, snippet });
    }
  }

  return base.library.composites.map((c, index) => ({
    index, oldId: c.name, entryId: c.entryId, len: c.len, freq: c.freq,
    tier: c.builtFromComposite ? "composite-of-composite" : "composite",
    memberShapes: c.memberLeafIds, // stable ids of the member shapes
    shapeSeq: (model.dict[c.entryId]?.symbols || []).map((sid) => shapeOfId[sid]),
    occurrences: (occ.get(c.entryId) || []).slice(0, 3),
  }));
}

/* -------------------------------------------------------------- the LLM step */

const NAMING_SYSTEM_PROMPT = [
  "You are a code librarian naming mined patterns in a TypeScript billing codebase.",
  "Each pattern is a recurring composite of smaller code shapes. Propose a short, intention-revealing",
  "lowerCamelCase identifier for each (like volumeCosting, wireRegistryEntry, importBillingConstants).",
  "Base the name on what the pattern's code DOES, not on its shape kinds. Names must be unique.",
  "Output ONLY a JSON array [{\"index\": <n>, \"name\": \"<lowerCamelCase>\", \"rationale\": \"<short why>\"}].",
  "No prose, no markdown fences — just the JSON array.",
].join(" ");

function namingPrompt(candidates) {
  const blocks = candidates.map((c) => {
    const shapes = c.shapeSeq.slice(0, 8).map((s) => s.split(" ").slice(0, 6).join(" ")).join("  |  ");
    const sites = c.occurrences.map((o) => `      ${o.rel}:${o.line}  ${o.snippet}`).join("\n") || "      (no maximal call-site; appears inside larger patterns)";
    return [
      `#${c.index}  (currently ${c.oldId}, recurs ${c.freq}x, ${c.len} shapes, ${c.tier})`,
      `    shape sequence: ${shapes}`,
      `    real call-sites:`,
      sites,
    ].join("\n");
  });
  return [
    "Propose a readable name for each mined composite below. Return a JSON array keyed by #index.",
    "",
    blocks.join("\n\n"),
    "",
    "Output ONLY the JSON array [{index, name, rationale}].",
  ].join("\n");
}

/** Return the model's proposals [{index, name, rationale}] (claude CLI or --stub). */
function proposeNames(candidates, opts) {
  let raw;
  if (opts.stub) {
    raw = fs.readFileSync(opts.stub, "utf8");
  } else {
    const model = opts.model || sdd.DEFAULT_MODEL;
    const res = spawnSync("claude", ["-p", "--model", model, "--append-system-prompt", NAMING_SYSTEM_PROMPT],
      { input: namingPrompt(candidates), encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 240000 });
    if (res.status !== 0) throw new Error(`claude CLI failed (status ${res.status}): ${(res.stderr || "").slice(0, 500)}`);
    raw = res.stdout;
  }
  const m = raw.match(/\[[\s\S]*\]/); // tolerate a stray sentence around the JSON array
  if (!m) throw new Error("model did not return a JSON array of proposals");
  return JSON.parse(m[0]);
}

/* ------------------------------------------------------ validation + gating */

/** The set of identifiers a new name may not collide with. */
function takenNames(base) {
  const taken = new Set([
    ...Object.keys(LEAVES), ...Object.keys(COMPOSITES),
    ...base.library.leaves.map((l) => l.id), ...base.library.composites.map((c) => c.name),
  ]);
  return taken;
}

/** Corpus byte-identity: every file reconstructs exactly from its token stream. */
function corpusByteIdentical(dir) {
  const files = walkDir(dir).sort();
  let ok = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    let recon = null;
    try {
      const { tokens, gaps } = tokenize(f, src);
      recon = [...tokens.map((t) => ({ s: t.start, text: t.text })), ...gaps.map((g) => ({ s: g.start, text: g.text }))]
        .sort((a, b) => a.s - b.s).map((x) => x.text).join("");
    } catch (e) { recon = null; }
    if (recon === src) ok++;
  }
  return { ok, total: files.length, allExact: ok === files.length };
}

/** Strip name/version metadata so two libraries can be compared for structural identity. */
function structuralSkeleton(lib) {
  const clone = JSON.parse(JSON.stringify(lib));
  delete clone.version; delete clone.refinement; delete clone.schema;
  for (const c of clone.composites) { delete c.name; delete c.minedName; delete c.namedBy; }
  return JSON.stringify(clone);
}

/* --------------------------------------------------------------- naming step */

function runNaming(dir, base, opts) {
  const candidates = collectEvidence(base);
  const proposalsRaw = proposeNames(candidates, opts);
  const byIndex = new Map(proposalsRaw.map((p) => [p.index, p]));

  const taken = takenNames(base);
  const claimed = new Set(); // names accepted so far this batch
  const proposals = [];
  const renames = new Map(); // oldId -> newName (validated, pre-gate)

  for (const c of candidates) {
    const p = byIndex.get(c.index);
    if (!p || typeof p.name !== "string") {
      proposals.push({ oldId: c.oldId, newName: null, rationale: null, accepted: false, reason: "no proposal returned" });
      continue;
    }
    const name = p.name.trim();
    const rationale = (p.rationale || "").toString().slice(0, 200);
    let reason = null;
    if (!IDENT.test(name)) reason = "not a valid lowerCamelCase identifier";
    else if (RESERVED.has(name)) reason = "reserved word";
    else if (name.length > 40) reason = "name too long";
    else if (taken.has(name)) reason = "collides with an existing generator name";
    else if (claimed.has(name)) reason = "duplicate name within this batch";
    if (reason) { proposals.push({ oldId: c.oldId, newName: name, rationale, accepted: false, reason }); continue; }
    claimed.add(name);
    renames.set(c.oldId, name);
    proposals.push({ oldId: c.oldId, newName: name, rationale, accepted: true, reason: "ok" });
  }

  return { proposals, renames };
}

const STEPS = { naming: runNaming };

/* --------------------------------------------------------------- entrypoint */

function refineLanguage(dir, opts = {}) {
  const step = opts.only || "naming";
  if (!STEPS[step]) throw new Error(`unknown --only step "${step}" (available: ${Object.keys(STEPS).join(", ")})`);

  // Baseline (v1): mine fresh so we have the internals the step needs.
  const base = mine(dir, { minCount: opts.minCount || 2 });
  const coverageBefore = base.rollup.coveragePct;
  const byteBefore = corpusByteIdentical(dir);

  const { proposals, renames } = STEPS[step](dir, base, opts);

  // Build the refined library (v2): swap ONLY the names of accepted composites.
  const v2lib = JSON.parse(JSON.stringify(base.library));
  for (const c of v2lib.composites) {
    if (renames.has(c.name)) { c.minedName = c.name; c.name = renames.get(c.name); c.namedBy = `refine-language/${step}`; }
  }
  v2lib.version = "v2";
  v2lib.refinement = { step, from: "mined-library.json", accepted: renames.size, proposed: proposals.length };

  // GATE. A relabel must be structurally inert; re-run the deterministic checks.
  const structuralInert = structuralSkeleton(base.library) === structuralSkeleton(v2lib);
  const byteAfter = corpusByteIdentical(dir);           // byte-identity independent of names
  const coverageAfter = mine(dir, { minCount: opts.minCount || 2 }).rollup.coveragePct;
  const byteIdentical = byteAfter.allExact;
  const coverageHeld = coverageAfter >= coverageBefore;

  let gatePassed = structuralInert && byteIdentical && coverageHeld;
  let gateReason = gatePassed ? "relabel inert: byte-identity + coverage invariant"
    : !structuralInert ? "refined library changed more than names — refusing (LLM must touch names only)"
    : !byteIdentical ? "byte-identity broke under a pure relabel — surfacing as a BUG, not accepting"
    : "coverage dropped under a pure relabel — surfacing as a BUG, not accepting";

  // If the gate failed, no rename is accepted (the whole batch reverts).
  if (!gatePassed) for (const p of proposals) if (p.accepted) { p.accepted = false; p.reason = `reverted: ${gateReason}`; }

  const out = {
    schema: "sdd-repo-dsl/refine-language/1", step, version: "v2", apply: !!opts.apply,
    byteIdentical, byteIdentity: `${byteAfter.ok}/${byteAfter.total}`,
    coverageBefore, coverageAfter,
    gate: { passed: gatePassed, reason: gateReason, structuralInert, coverageHeld },
    accepted: gatePassed ? renames.size : 0, proposed: proposals.length, proposals,
  };

  // Always write the proposal report; promote to v2 only with --apply and a clean gate.
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, "refine-language.json"), JSON.stringify(out, null, 2) + "\n");
  if (opts.apply && gatePassed) {
    fs.mkdirSync(CATALOG, { recursive: true });
    fs.writeFileSync(V2, JSON.stringify(v2lib, null, 2) + "\n");
    out.written = path.relative(process.cwd(), V2);
  } else if (opts.apply && !gatePassed) {
    out.written = null; // refused to promote a refinement that failed the gate
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--")) || "/home/amir/Documents/Rentsync/billing-system/src/rentsync-api/calculators";
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : "naming";
  const stub = args.includes("--stub") ? args[args.indexOf("--stub") + 1] : null;
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
  const out = refineLanguage(path.resolve(process.cwd(), dir), { apply: args.includes("--apply"), only, stub, model });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.gate.passed ? 0 : 1);
}

if (require.main === module) main();
module.exports = { refineLanguage };
