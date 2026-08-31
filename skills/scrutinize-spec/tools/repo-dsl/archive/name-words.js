#!/usr/bin/env node
'use strict';
/*
 * name-words.js — DETERMINISTIC, zero-LLM namer for the SDD word library.
 *
 * Reads the persisted word-library.json and assigns each mined word (leaf /
 * composite / whole-file / idiom) a readable, STABLE, UNIQUE display name
 * derived purely from its content. Same input -> same output, always. No model
 * calls, no randomness, no clock.
 *
 * It writes a SIDECAR the SDD panel can read without re-mining:
 *   <project>/word-names.json  ->  { id -> { name, hint, tier } }
 *
 * The mined id (p_/g_/w_) stays the canonical reference; `name` is a unique
 * display string, `hint` is the raw (possibly-repeated) derived hint.
 *
 * Deliberately does NOT touch catalog/ or word-library.json (s1's live writes).
 *
 * Usage:
 *   node name-words.js [projectDir]
 *     projectDir defaults to the hydra-source tree.
 *   node name-words.js --stdout [projectDir]   # print sidecar, don't write
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PROJECT = '/home/amir/Documents/Rentsync/delonix/hydra-source';

// ---------------------------------------------------------------------------
// small deterministic string helpers
// ---------------------------------------------------------------------------

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

// TS/JS keywords + trivial noise words we don't want AS a name on their own.
const KEYWORDS = new Set([
  'const', 'let', 'var', 'async', 'await', 'export', 'default', 'return',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'from', 'as', 'import', 'require', 'class', 'abstract', 'new', 'typeof',
  'instanceof', 'this', 'super', 'void', 'null', 'undefined', 'true', 'false',
  'function', 'of', 'in', 'type', 'interface', 'enum', 'extends', 'implements',
  'public', 'private', 'protected', 'readonly', 'static', 'get', 'set',
  'throw', 'try', 'catch', 'finally', 'yield', 'delete', 'string', 'number',
  'boolean', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint',
]);

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function lowerFirst(s) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

// Join identifier fragments into a single camelCase token.
function camel(parts) {
  const clean = parts.filter(Boolean);
  if (!clean.length) return '';
  const [head, ...rest] = clean;
  return lowerFirst(head) + rest.map(cap).join('');
}

function clip(name, max = 40) {
  if (name.length <= max) return name;
  return name.slice(0, max);
}

// Meaningful identifiers in a snippet, in order, keywords dropped.
function identsOf(example) {
  const all = (example || '').match(IDENT_RE) || [];
  return all.filter((t) => !KEYWORDS.has(t));
}

// ---------------------------------------------------------------------------
// shape-token -> readable word (for punctuation-only / keyword-only leaves)
// ---------------------------------------------------------------------------

const SHAPE_WORD = {
  SemicolonToken: 'semicolon',
  CommaToken: 'comma',
  DotToken: 'dot',
  DotDotDotToken: 'spread',
  ColonToken: 'colon',
  QuestionToken: 'ternary',
  QuestionQuestionToken: 'nullish',
  OpenParenToken: 'openParen',
  CloseParenToken: 'closeParen',
  OpenBracketToken: 'openBracket',
  CloseBracketToken: 'closeBracket',
  OpenBraceToken: 'openBrace',
  CloseBraceToken: 'closeBrace',
  FirstPunctuation: 'openBrace', // `{` in the mined shape vocabulary
  FirstAssignment: 'assign',
  FirstBinaryOperator: 'lessThan',
  EqualsGreaterThanToken: 'arrow',
  GreaterThanToken: 'greaterThan',
  LessThanToken: 'lessThan',
  ExclamationToken: 'not',
  AmpersandAmpersandToken: 'and',
  BarBarToken: 'or',
  PlusToken: 'plus',
  MinusToken: 'minus',
  AsteriskToken: 'star',
  SlashToken: 'slash',
  ConstKeyword: 'constDecl',
  LetKeyword: 'letDecl',
  VarKeyword: 'varDecl',
  ImportKeyword: 'importStmt',
  ExportKeyword: 'exportStmt',
  FromKeyword: 'fromClause',
  ReturnKeyword: 'returnStmt',
  ThrowKeyword: 'throwStmt',
  IfKeyword: 'ifStmt',
  ElseKeyword: 'elseStmt',
  ForKeyword: 'forStmt',
  WhileKeyword: 'whileStmt',
  NewKeyword: 'newExpr',
  AwaitKeyword: 'awaitExpr',
  AsyncKeyword: 'asyncFn',
  ClassKeyword: 'classDecl',
  FunctionKeyword: 'funcDecl',
  AsKeyword: 'asCast',
  ID: 'ident',
  STR: 'str',
  NUM: 'num',
};

function shapeWord(tok) {
  if (SHAPE_WORD[tok]) return SHAPE_WORD[tok];
  // Generic fallback: strip a trailing "Keyword"/"Token" and lowerFirst.
  const base = tok.replace(/(Keyword|Token)$/, '');
  return lowerFirst(base) || 'tok';
}

function hintFromShape(shape) {
  const toks = (shape || '').split(/\s+/).filter(Boolean);
  if (!toks.length) return 'token';
  const words = toks.slice(0, 2).map(shapeWord);
  return clip(camel(words));
}

// ---------------------------------------------------------------------------
// LEAF naming — derive a hint from the literal `example`, falling back to shape.
// Returns { hint, rank }, where rank orders a hint's naming value (used to pick
// which members carry a composite's name):
//   RANK_ID  (0) real identifier — method/declared/import name (best)
//   RANK_KW  (1) construct keyword — const/return/throw/import/... (mid)
//   RANK_PUN (2) punctuation, or the generic ID *placeholder* `first` (worst)
// The mined corpus normalises identifier slots to the literal token "first"
// (freq ~22k), so it is a slot marker, not a real name — demoted to RANK_PUN.
// ---------------------------------------------------------------------------

const RANK_ID = 0;
const RANK_KW = 1;
const RANK_PUN = 2;

// Strip string / template literal CONTENTS so we never name a word after text
// that lives inside a quoted string.
function stripStrings(s) {
  return (s || '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function nameLeaf(leaf) {
  const ex = (leaf.example || '').trim();
  const shape = leaf.shape || '';

  // 1) Declarations: the declared name is the strongest human signal.
  let m =
    ex.match(/\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/) ||
    ex.match(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/) ||
    ex.match(/\b(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/) ||
    ex.match(/\b(?:export\s+)?(?:interface|enum|type)\s+([A-Za-z_$][\w$]*)/);
  if (m && m[1] !== 'first') return { hint: clip(lowerFirst(m[1])), rank: RANK_ID };

  // 2) import ... from '<module>'
  if (/\bimport\b/.test(ex) || shape.startsWith('ImportKeyword')) {
    const from = ex.match(/from\s+['"]([^'"]+)['"]/);
    const named = ex.match(/import\s+\{?\s*([A-Za-z_$][\w$]*)/);
    let tail = '';
    if (from) {
      const seg = from[1].split('/').filter(Boolean).pop() || from[1];
      tail = cap(seg.replace(/[^A-Za-z0-9]/g, ''));
    } else if (named && !KEYWORDS.has(named[1]) && named[1] !== 'first') {
      tail = cap(named[1]);
    }
    return tail
      ? { hint: clip('import' + tail), rank: RANK_ID }
      : { hint: 'importStmt', rank: RANK_KW };
  }

  // 3) a bare `from '<module>';` continuation
  m = ex.match(/^[,\s]*from\s+['"]([^'"]+)['"]/);
  if (m) {
    const seg = m[1].split('/').filter(Boolean).pop() || m[1];
    return { hint: clip('from' + cap(seg.replace(/[^A-Za-z0-9]/g, ''))), rank: RANK_ID };
  }

  // 4) leading member access / call: `.join`, `.map(`, `});`
  m = ex.match(/^[)\s.]*\.([A-Za-z_$][\w$]*)\s*\(?/);
  if (m && !KEYWORDS.has(m[1]) && m[1] !== 'first') {
    return { hint: clip(lowerFirst(m[1])), rank: RANK_ID };
  }

  // 5) call / test helpers at the head: `describe('...')`, `expect(...)`
  m = ex.match(/^([A-Za-z_$][\w$]*)\s*\(/);
  if (m && !KEYWORDS.has(m[1]) && m[1] !== 'first') {
    return { hint: clip(lowerFirst(m[1])), rank: RANK_ID };
  }

  // 6) any meaningful identifier OUTSIDE string literals. For a member
  //    expression `a.b.c` the last segment tends to name the operation.
  const bare = stripStrings(ex);
  const ids = identsOf(bare).filter((t) => t !== 'first');
  if (ids.length) {
    const dotChain = bare.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)/);
    if (dotChain) {
      const segs = dotChain[1].split('.').filter((s) => !KEYWORDS.has(s) && s !== 'first');
      if (segs.length) return { hint: clip(camel([segs[0], segs[segs.length - 1]])), rank: RANK_ID };
    }
    return { hint: clip(lowerFirst(ids[0])), rank: RANK_ID };
  }

  // 7) the bare ID placeholder (`first`) — a slot marker, not a real name.
  if (/^first$/.test(ex) || shape === 'ID') return { hint: 'ident', rank: RANK_PUN };

  // 8) keyword-only or punctuation-only — name from the shape vocabulary.
  const firstTok = (shape.split(/\s+/)[0] || '');
  const rank = /Keyword$/.test(firstTok) ? RANK_KW : RANK_PUN;
  return { hint: hintFromShape(shape), rank };
}

// ---------------------------------------------------------------------------
// COMPOSITE naming — combine the significant member-leaf hints.
// ---------------------------------------------------------------------------

function nameComposite(comp, leafHints) {
  const members = (comp.memberLeafIds || []).map((id) => leafHints[id]).filter(Boolean);
  if (!members.length) return `group${comp.len || 0}`;

  // Name from the highest-value rank actually present among the members, in
  // member order: real identifiers > construct keywords > punctuation slots.
  const bestRank = Math.min(...members.map((h) => h.rank));
  const chosen = members.filter((h) => h.rank === bestRank).map((h) => h.hint);

  // De-dup consecutive repeats while preserving order.
  const dedup = [];
  for (const h of chosen) if (dedup[dedup.length - 1] !== h) dedup.push(h);

  const name = clip(camel(dedup.slice(0, 3)));
  // Pure-punctuation composites read better with a Seq suffix.
  if (bestRank === RANK_PUN) return clip(name + 'Seq');
  return name || `group${comp.len || 0}`;
}

// ---------------------------------------------------------------------------
// WHOLE-FILE naming — derive from the member files' most representative token.
// ---------------------------------------------------------------------------

function fileToken(filePath) {
  const parts = filePath.split('/').filter(Boolean);
  let base = parts[parts.length - 1] || filePath;
  base = base.replace(/\.[jt]sx?$/i, '');
  // Generic barrel/entry names -> use the containing directory instead.
  if (/^(index|main|mod)$/i.test(base) && parts.length >= 2) {
    base = parts[parts.length - 2];
  }
  // Interface prefix `IFoo` -> `foo`
  base = base.replace(/^I(?=[A-Z])/, '');
  return lowerFirst(base.replace(/[^A-Za-z0-9]/g, '')) || 'module';
}

function nameWholeFile(wf) {
  const files = wf.memberFiles || [];
  const tokens = files.map(fileToken);
  // Pick the most common token (deterministic tie-break: lexicographically
  // smallest, then longest — stable regardless of input order).
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  const best = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (a[0].length !== b[0].length) return b[0].length - a[0].length;
    return a[0] < b[0] ? -1 : 1;
  })[0];
  const token = best ? best[0] : 'module';
  return clip(token + 'Module');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function buildNames(lib) {
  const out = {}; // id -> { name, hint, tier }
  const leafHints = {}; // id -> { hint, significant }

  // 1) leaves first (composites depend on them). Deterministic order by id.
  const leaves = (lib.leaves || []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const l of leaves) {
    leafHints[l.id] = nameLeaf(l);
  }

  // 2) build raw hint per id in a fixed tier order, then disambiguate.
  const rows = []; // { id, hint, tier }

  for (const l of leaves) {
    rows.push({ id: l.id, hint: leafHints[l.id].hint, tier: 'leaf' });
  }

  const comps = (lib.composites || []).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of comps) {
    rows.push({ id: c.id, hint: nameComposite(c, leafHints), tier: 'composite' });
  }

  const wfs = (lib.wholeFileWords || []).slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const w of wfs) {
    rows.push({ id: w.name, hint: nameWholeFile(w), tier: 'wholeFile' });
  }

  const idioms = (lib.idiomWords || []).slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const i of idioms) {
    rows.push({ id: i.name, hint: i.name, tier: 'idiom' });
  }

  // 3) deterministic collision handling. Rows are already in a stable order
  //    (tier, then id). First claimant keeps the bare hint; later duplicates
  //    get a stable numeric suffix.
  const used = new Map(); // name -> count
  for (const r of rows) {
    let base = r.hint || 'word';
    let name = base;
    if (used.has(name)) {
      const n = used.get(name) + 1;
      used.set(base, n);
      name = `${base}_${n}`;
      // Extremely unlikely, but guard against a suffixed collision too.
      while (used.has(name)) {
        used.set(base, used.get(base) + 1);
        name = `${base}_${used.get(base)}`;
      }
      used.set(name, 1);
    } else {
      used.set(name, 1);
    }
    out[r.id] = { name, hint: base, tier: r.tier };
  }

  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const toStdout = argv.includes('--stdout');
  const projectDir = argv.filter((a) => !a.startsWith('--'))[0] || DEFAULT_PROJECT;

  const libPath = path.join(projectDir, 'word-library.json');
  if (!fs.existsSync(libPath)) {
    console.error(`[name-words] word-library.json not found at ${libPath}`);
    process.exit(1);
  }
  const lib = JSON.parse(fs.readFileSync(libPath, 'utf8'));
  const names = buildNames(lib);

  const sidecar = {
    schema: 'sdd-word-names/1',
    generatedBy: 'name-words.js (deterministic, zero-LLM)',
    project: projectDir,
    sourceLibrary: 'word-library.json',
    counts: (() => {
      const c = { leaf: 0, composite: 0, wholeFile: 0, idiom: 0 };
      for (const id in names) c[names[id].tier]++;
      return c;
    })(),
    names,
  };

  const json = JSON.stringify(sidecar, null, 1);
  if (toStdout) {
    process.stdout.write(json + '\n');
  } else {
    const outPath = path.join(projectDir, 'word-names.json');
    fs.writeFileSync(outPath, json + '\n');
    console.error(`[name-words] wrote ${Object.keys(names).length} names -> ${outPath}`);
    console.error(`[name-words] tiers: ${JSON.stringify(sidecar.counts)}`);
  }
}

if (require.main === module) main();

module.exports = { buildNames, nameLeaf, nameComposite, nameWholeFile };
