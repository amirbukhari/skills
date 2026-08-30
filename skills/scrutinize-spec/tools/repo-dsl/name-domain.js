#!/usr/bin/env node
'use strict';
/*
 * name-domain.js — the MODEL naming pass, persisted deterministically.
 *
 * Amir authorized turning the model on for the naming task ("make this real").
 * The domain names below were AUTHORED BY THE MODEL (this Opus session) by
 * reading the persisted tiers in delonix/hydra-source:
 *   - catalog/skeletons.json   (top skeletons: sig / kinds / fillProfile)
 *   - catalog/compose-words.json (c_ statement words: template / example)
 *   - catalog/archetypes.json + the 3 target arch specs (enum types)
 *
 * They are embedded here as data so the pass is RE-RUNNABLE and byte-stable;
 * the JUDGMENT is the model's, the persistence is deterministic.
 *
 * HONESTY: skeletons that are pure ASSIGN/CALL/RETURN plumbing keep their
 * structural name (source:"structural", no invented meaning). Only shapes whose
 * KIND sequence or dominant idiom-fill actually reveals intent get a domain
 * name, each with an explicit confidence.
 *
 * Writes two sidecars into delonix/hydra-source/catalog/ (writes stay inside
 * hydra-source; does NOT touch s1's repo-dsl/catalog or engine/*):
 *   domain-names.json  id -> { name, hint, confidence, source:"llm" }   (LLM layer)
 *   word-names.json    id -> { name, hint, tier, source, confidence,
 *                              deterministicName }  (merged: LLM supersedes,
 *                              deterministic name kept as fallback)
 *
 * Usage: node name-domain.js [hydraSourceDir]
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.argv.filter((a) => !a.startsWith('--'))[2]
  || '/home/amir/Documents/Rentsync/delonix/hydra-source';

// ===========================================================================
// (1) SKELETONS — model-authored intent names for the top shapes.
//     Keyed by the skeleton `name` from catalog/skeletons.json.
//     `keep:true` => too generic to name; keep the structural name honestly.
// ===========================================================================
const SKELETONS = {
  // -- generic plumbing: KEEP structural, do not invent meaning ------------
  call:                           { keep: true },
  return:                         { keep: true },
  assign:                         { keep: true },
  callCall:                       { keep: true },
  callCallCall:                   { keep: true },
  callCallCallCall:               { keep: true },
  callCallCallCallCall:           { keep: true },
  callCallCallCallCallCallCall:   { keep: true },
  assignCall:                     { keep: true },
  assignAssign:                   { keep: true },
  assignCallCall:                 { keep: true },
  assignCallCallCall:             { keep: true },
  assignAssignCall:               { keep: true },
  assignAssignCallCall:           { keep: true },
  assignAssignAssignAssignAssign: { keep: true },
  await:                          { keep: true },
  // -- low confidence: a weak but defensible intent -----------------------
  assignReturn:                   { name: 'computeAndReturn', confidence: 'low' },
  assignAssignReturn:             { name: 'buildAndReturn', confidence: 'low' },
  assignAssignAssignReturn:       { name: 'buildAndReturn', confidence: 'low' },
  assignAssignAssignAssignReturn: { name: 'buildAndReturn', confidence: 'low' },
  callReturn:                     { name: 'delegateAndReturn', confidence: 'low' },
  if:                             { name: 'branchOnCondition', confidence: 'low' },
  // -- medium: KIND sequence carries a real shape of intent ---------------
  tryCatch:                       { name: 'runGuarded', confidence: 'medium' },   // TRY = try/catch wrapper
  ifReturn:                       { name: 'guardEarlyReturn', confidence: 'medium' }, // IF then RETURN
  assignIfReturn:                 { name: 'computeGuardReturn', confidence: 'medium' },
  assignFetchAssign:              { name: 'loadAndCapture', confidence: 'medium' }, // fetch a record, capture it
  assignAssignFetchReturn:        { name: 'loadAndReturn', confidence: 'medium' },
  assignAssignAssignFetchAssign:  { name: 'loadAndCapture', confidence: 'medium' },
  // -- high: FETCH / GUARD_THROW make the intent unambiguous ---------------
  fetchReturn:                    { name: 'loadAndReturn', confidence: 'high' },   // FETCH RETURN
  assignFetchReturn:              { name: 'loadAndReturn', confidence: 'high' },   // ASSIGN FETCH RETURN
  guardReturn:                    { name: 'assertThenReturn', confidence: 'high' }, // GUARD_THROW RETURN (47/47 assertOrThrow)
};

// ===========================================================================
// (2) c_ STATEMENT WORDS — model-authored intention names from the template.
//     Keyed by c_ id from catalog/compose-words.json.
// ===========================================================================
const CWORDS = {
  c_9d7259dec1: { name: 'importSymbol', confidence: 'high' },            // import { x } from 'm'
  c_15b3e76d34: { name: 'testBlock', confidence: 'medium' },             // fn(label, () => {   (describe/it)
  c_22a979a0d7: { name: 'importTwoSymbols', confidence: 'high' },
  c_eae4bfb6fd: { name: 'returnValue', confidence: 'high' },             // return x;
  c_453f2ea865: { name: 'guardMissing', confidence: 'high' },            // if (!x) {
  c_99ba26648b: { name: 'throwError', confidence: 'high' },              // throw new E(msg);
  c_720477626a: { name: 'importThreeSymbols', confidence: 'high' },
  c_9b1b9c3073: { name: 'assignAwaitedCall', confidence: 'high' },       // const x = await f(a);
  c_ee69d79d19: { name: 'methodCall', confidence: 'high' },              // o.m(a);
  c_5edc0a6362: { name: 'assignCallResult', confidence: 'high' },        // const x = f(a);
  c_00198f0160: { name: 'importDefault', confidence: 'high' },           // import x from 'm';
  c_e24ec112ff: { name: 'catchClause', confidence: 'high' },             // } catch (e) {
  c_3523583b74: { name: 'assignConst', confidence: 'high' },             // const x = y;
  c_ecc42862c7: { name: 'assignCallResult', confidence: 'high' },        // const x = f(a);
  c_7ba62e59f9: { name: 'ifGuard', confidence: 'high' },                 // if (x) {
  c_8ed322933e: { name: 'throwTemplatedError', confidence: 'medium' },
  c_1a25fee5d1: { name: 'copyField', confidence: 'high' },               // a.b = c.d;
  c_bc8eebbf42: { name: 'importSymbol', confidence: 'medium' },          // multiline single import
  c_d6cddb342d: { name: 'assignAwaitedMethod', confidence: 'high' },     // const x = await o.m();
  c_320c9c6a66: { name: 'publicAsyncMethod', confidence: 'medium' },     // public async m(o: T = {}) {
  c_2e33daa544: { name: 'assignCallOnNested', confidence: 'medium' },    // const x = f(a.b.c);
  c_a5449911ac: { name: 'importTwoSymbols', confidence: 'medium' },      // multiline two import
  c_43aa410893: { name: 'chainedCall', confidence: 'medium' },           // f(a).g(b);
  c_ee3c234dab: { name: 'exportConstFromMethod', confidence: 'medium' }, // export const x = o.m(a);
  c_3cf6036683: { name: 'guardMissingField', confidence: 'high' },       // if (!o.f) {
  c_66635dd60e: { name: 'assignCallTwoArgs', confidence: 'high' },       // const x = f(a, b);
  c_e06ca426ab: { name: 'importFourSymbols', confidence: 'high' },
  c_6a57b9fa8d: { name: 'assignCallOnField', confidence: 'high' },       // const x = f(a.b);
  c_c7dfe4a51c: { name: 'assignConst', confidence: 'high' },             // const x = y;
  c_3a5d6bdf4f: { name: 'nestedCall', confidence: 'medium' },            // f(g(a));
  c_2b18373fdc: { name: 'chainedCallOnField', confidence: 'medium' },    // f(a.b).g(c);
  c_1c7869cb89: { name: 'callbackArg', confidence: 'medium' },           // f(() => {
  c_b685fb444d: { name: 'assignMapped', confidence: 'high' },            // const x = a.map(i => i.f);
  c_a0af89d8fb: { name: 'methodCall', confidence: 'high' },              // o.m(a);
  c_913ca47cd7: { name: 'destructureConst', confidence: 'high' },        // const { x } = y;
  c_41276fb4e9: { name: 'importThreeSymbols', confidence: 'medium' },    // multiline three import
  c_d48995e064: { name: 'guardFieldGreaterThan', confidence: 'high' },   // if (o.f > n) {
  c_78a478c8cc: { name: 'reExportSymbol', confidence: 'high' },          // export { x } from 'm';
};

// ===========================================================================
// (3) ENUM / TYPE NAMING HINTS — friendly phrasing for enum types.
//     Keyed by the enum type name. Deterministic de-`E`-prefix + humanize is
//     applied as the model rule: EBillingAccountClientType -> "the client type".
// ===========================================================================
const ENUM_OVERRIDES = {
  EBillingAccountClientType: 'the client type',
  EBillingAccountThirdParty: 'the third-party provider',
};

function humanizeEnum(typeName) {
  if (ENUM_OVERRIDES[typeName]) return ENUM_OVERRIDES[typeName];
  // Rule: strip a leading `E`, drop a leading entity word if the type embeds
  // one, split camelCase, lowercase -> "the <phrase>".
  let t = typeName.replace(/^E(?=[A-Z])/, '');
  const wordsArr = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/);
  // Keep the last 2-3 words as the descriptive tail (e.g. ...ClientType -> "client type").
  const tail = wordsArr.slice(-2).join(' ').toLowerCase();
  return 'the ' + tail;
}

// ---------------------------------------------------------------------------
// collect enum type names actually present across the archetype specs.
// ---------------------------------------------------------------------------
function collectEnumTypes() {
  const found = new Map(); // typeName -> hint
  for (const t of Object.keys(ENUM_OVERRIDES)) found.set(t, humanizeEnum(t));
  const archDir = path.join(ROOT, 'spec/archetypes');
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.arch.json')) {
        try {
          const d = JSON.parse(fs.readFileSync(p, 'utf8'));
          for (const pt of (d.slots && d.slots.preambleTypes) || []) {
            if (pt.kind === 'EnumDeclaration' && pt.name && !found.has(pt.name)) {
              found.set(pt.name, humanizeEnum(pt.name));
            }
          }
        } catch (_) {}
      }
    }
  };
  walk(archDir);
  return found;
}

// ---------------------------------------------------------------------------
// build the two sidecars.
// ---------------------------------------------------------------------------
function build() {
  const domain = {}; // id -> { name, hint, confidence, source:'llm' }

  // skeletons
  const skFile = path.join(ROOT, 'catalog/skeletons.json');
  const sk = JSON.parse(fs.readFileSync(skFile, 'utf8'));
  const skByName = new Map((sk.topSkeletons || []).concat(sk.all || []).map((s) => [s.name, s]));
  let skNamed = 0, skKept = 0;
  for (const [name, spec] of Object.entries(SKELETONS)) {
    const s = skByName.get(name);
    const sig = s ? s.sig : '';
    if (spec.keep) {
      domain['sk:' + name] = { name, hint: (sig || name).toLowerCase(), confidence: 'structural', source: 'llm', kind: 'skeleton', sig, structural: true };
      skKept++;
    } else {
      domain['sk:' + name] = { name: spec.name, hint: spec.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase(), confidence: spec.confidence, source: 'llm', kind: 'skeleton', sig, structuralName: name };
      skNamed++;
    }
  }

  // c_ statement words
  const cwFile = path.join(ROOT, 'catalog/compose-words.json');
  const cw = JSON.parse(fs.readFileSync(cwFile, 'utf8')).words || {};
  let cNamed = 0;
  for (const [id, spec] of Object.entries(CWORDS)) {
    const e = cw[id];
    domain[id] = {
      name: spec.name,
      hint: spec.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase(),
      confidence: spec.confidence,
      source: 'llm',
      kind: 'composeWord',
      freq: e ? e.freq : undefined,
      example: e ? String(e.example || '').slice(0, 60) : undefined,
    };
    cNamed++;
  }

  // enum types
  const enums = collectEnumTypes();
  let enumNamed = 0;
  for (const [type, hint] of enums) {
    domain['enum:' + type] = { name: type, hint, confidence: ENUM_OVERRIDES[type] ? 'high' : 'medium', source: 'llm', kind: 'enum' };
    enumNamed++;
  }

  // ---- merged word-names.json: deterministic fallback + LLM supersede -----
  // Seed from the deterministic sidecar if present (hydra-source/word-names.json).
  const merged = {};
  const detPath = path.join(ROOT, 'word-names.json');
  let detCount = 0;
  if (fs.existsSync(detPath)) {
    try {
      const det = JSON.parse(fs.readFileSync(detPath, 'utf8')).names || {};
      for (const [id, v] of Object.entries(det)) {
        merged[id] = { name: v.name, hint: v.hint, tier: v.tier, source: 'deterministic', confidence: 'deterministic', deterministicName: v.name };
        detCount++;
      }
    } catch (_) {}
  }
  // LLM layer supersedes for DISPLAY; deterministic name kept as fallback.
  for (const [id, v] of Object.entries(domain)) {
    const prior = merged[id];
    merged[id] = {
      name: v.name,
      hint: v.hint,
      tier: prior ? prior.tier : v.kind,
      source: 'llm',
      confidence: v.confidence,
      deterministicName: prior ? prior.deterministicName : undefined,
    };
  }

  return { domain, merged, stats: { skNamed, skKept, cNamed, enumNamed, detCount, mergedCount: Object.keys(merged).length } };
}

function main() {
  const { domain, merged, stats } = build();
  const stamp = { schema: null, project: ROOT, generatedBy: 'name-domain.js — model-authored (Opus session), persisted deterministically', modelPass: true };

  const domainOut = { ...stamp, schema: 'sdd-domain-names/1', source: 'llm', count: Object.keys(domain).length, names: domain };
  const wordOut = { ...stamp, schema: 'sdd-word-names/2-merged', note: 'LLM names supersede for display; deterministicName kept as fallback.', count: Object.keys(merged).length, names: merged };

  const dPath = path.join(ROOT, 'catalog/domain-names.json');
  const wPath = path.join(ROOT, 'catalog/word-names.json');
  fs.writeFileSync(dPath, JSON.stringify(domainOut, null, 1) + '\n');
  fs.writeFileSync(wPath, JSON.stringify(wordOut, null, 1) + '\n');

  console.error(`[name-domain] domain-names.json: ${domainOut.count} LLM names -> ${dPath}`);
  console.error(`[name-domain]   skeletons named=${stats.skNamed} kept-structural=${stats.skKept}; c_ words=${stats.cNamed}; enums=${stats.enumNamed}`);
  console.error(`[name-domain] word-names.json (merged): ${stats.mergedCount} ids (${stats.detCount} deterministic seeded, ${domainOut.count} LLM superseding) -> ${wPath}`);
}

if (require.main === module) main();
module.exports = { build, humanizeEnum, SKELETONS, CWORDS, ENUM_OVERRIDES };
