// prove-guards against a throwaway project whose guards are small node scripts: a real guard
// is PROVEN, a guard that cannot fail and a guard that is already red are NOT, and whatever
// happens the tree ends byte-for-byte as it started. `node --test tests/prove-guards.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'prove-guards.mjs');
const NODE = process.execPath;

// Guards: each exits 1 with a message when its rule is broken.
const GUARDS = {
  'guards/no-pem.js': 'const fs=require("fs");const bad=fs.readdirSync("src").filter(f=>f.endsWith(".pem"));if(bad.length){console.error("FAIL secret file: "+bad);process.exit(1)}console.log("ok no secret files");\n',
  'guards/line-limit.js': 'const fs=require("fs");for(const f of fs.readdirSync("src")){const n=fs.readFileSync("src/"+f,"utf8").split("\\n").length-1;if(n>300){console.error("FAIL "+f+" has "+n+" lines");process.exit(1)}}console.log("ok line limit");\n',
  'guards/no-debug.js': 'if(/debug: true/.test(require("fs").readFileSync("src/config.js","utf8"))){console.error("FAIL debug is on");process.exit(1)}console.log("ok debug off");\n',
  'guards/ignore.js': 'if(/^data\\/$/m.test(require("fs").readFileSync(".gitignore","utf8"))){console.error("FAIL data/ is ignored");process.exit(1)}console.log("ok ignore rules");\n',
  'guards/note.js': 'if(!require("fs").existsSync("notes/branch.md")){console.error("FAIL no change note");process.exit(1)}console.log("ok note present");\n',
  'guards/hollow.js': 'console.log("ok (checks nothing)");\n',
  'guards/broken.js': 'console.error("FAIL always");process.exit(1);\n',
};
const PROOFS = {
  pem: { guard: 'secret file', run: [NODE, 'guards/no-pem.js'], plant: { create: 'src/server.pem', text: 'not really a key\n' } },
  lines: { guard: 'line limit', run: [NODE, 'guards/line-limit.js'], plant: { create: 'src/too-long.js', text: '//\n', repeat: 301 } },
  debug: { guard: 'no debug', run: [NODE, 'guards/no-debug.js'], plant: { replace: 'src/config.js', find: 'debug: false', with: 'debug: true' } },
  ignore: { guard: 'ignored source', run: [NODE, 'guards/ignore.js'], plant: { append: '.gitignore', text: 'data/\n' } },
  note: { guard: 'change note', run: [NODE, 'guards/note.js'], plant: { absent: 'notes/branch.md', text: 'bump: patch\n' } },
  hollow: { guard: 'hollow', run: [NODE, 'guards/hollow.js'], plant: { create: 'src/server.pem', text: 'x\n' } },
  broken: { guard: 'broken', run: [NODE, 'guards/broken.js'], plant: { append: '.gitignore', text: 'x\n' } },
};

function snapshot(root) {
  const out = [];
  const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) { out.push(`D ${path.relative(root, p)}`); walk(p); } else out.push(`F ${path.relative(root, p)} ${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')}`); } };
  walk(root);
  return out;
}
function project(t, proofs, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prove-guards-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = { ...GUARDS, 'src/config.js': 'module.exports = { debug: false };\n', 'src/a.js': '// a\n', '.gitignore': 'node_modules/\n', ...extra };
  if (proofs) files['prove-guards.json'] = JSON.stringify({ evidence: 'FAIL|ok', proofs });
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
  return { dir, run: (...args) => spawnSync(NODE, [CLI, ...args], { cwd: dir, encoding: 'utf8' }) };
}

test('every kind of plant proves a real guard: red with the violation, green without, and the tree is unchanged', (t) => {
  const p = project(t, [PROOFS.pem, PROOFS.lines, PROOFS.debug, PROOFS.ignore, PROOFS.note]);
  const before = snapshot(p.dir);
  const r = p.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.match(/: PROVEN$/gm).length, 5);
  assert.match(r.stdout, /## secret file: PROVEN\nplanted: add src\/server\.pem\ncommand: .*no-pem\.js\nRED {3}exit=1 {2}FAIL secret file: server\.pem\nGREEN exit=0 {2}ok no secret files/);
  assert.match(r.stdout, /RED {3}exit=1 {2}FAIL too-long\.js has 301 lines/);
  assert.match(r.stdout, /## change note: PROVEN\nplanted: run without notes\/branch\.md \(green adds it\)/);
  assert.match(r.stdout, /every guard went red with its violation and green without it \(5\/5\)/);
  assert.deepEqual(snapshot(p.dir), before, 'a planted file, an edit or a created folder was left behind');
});

test('a guard that stays green with the violation planted is NOT PROVEN, and the run fails', (t) => {
  const p = project(t, [PROOFS.pem, PROOFS.hollow]);
  const before = snapshot(p.dir);
  const r = p.run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /## secret file: PROVEN/);
  assert.match(r.stdout, /## hollow: NOT PROVEN[\s\S]*why: the guard stayed GREEN with the violation planted/);
  assert.match(r.stdout, /prove:guards: FAIL/);
  assert.deepEqual(snapshot(p.dir), before);
});

test('a guard that is red without the violation is NOT PROVEN: its red run proves nothing', (t) => {
  const p = project(t, [PROOFS.broken]);
  const r = p.run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /## broken: NOT PROVEN[\s\S]*why: the guard is RED without the violation/);
});

test('a guard command that cannot be started is NOT PROVEN, not counted as a red run', (t) => {
  const p = project(t, [{ guard: 'missing tool', run: ['no-such-guard-binary-xyz'], plant: { create: 'src/x.pem', text: 'x' } }]);
  const before = snapshot(p.dir);
  const r = p.run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /NOT PROVEN[\s\S]*why: the guard command could not be run at all/);
  assert.deepEqual(snapshot(p.dir), before);
});

test('it refuses to overwrite an existing file, and a replace target must be one exact place', (t) => {
  const p = project(t, [PROOFS.pem, PROOFS.debug], { 'src/server.pem': 'a real file\n', 'src/config.js': 'a = { debug: false }; b = { debug: false };\n' });
  const before = snapshot(p.dir);
  const r = p.run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /could not plant: refusing to overwrite existing src\/server\.pem/);
  assert.match(r.stdout, /could not plant: src\/config\.js contains "debug: false" more than once/);
  assert.equal(fs.readFileSync(path.join(p.dir, 'src/server.pem'), 'utf8'), 'a real file\n');
  assert.deepEqual(snapshot(p.dir), before);
});

test('an empty proof list, a missing config and a bad proof are refusals (exit 2), never a pass', (t) => {
  assert.equal(project(t, []).run().status, 2);
  assert.match(project(t, []).run().stderr, /lists no proofs/);
  assert.equal(project(t, null).run().status, 2);
  const escape = project(t, [{ guard: 'x', run: [NODE, 'guards/hollow.js'], plant: { create: '../outside.txt', text: 'x' } }]).run();
  assert.equal(escape.status, 2);
  assert.match(escape.stderr, /is outside/);
  const two = project(t, [{ guard: 'x', run: [NODE, 'g.js'], plant: { create: 'a', append: 'b', text: 'x' } }]).run();
  assert.match(two.stderr, /needs exactly one of create, append, replace, absent/);
  const dup = project(t, [PROOFS.pem, PROOFS.pem]).run();
  assert.match(dup.stderr, /two proofs are named "secret file"/);
});

test('--only runs the named proofs; a name that matches nothing is an error, not zero proofs passing', (t) => {
  const p = project(t, [PROOFS.pem, PROOFS.hollow]);
  const one = p.run('--only', 'secret file');
  assert.equal(one.status, 0, one.stdout);
  assert.match(one.stdout, /\(1\/1\)/);
  assert.doesNotMatch(one.stdout, /hollow/);
  const none = p.run('--only', 'secret flie');
  assert.equal(none.status, 2);
  assert.match(none.stderr, /matches no proof/);
  assert.match(p.run('--list').stdout, /^secret file\tadd src\/server\.pem\t/);
});

test('interrupted while a violation is planted, it takes the violation out before exiting', async (t) => {
  const slow = 'require("fs").writeFileSync("started","x");setTimeout(()=>process.exit(1),4000);\n';
  const p = project(t, [{ guard: 'slow', run: [NODE, 'guards/slow.js'], plant: { append: '.gitignore', text: 'planted\n' } }], { 'guards/slow.js': slow });
  const child = spawn(NODE, [CLI], { cwd: p.dir, stdio: 'ignore' });
  const exited = new Promise(res => child.on('exit', res));
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(path.join(p.dir, 'started')) && Date.now() < deadline) await new Promise(res => setTimeout(res, 50));
  assert.match(fs.readFileSync(path.join(p.dir, '.gitignore'), 'utf8'), /planted/, 'the violation is in place while the guard runs');
  child.kill('SIGTERM');
  await exited;
  assert.equal(fs.readFileSync(path.join(p.dir, '.gitignore'), 'utf8'), 'node_modules/\n');
});
