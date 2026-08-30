#!/usr/bin/env node
"use strict";
/**
 * name-generators.js — the LLM gloss-naming pass (worksheet + apply), correctness-irrelevant.
 *
 * The multi-line generator span in a .en file is «▶ <gloss> ⟪base64({g,h})⟫». Only the payload
 * {g,h} is used to COMPILE back to .ts; the gloss between ▶ and ⟪ is a human LABEL the compiler
 * never reads. So renaming the gloss cannot change what compiles — the byte-exact gate is
 * untouched. This tool (a) emits a WORKSHEET of the generators actually used in the .en (ranked
 * by impact) with their structural gloss + a real source snippet, for an LLM to propose DOMAIN
 * phrases (names only); and (b) APPLIES a {id -> name} map into catalog/generators.json as a new
 * `name` field (key/id/gloss untouched). enfile.js renders `g.name || g.gloss`, so re-running
 * write-en-files.js after apply swaps the domain phrase into the .en, re-verifying 1038/1038.
 *
 *   node name-generators.js worksheet [--wide-only] [--top N]   -> writes name-worksheet.json
 *   node name-generators.js apply <names.json>                  -> patches catalog `name` fields
 * Deterministic scaffolding; the naming itself is the single LLM pass (author fills names.json).
 */
const fs = require("fs");
const path = require("path");
const G = require("./engine/generators");

const CORPUS = process.env.HYDRA_CORPUS || "/home/amir/Documents/Rentsync/delonix/hydra-source";
const CATALOG = path.join(CORPUS, "catalog", "generators.json");
const EN_ROOT = path.join(CORPUS, "spec", "files");
const WORKSHEET = path.join(__dirname, "name-worksheet.json");

const walkEn = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkEn(p, o); else if (p.endsWith(".en")) o.push(p); } return o; };

/* scan every .en span: id -> {count, sampleHoles} (first site's holes give a real snippet via refill) */
function scanUsage() {
  const use = new Map();
  for (const f of walkEn(EN_ROOT)) {
    const s = fs.readFileSync(f, "utf8");
    const re = /⟪([A-Za-z0-9+/=]+)⟫/g; let m;
    while ((m = re.exec(s))) {
      let g, h; try { ({ g, h } = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"))); } catch { continue; }
      if (!g) continue;
      let u = use.get(g); if (!u) { u = { count: 0, holes: h }; use.set(g, u); }
      u.count++;
    }
  }
  return use;
}

function worksheet(args) {
  const wideOnly = args.includes("--wide-only");
  const topIx = args.indexOf("--top"); const top = topIx >= 0 ? parseInt(args[topIx + 1], 10) : Infinity;
  const cat = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const byId = new Map(cat.generators.map((g) => [g.id, g]));
  const use = scanUsage();
  const rows = [];
  for (const [id, u] of use) {
    const g = byId.get(id); if (!g) continue;
    if (wideOnly && g.level !== "opw") continue;
    let snippet = null; try { snippet = G.refill(g.key, u.holes); } catch { snippet = "(refill failed)"; }
    rows.push({ id, level: g.level, k: g.k, calls: u.count, statements: g.k * u.count, gloss: g.gloss, snippet });
  }
  // impact rank: statements collapsed desc, then calls desc
  rows.sort((a, b) => (b.statements - a.statements) || (b.calls - a.calls));
  const chosen = rows.slice(0, top);
  const out = { corpus: path.basename(CORPUS), builtFrom: CATALOG, totalUsed: rows.length, emitted: chosen.length, wideOnly, note: "LLM proposes `name` (domain phrase, label only). Correctness-irrelevant; byte gate untouched.", rows: chosen };
  fs.writeFileSync(WORKSHEET, JSON.stringify(out, null, 1));
  console.log(`worksheet: ${rows.length} used generators; emitted ${chosen.length} -> ${WORKSHEET}`);
  const wide = rows.filter((r) => r.level === "opw");
  console.log(`  wide (middle-tier) used: ${wide.length}; wide calls: ${wide.reduce((s, r) => s + r.calls, 0)}`);
  // Zipf head: how many wide cover 80% of wide calls
  const wc = wide.reduce((s, r) => s + r.calls, 0); let acc = 0, n = 0;
  for (const r of wide) { acc += r.calls; n++; if (acc >= 0.8 * wc) break; }
  console.log(`  wide Zipf head: ${n} generators cover 80% of wide calls`);
}

function apply(namesPath) {
  const names = JSON.parse(fs.readFileSync(namesPath, "utf8")); // { id: "domain phrase", ... }
  const cat = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  let n = 0;
  for (const g of cat.generators) {
    if (Object.prototype.hasOwnProperty.call(names, g.id)) {
      const nm = names[g.id];
      if (/[«»▶⟪⟫]/.test(nm)) throw new Error(`name for ${g.id} contains a reserved delimiter: ${nm}`);
      g.name = nm; n++;
    }
  }
  cat.naming = { ...(cat.naming || {}), generatorNamesApplied: n, namingModelCalls: 1 };
  fs.writeFileSync(CATALOG, JSON.stringify(cat, null, 1));
  console.log(`apply: set \`name\` on ${n} generators -> ${CATALOG}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "worksheet") worksheet(rest);
else if (cmd === "apply") apply(rest[0]);
else { console.error("usage: name-generators.js worksheet [--wide-only] [--top N] | apply <names.json>"); process.exit(2); }
