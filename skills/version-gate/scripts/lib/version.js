// The version: ONE number, and the rules that keep it one.
//
// THE AUTHORITATIVE SOURCE is the root package.json's `version`. Every other file that
// carries a version (config.js `versionCopies`: the lockfile, a sub-package, ...) is a COPY
// of it and is checked against it, never read instead of it.
//
// WHO WRITES IT: only a release prep (`release.mjs prepare`), once per release. Feature
// branches never touch a version field: when every open PR bumps it, every merge conflicts
// the next. The gate (check-version.mjs, changesets.js releaseGuard) FAILS a branch that
// moves a version field unless the diff is exactly what `prepare` writes, and a prep must
// raise the version STRICTLY, compared as semver, so 0.10.0 > 0.9.0.

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

// { major, minor, patch, pre: [] } or null. A leading `v` / `<name>-v` is tolerated
// so release tag names parse directly.
export function parseSemver(v) {
  if (typeof v !== 'string') return null;
  const m = SEMVER_RE.exec(v.trim().replace(/^(?:[A-Za-z][\w.]*-)*v/, ''));
  if (!m) return null;
  return {
    major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]),
    pre: m[4] ? m[4].split('.') : [],
  };
}

// -1 / 0 / 1. Throws on an unparsable input: a caller comparing garbage must not get
// an answer it can mistake for "not newer" (or worse, "newer").
export function compareSemver(a, b) {
  const pa = parseSemver(a), pb = parseSemver(b);
  if (!pa) throw new Error(`not a semver version: ${JSON.stringify(a)}`);
  if (!pb) throw new Error(`not a semver version: ${JSON.stringify(b)}`);
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1;
  }
  // semver §11: a pre-release sorts BELOW its release; identifiers compare
  // numerically when both are numeric, lexically otherwise, numeric < alphanumeric.
  if (!pa.pre.length || !pb.pre.length) {
    return pa.pre.length === pb.pre.length ? 0 : (pa.pre.length ? -1 : 1);
  }
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i], y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) > Number(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

// The version a directory's package.json reports. Null (never a throw) when the file is missing
// or unreadable, so a broken manifest cannot take a caller down.
export function readPackageVersion(dir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    return parseSemver(v) ? v : null;
  } catch { return null; }
}

export const VERSION_COPIES = CONFIG.versionCopies;

// Pure: given { [file]: parsedJson }, list every copy that disagrees with the root.
// A missing file or field is a mismatch, not a pass.
export function lockstepMismatches(docs, copies = VERSION_COPIES) {
  const source = docs['package.json']?.version;
  const out = [];
  if (!parseSemver(source)) {
    out.push({ where: 'package.json version', found: source ?? null, expected: 'a semver version' });
    return out;
  }
  for (const { file, fields } of copies) {
    for (const f of fields) {
      const found = f.reduce((o, k) => (o == null ? undefined : o[k]), docs[file]);
      if (found !== source) out.push({ where: `${file} ${f.map(k => k === '' ? '[""]' : k).join('.')}`, found: found ?? null, expected: source });
    }
  }
  return out;
}

export const GATED_BRANCH = CONFIG.integrationBranch;
const ZERO_SHA = /^0+$/;

export const RELEASE_BRANCH = CONFIG.releaseBranch;

// WHAT the gate compares against, for one CI event. Pure, so every event shape is
// unit-tested rather than living in workflow bash.
//
//   { mode: 'pr',   baseBranch }  a PR into the integration branch: guard its diff against the tip
//   { mode: 'push', before }      a push TO it: guard it against the commit
//                                 the push replaced (github.event.before)
//   { mode: 'release-pr', baseBranch }  a PR into the release branch: no changeset may be left pending,
//                                 or the release it tags would ship without their notes
//   { mode: 'skip', reason }      nothing to enforce (logged, never silent)
//   { mode: 'error', reason }     enforceable, but the inputs are unusable — fail closed
//
// The push mode exists because a PR-only gate let a direct push (an admin bypassing
// protection) land whatever it liked with every check green. A push run cannot UN-push
// anything — it can only turn the post-push check red. The rule it applies is the PR rule
// (changesets.js releaseGuard), so an ordinary merge — which moves no version — passes.
export function gatePlan({ event, baseBranch, refName, before, integrationBranch = GATED_BRANCH, releaseBranch = RELEASE_BRANCH } = {}) {
  const gated = integrationBranch, release = releaseBranch;
  if (!gated) return { mode: 'error', reason: 'no integration branch is known: set "integrationBranch" in .version-gate.json (or VERSION_GATE_BRANCH)' };
  if (event === 'push') {
    if (refName !== gated) return { mode: 'skip', reason: `push to '${refName || '?'}', only pushes to ${gated} are gated` };
    if (!before || ZERO_SHA.test(before)) return { mode: 'error', reason: `push to ${gated} with no previous commit (before=${JSON.stringify(before ?? null)}) — cannot tell what it replaced` };
    return { mode: 'push', before };
  }
  if (baseBranch === gated) return { mode: 'pr', baseBranch };
  if (release && baseBranch === release) return { mode: 'release-pr', baseBranch };
  return { mode: 'skip', reason: `base is '${baseBranch || '<none — not a PR>'}', only PRs into ${[gated, release].filter(Boolean).join(' or ')} (and pushes to ${gated}) are gated` };
}

// A release prep's version rule. `head` is the prep's version, `base` the target branch's.
export function bumpVerdict(head, base) {
  if (!parseSemver(head)) return { ok: false, reason: `this branch's package.json version ${JSON.stringify(head)} is not semver` };
  if (!parseSemver(base)) return { ok: false, reason: `the base branch's package.json version ${JSON.stringify(base)} is not semver` };
  if (compareSemver(head, base) > 0) return { ok: true, reason: `version ${base} -> ${head}` };
  return {
    ok: false,
    reason: `version ${head} is not greater than ${base} — a release prep must raise package.json's version (and its copies)`,
  };
}
