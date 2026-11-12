#!/usr/bin/env node
// Show that each guard can actually fail. For every guard it plants one violation, runs the
// guard (expecting RED), removes the violation, and runs it again (expecting GREEN). A guard
// is PROVEN only by both. Every planted change is undone in a `finally` (and on SIGINT /
// SIGTERM), and the run ends by checking that each touched file is byte-for-byte what it was.
//
//   prove-guards.mjs [--config <file>] [--only <guard>]... [--list]
//
// The proofs are data, in prove-guards.json at the directory it runs in (or --config):
//
//   { "evidence": "FAIL|✖|error",               optional: regex choosing which output lines to quote
//     "proofs": [
//       { "guard": "line limit",
//         "run": ["node", "--test", "tests/guards/line-limit.test.js"],
//         "plant": { "create": "src/too-long.js", "text": "//\n", "repeat": 301 } },
//       { "guard": "generated drift", "run": [...], "plant": { "append": "src/generated/enums.js", "text": "// hand edit\n" } },
//       { "guard": "no debug flag",   "run": [...], "plant": { "replace": "src/config.js", "find": "debug: false", "with": "debug: true" } },
//       { "guard": "changes note",    "run": [...], "plant": { "absent": ".changes/my-branch.md", "text": "bump: patch\n" } } ] }
//
//   create   add a file that must not exist yet (refuses to overwrite one)
//   append   add text to the end of an existing file
//   replace  swap one exact, unique piece of text in an existing file
//   absent   the violation is that the file is MISSING: red runs without it, green runs with it
//            written, and it is removed again afterwards
//
// Exit 0: every guard went red with its violation and green without it. Exit 1: a guard was
// not proven, or the tree could not be put back. Exit 2: bad usage or a bad config.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const bad = (msg) => { console.error(`prove-guards: ${msg}`); process.exit(2); };
const argv = process.argv.slice(2);
let configPath = 'prove-guards.json', list = false;
const only = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--list') list = true;
  else if (a === '--config' || a === '--only') {
    if (argv[i + 1] === undefined) bad(`${a} needs a value`);
    if (a === '--config') configPath = argv[++i]; else only.push(argv[++i]);
  } else bad(`unknown argument ${a}`);
}

let config;
try { config = JSON.parse(fs.readFileSync(path.resolve(root, configPath), 'utf8')); }
catch (e) { bad(`cannot read ${configPath}: ${e.message}`); }
if (!config || !Array.isArray(config.proofs)) bad(`${configPath} must be { "proofs": [...] }`);
// AN EMPTY LIST IS NOT A PASS: "every guard proven" over zero guards proves nothing.
if (!config.proofs.length) bad(`${configPath} lists no proofs — there is nothing to prove, which is not a pass`);
let evidenceRe = null;
if (config.evidence !== undefined) { try { evidenceRe = new RegExp(config.evidence); } catch (e) { bad(`"evidence" is not a regex: ${e.message}`); } }

// A planted path stays inside the directory the tool runs in.
function inside(rel, where) {
  if (typeof rel !== 'string' || !rel) bad(`${where}: needs a file path`);
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) bad(`${where}: ${rel} is outside ${root}`);
  return abs;
}
const KINDS = ['create', 'append', 'replace', 'absent'];
const seenNames = new Set();
const proofs = config.proofs.map((p, i) => {
  const where = `proofs[${i}]${p && typeof p.guard === 'string' ? ` (${p.guard})` : ''}`;
  if (!p || typeof p.guard !== 'string' || !p.guard.trim()) bad(`${where}: needs a "guard" name`);
  if (seenNames.has(p.guard)) bad(`${where}: two proofs are named ${JSON.stringify(p.guard)}`);
  seenNames.add(p.guard);
  if (!Array.isArray(p.run) || !p.run.length || !p.run.every(s => typeof s === 'string' && s)) bad(`${where}: "run" must be a command as a list of strings`);
  const plant = p.plant;
  const kinds = plant && typeof plant === 'object' ? KINDS.filter(k => k in plant) : [];
  if (kinds.length !== 1) bad(`${where}: "plant" needs exactly one of ${KINDS.join(', ')}`);
  const kind = kinds[0];
  const file = inside(plant[kind], where);
  if (kind === 'replace') {
    if (typeof plant.find !== 'string' || !plant.find || typeof plant.with !== 'string') bad(`${where}: replace needs "find" and "with"`);
  } else if (typeof plant.text !== 'string' || !plant.text) bad(`${where}: ${kind} needs "text"`);
  const repeat = plant.repeat === undefined ? 1 : plant.repeat;
  if (!Number.isInteger(repeat) || repeat < 1) bad(`${where}: "repeat" must be a positive whole number`);
  const text = kind === 'replace' ? null : plant.text.repeat(repeat);
  const label = { create: `add ${plant[kind]}`, append: `append to ${plant[kind]}`, replace: `in ${plant[kind]}, replace ${JSON.stringify(plant.find)} with ${JSON.stringify(plant.with)}`, absent: `run without ${plant[kind]} (green adds it)` }[kind];
  return { guard: p.guard, run: p.run, kind, file, rel: plant[kind], text, find: plant.find, with: plant.with, label: typeof p.note === 'string' ? p.note : label };
});
for (const name of only) if (!seenNames.has(name)) bad(`--only ${JSON.stringify(name)} matches no proof (have: ${[...seenNames].join(', ')})`);
const chosen = only.length ? proofs.filter(p => only.includes(p.guard)) : proofs;
if (list) { for (const p of chosen) console.log(`${p.guard}\t${p.label}\t${p.run.join(' ')}`); process.exit(0); }

const hashOf = (file) => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

// What a plant does to the tree, and how it is taken out again. `madeDirs` are folders that
// did not exist before a file was planted in them; they are removed again, innermost first.
function planter(p) {
  const madeDirs = [];
  const writeNew = () => {
    for (let d = path.dirname(p.file); !fs.existsSync(d); d = path.dirname(d)) madeDirs.push(d);
    fs.mkdirSync(path.dirname(p.file), { recursive: true });
    fs.writeFileSync(p.file, p.text, { flag: 'wx' });
  };
  const removeNew = () => {
    fs.rmSync(p.file, { force: true });
    for (const d of madeDirs.splice(0)) { try { fs.rmdirSync(d); } catch {} }
  };
  if (p.kind === 'create' || p.kind === 'absent') {
    if (fs.existsSync(p.file)) throw new Error(`refusing to overwrite existing ${p.rel}`);
    return p.kind === 'create'
      ? { apply: writeNew, revert: removeNew, cleanup: () => {} }
      : { apply: () => {}, revert: writeNew, cleanup: removeNew };
  }
  const original = fs.readFileSync(p.file);
  const restore = () => fs.writeFileSync(p.file, original);
  if (p.kind === 'append') return { apply: () => fs.writeFileSync(p.file, Buffer.concat([original, Buffer.from(p.text)])), revert: restore, cleanup: () => {} };
  const text = original.toString('utf8');
  const at = text.indexOf(p.find);
  if (at < 0) throw new Error(`${p.rel} does not contain ${JSON.stringify(p.find)}`);
  if (text.indexOf(p.find, at + 1) >= 0) throw new Error(`${p.rel} contains ${JSON.stringify(p.find)} more than once; the plant must be one exact place`);
  return { apply: () => fs.writeFileSync(p.file, text.slice(0, at) + p.with + text.slice(at + p.find.length)), revert: restore, cleanup: () => {} };
}

function run(cmd) {
  const out = spawnSync(cmd[0], cmd.slice(1), { cwd: root, encoding: 'utf8' });
  if (out.error) return { code: -1, evidence: `could not run: ${out.error.message}`, spawnFailed: true };
  const lines = `${out.stdout}${out.stderr}`.split('\n').map(l => l.trim()).filter(Boolean);
  const picked = evidenceRe ? lines.filter(l => evidenceRe.test(l)).slice(0, 4) : lines.slice(-3);
  return { code: out.status ?? -1, evidence: picked.join(' | ').slice(0, 400) };
}

// Whatever is planted right now, so a signal can take it out before the process dies.
let active = null;
const undoActive = () => { if (active) { try { active.revert(); } catch {} try { active.cleanup(); } catch {} active = null; } };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { undoActive(); process.exit(130); });

let allProven = true;
const unrestored = [];
for (const p of chosen) {
  const before = hashOf(p.file);
  let red = null, green = null, problem = null;
  try {
    const plant = planter(p);
    active = { revert: p.kind === 'absent' ? () => {} : plant.revert, cleanup: plant.cleanup };
    try {
      plant.apply();
      red = run(p.run);
    } finally {
      plant.revert();                       // for `absent`, this is what ADDS the file
      if (p.kind === 'absent') active = { revert: () => {}, cleanup: plant.cleanup };
    }
    try { green = run(p.run); } finally { plant.cleanup(); active = null; }
  } catch (e) {
    undoActive();
    problem = e.message;
  }
  if (hashOf(p.file) !== before) unrestored.push(p.rel);
  // A command that could not start is not a red guard: it would "fail" with or without the plant.
  const proven = !problem && !red.spawnFailed && red.code !== 0 && green.code === 0;
  allProven &&= proven;
  console.log(`\n## ${p.guard}: ${proven ? 'PROVEN' : 'NOT PROVEN'}`);
  console.log(`planted: ${p.label}`);
  console.log(`command: ${p.run.join(' ')}`);
  if (problem) { console.log(`could not plant: ${problem}`); continue; }
  console.log(`RED   exit=${red.code}  ${red.evidence}`);
  console.log(`GREEN exit=${green.code}  ${green.evidence}`);
  if (!proven) {
    console.log(red.spawnFailed ? 'why: the guard command could not be run at all'
      : red.code === 0 ? 'why: the guard stayed GREEN with the violation planted — it cannot catch this'
      : 'why: the guard is RED without the violation — it is failing for another reason, so the red run proves nothing');
  }
}

if (unrestored.length) {
  console.log(`\nprove:guards: FAIL — not restored to what it was: ${unrestored.join(', ')}`);
  process.exit(1);
}
console.log(`\nprove:guards: ${allProven ? `every guard went red with its violation and green without it (${chosen.length}/${chosen.length})` : 'FAIL'}`);
process.exit(allProven ? 0 : 1);
