// What the operators need to know about the repository under test, read from the environment
// run.mjs sets for each test process (module hooks and --import files take no arguments).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const list = v => String(v || '').split(',').map(x => x.trim().replace(/^\.?\/+|\/+$/g, '')).filter(Boolean);

// The repository root, as a path with a trailing separator and as a file: URL with a trailing /.
export const REPO_DIR = path.resolve(process.env.SUBJECT_MUTATION_REPO || process.cwd()) + path.sep;
export const REPO_URL = pathToFileURL(REPO_DIR).href;
// Folders (relative to the root) whose modules are SUBJECTS for M1.
export const SUBJECT_DIRS = list(process.env.SUBJECT_MUTATION_SUBJECTS || 'lib,bin,tools,src');
// The folder test files live in.
export const TESTS_DIR = list(process.env.SUBJECT_MUTATION_TESTS_DIR || 'tests')[0];

const TEST_FILE = /\.test\.[cm]?js$/;
const fwd = p => p.replace(/\\/g, '/');
const under = (rel, dir) => rel === dir || rel.startsWith(dir + '/');

// A path relative to the root (forward slashes), or null when it is outside the root.
export function relOf(p) {
  let s;
  try { s = p instanceof URL || (typeof p === 'string' && p.startsWith('file:')) ? fileURLToPath(p) : typeof p === 'string' ? path.resolve(p) : null; } catch { return null; }
  if (!s || !(s + path.sep).startsWith(REPO_DIR)) return null;
  return fwd(s.slice(REPO_DIR.length));
}
export const isTestRel = rel => rel != null && under(rel, TESTS_DIR) && TEST_FILE.test(rel);
export const isSubjectModuleRel = rel => rel != null && SUBJECT_DIRS.some(d => under(rel, d)) && /\.(m?js|cjs)$/.test(rel) && !/(^|\/)node_modules\//.test(rel);
// M2: any source file of the repository — everything but the tests, dependencies and git's own files.
export const isSourceRel = rel => !!rel && !under(rel, TESTS_DIR) && !/(^|\/)node_modules(\/|$)/.test(rel) && !under(rel, '.git');
