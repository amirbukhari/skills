/* engine/corpus-root.test.js — AMIR'S ACCEPTANCE TEST, MADE EXECUTABLE.
 *
 * Verbatim: "if you need to make more than 1 file change to alter the directory we are pointing at
 * then we have done this wrong and need to fix it."
 *
 * (f) below is that sentence as a property, applied PER ROOT: it greps the live engine for anything
 * that names a root and fails unless the only places are corpus-root.js's own registry defaults and
 * <engine>/.env. (g) does the same for the `sen` folder name, so the spec->sen rename cannot half
 * happen. The other cases pin per-root precedence and the no-silent-fallback rule, because a single
 * resolver that quietly falls through to a default is the 38-file problem wearing one file's hat.
 *
 * Deterministic; needs no corpus; exits non-zero on failure.
 */
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const CR = require("./corpus-root");

const ENGINE = path.resolve(__dirname, "..");                 // the repo-dsl tree
let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; } };

/* (a) The registry is the two roots Amir asked for: SOURCE reads, CORPUS writes. */
ok("the registry holds exactly the read root and the write root", () => {
  assert.deepStrictEqual(CR.names().sort(), ["corpus", "source"]);
  assert.strictEqual(CR.envOf("source"), "SOURCE");
  assert.strictEqual(CR.envOf("corpus"), "CORPUS");
  assert.strictEqual(CR.flagOf("source"), "--source");
  assert.strictEqual(CR.flagOf("corpus"), "--corpus");
});

/* (b) PER-ROOT PRECEDENCE, highest first. Injected argv/env so the test says nothing about the
 *     machine it runs on. Each root is driven by ITS OWN variable and flag — no crosstalk. */
ok("precedence per root is --flag > env > .env > built-in default", () => {
  const A = "/tmp", B = "/usr", opt = { mustExist: false };

  for (const [name, flag, env] of [["source", "--source", "SOURCE"], ["corpus", "--corpus", "CORPUS"]]) {
    const f = CR.resolveRoot(name, { ...opt, argv: ["node", "x", flag, A], env: { [env]: B } });
    assert.strictEqual(f.root, A, `${flag} must beat ${env}`);
    assert.strictEqual(f.layer, `${flag} flag`);

    const eq = CR.resolveRoot(name, { ...opt, argv: ["node", "x", `${flag}=${A}`], env: { [env]: B } });
    assert.strictEqual(eq.root, A, `${flag}=<path> must parse like ${flag} <path>`);

    const e = CR.resolveRoot(name, { ...opt, argv: ["node", "x"], env: { [env]: B } });
    assert.strictEqual(e.root, B, `${env} must beat .env and the default`);
    assert.strictEqual(e.layer, `${env} env`);
  }
});

/* (c) NO CROSSTALK. Setting one root must not move the other — that independence is the entire
 *     point of two variables ("copy the contents of one codebase into a new one … flip the path"). */
ok("SOURCE and CORPUS are independent — setting one never moves the other", () => {
  const opt = { mustExist: false, argv: ["node", "x"] };
  const a = CR.resolveRoot("source", { ...opt, env: { SOURCE: "/tmp" } });
  const b = CR.resolveRoot("corpus", { ...opt, env: { SOURCE: "/tmp" } });
  assert.strictEqual(a.root, "/tmp");
  assert.notStrictEqual(b.root, "/tmp", "CORPUS must not follow SOURCE");

  const c = CR.resolveRoot("corpus", { ...opt, env: { CORPUS: "/usr" } });
  const d = CR.resolveRoot("source", { ...opt, env: { CORPUS: "/usr" } });
  assert.strictEqual(c.root, "/usr");
  assert.notStrictEqual(d.root, "/usr", "SOURCE must not follow CORPUS");
});

/* (d) They must also be settable to the SAME path — self-hosting, which is today's behavior and
 *     the shipped default. */
ok("both roots may point at one tree (self-hosting) and do so by default", () => {
  const opt = { mustExist: false, argv: ["node", "x"], env: { SOURCE: "/tmp", CORPUS: "/tmp" } };
  assert.strictEqual(CR.resolveRoot("source", opt).root, CR.resolveRoot("corpus", opt).root);
  // the shipped configuration resolves both to the same tree
  assert.strictEqual(CR.sourceRoot(), CR.corpusRoot(), "shipped default must self-host");
});

/* (e) NO SILENT FALLBACK. A root that is SET but absent must throw and NAME THE LAYER. Falling
 *     through would turn "your SOURCE is a typo" into "your corpus contains no patterns" — a
 *     measurement, not a failure. Same rule as artifact-contract.js. */
ok("a set-but-missing root throws, naming the root, the path and the layer", () => {
  for (const [name, env] of [["source", "SOURCE"], ["corpus", "CORPUS"]]) {
    const bogus = `/definitely/not/a/tree/${name}/${Date.now()}`;
    assert.throws(() => CR.resolveRoot(name, { argv: ["node", "x"], env: { [env]: bogus } }),
      (e) => {
        assert.strictEqual(e.name, "RootError");
        assert.strictEqual(e.rootName, name, "the error must name which root failed");
        assert.ok(e.message.includes(bogus), "the error must name the offending path");
        assert.ok(e.message.includes(`${env} env`), "the error must name the layer that supplied it");
        return true;
      });
  }
});

ok("a file where a directory belongs is refused, and an empty flag is a usage error", () => {
  assert.throws(() => CR.resolveRoot("source", { argv: ["node", "x"], env: { SOURCE: __filename } }),
    (e) => e.name === "RootError" && /not a directory/.test(e.message));
  assert.throws(() => CR.fromArgv("source", ["node", "x", "--source"]), (e) => e.name === "RootError");
  assert.throws(() => CR.fromArgv("corpus", ["node", "x", "--corpus", "--apply"]), (e) => e.name === "RootError");
});

/* (f) THE ONE-FILE PROPERTY, PER ROOT. Nothing in the live engine may name a root. The only
 *     permitted homes for such a literal are this resolver's registry defaults and <engine>/.env.
 *
 *     archive/ is excluded deliberately: those scripts are RETIRED, not deleted (see
 *     archive/README.md), they are never executed, and rewriting them would falsify a historical
 *     record without making any live path configurable. node_modules/ and Examples/ (the corpus
 *     itself, whose mined artifacts record the tree they came from) are likewise not engine source. */
const SKIP_DIRS = new Set(["node_modules", ".git", "archive", "Examples"]);
const SELF = path.join(__dirname, "corpus-root.js");
/* A "root literal" is a literal the engine could RESOLVE A PATH AGAINST — deliberately narrower
 * than "mentions a corpus name". It matches an absolute user path, or a path-ANCHORED literal
 * (leading /, ./ or ../, or a leading Examples/) naming a known tree.
 *   caught:   "/home/amir/.../hydra-source"   "./Examples/hydra-source"   "Examples/hydra-source"
 *   exempt:   "package-hydra-source.js" (a script filename), "sdd-hydra-source-package/2" (a
 *             schema string). Substring-matching those produced six false positives on the first
 *             run of this test; a guard that cries wolf gets deleted, so it matches shape.
 * Comment lines are exempt throughout: they describe history, and history is why this test exists. */
const ROOT_LITERAL = new RegExp(
  "([\"'])(?:" +
    "\\/(?:home|Users)\\/[^\"']*" +
    "|\\.{0,2}\\/[^\"']*(?:hydra-source|hydra-calculators|billing-system)[^\"']*" +
    "|Examples\\/hydra-source[^\"']*" +
  ")\\1");

const liveFiles = () => {
  const out = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      if (p.endsWith(".js")) out.push(p);
    }
  };
  scan(ENGINE);
  return out;
};
const scanLines = (pred, { skipSelf = true } = {}) => {
  const bad = [];
  for (const p of liveFiles()) {
    if (p === __filename) continue;
    if (skipSelf && p === SELF) continue;
    fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) return;          // comments describe history
      if (pred(line)) bad.push(`${path.relative(ENGINE, p)}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
  return bad;
};

ok("no live engine source names a root — only the registry and .env may", () => {
  const bad = scanLines((line) => ROOT_LITERAL.test(line));
  assert.deepStrictEqual(bad, [],
    `these name a root instead of asking engine/corpus-root.js:\n    ${bad.join("\n    ")}\n` +
    `  Repointing a root must be a ONE-FILE change (<engine>/.env).`);
});

/* (g) THE spec->sen RENAME, enforced. The English tree is <CORPUS>/sen; `spec` as a path segment
 *     against a corpus root is gone. Two things are deliberately NOT caught here, because they are
 *     not this folder:
 *       - the SDD lane's own <projectRoot|outDir|exampleDir>/spec/modules (sdd-code-from-spec.js,
 *         selfhost-package.js, package-delonix.js) — a DIFFERENT tree with its own layout;
 *       - ".cache/spec-derived", a directory inside .cache that Amir did not rename;
 *       - "spec" inside a walk SKIP set, which keeps excluding a not-yet-renamed corpus.
 *     So this asserts the specific joins that used to point at the renamed folder. */
ok("no live engine source joins a corpus root to a 'spec' path segment", () => {
  const bad = scanLines((line) =>
    /* a walk SKIP set legitimately lists BOTH names — `"sen", "spec", "catalog"` — so that a
     * corpus which has not been renamed yet stays excluded. It is the one shape below that is
     * not a path join, and exempting it is what keeps this guard from crying wolf. */
    (!/SKIP\s*=\s*new Set\(/.test(line)) && (
    /path\.join\(\s*(?:AC\.corpusRoot\(\)|CR\.corpusRoot\(\)|CORPUS|PROJECT)\s*,\s*["']spec["']/.test(line) ||
    /["']spec\/(?:files|catalog|skeletons|archetypes)["']/.test(line) ||
    /["']spec["']\s*,\s*["'](?:files|catalog|skeletons|archetypes)["']/.test(line)));
  assert.deepStrictEqual(bad, [],
    `these still name the pre-rename spec/ folder:\n    ${bad.join("\n    ")}`);
});

ok("the sen folder name is spelled in exactly one place", () => {
  assert.strictEqual(CR.LAYOUT.sen, "sen");
  assert.strictEqual(CR.senDir("/tmp"), path.join("/tmp", "sen"));
  // no live file hardcodes a corpus-rooted "sen" join either — they all go through CR.senDir()
  const bad = scanLines((line) =>
    /path\.join\(\s*(?:AC\.corpusRoot\(\)|CR\.corpusRoot\(\)|CORPUS|PROJECT)\s*,\s*["']sen["']/.test(line));
  assert.deepStrictEqual(bad, [], `these spell out sen/ instead of calling CR.senDir():\n    ${bad.join("\n    ")}`);
});

/* (h) The old variable name is gone entirely — a single name is the point, two names is the drift
 *     this whole exercise removed. */
ok("HYDRA_CORPUS appears nowhere in live engine source", () => {
  const bad = [];
  for (const p of liveFiles()) {
    if (p === __filename) continue;
    fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (line.includes("HYDRA_CORPUS")) bad.push(`${path.relative(ENGINE, p)}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepStrictEqual(bad, [], `the old variable name survives here:\n    ${bad.join("\n    ")}`);
});

/* (i) Every live consumer really does route through the resolver: artifact-contract, the module
 *     every artifact read goes through, must agree with it, and anchor artifacts under sen/. */
ok("artifact-contract agrees with the resolver and anchors artifacts under <corpus>/sen/catalog", () => {
  const AC = require("./artifact-contract");
  assert.strictEqual(AC.corpusRoot(), CR.corpusRoot());
  assert.strictEqual(AC.corpusRoot("/tmp"), "/tmp", "an explicit root must still win");
  assert.strictEqual(AC.HOMES.tracked, path.join("sen", "catalog"));
  const p = AC.pathFor("generators-lzw", "/tmp");
  assert.strictEqual(p, path.join("/tmp", "sen", "catalog", "generators-lzw.json"));
});

console.log(`\n${pass} assertions passed`);
