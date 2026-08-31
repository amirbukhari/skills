#!/usr/bin/env node
'use strict';
/*
 * Isolated, dependency-free self-test for name-words.js.
 * Run directly:  node name-words.test.js
 * Does NOT touch the shared jest suite or any of s1's engine state.
 */

const assert = require('assert');
const { buildNames, nameLeaf } = require('./name-words');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}

// --- leaf hint extraction -------------------------------------------------
ok(nameLeaf({ example: 'export const saveClientBillingProfile = async (', shape: '' }).hint
  === 'saveClientBillingProfile', 'declared export const name');
ok(nameLeaf({ example: '.join', shape: 'DotToken ID' }).hint === 'join', 'method access');
ok(nameLeaf({ example: " from '@jamesgmarks/utilities';", shape: 'FromKeyword STR SemicolonToken' }).hint
  === 'fromUtilities', 'from-module hint');
ok(nameLeaf({ example: 'first', shape: 'ID' }).hint === 'ident', 'ID placeholder -> ident');
ok(nameLeaf({ example: ';', shape: 'SemicolonToken' }).hint === 'semicolon', 'punctuation');
ok(nameLeaf({ example: 'const ', shape: 'ConstKeyword' }).hint === 'constDecl', 'keyword construct');
// a name must never be derived from string-literal contents:
ok(nameLeaf({ example: "('no data in this file')", shape: 'OpenParenToken STR CloseParenToken' }).rank === 2,
  'string contents do not yield an identifier name');

// --- fixture library: determinism, uniqueness, coverage -------------------
const lib = {
  leaves: [
    { id: 'p_aaa', example: 'const ', shape: 'ConstKeyword', freq: 5 },
    { id: 'p_bbb', example: 'first', shape: 'ID', freq: 9 },
    { id: 'p_ccc', example: '.join', shape: 'DotToken ID', freq: 3 },
    { id: 'p_ddd', example: ';', shape: 'SemicolonToken', freq: 2 },
  ],
  composites: [
    { id: 'g_2_1', memberLeafIds: ['p_aaa', 'p_bbb'], len: 2 },
    { id: 'g_2_2', memberLeafIds: ['p_bbb', 'p_ccc'], len: 2 },
    { id: 'g_2_3', memberLeafIds: ['p_aaa', 'p_bbb'], len: 2 }, // dup -> constDecl_2
  ],
  wholeFileWords: [
    { name: 'w_01_x', memberFiles: ['src/a/chatbot.ts', 'src/b/index.ts'] },
  ],
  idiomWords: [{ name: 'fetchAndValidate' }],
};

const a = buildNames(lib);
const b = buildNames(JSON.parse(JSON.stringify(lib)));
ok(JSON.stringify(a) === JSON.stringify(b), 'same input -> identical output (deterministic)');
ok(Object.keys(a).length === 4 + 3 + 1 + 1, 'every id covered');
// composites are named by their best-rank member's HINT; names are unique
// across ALL tiers, so these inherit suffixes because the leaves p_aaa/p_ccc
// already claimed the bare `constDecl` / `join`.
ok(a['g_2_1'].hint === 'constDecl' && a['g_2_2'].hint === 'join', 'composite hint = best-rank member');
ok(a['p_aaa'].name === 'constDecl' && a['g_2_1'].name === 'constDecl_2', 'stable suffix after leaf claim');
ok(a['g_2_3'].name === 'constDecl_3', 'second collision gets next stable suffix');
const finals = Object.values(a).map((v) => v.name);
ok(new Set(finals).size === finals.length, 'all final names unique');
ok(a['w_01_x'].tier === 'wholeFile' && /Module$/.test(a['w_01_x'].name), 'whole-file tier + suffix');
ok(a['fetchAndValidate'].name === 'fetchAndValidate' && a['fetchAndValidate'].tier === 'idiom', 'idiom kept');

console.log(`name-words.test.js: ${passed} assertions passed`);
