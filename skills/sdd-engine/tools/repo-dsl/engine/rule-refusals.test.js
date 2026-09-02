/* rule-refusals.test.js — the silent-rule-mismatch detector, PROVED TO FIRE.
 *
 * §10.3: a guard that cannot be shown to FIRE is not a guard. This engine's refusals are the
 * definition of silent — every one of them is a `return null` that degrades collapse and says
 * nothing — so a test that only checks the happy path would pass just as well against a recorder
 * that was never wired up. Every case below therefore drives a real refusal and asserts on the
 * recorded row, and the two that gate (the closed vocabulary, the baseline differential) are shown
 * firing AND, with a control, shown not to fire on everything.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const ts = require("typescript");
const { execFileSync } = require("child_process");
const REF = require("./refusals");
const EN = require("./enfile");
const CR = require("./corpus-root");

let pass = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } else { pass++; console.log("ok - " + m); } };
const eq = (a, b, m) => ok(a === b, m + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

const parse = (src) => ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true);
const capture = (fn) => {
  const col = REF.collector(5);
  const prev = REF.setSink(col.sink);
  try { fn(); } finally { REF.setSink(prev); }
  return col.report();
};

/* ---- 1. the closed vocabulary REFUSES an unknown reason, and accepts a known one -------------- */
{
  const rep = capture(() => {
    let threw = null;
    try { REF.record({ rule: "x", reason: "not-a-real-reason" }); } catch (e) { threw = e.message; }
    ok(threw && /unknown reason/.test(threw), "an invented reason throws rather than silently becoming a new category");
    let threw2 = null;
    try { REF.record({ rule: "", reason: "no-word" }); } catch (e) { threw2 = e.message; }
    ok(threw2 && /must name a rule/.test(threw2), "a refusal with no rule named throws — 'which rule' is the point of the record");
    REF.setFile("ctl.ts");
    REF.record({ rule: "ctl", reason: "no-word", start: 0, end: 1 });   // control: the guard is not a blanket refusal
    REF.setFile(null);
  });
  eq(rep.total, 1, "control: a well-formed refusal IS recorded, so the throws above are the guard and not a broken recorder");
}

/* ---- 2. spans are counted once however often the gate is consulted ---------------------------- */
{
  const rep = capture(() => {
    REF.setFile("a.ts");
    for (let i = 0; i < 4; i++) REF.record({ rule: "r", reason: "no-word", start: 10, end: 20 });
    REF.record({ rule: "r", reason: "no-word", start: 30, end: 40 });
    REF.setFile(null);
  });
  eq(rep.total, 2, "count is DISTINCT spans — five consultations of two spans is two refusals");
  eq(rep.events, 5, "...and the raw consultation count is still published, so the ratio is not hidden");
}

/* ---- 3. gloss-refused FIRES, with a control that the gate does not refuse everything ---------- */
{
  const refused = capture(() => {
    const sf = parse("a();\nb();\na();\n");   // non-adjacent repetition: the rule for it is not written
    EN.chunkGloss(sf.statements.slice(0, 3), sf);
  });
  const row = refused.rules.find((r) => r.reason === "gloss-refused");
  ok(row, "a run R-ARCH-17 cannot say is RECORDED, not just declined");
  ok(row && /^chunkGloss:/.test(row.rule), "...and the row names the specific clause that refused: " + (row && row.rule));

  const fine = capture(() => {
    const sf = parse("callA();\ncallB();\n");
    ok(EN.chunkGloss(sf.statements.slice(0, 2), sf), "control: a sayable run still glosses");
  });
  eq(fine.total, 0, "control: a run that passes the gate records NO refusal");
}

/* ---- 4. rule-declined FIRES — a node-kind rule that matched the kind and refused the run ------ */
{
  const rep = capture(() => {
    /* A run that MIXES a re-export with a local export: the ExportDeclaration rule matches both
     * statements by kind and then declines rather than fudge two verbs into one. */
    const sf = parse("export { A } from './m';\nexport { B };\n");
    EN.spanActions(sf.statements.slice(0, 2), sf);
  });
  const row = rep.rules.find((r) => r.reason === "rule-declined");
  ok(row, "a hand-written chunk rule that declines its own run is recorded");
  eq(row && row.rule, "chunkRule:ExportDeclaration", "...named by the rule, so an unwritten case is a counted backlog item");
}

/* ---- 5. the LIVE corpus path: no-word / no-symbol fire on real source ------------------------- */
{
  const SRC = CR.sourceRoot(), CORPUS = CR.corpusRoot();
  const index = EN.loadIndex(CORPUS);
  const rep = capture(() => {
    for (const rel of ["src/billingRunner.ts", "src/hydra-api/massCredits/index.ts"]) {
      const abs = path.join(SRC, rel);
      if (!fs.existsSync(abs)) continue;
      REF.setFile(rel);
      const source = fs.readFileSync(abs, "utf8");
      const r = EN.renderFileEn(source, index);
      ok(EN.compileFileEn(r.en, index) === source, "byte-identity holds for " + rel + " with the recorder installed");
    }
    REF.setFile(null);
  });
  ok(rep.total > 0, "the real corpus produces real refusals — " + rep.total + " spans across " + rep.rules.length + " rules");
  ok(rep.rules.every((r) => r.samples.every((s) => s.file && s.start != null && s.end != null)),
     "every recorded refusal names a file AND a span — 'which rule, which file/span' is the deliverable");

  /* R-MECH-8, stated as a test rather than a comment: these two are published as zero because they
   * CANNOT fire, and the report says so. If someone reorders runWord so they can, this fails and
   * the claim in refusals.js gets rewritten instead of quietly becoming false. */
  for (const r of ["parts-inexact", "byte-gate"]) {
    const row = rep.reasons.find((x) => x.reason === r);
    eq(row.count, 0, r + " is zero on the live path");
    eq(row.reachable, false, "...and is published as UNREACHABLE, not as a passing guard: " + row.unreachableBecause);
  }
}

/* ---- 6. THE DIFFERENTIAL GATE FIRES ON REAL DRIFT, with a control that it is not a blanket fail --
 *
 * Drift is source moving under a FIXED catalog, so that is what this drives: a real corpus file is
 * copied into a throwaway tree, `SOURCE` is pointed at the copy (the catalog stays the real one),
 * and a statement shape the dictionary has never seen is appended. Nothing under the corpus is read
 * for writing or modified — the mutation happens only inside the temp dir, which is removed after.
 */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "refusal-drift-"));
  const script = path.join(__dirname, "..", "audit-rules.js");
  const cwd = path.join(__dirname, "..");
  const baseline = path.join(tmp, "baseline.json");
  const fixture = path.join(tmp, "src", "csvUtils.ts");
  fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
  fs.copyFileSync(path.join(CR.sourceRoot(), "src", "csvUtils.ts"), fixture);
  const before = fs.readFileSync(fixture, "utf8");

  const audit = (args) => {
    const opts = { encoding: "utf8", cwd, env: Object.assign({}, process.env, { SOURCE: tmp }) };
    try { return { code: 0, out: execFileSync(process.execPath, [script].concat(args), opts) }; }
    catch (e) { return { code: e.status, out: (e.stdout || "") + (e.stderr || "") }; }
  };

  const wrote = audit(["--write-baseline", "--baseline", baseline]);
  eq(wrote.code, 0, "a baseline can be recorded against a source tree");
  const recorded = JSON.parse(fs.readFileSync(baseline, "utf8"));
  ok(recorded.counts && typeof recorded.counts === "object", "the baseline records per-rule counts");

  const control = audit(["--baseline", baseline]);
  eq(control.code, 0, "control: unchanged source against its own baseline PASSES — the gate is not a blanket failure");
  ok(/PASS —/.test(control.out), "...and says so");

  /* The drift itself: a shape the dictionary was never mined on, appended to the file. The word that
   * covered this file stops covering it, and the refusal that used not to exist now does. */
  fs.writeFileSync(fixture, before + "\ninterface ZzDrift {\n  a: number;\n}\n");
  const drifted = audit(["--baseline", baseline]);
  eq(drifted.code, 1, "source moving under a fixed catalog FAILS the audit — the silent degradation is now loud");
  ok(/used to match this corpus/.test(drifted.out), "...saying what actually went wrong");
  ok(/InterfaceDeclaration/.test(drifted.out), "...and NAMING the rule that stopped matching (dictionary:InterfaceDeclaration)");
  ok(/0 -> 1/.test(drifted.out), "...with the before/after counts, so the size of the regression is visible");

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("\n" + pass + " assertions passed");
