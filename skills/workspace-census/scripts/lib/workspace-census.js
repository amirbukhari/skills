// A REPORT-ONLY census of what coding agents left outside the places a workspace gives them.
// It changes nothing, and its report makes no recommendation about any item: it states the
// path, the size, when it was last modified, and the evidence for who made it, and leaves
// every decision to the user. That is a hard property, not a style choice: the tests assert
// a run leaves the scanned tree byte-identical and that the report carries no advice.
//
// Four sections, each from a different source of evidence:
//   1. worktrees      `git worktree list` of every repo a Claude profile knows, minus those
//                     under <repo>/<worktrees dir>/ (the sanctioned place).
//   2. agent writes   paths Claude's own transcripts show an agent writing (Write/Edit targets,
//                     and the targets of mkdir, git clone, git worktree add, cp/mv/rsync, tee
//                     and `>` in Bash commands), rolled up to the folder the agent introduced,
//                     minus anything inside a repo, the temp dir, a profile or a managed place.
//   3. repo roots     untracked, un-ignored entries at the top of each known repo.
//   4. temp dir       entries in the OS temp dir owned by this user, grouped by name pattern.
//
// Never walked or reported: the caller's managed locations (state a tool keeps on purpose)
// and anything the caller excludes.
//
// Pure: fs, git and the transcript lines are injected; workspace-census.mjs does the I/O.
import path from 'node:path';

export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

// ---- profiles and known repos -------------------------------------------------------------

// Claude config dirs: ~/.claude plus sibling ~/.claude* dirs that look like one.
export function profileDirs(fs, home) {
  const out = [path.join(home, '.claude')];
  let names = [];
  try { names = fs.readdirSync(home); } catch {}
  for (const n of names.sort()) {
    if (!n.startsWith('.claude') || n === '.claude') continue;
    const dir = path.join(home, n);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      if (fs.existsSync(path.join(dir, '.claude.json')) || fs.existsSync(path.join(dir, 'projects'))) out.push(dir);
    } catch {}
  }
  return out;
}

// Every folder a profile has run Claude in (the `projects` keys of its .claude.json).
export function knownProjectDirs(fs, home, profiles) {
  const files = new Set([path.join(home, '.claude.json'), ...profiles.map(p => path.join(p, '.claude.json'))]);
  const dirs = new Set();
  for (const f of files) {
    let j;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    for (const k of Object.keys(j?.projects || {})) if (path.isAbsolute(k)) dirs.add(path.resolve(k));
  }
  return [...dirs].sort();
}

// The main checkout that owns `dir`, walking up to the nearest .git. A .git FILE names a git
// dir elsewhere: a linked worktree (the main checkout owns the common dir), a submodule or
// --separate-git-dir checkout (the folder holding the file IS the checkout), or a linked
// worktree of a submodule (core.worktree in the common dir names the checkout).
// Returns { root, gitDir } (gitDir = the COMMON git dir) or null outside a git checkout.
export function findRepo(fs, dir) {
  let cur = path.resolve(dir);
  for (;;) {
    const dotGit = path.join(cur, '.git');
    let st = null;
    try { st = fs.statSync(dotGit); } catch {}
    if (st?.isDirectory()) return { root: cur, gitDir: dotGit };
    if (st?.isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(String(fs.readFileSync(dotGit, 'utf8')));
      if (!m) return null;
      const linked = path.resolve(cur, m[1]);
      if (path.basename(path.dirname(linked)) !== 'worktrees') return { root: cur, gitDir: linked };
      const common = path.dirname(path.dirname(linked));
      if (path.basename(common) === '.git') return { root: path.dirname(common), gitDir: common };
      let cfg = '';
      try { cfg = String(fs.readFileSync(path.join(common, 'config'), 'utf8')); } catch {}
      const wt = /^\s*worktree\s*=\s*(.+?)\s*$/m.exec(cfg);
      return { root: wt ? path.resolve(common, wt[1]) : cur, gitDir: common };
    }
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

// ---- worktrees ------------------------------------------------------------------------------

export function parseWorktreeList(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null, detached: false, bare: false }; out.push(cur); }
    else if (!cur) continue;
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'bare') cur.bare = true;
  }
  return out;
}

// The linked worktrees of one repo that are NOT under <main>/<worktrees dir>/. The first entry
// of `git worktree list` is always the main checkout.
// `managed` lists locations a tool itself keeps worktrees in (preview checkouts, say): those
// are that tool's state, not something an agent left.
export function worktreesOutside(list, managed = [], worktreesDir = '.worktrees') {
  if (!list.length) return [];
  const main = list[0].path;
  const home = path.join(main, worktreesDir);
  return list.slice(1)
    .filter(w => !w.bare && !isInside(w.path, home) && !managed.some(m => isInside(w.path, m)))
    .map(w => ({ ...w, repo: main }));
}

// ---- repo roots -----------------------------------------------------------------------------

// `git status --porcelain=v1 -z --untracked-files=normal` → the untracked entries at the root,
// minus the worktrees dir itself (the sanctioned place, whether or not it is ignored yet).
export function untrackedAtRoot(porcelainZ, worktreesDir = '.worktrees') {
  return String(porcelainZ).split('\0')
    .filter(e => e.startsWith('?? '))
    .map(e => e.slice(3).replace(/\/$/, ''))
    .filter(p => p && !p.includes('/') && p !== worktreesDir);
}

// ---- temp dir ---------------------------------------------------------------------------------

// Group temp-dir names by the pattern that made them: mkdtemp's six random characters and
// trailing -<pid>/-<port> numbers become `*`, so 21,000 `app-home-XXXXXX` dirs are one row.
export function tempPattern(name) {
  let k = name.replace(/([-_.])[A-Za-z0-9]{6}$/, '$1*');
  if (k === name) k = name.replace(/([-_])\d+(?:[-_]\d+)*$/, '$1*');
  return k;
}

// ---- transcript attribution -------------------------------------------------------------------

function shellWords(s) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// The paths one Bash command writes to, as far as a plain reading can tell. Deliberately a
// short list of unambiguous shapes: a wrong guess here puts a user's own folder in the report.
export function bashWriteTargets(command) {
  const targets = [];
  for (const seg of String(command).split(/&&|\|\||;|\n|\|/)) {
    const w = shellWords(seg.trim());
    for (let i = 0; i < w.length; i++) {
      if ((w[i] === '>' || w[i] === '>>') && w[i + 1]) targets.push(w[i + 1]);
      else if (/^>>?[^>&=]/.test(w[i])) targets.push(w[i].replace(/^>>?/, ''));
    }
    // Skip leading VAR=value assignments and `sudo`.
    let j = 0;
    while (j < w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[j]) || w[j] === 'sudo')) j++;
    const cmd = w[j], rest = w.slice(j + 1).filter(a => !/^>/.test(a));
    const args = rest.filter(a => !a.startsWith('-'));
    if (cmd === 'mkdir') targets.push(...args);
    else if (cmd === 'tee') targets.push(...args);
    else if ((cmd === 'cp' || cmd === 'mv' || cmd === 'rsync') && args.length >= 2) targets.push(args[args.length - 1]);
    else if (cmd === 'git') {
      const sub = rest.findIndex(a => !a.startsWith('-'));
      if (rest[sub] === 'clone') {
        const a = rest.slice(sub + 1).filter(x => !x.startsWith('-'));
        if (a.length >= 2) targets.push(a[1]);
      } else if (rest[sub] === 'worktree' && rest[sub + 1] === 'add') {
        const a = rest.slice(sub + 2);
        for (let k = 0; k < a.length; k++) {
          if (a[k] === '-b' || a[k] === '-B' || a[k] === '--reason') { k++; continue; }
          if (!a[k].startsWith('-')) { targets.push(a[k]); break; }
        }
      }
    }
  }
  return targets.filter(t => t && !t.startsWith('/dev/') && !/^&\d?$/.test(t) && !/[`$(){}*?]/.test(t.replace(/^\$HOME\b|^\$\{HOME\}/, '')));
}

// One transcript line → [{ path, tool, excerpt, at, cwd }] for every write it records.
export function writesFromLine(line, home) {
  if (!line.includes('"tool_use"')) return [];
  let j;
  try { j = JSON.parse(line); } catch { return []; }
  const content = j?.message?.content;
  if (!Array.isArray(content)) return [];
  const cwd = typeof j.cwd === 'string' && path.isAbsolute(j.cwd) ? j.cwd : null;
  const resolve = p => {
    let s = String(p).replace(/^~(?=\/|$)/, home).replace(/^\$\{?HOME\}?(?=\/|$)/, home);
    if (!path.isAbsolute(s)) { if (!cwd) return null; s = path.join(cwd, s); }
    return path.normalize(s);
  };
  const out = [];
  for (const b of content) {
    if (b?.type !== 'tool_use') continue;
    const inp = b.input || {};
    let paths = [], excerpt = '';
    if ((b.name === 'Write' || b.name === 'Edit' || b.name === 'NotebookEdit') && typeof (inp.file_path || inp.notebook_path) === 'string') {
      paths = [inp.file_path || inp.notebook_path];
      excerpt = `${b.name} ${paths[0]}`;
    } else if (b.name === 'Bash' && typeof inp.command === 'string') {
      paths = bashWriteTargets(inp.command);
      excerpt = inp.command;
    }
    for (const p of paths) {
      const abs = resolve(p);
      if (abs) out.push({ path: abs, tool: b.name, excerpt: redact(around(excerpt, p)), at: typeof j.timestamp === 'string' ? j.timestamp : null, cwd });
    }
  }
  return out;
}

// The part of a long command that names the target, so the evidence shows the write itself.
function around(text, needle, width = 140) {
  const t = String(text).replace(/\s+/g, ' ');
  const at = t.indexOf(needle);
  if (at < 0 || t.length <= width) return t;
  const start = Math.max(0, Math.min(at - 50, t.length - width));
  return (start ? '…' : '') + t.slice(start, start + width);
}

// Transcripts carry tokens and API keys in commands; none of that goes in a report.
export function redact(s) {
  return String(s).replace(/\s+/g, ' ').trim()
    .replace(/((?:token|key|secret|password|authorization)[=:]\s*)\S+/gi, '$1…')
    .replace(/Bearer\s+\S+/gi, 'Bearer …')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '…')
    .slice(0, 150);
}

// Standard per-user folders: a write into one of these is filed under the item inside it, never
// under the folder itself.
export const STANDARD_DIRS = ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Public', 'Templates', 'Videos'];

// Roll a written path up to the folder the agent introduced: climb toward home and stop at the
// child of the nearest ancestor that is home, a standard folder, or an ancestor of a known repo.
// So ~/scratch/a/b.png → ~/scratch, and ~/Documents/work/foo-copy/x → ~/Documents/work/foo-copy
// when ~/Documents/work holds a repo.
export function candidateFor(p, { home, anchors }) {
  if (!isInside(p, home) || p === home) return null;
  let cur = p;
  for (;;) {
    const parent = path.dirname(cur);
    if (parent === home || anchors.has(parent)) return cur;
    if (parent === cur) return null;
    cur = parent;
  }
}

export function anchorSet(home, repos) {
  const a = new Set([home, ...STANDARD_DIRS.map(d => path.join(home, d))]);
  for (const r of repos) {
    for (let cur = path.dirname(r); isInside(cur, home) && cur !== home; cur = path.dirname(cur)) a.add(cur);
  }
  return a;
}

// Where a written path is NOT clutter, whatever it is.
const CONFIG_DOTDIRS = new Set(['.config', '.cache', '.local', '.ssh', '.npm', '.nvm', '.gnupg', '.pki']);
export function sanctioned(p, { home, tmpBase, profiles, repos, excludes, managed = [] }) {
  if (isInside(p, tmpBase)) return 'temp';
  if (profiles.some(d => isInside(p, d))) return 'profile';
  if (repos.some(r => isInside(p, r))) return 'repo';
  if (excludes.some(e => isInside(p, e))) return 'excluded';
  if (managed.some(m => isInside(p, m))) return 'managed';
  const top = path.relative(home, p).split(path.sep)[0];
  if (CONFIG_DOTDIRS.has(top)) return 'config';
  // A dotfile directly in home is a config edit, not a folder left behind.
  if (path.dirname(p) === home && top.startsWith('.')) return 'config';
  return null;
}

// Fold writes into candidates: { path, writes, first, last, sample }.
export function attribute(writes, ctx) {
  const anchors = anchorSet(ctx.home, ctx.repos);
  const byPath = new Map();
  for (const w of writes) {
    if (sanctioned(w.path, ctx)) continue;
    const c = candidateFor(w.path, { home: ctx.home, anchors });
    if (!c || sanctioned(c, ctx)) continue;
    let e = byPath.get(c);
    if (!e) byPath.set(c, e = { path: c, writes: 0, first: null, last: null, sample: null });
    e.writes++;
    if (w.at && (!e.first || w.at < e.first)) { e.first = w.at; e.sample = w.excerpt; }
    if (w.at && (!e.last || w.at > e.last)) e.last = w.at;
    if (!e.sample) e.sample = w.excerpt;
  }
  return [...byPath.values()];
}

// ---- sizes and report ---------------------------------------------------------------------------

// Total bytes under p without following symlinks. Stops counting past `maxEntries` and says so.
export function sizeOf(fs, p, maxEntries = 500_000) {
  let bytes = 0, entries = 0, capped = false;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    let st;
    try { st = fs.lstatSync(cur); } catch { continue; }
    bytes += st.size;
    if (++entries > maxEntries) { capped = true; break; }
    if (st.isDirectory()) {
      let names = [];
      try { names = fs.readdirSync(cur); } catch {}
      for (const n of names) stack.push(path.join(cur, n));
    }
  }
  return { bytes, capped };
}

export function humanBytes(n) {
  const u = ['B', 'K', 'M', 'G', 'T'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${i ? n.toFixed(n < 10 ? 1 : 0) : n}${u[i]}`;
}

const day = t => (t ? new Date(t).toISOString().slice(0, 10) : '—');

// The report. It states facts only: no verdicts, no suggested commands, nothing that reads as
// advice about any item. The last line says so, because a reader should not have to wonder.
export function formatReport(c) {
  const tilde = p => (isInside(p, c.home) ? '~' + p.slice(c.home.length) : p);
  const size = s => (s ? humanBytes(s.bytes) + (s.capped ? '+' : '') : '?');
  const L = [];
  L.push('Workspace census — a report only. Nothing was changed.');
  L.push(`Home ${c.home} · temp dir ${c.tmpBase} · ${c.generatedAt}`);
  L.push(`Sources: ${c.profiles.length} Claude profile(s), ${c.repos.length} known repo(s), ${c.transcripts} transcript file(s).`);
  L.push('');
  L.push(`1. Worktrees outside <repo>/${c.worktreesDir}/ (${c.worktrees.length})`);
  for (const w of c.worktrees) L.push(`   ${size(w.size).padStart(6)}  ${day(w.mtime)}  ${tilde(w.path)}  — worktree of ${tilde(w.repo)}, ${w.branch ? `branch ${w.branch}` : w.detached ? 'detached HEAD' : 'no branch'}`);
  L.push('');
  L.push(`2. Paths agents wrote outside the sanctioned places (${c.written.length})`);
  for (const e of c.written) {
    L.push(`   ${size(e.size).padStart(6)}  ${day(e.mtime)}  ${tilde(e.path)}${e.isGitCheckout ? '  (a git checkout)' : ''}`);
    L.push(`          ${e.writes} write(s) in transcripts, ${day(e.first)} → ${day(e.last)}; first: ${e.sample}`);
  }
  L.push('');
  L.push(`3. Untracked entries at repo roots (${c.rootEntries.reduce((n, r) => n + r.entries.length, 0)} in ${c.rootEntries.length} repo(s))`);
  for (const r of c.rootEntries) {
    L.push(`   ${tilde(r.repo)}`);
    for (const e of r.entries) L.push(`   ${size(e.size).padStart(6)}  ${day(e.mtime)}  ${e.name}`);
  }
  L.push('');
  const tTotal = c.temp.reduce((n, g) => n + (g.size?.bytes || 0), 0);
  L.push(`4. Entries in ${c.tmpBase} owned by this user, by name pattern (${c.temp.reduce((n, g) => n + g.count, 0)} entries, ${humanBytes(tTotal)})`);
  // A pattern with one entry under 100M is folded into a single line: the temp dir holds many
  // unrelated one-offs, and listing each buries the patterns that repeat.
  const big = g => g.count > 1 || (g.size?.bytes || 0) >= 100 * 1024 * 1024;
  for (const g of c.temp.filter(big)) L.push(`   ${String(g.count).padStart(6)} × ${size(g.size).padStart(6)}  ${day(g.oldest)} → ${day(g.newest)}  ${g.pattern}`);
  const rest = c.temp.filter(g => !big(g));
  if (rest.length) L.push(`   ${String(rest.length).padStart(6)} single entries under 100M, ${humanBytes(rest.reduce((n, g) => n + (g.size?.bytes || 0), 0))} together (--json lists them)`);
  L.push('');
  L.push('Not walked:');
  for (const e of c.excluded) L.push(`   ${tilde(e)}`);
  L.push('');
  L.push('Already in the sanctioned places:');
  if (c.inPlace.work) L.push(`   ${tilde(c.inPlace.work.path)}  ${size(c.inPlace.work.size)}`);
  L.push(`   <repo>/${c.worktreesDir}/  ${c.inPlace.worktrees} worktree(s) across ${c.inPlace.worktreeRepos} repo(s)`);
  L.push('');
  L.push('Every item above is listed with its evidence only; what to do with any of them is the user\'s decision.');
  return L.join('\n') + '\n';
}
