#!/usr/bin/env node
/**
 * sdd-spec-from-intent — the INTENT->spec stage of the spec-driven-dev harness.
 *
 * The panel's new INTENT lane makes plain-English `intent.md` the SOLE review
 * surface for a module; the technical spec, the constants, and the fixtures are
 * no longer hand-authored — they are DERIVED from the intent and validated
 * downstream. This tool owns that derivation.
 *
 * It is DETERMINISTIC on purpose (it does NOT shell out to a model): the
 * fixtures-pass gate that makes the whole harness trustworthy only holds if the
 * fixtures are an exact, reproducible compile of the acceptance examples — an
 * LLM emitting fixtures could not be gated by "every example maps to a fixture".
 * The creative, model-driven step lives DOWNSTREAM in sdd-generate (spec->code),
 * which is Kraken's concern, not this stage's.
 *
 * READS (only under <exampleDir>):
 *   spec/modules/<m>/intent.md        REQUIRED — prose + "## Acceptance examples"
 *   spec/standards/*.md, spec/contracts/*.md   cross-module governing inputs
 *                                              (referenced, not rewritten)
 *
 * WRITES (all DERIVED — overwritten each run):
 *   spec/modules/<m>/spec.md          the derived technical spec
 *   spec/modules/<m>/constants.md     derived from intent's "## Constants"
 *   spec/modules/<m>/fixtures/<fn>.json   compiled acceptance examples, in the
 *                                     EXACT schema tools/verify.js consumes
 *   .sdd-intent-provenance.json       intent-hash -> {spec, constants, fixtures}
 *
 * DETERMINISM SAFETY: a bad intent could yield fixtures that trivially pass
 * against wrong code. Guard: every acceptance example MUST compile to >= 1
 * fixture; the verdict prints examples/fixtures counts and any mismatch (or an
 * unparseable example, or no examples) is a hard, non-zero-exit failure.
 *
 * Usage:
 *   node tools/sdd-spec-from-intent.js <exampleDir> [--module m] [--lang ts]
 *        [--model <id>] [--verify]
 *
 * SIGNALS: prints a single "spec-from-intent: ..." verdict line per module and
 * exits non-zero if any module did not produce a valid spec + fixtures.
 */

const fs = require("fs");
const path = require("path");
const lib = require("./sdd-lib");

function parseArgs(argv) {
  const a = { exampleDir: null, module: null, lang: "ts", model: null, verify: false };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--module") a.module = rest[++i];
    else if (t === "--lang") a.lang = rest[++i];
    else if (t === "--model") a.model = rest[++i]; // accepted for CLI parity; unused (deterministic)
    else if (t === "--verify") a.verify = true;
    else if (!a.exampleDir) a.exampleDir = t;
    else throw new Error(`unexpected argument: ${t}`);
  }
  if (!a.exampleDir) throw new Error("usage: sdd-spec-from-intent.js <exampleDir> [--module m] [--lang ts] [--verify]");
  a.exampleDir = path.resolve(process.cwd(), a.exampleDir);
  return a;
}

/* --------------------------------------------------------------------------
 * intent.md parsing
 *
 * The file is free English prose, plus two structured sections:
 *   ## Constants           (optional) — a ```json fenced object
 *   ## Acceptance examples  (required) — one compilable line per example:
 *
 *     - fn(<jsonArgs>) => <jsonExpected>  [| prop=val, prop=val]  [# name]
 *
 * where <jsonArgs> is the comma-separated argument list (JSON literals),
 * <jsonExpected> is a JSON literal, props are optional verify-properties, and
 * "# name" is an optional human label. Arrows =>, ->, and → are all accepted.
 * Everything to the left of "## Acceptance examples" is the human review prose.
 * -------------------------------------------------------------------------- */

/** Split `s` on top-level `sep` chars only (respecting [], {}, and "" quotes). */
function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0, inStr = false, esc = false, cur = "";
  for (const ch of s) {
    if (inStr) {
      cur += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; cur += ch; continue; }
    if (ch === "[" || ch === "{") { depth++; cur += ch; continue; }
    if (ch === "]" || ch === "}") { depth--; cur += ch; continue; }
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function findArrow(s) {
  const candidates = ["=>", "->", "→"];
  let best = -1, token = null;
  for (const t of candidates) {
    const idx = s.indexOf(t);
    if (idx >= 0 && (best === -1 || idx < best)) { best = idx; token = t; }
  }
  return best === -1 ? null : { index: best, token };
}

function parseSections(md) {
  // Returns { prose, constantsBlock|null, exampleLines: [{raw, lineNo}] }
  const lines = md.split(/\r?\n/);
  const proseLines = [];
  let constantsBlock = null;
  const exampleLines = [];
  let section = "prose"; // prose | constants | acceptance
  let fence = null; // when inside a ``` block, the accumulated lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (heading && fence === null) {
      const title = heading[1].trim().toLowerCase();
      if (/^acceptance examples?\b/.test(title)) { section = "acceptance"; continue; }
      if (/^constants?\b/.test(title)) { section = "constants"; continue; }
      // any other heading ends a structured section, back to prose capture
      section = "prose";
      proseLines.push(line);
      continue;
    }
    if (section === "constants") {
      const isFence = /^\s*```/.test(line);
      if (isFence && fence === null) { fence = []; continue; }
      if (isFence && fence !== null) { if (constantsBlock === null) constantsBlock = fence.join("\n"); fence = null; continue; }
      if (fence !== null) { fence.push(line); continue; }
      continue; // ignore non-fenced prose inside constants
    }
    if (section === "acceptance") {
      const m = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
      if (m) exampleLines.push({ raw: m[1], lineNo: i + 1 });
      continue;
    }
    proseLines.push(line);
  }
  return { prose: proseLines.join("\n").trim(), constantsBlock, exampleLines };
}

function parseExampleLine(raw, lineNo) {
  // Peel an optional trailing "# name" (safe: JSON payloads here contain no " # ").
  let name = null;
  let body = raw;
  const hashIdx = body.lastIndexOf(" #");
  if (hashIdx >= 0) {
    name = body.slice(hashIdx + 2).replace(/^#*/, "").trim();
    body = body.slice(0, hashIdx).trim();
  }
  const arrow = findArrow(body);
  if (!arrow) throw new Error(`line ${lineNo}: no '=>' arrow in acceptance example: ${raw}`);
  const lhs = body.slice(0, arrow.index).trim();
  let rhs = body.slice(arrow.index + arrow.token.length).trim();

  // LHS: fn(argList)
  const call = /^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*$/.exec(lhs);
  if (!call) throw new Error(`line ${lineNo}: left side is not a call fn(...): ${lhs}`);
  const fn = call[1];
  const argsSrc = call[2].trim();
  let args;
  try {
    args = argsSrc === "" ? [] : JSON.parse(`[${argsSrc}]`);
  } catch (e) {
    throw new Error(`line ${lineNo}: could not parse args '[${argsSrc}]' as JSON: ${e.message}`);
  }

  // RHS: <expected> [| props]
  const bar = splitTopLevel(rhs, "|");
  const expectedSrc = bar[0].trim();
  const propsSrc = bar.length > 1 ? bar.slice(1).join("|").trim() : "";
  let expect;
  try {
    expect = JSON.parse(expectedSrc);
  } catch (e) {
    throw new Error(`line ${lineNo}: could not parse expected '${expectedSrc}' as JSON: ${e.message}`);
  }

  const properties = [];
  if (propsSrc) {
    if (propsSrc.startsWith("{")) {
      let obj;
      try { obj = JSON.parse(propsSrc); } catch (e) { throw new Error(`line ${lineNo}: bad props object: ${e.message}`); }
      for (const [k, v] of Object.entries(obj)) properties.push({ [k]: v });
    } else {
      for (const tok of splitTopLevel(propsSrc, ",")) {
        const t = tok.trim();
        if (!t) continue;
        const eq = t.indexOf("=");
        if (eq < 0) throw new Error(`line ${lineNo}: property '${t}' is not key=value`);
        const key = t.slice(0, eq).trim();
        const valSrc = t.slice(eq + 1).trim();
        let val;
        try { val = JSON.parse(valSrc); } catch (e) { throw new Error(`line ${lineNo}: property '${key}' value '${valSrc}' is not JSON: ${e.message}`); }
        properties.push({ [key]: val });
      }
    }
  }

  const fixture = { name: name || `${fn}(${argsSrc}) => ${expectedSrc}`, call: { fn, args } };
  if (!(expectedSrc === "" )) fixture.expect = expect;
  if (properties.length) fixture.properties = properties;
  return { fn, fixture };
}

/* --------------------------------------------------------------------------
 * derivation
 * -------------------------------------------------------------------------- */

function deriveConstantsMd(moduleName, constantsBlock) {
  const header = `# Constants — \`${moduleName}\`\n\n> DERIVED from \`intent.md\` by sdd-spec-from-intent. Do not hand-edit.\n`;
  if (!constantsBlock) {
    return header + `\nThis module declares no constants in its intent.\n`;
  }
  return header + `\n\`\`\`json\n${constantsBlock.trim()}\n\`\`\`\n`;
}

function deriveSpecMd(exampleDir, moduleName, prose, examples, intentShortHash) {
  const specDir = path.join(exampleDir, "spec");
  const standards = lib.listFiles(path.join(specDir, "standards"), ".md").map((p) => lib.relTo(exampleDir, p));
  const contracts = lib.listFiles(path.join(specDir, "contracts"), ".md").map((p) => lib.relTo(exampleDir, p));

  const govLines = [];
  for (const s of standards) govLines.push(`- \`${s}\` — governing standard`);
  for (const c of contracts) govLines.push(`- \`${c}\` — signatures + guarantees`);
  govLines.push("- `constants.md` — literal values (derived from intent)");
  govLines.push("- `fixtures/` — executable input→expected / property cases (derived from intent)");

  const criteria = examples.map((ex, i) => {
    const c = ex.fixture.call;
    const argStr = c.args.map((a) => JSON.stringify(a)).join(", ");
    const expectStr = "expect" in ex.fixture ? ` => ${JSON.stringify(ex.fixture.expect)}` : "";
    const propStr = ex.fixture.properties ? `  [${ex.fixture.properties.map((p) => JSON.stringify(p)).join(", ")}]` : "";
    return `${i + 1}. \`${c.fn}(${argStr})\`${expectStr}${propStr}`;
  });

  return [
    `# Module spec — \`${moduleName}\`  (DERIVED — do not hand-edit)`,
    ``,
    `> Compiled from \`spec/modules/${moduleName}/intent.md\` (intent hash \`${intentShortHash}\`)`,
    `> by \`tools/sdd-spec-from-intent.js\`. The English intent is the sole review`,
    `> surface; this file, \`constants.md\`, and \`fixtures/\` are mechanical derivations`,
    `> and are regenerated whenever the intent changes.`,
    ``,
    `## Behaviour`,
    ``,
    // Drop the intent's own title heading so it nests cleanly under this H2.
    (prose.replace(/^\s*#\s+.*(\r?\n)+/, "").trim()) || "_(no prose supplied in intent.md)_",
    ``,
    `## Governing inputs`,
    ``,
    ...govLines,
    ``,
    `## Acceptance criteria`,
    ``,
    `The generated implementation is valid iff every fixture in \`fixtures/\` passes`,
    `(exact \`expect\` and every \`property\`). Compiled from ${examples.length} acceptance example(s):`,
    ``,
    ...criteria,
    ``,
  ].join("\n");
}

function writeFixtures(exampleDir, moduleName, examples) {
  const dir = lib.fixturesDir(exampleDir, moduleName);
  fs.mkdirSync(dir, { recursive: true });
  // Fixtures are now fully derived: clear any prior *.json so nothing stale survives.
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".json")) fs.rmSync(path.join(dir, f));
  }
  const byFn = new Map();
  for (const ex of examples) {
    if (!byFn.has(ex.fn)) byFn.set(ex.fn, []);
    byFn.get(ex.fn).push(ex.fixture);
  }
  const files = [];
  let count = 0;
  for (const fn of [...byFn.keys()].sort()) {
    const cases = byFn.get(fn);
    const p = path.join(dir, `${fn}.json`);
    fs.writeFileSync(p, JSON.stringify(cases, null, 2) + "\n");
    files.push(`${fn}.json`);
    count += cases.length;
  }
  return { files, count };
}

/* --------------------------------------------------------------------------
 * per-module driver
 * -------------------------------------------------------------------------- */

function processModule(cfg, moduleName) {
  const intentP = lib.intentPath(cfg.exampleDir, moduleName);
  if (!fs.existsSync(intentP)) {
    return { module: moduleName, ok: false, verdict: `FAIL module=${moduleName} missing ${lib.relTo(cfg.exampleDir, intentP)}` };
  }
  const md = fs.readFileSync(intentP, "utf8");
  const intentHash = lib.sha256(md);
  const intentShort = intentHash.slice(0, 12);

  const { prose, constantsBlock, exampleLines } = parseSections(md);
  if (!exampleLines.length) {
    return { module: moduleName, ok: false, verdict: `FAIL module=${moduleName} no acceptance examples found (need a "## Acceptance examples" section)` };
  }

  // Compile every example; a single unparseable line fails the whole module.
  const examples = [];
  try {
    for (const { raw, lineNo } of exampleLines) examples.push(parseExampleLine(raw, lineNo));
  } catch (e) {
    return { module: moduleName, ok: false, verdict: `FAIL module=${moduleName} ${e.message}` };
  }

  // Derive + write.
  const constMd = deriveConstantsMd(moduleName, constantsBlock);
  fs.writeFileSync(path.join(cfg.exampleDir, "spec", "modules", moduleName, "constants.md"), constMd);
  const specMd = deriveSpecMd(cfg.exampleDir, moduleName, prose, examples, intentShort);
  fs.writeFileSync(path.join(cfg.exampleDir, "spec", "modules", moduleName, "spec.md"), specMd);
  const { files, count } = writeFixtures(cfg.exampleDir, moduleName, examples);

  // DETERMINISM GUARD: every acceptance example must have produced a fixture.
  if (count !== examples.length) {
    return { module: moduleName, ok: false, verdict: `FAIL module=${moduleName} mapping mismatch: ${examples.length} example(s) -> ${count} fixture(s)` };
  }

  // Stamp provenance (intent -> derived artifacts) for later drift detection.
  const modDir = path.join(cfg.exampleDir, "spec", "modules", moduleName);
  const specPath = path.join(modDir, "spec.md");
  const constPath = path.join(modDir, "constants.md");
  const entry = {
    module: moduleName,
    intent: { path: lib.relTo(cfg.exampleDir, intentP), hash: intentHash },
    derived: {
      spec: { path: lib.relTo(cfg.exampleDir, specPath), hash: lib.hashFile(specPath) },
      constants: { path: lib.relTo(cfg.exampleDir, constPath), hash: lib.hashFile(constPath) },
      fixtures: { files: files.map((f) => `spec/modules/${moduleName}/fixtures/${f}`), hash: lib.fixturesHash(cfg.exampleDir, moduleName) },
    },
    exampleCount: examples.length,
    fixtureCount: count,
  };

  // Optional stage-crossing safety: if code already exists, confirm derived
  // fixtures still pass it (does not build code — that is sdd-generate's job).
  let verifyNote = "";
  if (cfg.verify) {
    const genPath = path.join(cfg.exampleDir, "generated", `${moduleName}.${cfg.lang}`);
    if (fs.existsSync(genPath)) {
      const v = lib.runVerify(cfg.exampleDir, genPath);
      if (v.ok === false) {
        return { module: moduleName, ok: false, verdict: `FAIL module=${moduleName} derived fixtures FAIL existing generated/${moduleName}.${cfg.lang}`, entry: null };
      }
      verifyNote = v.ok ? " verify=pass" : " verify=n/a";
    } else {
      verifyNote = " verify=skipped(no-code)";
    }
  }

  const verdict = `OK module=${moduleName} examples=${examples.length} fixtures=${count} files=[${files.join(",")}] spec+constants derived (intent ${intentShort})${verifyNote}`;
  return { module: moduleName, ok: true, verdict, entry };
}

function main() {
  const cfg = parseArgs(process.argv);
  let modules;
  if (cfg.module) {
    modules = [cfg.module];
  } else {
    modules = lib.listModules(cfg.exampleDir).filter((m) => fs.existsSync(lib.intentPath(cfg.exampleDir, m)));
    if (!modules.length) {
      console.log(`spec-from-intent: FAIL no module under ${lib.relTo(process.cwd(), cfg.exampleDir)}/spec/modules has an intent.md`);
      process.exit(1);
    }
  }

  const prior = lib.readIntentProvenance(cfg.exampleDir);
  const byModule = new Map((prior?.artifacts || []).map((a) => [a.module, a]));

  let allOk = true;
  for (const m of modules) {
    const res = processModule(cfg, m);
    console.log(`spec-from-intent: ${res.verdict}`);
    if (!res.ok) { allOk = false; continue; }
    byModule.set(m, res.entry);
  }

  if (allOk) {
    const manifest = {
      schema: "sdd-intent-provenance/1",
      stage: "intent->spec",
      generatedAt: null, // stamped at commit time, kept deterministic
      artifacts: [...byModule.values()].sort((a, b) => a.module.localeCompare(b.module)),
    };
    lib.writeIntentProvenance(cfg.exampleDir, manifest);
    console.log(`spec-from-intent: wrote ${lib.relTo(process.cwd(), lib.intentProvenancePath(cfg.exampleDir))}`);
  }

  process.exit(allOk ? 0 : 1);
}

main();
