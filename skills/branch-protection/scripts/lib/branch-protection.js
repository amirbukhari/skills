// Branch protection as a checked-in desired state (a JSON file in the repository), and
// the plan branch-protection.mjs prints and applies.
//
// ONE FIELD IS MANAGED: `required_status_checks.strict` ("Require branches to be up to date
// before merging"). Everything else in the file is RECORDED, compared and reported, but never
// written. The reason is what a non-admin can see. Without repo admin the protection endpoints
// 404 and `GET /branches/<b>` shows only the required contexts, so required reviews,
// restrictions and enforce_admins are invisible. A full `PUT .../protection` replaces all of
// them, and a body built from what this account can read would silently wipe what it can't.
// The only write is `PATCH .../protection/required_status_checks` with `{ strict }`, which
// touches nothing else.
//
// Pure: it sees the desired branch entry and what was observed, and returns rows + a patch.

// Order-insensitive identity of a required check. `app_id` is part of it: a check pinned to
// GitHub Actions (15368) and the same context name from any app are different requirements.
const checkKey = c => `${c.context}@${c.app_id ?? 'any'}`;

export function sameChecks(a = [], b = []) {
  const x = a.map(checkKey).sort();
  const y = b.map(checkKey).sort();
  return x.length === y.length && x.every((k, i) => k === y[i]);
}

// desired: the branch's entry from the JSON file.
// observed: { checks: [{context, app_id}] | null, strict: boolean | null } — null = could not read.
export function planBranch(desired, observed) {
  const want = desired?.required_status_checks || {};
  const rows = [];

  const haveStrict = observed?.strict ?? null;
  rows.push({
    field: 'required_status_checks.strict',
    managed: true,
    want: want.strict,
    have: haveStrict,
    status: haveStrict === null ? 'unknown' : haveStrict === want.strict ? 'ok' : 'drift',
  });

  const haveChecks = observed?.checks ?? null;
  rows.push({
    field: 'required_status_checks.checks',
    managed: false,
    want: (want.checks || []).map(checkKey),
    have: haveChecks === null ? null : haveChecks.map(checkKey),
    status: haveChecks === null ? 'unknown' : sameChecks(want.checks, haveChecks) ? 'ok' : 'drift',
  });

  // Patch only the managed field, and only when it is not already known to match. An
  // unknown current value is patched: setting strict to the value it already has is a no-op.
  const strictRow = rows[0];
  const patch = typeof want.strict === 'boolean' && strictRow.status !== 'ok' ? { strict: want.strict } : null;
  return { rows, patch };
}

// Whether `--apply` may write. Refuses without admin, BEFORE any request is sent: the write
// would 404 anyway, and refusing up front says why instead of leaving a bare "Not Found".
export function applyDecision({ patch, admin }) {
  if (!patch) return { write: false, reason: 'nothing to change: the managed field already matches' };
  if (admin !== true) {
    return { write: false, refuse: true, reason: 'this account is not an admin on the repo; branch protection needs repo admin (an org owner, or an admin collaborator)' };
  }
  return { write: true, reason: `PATCH required_status_checks ${JSON.stringify(patch)}` };
}
