// M2: in a test process, every read of a repository source file (anything outside the tests
// folder, node_modules/ and .git) returns empty. Only the test process is affected: a server or
// script it spawns reads the real files, so a subject that runs in a child is NOT mutated by M2
// and its tests survive by construction.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { relOf, isTestRel, isSourceRel } from './config.mjs';

if (isTestRel(relOf(process.argv[1] || ''))) {
  const subject = p => { const rel = p instanceof URL || typeof p === 'string' ? relOf(p) : null; return isSourceRel(rel); };
  const empty = opts => (typeof opts === 'string' || opts?.encoding) ? '' : Buffer.alloc(0);
  const rfs = fs.readFileSync;
  fs.readFileSync = function (p, opts) { return subject(p) ? empty(opts) : rfs.apply(this, arguments); };
  const rf = fs.promises.readFile;
  fs.promises.readFile = function (p, opts) { return subject(p) ? Promise.resolve(empty(opts)) : rf.apply(this, arguments); };
  syncBuiltinESMExports();   // named imports (`import { readFileSync }`) see the patch too
}
