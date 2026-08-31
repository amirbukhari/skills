'use strict';
/*
 * prose-llm-render.js — renders the 3 target files TWICE:
 *   OLD = the deterministic engine/prose.js output (s1's renderer, unchanged), and
 *   NEW = the same, upgraded with the model-authored domain names from
 *         catalog/domain-names.json (+ merged catalog/word-names.json).
 *
 * It does NOT edit engine/prose.js — it reuses that module's exported helpers
 * (coverage, byteToLine, words, list, a) and layers domain phrasing on top, so
 * s1's live file is untouched. Run read-only: `node prose-llm-render.js`.
 */
const fs = require('fs');
const path = require('path');
const P = require('./engine/prose.js');
const CR = require("./engine/corpus-root");

const ROOT = CR.corpusRoot();   // WRITE root: sen/
const SRC = CR.sourceRoot();    // READ root: the .ts
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readArch = (rel) => readJson(path.join(CR.senDir(), 'archetypes', rel + '.arch.json'));
const readBodies = (rel) => { try { return readJson(path.join(CR.senDir(), 'skeletons', rel + '.skel.json')).bodies || []; } catch (_) { return []; } };
const readSrc = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const DOMAIN = readJson(path.join(ROOT, 'catalog/domain-names.json')).names;

const targets = [
  'src/entities/hydra/BillingAccount.ts',
  'src/routers/accounts.ts',
  'src/hydra-ui/src/redux/features/accounts/accountsSlice.ts',
];

/* ---- shared helpers reused from prose.js (a() is internal, redefined here) ---- */
const { coverage, coverageLine, byteToLine, words, list } = P;
const a = (noun) => (/^[aeiou]/i.test(noun) ? 'an ' : 'a ') + noun;

/* =========================================================== ENTITY (NEW) === */
function newEntity(arch, bodies) {
  const s = arch.slots;
  const out = [];
  out.push(`\`${s.className}\` is an entity stored in \`${arch.table || s.table}\`.`);
  const cols = (s.columns || []).map((col) => {
    const name = words(col.prop);
    const p = col.parsed || {};
    if (col.decorator === 'PrimaryGeneratedColumn' || /PrimaryGenerated/.test(p.raw || '')) return `an auto-generated ${name}`;
    // DOMAIN UPGRADE: enum columns read via their model hint.
    if (p.type === 'enum' && p.enum && DOMAIN['enum:' + p.enum]) {
      const req = p.nullable === 'true' ? 'optional' : 'required';
      return `${DOMAIN['enum:' + p.enum].hint} (${req})`;
    }
    const type = p.type || 'value';
    const req = p.nullable === 'true' ? 'optional' : 'required';
    return a(`${name} (${type}, ${req})`);
  });
  if (cols.length) out.push(`It has ${cols.length} fields: ${list(cols)}.`);
  const belongs = [], many = [];
  for (const r of s.relations || []) {
    if (r.decorator === 'JoinColumn' || r.decorator === 'JoinTable') continue;
    const m = (r.args || '').match(/=>\s*([A-Za-z_$][\w$]*)/);
    const t = m ? m[1] : (r.decorator || 'record');
    if (r.decorator === 'ManyToOne' || r.decorator === 'OneToOne') belongs.push(t);
    else many.push(words(r.prop));
  }
  const rel = [];
  if (belongs.length) rel.push(`belongs to ${list(belongs.map((t) => a(t)))}`);
  if (many.length) rel.push(`has many ${list(many)}`);
  if (rel.length) out.push(`It ${list(rel)}.`);
  // DOMAIN UPGRADE: name the enum types by their friendly phrasing.
  const enums = (s.preambleTypes || []).filter((t) => t.kind === 'EnumDeclaration' && DOMAIN['enum:' + t.name]);
  if (enums.length) out.push(`It defines ${enums.length} enumerated type${enums.length === 1 ? '' : 's'}: ${list(enums.map((t) => `${DOMAIN['enum:' + t.name].hint} (\`${t.name}\`)`))}.`);
  return out.join(' ') + '\n' + coverageLine(coverage(bodies));
}

/* =========================================================== ROUTER (NEW) === */
const ENTITY_OF = { accountId: 'account', freshbooksClientId: 'client', partnerId: 'partner', contactId: 'contact', profileId: 'profile' };
function humanSeg(seg) { return seg.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase(); }
const PLURAL = /(costs|splits|usage|invoices|groups|statements|ids|contacts|addresses)$/i;

function routeResource(rtPath) {
  const segs = rtPath.split('/').filter(Boolean);
  const params = segs.filter((x) => x.startsWith(':')).map((x) => x.slice(1));
  const statics = segs.filter((x) => !x.startsWith(':') && !/^:?\w+-:?\w+$/.test(x));
  const entity = ENTITY_OF[params[0]] || (params[0] ? humanSeg(params[0].replace(/Id$/, '')) : 'collection');
  const subs = statics.filter((x) => !/^\d/.test(x));
  if (subs.length) {
    const sub = humanSeg(subs[subs.length - 1]);
    return { phrase: `the ${entity}'s ${sub}`, plural: PLURAL.test(subs[subs.length - 1]) };
  }
  if (params.length === 0) return { phrase: `the list of ${entity === 'collection' ? 'accounts' : entity + 's'}`, plural: true };
  return { phrase: `the ${entity}`, plural: false };
}

function routePhrase(rt, handler) {
  const { phrase, plural } = routeResource(rt.path);
  const it = plural ? 'them' : 'it';
  const m = rt.method.toLowerCase();
  const hasFetch = handler && (handler.sig || '').includes('FETCH');
  let verb;
  if (m === 'get') verb = hasFetch ? `loads ${phrase} and returns ${it}` : `returns ${phrase}`;
  else if (m === 'post') verb = `creates ${phrase}`;
  else if (m === 'put' || m === 'patch') verb = `updates ${phrase}`;
  else if (m === 'delete') verb = `removes ${phrase}`;
  else verb = `handles ${phrase}`;
  // Honesty tail: named skeleton -> confirm the shape; bespoke -> flag custom logic.
  if (handler && handler.named) {
    const dn = DOMAIN['sk:' + handler.skeleton];
    const shape = dn && !dn.structural ? ` (${dn.name})` : '';
    return `${verb}${shape}`;
  }
  if (handler) return `${verb} — custom logic (${handler.stmtCount} statements)`;
  return verb;
}

function newRouter(arch, bodies, src) {
  const s = arch.slots;
  const out = [];
  const routes = s.routes || [];
  out.push(`The \`${(s.routerVars || ['router'])[0]}\` router exposes ${routes.length} routes under \`${s.prefix || '/'}\`.`);
  const arrows = (bodies || []).filter((b) => b.ownerKind === 'arrow').slice().sort((x, y) => x.line - y.line);
  for (const rt of routes) {
    let handler = null;
    if (rt.handlerSpan && src) {
      const lo = byteToLine(src, rt.handlerSpan[0]), hi = byteToLine(src, rt.handlerSpan[1]);
      const inSpan = arrows.filter((b) => b.line >= lo && b.line <= hi);
      handler = inSpan.sort((x, y) => (y.stmtCount || 0) - (x.stmtCount || 0))[0] || null;
    }
    out.push(`- ${rt.method.toUpperCase()} ${rt.path} — ${routePhrase(rt, handler)}.`);
  }
  return out.join('\n') + '\n' + coverageLine(coverage(bodies));
}

/* ============================================================ REDUX (NEW) === */
function newRedux(arch, bodies) {
  const s = arch.slots;
  const out = [];
  const reducers = s.reducers || [];
  out.push(`The \`${s.name}\` slice owns its state with ${reducers.length} reducers: ${list(reducers.map((r) => `${words(r)} (\`${r}\`)`))}.`);
  if (s.hasInitialState) out.push('It defines an initial state.');
  if (s.hasExtraReducers) out.push(`It also handles extra reducers.`);
  return out.join(' ') + '\n' + coverageLine(coverage(bodies));
}

const NEW = { Entity: newEntity, RouterModule: newRouter, ReduxModule: newRedux };
function renderNew(arch, bodies, src) {
  const r = NEW[arch.archetype];
  return r ? r(arch, bodies, src) : '(no renderer)';
}

/* ================================================================= main ==== */
for (const rel of targets) {
  const arch = readArch(rel), bodies = readBodies(rel), src = readSrc(rel);
  console.log('\n' + '#'.repeat(92));
  console.log(`${rel}   [${arch.archetype}]`);
  console.log('#'.repeat(92));
  console.log('\n--- OLD (deterministic engine/prose.js) ---');
  console.log(P.renderProse(arch, { bodies, src }));
  console.log('\n--- NEW (model domain names) ---');
  console.log(renderNew(arch, bodies, src));
}
