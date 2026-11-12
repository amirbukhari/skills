// GIT GUARD — a PreToolUse hook on Bash for agent sessions that share a machine.
//
// When several sessions share one machine, one stash stack and one set of remote branches, a few
// git forms destroy someone else's work rather than your own: reset and checkout -- throw away a
// working tree, stash moves it onto a stack every worktree shares, a force push or update-ref or
// branch -f rewrites a ref others build on, add -A / add . stages files nobody looked at, and
// --no-verify skips the hooks that catch the rest. Saying so in a prompt does not hold; this is
// the mechanism. It is wired as a PreToolUse group matched on Bash only (scripts/install.mjs
// writes it into a Claude Code settings file), run by scripts/git-guard-hook.mjs.
//
// WHAT IT READS. The command string, tokenized the way a shell would split it: quotes and
// escapes respected, heredoc bodies and comments dropped (they are text, not commands — so a
// commit message that NAMES a banned command is not one), and every command position found:
// after && || ; | & and newlines, inside ( ) $( ) and backticks, and inside sh/bash -c and eval
// strings. In each, leading VAR=x assignments and wrappers (sudo, env, nohup, …) are skipped, git
// is recognised by basename (/usr/bin/git), and git's own options (-C <dir>, -c k=v, --git-dir=…)
// are skipped before the subcommand. It is a classifier, not a sandbox: a command built at run
// time (a variable holding "reset", an alias, a script file) is not seen. That is the line on
// purpose — the ban stops the habit, not a determined author.
//
// THE SAME OPERATION SPELLED ANOTHER WAY IS THE SAME OPERATION: `commit -n` is --no-verify,
// `push origin +ref` is a force push, `add ./` and `add :/` are `add .`/`add -A`. Those are
// blocked too. So are the other ways of throwing a working tree away: checkout -f, checkout of a
// pathspec without -- (`checkout .`, `checkout HEAD file`, --ours/--theirs), restore of the
// working tree (anything but --staged alone), clean in any form, and branch -D / -M (a forced
// delete or rename). Left allowed on purpose: checkout <branch> / -b / -B, restore --staged,
// branch -d, rebase. A lone `checkout <word>` is read as a branch unless the word can only be a
// path (starts with . or :, or holds a glob), since git itself decides that from the repo.
//
// FAILS OPEN on input it cannot read (no command, unparseable JSON): a hook that blocked every
// Bash call on a parse slip would take the session's shell away, which is worse than the ban.

const OPS = new Set(['&&', '||', ';', '|', '|&', '&', '\n', '(', ')', ';;']);
const WRAPPERS = new Set(['sudo', 'env', 'command', 'builtin', 'nohup', 'time', 'exec', 'nice', 'ionice', 'xargs', 'stdbuf', 'timeout',
  'then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const base = w => String(w).split(/[\\/]/).pop().replace(/\.exe$/i, '');

// Tokenize one command string into segments (arrays of words). `nested` collects the strings of
// $( ) and backtick substitutions, which are scanned as commands of their own.
function tokenize(src, nested) {
  const s = String(src);
  const segs = [];
  let seg = [];
  let word = null;
  let skipNext = false;          // the next word is a redirect target
  const heredocs = [];           // pending { delim, strip }
  const pushWord = () => {
    if (word !== null) { if (skipNext) skipNext = false; else seg.push(word); }
    word = null;
  };
  const endSeg = () => { pushWord(); if (seg.length) segs.push(seg); seg = []; };
  // Read a $( … ) body starting just after "$(", quote-aware; returns [body, indexAfter].
  // Heredoc-aware: a heredoc BODY is text, so an apostrophe or a ) in it (Claude Code's own
  // `-m "$(cat <<'EOF' … EOF)"` commit shape) must not open a quote or close the substitution —
  // or whatever is chained after it would be read as part of the message and never checked.
  const readParen = i => {
    let depth = 1, j = i, q = null;
    const docs = [];
    for (; j < s.length; j++) {
      const c = s[j];
      if (q) { if (c === '\\' && q === '"') { j++; continue; } if (c === q) q = null; continue; }
      if (c === '<' && s[j + 1] === '<' && s[j + 2] !== '<') {
        let k = j + 2; const strip = s[k] === '-'; if (strip) k++;
        while (s[k] === ' ' || s[k] === '\t') k++;
        let delim = '';
        while (k < s.length && !/[\s;&|<>()]/.test(s[k])) { if (s[k] !== "'" && s[k] !== '"' && s[k] !== '\\') delim += s[k]; k++; }
        if (delim) docs.push({ delim, strip });
        j = k - 1; continue;
      }
      if (c === '\n' && docs.length) {
        let k = j + 1;
        while (docs.length) {
          const { delim, strip } = docs.shift();
          while (k < s.length) {
            const nl = s.indexOf('\n', k);
            const line = s.slice(k, nl < 0 ? s.length : nl);
            k = nl < 0 ? s.length : nl + 1;
            if ((strip ? line.replace(/^\t+/, '') : line) === delim) break;
          }
        }
        j = k - 1; continue;
      }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === '\\') { j++; continue; }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) return [s.slice(i, j), j + 1];
    }
    return [s.slice(i), s.length];
  };
  const readTick = i => {
    let j = i;
    for (; j < s.length; j++) { if (s[j] === '\\') { j++; continue; } if (s[j] === '`') return [s.slice(i, j), j + 1]; }
    return [s.slice(i), s.length];
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      word = (word ?? '') + (j < 0 ? s.slice(i + 1) : s.slice(i + 1, j));
      i = j < 0 ? s.length : j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1, buf = '';
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === '\\' && j + 1 < s.length) { buf += s[++j]; continue; }
        if (s[j] === '$' && s[j + 1] === '(') { const [body, k] = readParen(j + 2); nested.push(body); buf += '$()'; j = k - 1; continue; }
        if (s[j] === '`') { const [body, k] = readTick(j + 1); nested.push(body); buf += '``'; j = k - 1; continue; }
        buf += s[j];
      }
      word = (word ?? '') + buf; i = j + 1; continue;
    }
    if (c === '\\') {
      if (s[i + 1] === '\n') { i += 2; continue; }
      word = (word ?? '') + (s[i + 1] ?? ''); i += 2; continue;
    }
    if (c === '$' && s[i + 1] === '(') {
      const [body, k] = readParen(i + 2); nested.push(body); word = (word ?? '') + '$()'; i = k; continue;
    }
    if (c === '`') { const [body, k] = readTick(i + 1); nested.push(body); word = (word ?? '') + '``'; i = k; continue; }
    if (c === '#' && word === null) { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === ' ' || c === '\t') { pushWord(); i++; continue; }
    if (c === '\n') {
      endSeg(); i++;
      // Heredoc bodies start on the line after their operator; they are data, never commands.
      while (heredocs.length) {
        const { delim, strip } = heredocs.shift();
        while (i < s.length) {
          const nl = s.indexOf('\n', i);
          const line = s.slice(i, nl < 0 ? s.length : nl);
          i = nl < 0 ? s.length : nl + 1;
          if ((strip ? line.replace(/^\t+/, '') : line) === delim) break;
        }
      }
      continue;
    }
    if (c === '<' || c === '>' || (c === '&' && s[i + 1] === '>')) {
      // A redirect. A bare fd number right before it ("2>") is part of it, not an argument.
      if (word !== null && /^\d+$/.test(word)) word = null;
      pushWord();
      if (s.startsWith('<<<', i)) { i += 3; skipNext = true; continue; }
      if (s.startsWith('<<', i)) {
        i += 2; const strip = s[i] === '-'; if (strip) i++;
        while (s[i] === ' ' || s[i] === '\t') i++;
        let delim = '';
        while (i < s.length && !/[\s;&|<>()]/.test(s[i])) { if (s[i] !== "'" && s[i] !== '"' && s[i] !== '\\') delim += s[i]; i++; }
        if (delim) heredocs.push({ delim, strip });
        continue;
      }
      i++;
      while (s[i] === '>' || s[i] === '&' || s[i] === '|') i++;
      if (/[\d-]/.test(s[i] || '') && s[i - 1] === '&') { while (/[\d-]/.test(s[i] || '')) i++; continue; }
      skipNext = true; continue;
    }
    const two = s.slice(i, i + 2);
    if (OPS.has(two)) { endSeg(); i += 2; continue; }
    if (OPS.has(c)) { endSeg(); i++; continue; }
    word = (word ?? '') + c; i++;
  }
  endSeg();
  return segs;
}

// Every command (array of words) in `src`, including those nested in substitutions and in
// sh -c / eval strings. Depth-bounded so a pathological string cannot recurse forever.
export function commandsOf(src, depth = 0) {
  if (depth > 4) return [];
  const nested = [];
  const out = [];
  for (let words of tokenize(src, nested)) {
    let k = 0;
    for (;;) {
      while (k < words.length && ASSIGN.test(words[k])) k++;
      if (k < words.length && WRAPPERS.has(base(words[k]))) {
        const w = base(words[k]); k++;
        while (k < words.length && (words[k].startsWith('-') || (w === 'env' && ASSIGN.test(words[k])))) k++;
        if (w === 'timeout' && k < words.length && /^\d/.test(words[k])) k++;
        continue;
      }
      break;
    }
    words = words.slice(k);
    if (!words.length) continue;
    const cmd = base(words[0]);
    if (SHELLS.has(cmd)) {
      const ci = words.findIndex((w, j) => j > 0 && /^-[a-z]*c[a-z]*$/.test(w));
      if (ci > 0 && words[ci + 1] != null) out.push(...commandsOf(words[ci + 1], depth + 1));
      continue;
    }
    if (cmd === 'eval') { out.push(...commandsOf(words.slice(1).join(' '), depth + 1)); continue; }
    out.push(words);
  }
  for (const body of nested) out.push(...commandsOf(body, depth + 1));
  return out;
}

// git's own options before the subcommand that take a separate value.
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path', '--list-cmds']);

// Per-subcommand options whose VALUE is the next word (long) or the rest of the cluster (short),
// so a message or a file name is never read as a flag.
const VALUE_LONG = {
  commit: ['-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message', '--author', '--date', '-t', '--template', '--fixup', '--squash', '--trailer', '--cleanup', '--pathspec-from-file'],
  merge: ['-m', '--message', '-F', '--file', '-s', '--strategy', '-X', '--strategy-option', '--cleanup', '--into-name'],
  push: ['-o', '--push-option', '--repo', '--receive-pack', '--exec'],
  tag: ['-m', '--message', '-F', '--file', '-u', '--local-user', '--cleanup'],
  branch: ['-u', '--set-upstream-to', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format'],
  checkout: ['-b', '-B', '--orphan', '--conflict', '--pathspec-from-file'],
  restore: ['-s', '--source', '--conflict', '--pathspec-from-file'],
  add: ['--chmod', '--pathspec-from-file'],
};
const VALUE_SHORT = { commit: 'mFCct', merge: 'mFsX', push: 'o', tag: 'mFu', branch: 'u', checkout: 'bB', restore: 's', add: '' };

// A word that can only be a pathspec, never a branch: git refuses ref names that start with "."
// or contain glob characters, and a leading ":" is pathspec magic.
const PATH_ONLY = p => p.startsWith('.') || p.startsWith(':') || /[*?[]/.test(p);

// Split a subcommand's args into short-flag letters, long flags, positionals, and whether `--`
// appeared. Values of value-taking options are dropped.
function readArgs(sub, args) {
  const vlong = new Set(VALUE_LONG[sub] || []);
  const vshort = VALUE_SHORT[sub] || '';
  const shorts = new Set(), longs = [], positional = [];
  let dashdash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (dashdash) { positional.push(a); continue; }
    if (a === '--') { dashdash = true; continue; }
    if (a.startsWith('--')) {
      const name = a.split('=')[0];
      longs.push(name);
      if (vlong.has(name) && !a.includes('=')) i++;
      continue;
    }
    if (/^-[A-Za-z0-9]/.test(a)) {
      if (vlong.has(a)) { shorts.add(a[1]); i++; continue; }
      for (let j = 1; j < a.length; j++) {
        shorts.add(a[j]);
        if (vshort.includes(a[j])) { if (j === a.length - 1) i++; break; }
      }
      continue;
    }
    positional.push(a);
  }
  return { shorts, longs, positional, dashdash };
}

const block = (rule, reason) => ({ blocked: true, rule, reason });

// The verdict for ONE git invocation (`words[0]` is git), or null when it is allowed.
function judgeGit(words) {
  let i = 1;
  while (i < words.length && words[i].startsWith('-')) {
    const w = words[i];
    i += GIT_VALUE_OPTS.has(w) ? 2 : 1;
  }
  const sub = words[i];
  if (!sub) return null;
  const args = words.slice(i + 1);
  const { shorts, longs, positional, dashdash } = readArgs(sub, args);
  if (sub === 'reset') return block('git reset', 'git reset discards or moves work other sessions may depend on');
  if (sub === 'stash') return block('git stash', 'the stash stack is shared by every worktree on this machine');
  if (sub === 'update-ref') return block('git update-ref', 'update-ref rewrites a ref with no safety check');
  if (longs.includes('--no-verify') || (sub === 'commit' && shorts.has('n'))) return block('--no-verify', '--no-verify skips the hooks that guard this repo');
  if (sub === 'push') {
    if (longs.includes('--force') || longs.includes('--force-with-lease') || shorts.has('f')) return block('git push --force', 'a force push rewrites a branch other sessions build on');
    if (positional.slice(1).some(p => p.startsWith('+'))) return block('git push --force', 'a +refspec is a force push');
  }
  if (sub === 'checkout') {
    if (dashdash) return block('git checkout --', 'checkout -- throws away working-tree changes');
    if (longs.includes('--force') || shorts.has('f')) return block('git checkout -f', 'checkout -f throws away working-tree changes');
    if (longs.includes('--ours') || longs.includes('--theirs') || longs.includes('--pathspec-from-file')) return block('git checkout <pathspec>', 'checking out paths throws away working-tree changes');
    // With -b/-B/--orphan the one positional is a start point; without, a second positional
    // (`checkout HEAD file`) or a path-only word (`checkout .`) is a pathspec.
    const creates = shorts.has('b') || shorts.has('B') || longs.includes('--orphan');
    if ((!creates && positional.length > 1) || positional.some(PATH_ONLY)) return block('git checkout <pathspec>', 'checking out paths throws away working-tree changes');
  }
  if (sub === 'restore') {
    const staged = longs.includes('--staged') || shorts.has('S');
    const worktree = longs.includes('--worktree') || shorts.has('W');
    if (!staged || worktree) return block('git restore', 'restoring the working tree throws away changes; only --staged (unstage) is allowed');
  }
  if (sub === 'clean') return block('git clean', 'git clean deletes untracked files for good');
  if (sub === 'add') {
    if (longs.includes('--all') || shorts.has('A')) return block('git add -A', 'stage files by path, not everything at once');
    if (positional.some(p => p === '.' || p === './' || p === ':/' || p === ':/.' || p === ':(top)')) return block('git add .', 'stage files by path, not everything at once');
  }
  if (sub === 'branch' && (longs.includes('--force') || shorts.has('f'))) return block('git branch -f', 'branch -f moves a branch other sessions build on');
  if (sub === 'branch' && (shorts.has('D') || shorts.has('M'))) return block('git branch -D/-M', 'a forced delete or rename drops a branch other sessions may build on');
  return null;
}

// THE VERDICT for one Bash command string: { blocked:false } or { blocked:true, rule, reason }.
// Never throws.
export function gitBanVerdict(command, { allow } = {}) {
  if (typeof command !== 'string' || !command.trim()) return { blocked: false };
  let cmds;
  try { cmds = commandsOf(command); } catch { return { blocked: false }; }
  for (const words of cmds) {
    if (base(words[0]) !== 'git') continue;
    const v = judgeGit(words);
    if (v && !(allow && allow.has(v.rule))) return v;
  }
  return { blocked: false };
}

// The line the session's model reads when a call is refused.
export function denyReason(v) {
  return `Blocked by git-guard: ${v.rule} is not allowed in this session (${v.reason}). `
    + 'Use non-destructive git instead: stage by path and commit with `git commit --only <paths>`, push without force, '
    + 'and set work aside with a WIP commit rather than a stash. If this really must happen, ask the user to run it themselves.';
}

// Rules switched off by name (the `rule` of a verdict, e.g. "git stash"), from a comma-separated
// list. A repo with one session and no shared stash can allow what it needs; everything else holds.
export function allowedRules(value) {
  return new Set(String(value || '').split(',').map(x => x.trim()).filter(Boolean));
}

// The PreToolUse group a settings file carries. `nodeCmd` is the node binary to run the hook
// with, `script` the absolute path of scripts/git-guard-hook.mjs.
export function gitBanHookGroup(nodeCmd, script) {
  return { matcher: 'Bash', hooks: [{ type: 'command', command: `"${nodeCmd}" "${script}"` }] };
}

// `settings` (a parsed Claude Code settings object) with the guard's group added to
// hooks.PreToolUse. Idempotent: a group already running this hook script is replaced, never
// duplicated, and every other hook is left exactly where it was.
export function withGitGuard(settings, nodeCmd, script) {
  const out = { ...(settings || {}) };
  out.hooks = { ...(out.hooks || {}) };
  const isOurs = g => g && Array.isArray(g.hooks) && g.hooks.some(h => typeof h.command === 'string' && /git-guard-hook\.mjs"?$/.test(h.command));
  out.hooks.PreToolUse = [...(Array.isArray(out.hooks.PreToolUse) ? out.hooks.PreToolUse : []).filter(g => !isOurs(g)), gitBanHookGroup(nodeCmd, script)];
  return out;
}
