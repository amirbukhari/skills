#!/usr/bin/env node
"use strict";
/**
 * report-server.js — the REPORTING LAYER. A read-only view of what the engine has already
 * published, rendered as one page.
 *
 * AMIR'S CONSTRAINT, IN HIS WORDS: it is "READ-ONLY reporting, not a control surface". So this file
 * has no write path at all — no endpoint mines, renders, names, stamps, cleans or edits anything,
 * and there is no POST. That is not a policy note, it is the reason the code is shaped this way:
 * the `.en` -> `.ts` direction-of-truth question is still OPEN (CLAUDE.md §6, R-PAY-6, Q-1), and a
 * button that could act would bake in an answer only Amir can give. A page that can only read
 * cannot make that mistake.
 *
 * WHAT IT READS (and nothing else)
 *   en-index         <CORPUS>/.cache/spec-derived/en-index.json   npm run render
 *   corpus-coverage  <CORPUS>/.cache/spec-derived/corpus-coverage.json   npm run gate
 *   generators-lzw   <CORPUS>/sen/catalog/generators-lzw.json     npm run mine   (HEADER ONLY — the
 *                    body is ~42 MB and no reporting number needs it)
 *   the register     by RUNNING verify-register.js --json, because the register has NO on-disk
 *                    artifact. That runner's own writes are confined to os.tmpdir() (measured: every
 *                    writeFileSync/mkdirSync site in it is under a mkdtempSync root, and the one
 *                    destructive tool it exercises, sdd-clean.js, is pointed at a throwaway tree).
 *                    `--no-register` skips it and the panel then says so, rather than showing zeros.
 *
 * AN ABSENT ARTIFACT IS A NAMED MISS, NEVER A ZERO. Every panel either reports numbers or reports
 * what it looked for, where, and the command that would produce it — the `{ optional: true }` rule
 * from CLAUDE.md §8, at the presentation layer. A dashboard that renders 0% for "not yet rendered"
 * is the bug class this engine exists to eliminate, one layer up.
 *
 *   node report-server.js                 # http://127.0.0.1:8787
 *   node report-server.js --port 9000
 *   node report-server.js --once          # print the HTML to stdout and exit (redirect it yourself)
 *   node report-server.js --once --json   # print the model as JSON and exit
 *   node report-server.js --no-register   # skip the 5s register run
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawnSync } = require("child_process");

const AC = require("./engine/artifact-contract");
const CR = require("./engine/corpus-root");

const HERE = __dirname;
const argv = process.argv.slice(2);
const KNOWN = ["--port", "--host", "--once", "--json", "--no-register", "--help"];
for (const a of argv) {
  if (a.startsWith("--") && !KNOWN.includes(a.split("=")[0])) {
    console.error(`report-server.js REFUSED: unknown flag \`${a}\`. known: ${KNOWN.join(", ")}`);
    process.exit(2);
  }
}
const flag = (name, dflt) => {
  const i = argv.findIndex((a) => a === name || a.startsWith(name + "="));
  if (i < 0) return dflt;
  return argv[i].includes("=") ? argv[i].split("=").slice(1).join("=") : (argv[i + 1] || dflt);
};
const ONCE = argv.includes("--once");
const AS_JSON = argv.includes("--json");
const NO_REGISTER = argv.includes("--no-register");
const PORT = Number(flag("--port", 8787));
/* LOOPBACK BY DEFAULT, and this is why there is no auth to configure: the page is not reachable off
 * this machine unless someone deliberately overrides the host. It reports corpus-derived numbers,
 * and the corpus is not public (PRD §8B). */
const HOST = flag("--host", "127.0.0.1");
if (argv.includes("--help")) { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]); process.exit(0); }

/* ---------- reading. Every reader returns numbers OR a named miss. Never a bare null. ---------- */

const PRODUCERS = { "en-index": "npm run render", "corpus-coverage": "npm run gate", "generators-lzw": "npm run mine" };

function loadArtifact(kind) {
  let where;
  try { where = AC.pathFor(kind); }
  catch (e) { return { miss: { what: kind, where: "(unresolvable)", why: e.message.split("\n")[0], how: PRODUCERS[kind] } }; }
  if (!fs.existsSync(where)) return { miss: { what: kind, where, why: "not present", how: PRODUCERS[kind] } };
  try { return { ok: true, where, j: AC.load(kind, where) }; }
  catch (e) { return { miss: { what: kind, where, why: e.message.split("\n")[0], how: PRODUCERS[kind] } }; }
}

/* The dictionary HEADER only. AC.stamp writes the header keys first, so the first few KB carry them;
 * the body is tens of megabytes and no number on this page comes from it. Reading the whole file to
 * print a fingerprint would make the page cost more than the mine it describes. */
function dictionaryHeader() {
  let where;
  try { where = AC.pathFor("generators-lzw"); } catch (e) { return { miss: { what: "generators-lzw", where: "(unresolvable)", why: e.message.split("\n")[0], how: PRODUCERS["generators-lzw"] } }; }
  let st;
  try { st = fs.statSync(where); }
  catch (e) { return { miss: { what: "generators-lzw", where, why: `not present (${e.code})`, how: PRODUCERS["generators-lzw"] } }; }
  let head = "";
  try {
    const fd = fs.openSync(where, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.slice(0, n).toString("utf8");
  } catch (e) { return { miss: { what: "generators-lzw", where, why: `unreadable (${e.code})`, how: PRODUCERS["generators-lzw"] } }; }
  const field = (k) => { const m = new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`).exec(head); return m ? m[1] : null; };
  const num = (k) => { const m = new RegExp(`"${k}"\\s*:\\s*(-?[0-9.]+)`).exec(head); return m ? Number(m[1]) : null; };
  return { ok: true, where, bytes: st.size, mtime: st.mtime.toISOString(),
    fingerprint: field("fingerprint"), generated: field("generated"), corpus: field("corpus"),
    schema: field("schema"), words: num("words") };
}

/* THE REGISTER HAS NO ARTIFACT, so reading it means running it. Cached in memory for a minute: the
 * run takes ~5s, and a page reload must not be a way to spend it repeatedly. */
let _reg = null;
function register() {
  if (NO_REGISTER) return { miss: { what: "the register", where: "verify-register.js", why: "skipped (--no-register)", how: "npm run register" } };
  if (_reg && Date.now() - _reg.at < 60000) return _reg.value;
  const r = spawnSync(process.execPath, [path.join(HERE, "verify-register.js"), "--json"],
    { cwd: HERE, encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  let value;
  if (r.error) value = { miss: { what: "the register", where: "verify-register.js", why: r.error.message.split("\n")[0], how: "npm run register" } };
  else {
    try {
      const j = JSON.parse(r.stdout);
      /* Exit 1 means at least one row FAILS -- which is the register's normal state while four reds
       * stand on purpose. So the exit code is reported, not treated as a read failure. */
      value = { ok: true, j, exit: r.status, ranAt: new Date().toISOString() };
    } catch (e) {
      value = { miss: { what: "the register", where: "verify-register.js", why: `--json did not parse: ${e.message.split("\n")[0]}`, how: "node verify-register.js --json" } };
    }
  }
  _reg = { at: Date.now(), value };
  return value;
}

/* ---------- the one-word-per-file panel, derived rather than quoted ----------
 *
 * The CEILING is 1035, not 1037, because two files are empty (1 and 9 bytes) and cannot carry a top
 * word at all. That number is recorded in the register at R-ARCH-15 and in PRD §5D.4 -- but quoting
 * a doc from a dashboard is how a stale number outlives the thing it described. So it is DERIVED
 * from the artifact here (files with no statements and no spans) and the recorded value is shown
 * beside it; if they ever disagree, the page says so instead of picking one. */
const RECORDED_CEILING = { files: 1035, of: 1037, source: "register R-ARCH-15 / PRD §5D.4, measured 2026-09-01" };

function oneWord(en) {
  if (en.miss) return en;
  const rs = en.j.reviewSurface || {};
  const perFile = Array.isArray(en.j.perFile) ? en.j.perFile : [];
  if (!perFile.length) return { miss: { what: "per-file detail", where: en.where, why: "the artifact carries no perFile array", how: PRODUCERS["en-index"] } };
  const emptyFiles = perFile.filter((f) => !f.bodyStatements && !f.stmtSpans && !f.dataSpans && !f.topSpans);
  const residue = perFile.filter((f) => !f.oneWord).map((f) => ({
    rel: f.rel, bytes: f.totalBytes, topSpans: f.topSpans, outsideNonWs: f.outsideNonWs,
    /* The three causes, read off the file's own numbers -- the same split the register records:
     * empty · non-whitespace outside the top span (the leading-comment case, refused because it
     * broke byte-identity) · no top span at all (the dictionary holds no word for it). */
    cause: (!f.bodyStatements && !f.topSpans) ? "empty file — cannot have a top word"
         : f.topSpans ? "non-whitespace outside the top span"
         : "no top-level word covers the file",
  }));
  const derivedCeiling = perFile.length - emptyFiles.length;
  return {
    ok: true, where: en.where,
    files: perFile.length,
    oneWordFiles: rs.oneWordFiles, oneWordPct: rs.oneWordPct, notCollapsed: rs.filesNotCollapsed,
    derivedCeiling, emptyFiles: emptyFiles.map((f) => ({ rel: f.rel, bytes: f.totalBytes })),
    recordedCeiling: RECORDED_CEILING,
    ceilingAgrees: derivedCeiling === RECORDED_CEILING.files && perFile.length === RECORDED_CEILING.of,
    residue,
  };
}

function model() {
  const en = loadArtifact("en-index");
  const cov = loadArtifact("corpus-coverage");
  return {
    tool: "report-server", readOnly: true, generated: new Date().toISOString(),
    roots: { source: safe(() => CR.sourceRoot()), corpus: safe(() => CR.corpusRoot()) },
    en, coverage: cov, dictionary: dictionaryHeader(), oneWord: oneWord(en), register: register(),
  };
}
const safe = (fn) => { try { return fn(); } catch (e) { return `(unresolved: ${e.message.split("\n")[0]})`; } };

/* ---------- rendering. No client-side JS, no network, no fonts: one document, offline. ---------- */

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nfmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "—");
const pct = (n) => (typeof n === "number" ? `${n}%` : "—");

const CSS = `
:root{--bg:#f7f7f5;--card:#fff;--ink:#1c1c1a;--dim:#6b6b66;--line:#e2e2dd;--hold:#1f7a4d;--fail:#b03030;--manual:#8a6d1f;--accent:#2b5f8f}
@media (prefers-color-scheme:dark){:root{--bg:#17181a;--card:#1f2124;--ink:#e8e8e4;--dim:#9a9a94;--line:#33353a;--hold:#4fbf85;--fail:#e07070;--manual:#d9b64a;--accent:#79b4e6}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:1080px;margin:0 auto;padding:28px 20px 64px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 12px;letter-spacing:.02em}
.sub{color:var(--dim);margin:0 0 24px;font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:18px 20px;margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:0 0 6px}
.stat{border-left:3px solid var(--accent);padding:2px 0 2px 12px}
.stat .n{font-size:26px;font-weight:600;letter-spacing:-.01em}
.stat .k{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.stat .note{color:var(--dim);font-size:12px;margin-top:2px}
.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden;margin:10px 0 6px}
.bar>i{display:block;height:100%;background:var(--hold)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.hold{color:var(--hold);font-weight:600}.fail{color:var(--fail);font-weight:600}.manual{color:var(--manual);font-weight:600}
.miss{border-left:3px solid var(--manual);padding:10px 14px;background:color-mix(in srgb,var(--manual) 8%,transparent);border-radius:4px}
.prov{color:var(--dim);font-size:12px;margin-top:14px;border-top:1px dashed var(--line);padding-top:10px}
.tag{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 8px;font-size:11px;color:var(--dim);margin-left:6px}
.wrap{overflow-x:auto}
a{color:var(--accent)}
`;

function missBlock(m) {
  return `<div class="miss"><strong>${esc(m.what)}: ${esc(m.why)}</strong><div class="mono">looked for: ${esc(m.where)}</div>` +
    (m.how ? `<div>produce it with <code>${esc(m.how)}</code></div>` : "") +
    `<div style="color:var(--dim);margin-top:6px">Reported as a miss, not as a zero.</div></div>`;
}

/* CONVENTION, and it was a bug first: `n` and `note` are HTML, `k` is text. The first cut escaped
 * `n`, so every value wrapped in a colour span rendered as literal `&lt;span class=...` on the page.
 * Callers therefore pass numbers through nfmt/pct or wrap data in esc() themselves -- every value on
 * this page is either a formatted number or an esc()d string from an artifact. */
function statBlock(k, n, note) {
  return `<div class="stat"><div class="k">${esc(k)}</div><div class="n">${n}</div>${note ? `<div class="note">${note}</div>` : ""}</div>`;
}

function oneWordCard(ow) {
  if (ow.miss) return `<section class="card"><h2>ONE WORD PER FILE (R-ARCH-15)</h2>${missBlock(ow.miss)}</section>`;
  const share = ow.derivedCeiling ? (ow.oneWordFiles / ow.derivedCeiling) * 100 : 0;
  const rows = ow.residue.map((f) => `<tr><td class="mono">${esc(f.rel)}</td><td>${nfmt(f.bytes)}</td><td>${nfmt(f.outsideNonWs)}</td><td>${esc(f.cause)}</td></tr>`).join("");
  return `<section class="card"><h2>ONE WORD PER FILE (R-ARCH-15)</h2>
  <div class="grid">
    ${statBlock("one top word", `${nfmt(ow.oneWordFiles)} / ${nfmt(ow.files)}`, `${pct(ow.oneWordPct)} of all files`)}
    ${statBlock("against the ceiling", `${share.toFixed(1)}%`, `ceiling ${nfmt(ow.derivedCeiling)} — ${ow.emptyFiles.length} empty file(s) cannot carry a top word`)}
    ${statBlock("residue", nfmt(ow.residue.length), "every one classified below")}
  </div>
  <div class="bar"><i style="width:${Math.max(0, Math.min(100, share)).toFixed(2)}%"></i></div>
  <p class="sub" style="margin:0">${ow.ceilingAgrees
    ? `Ceiling <strong>${nfmt(ow.derivedCeiling)} of ${nfmt(ow.files)}</strong>, derived from the artifact and matching the recorded ${nfmt(ow.recordedCeiling.files)}/${nfmt(ow.recordedCeiling.of)} (${esc(ow.recordedCeiling.source)}).`
    : `<span class="fail">The derived ceiling (${nfmt(ow.derivedCeiling)} of ${nfmt(ow.files)}) DISAGREES with the recorded ${nfmt(ow.recordedCeiling.files)}/${nfmt(ow.recordedCeiling.of)} (${esc(ow.recordedCeiling.source)}).</span> One of the two is stale; this page will not pick for you.`}</p>
  <div class="wrap"><table><thead><tr><th>file</th><th>bytes</th><th>non-ws outside</th><th>why it is not one word</th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="prov">from <code>${esc(ow.where)}</code> — <code>perFile[].oneWord</code> and <code>reviewSurface</code>; the residue causes are read off each file's own counts, not from a list kept here.</div>
  </section>`;
}

function registerCard(reg) {
  if (reg.miss) return `<section class="card"><h2>REQUIREMENTS REGISTER</h2>${missBlock(reg.miss)}</section>`;
  const s = reg.j.summary, rows = reg.j.results;
  const notGreen = rows.filter((r) => r.verdict !== "HOLDS");
  const body = notGreen.map((r) => `<tr>
    <td class="${r.verdict === "FAILS" ? "fail" : "manual"}">${esc(r.verdict)}${r.deliberate ? '<span class="tag">on purpose</span>' : r.verdict === "FAILS" ? '<span class="tag" style="color:var(--fail);border-color:var(--fail)">unexplained</span>' : ""}</td>
    <td class="mono">${esc(r.id)}</td>
    <td>${esc(r.got || r.why || "")}${r.deliberate ? `<div style="color:var(--dim);margin-top:4px">${esc(r.deliberate)}</div>` : ""}${r.how ? `<div class="mono" style="margin-top:4px">→ ${esc(r.how)}</div>` : ""}</td></tr>`).join("");
  return `<section class="card"><h2>REQUIREMENTS REGISTER</h2>
  <div class="grid">
    ${statBlock("hold", `<span class="hold">${nfmt(s.holds)}</span>`, `of ${nfmt(s.mechanizedRows)} mechanized rows`)}
    ${statBlock("fail", `<span class="fail">${nfmt(s.fails)}</span>`, `${nfmt(s.failsDeliberate)} red on purpose · ${nfmt(s.failsRegression)} unexplained`)}
    ${statBlock("manual", `<span class="manual">${nfmt(s.manual)}</span>`, "MANUAL is not a pass")}
  </div>
  <p class="sub" style="margin:6px 0 12px">A row absent from the runner is not a row that holds — the register itself has more rows than these ${nfmt(s.mechanizedRows)}.</p>
  <div class="wrap"><table><thead><tr><th>verdict</th><th>row</th><th>evidence</th></tr></thead><tbody>${body}</tbody></table></div>
  <div class="prov">by RUNNING <code>node verify-register.js --json</code> at ${esc(reg.ranAt)} (exit ${esc(reg.exit)}) — the register has no on-disk artifact. Cached for 60s. That runner reads the tree and writes only under <code>os.tmpdir()</code>.</div>
  </section>`;
}

function surfaceCard(en, cov) {
  const rs = en.miss ? {} : (en.j.reviewSurface || {}), g = en.miss ? {} : (en.j.gate || {}), gen = en.miss ? {} : (en.j.generators || {});
  const covBlock = cov.miss
    ? missBlock(cov.miss)
    : `<div class="grid">${statBlock("corpus coverage", pct(cov.j.rollup && cov.j.rollup.coveragePct), `${nfmt(cov.j.rollup && cov.j.rollup.files)} files, byte-exact refill`)}
       ${statBlock("residue chars", nfmt(cov.j.rollup && ["A", "B", "C", "D"].reduce((t, k) => t + (cov.j.rollup.residueChars[k] || 0), 0)),
         cov.j.rollup ? Object.keys(cov.j.rollup.residueLegend).map((k) => `${k} ${esc(cov.j.rollup.residueLegend[k])}: ${nfmt(cov.j.rollup.residueChars[k])}`).join("<br>") : "")}</div>
       <div class="prov" style="border:0;padding:0;margin-top:8px">from <code>${esc(cov.where)}</code></div>`;
  if (en.miss) return `<section class="card"><h2>REVIEW SURFACE</h2>${missBlock(en.miss)}${covBlock}</section>`;
  return `<section class="card"><h2>REVIEW SURFACE</h2>
  <div class="grid">
    ${statBlock("top-level read", nfmt(rs.reviewSurfaceTop), "what a reader sees first")}
    ${statBlock("whole-tree read", nfmt(rs.reviewSurface), typeof rs.reviewSurface === "number" && rs.reviewSurfaceTop ? `${(rs.reviewSurface / rs.reviewSurfaceTop).toFixed(1)}× the top read` : "")}
    ${statBlock("statements", `${nfmt(rs.collapsedStatements)} / ${nfmt(rs.bodyStatements)}`, `${pct(rs.collapseRatioPct)} collapse ratio · ${nfmt(rs.verbatimStatements)} verbatim`)}
    ${statBlock("byte-identity", `${nfmt(g.byteIdentical)} / ${nfmt(g.totalFiles)}`, g.allByteIdentical ? "the floor holds (R-REND-1)" : '<span class="fail">the floor is BROKEN</span>')}
  </div>
  <p class="sub" style="margin:6px 0 0">Both reads, side by side, never one alone (R-MEAS-10): the top-level number is the first read, the whole-tree number is every nested chunk down to leaves — ${nfmt(rs.chunks)} chunks, ${nfmt(rs.chunksAtomic)} atomic and ${nfmt(rs.chunksStructural)} structural, deepest nest ${nfmt(rs.nestMaxDepth)}. Words compose to depth ${nfmt(gen.maxDepth)}.</p>
  <div class="prov">from <code>${esc(en.where)}</code>, generated ${esc(en.j.generated)}, fingerprint <code>${esc(String(en.j.fingerprint).slice(0, 16))}</code></div>
  ${covBlock}
  </section>`;
}

function dictCard(d) {
  if (d.miss) return `<section class="card"><h2>DICTIONARY</h2>${missBlock(d.miss)}</section>`;
  return `<section class="card"><h2>DICTIONARY</h2>
  <div class="grid">
    ${statBlock("artifact size", `${(d.bytes / 1048576).toFixed(1)} MB`, `mined ${esc(d.generated || "(no date)")}`)}
    ${statBlock("fingerprint", `<span class="mono">${esc(String(d.fingerprint).slice(0, 16))}</span>`, "the stamp over the body")}
    ${statBlock("declares corpus", `<span class="mono" style="font-size:12px">${esc(path.basename(String(d.corpus || "—")))}</span>`, esc(d.corpus || ""))}
  </div>
  <div class="prov">HEADER ONLY, from the first 8 KB of <code>${esc(d.where)}</code> — the body is tens of megabytes and no number here needs it. Last written ${esc(d.mtime)}.</div>
  </section>`;
}

function page(m) {
  const reg = m.register;
  const banner = !reg.miss && reg.j.summary.failsRegression > 0
    ? `<div class="card" style="border-color:var(--fail)"><strong class="fail">${reg.j.summary.failsRegression} register row(s) fail with no recorded reason.</strong> A red that is not argued for is a regression, not a known gap.</div>` : "";
  return `<title>sdd-engine — reporting</title><style>${CSS}</style><main>
  <h1>sdd-engine — reporting</h1>
  <p class="sub">Read-only. This page reads published artifacts and renders them; it has no write path, no action buttons and no POST route. Mining, naming, rendering and cleaning stay in the CLI — the <code>.en</code> → <code>.ts</code> direction of truth is an open question (R-PAY-6, CLAUDE.md §6) and a page that could act would answer it by accident.<br>
  SOURCE <code>${esc(m.roots.source)}</code><br>CORPUS <code>${esc(m.roots.corpus)}</code><br>read at ${esc(m.generated)} · <a href="/">refresh</a> · <a href="/api.json">api.json</a></p>
  ${banner}
  ${oneWordCard(m.oneWord)}
  ${registerCard(reg)}
  ${surfaceCard(m.en, m.coverage)}
  ${dictCard(m.dictionary)}
  <p class="sub">Every panel above is either a number read from a published artifact or a named miss saying what was looked for and where. None of it is computed by eye (R-MEAS-1).</p>
  </main>`;
}

/* ---------- serve, or print once ---------- */

if (ONCE) {
  const m = model();
  process.stdout.write(AS_JSON ? JSON.stringify(m, null, 2) + "\n" : page(m));
  process.exit(0);
}

const server = http.createServer((req, res) => {
  /* THE ONLY METHODS THAT EXIST. Not defence in depth -- a statement of what this surface is. */
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
    return res.end("405 — this is a reporting surface. It has no write path: mine, render, name and clean run from the CLI.\n");
  }
  const url = (req.url || "/").split("?")[0];
  const send = (code, type, body) => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  if (url === "/") return send(200, "text/html; charset=utf-8", page(model()));
  if (url === "/api.json") return send(200, "application/json; charset=utf-8", JSON.stringify(model(), null, 2) + "\n");
  if (url === "/health") return send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, readOnly: true }) + "\n");
  send(404, "text/plain; charset=utf-8", `404 — this server serves /, /api.json and /health, and nothing else.\n`);
});

server.listen(PORT, HOST, () => {
  console.log(`report-server: http://${HOST}:${PORT}  (read-only; GET only)`);
  console.log(`  SOURCE ${safe(() => CR.sourceRoot())}`);
  console.log(`  CORPUS ${safe(() => CR.corpusRoot())}`);
  if (NO_REGISTER) console.log("  register panel: SKIPPED (--no-register)");
});
server.on("error", (e) => {
  console.error(`report-server REFUSED: cannot listen on ${HOST}:${PORT} — ${e.code === "EADDRINUSE" ? "already in use (another report-server? pass --port)" : e.message}`);
  process.exit(2);
});
