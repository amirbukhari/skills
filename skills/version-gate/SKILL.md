---
name: version-gate
description: Stop open pull requests from conflicting on the version number and changelog by having each PR add one changeset file, with a CI gate that rejects hand edits and a release command that writes the version, changelog and release notes once. Use when every PR bumps package.json and merges keep conflicting, when setting up release notes or a changelog workflow for a Node repository, when version copies drift between package files, or when the user asks for a version check in CI.
---

# version-gate

When every PR raises the version and adds a changelog entry, any two open PRs
edit the same lines, so each merge conflicts the next. Here a feature PR adds
one new file and touches nothing shared. One command per release writes the
version and both logs, and the gate accepts that diff only if it is byte-for-byte
what the command produces.

| Who | What it changes |
| --- | --- |
| A feature PR | Adds `.changes/<unique-name>.md`. No version field, no changelog entry, no release note. |
| A release prep | `release.mjs prepare`: raises the version in every copy, folds all changesets into `CHANGELOG.md` and `release-notes.json`, deletes them. |

## A changeset

```markdown
---
what: Search results load as you type.
why: You find the right record without pressing Enter and waiting.
---
- **Incremental search** (`searchIndex`). The engineering changelog text; identifiers welcome.
```

`what` and `why` become one change in the customer-facing release note. They are
linted: no commit prefix such as `fix(...):`, no `#123`, no backticks, no file
names, no snake_case identifiers. A change no user would notice says
`noUserFacingChanges: true` in place of `what` and `why`. The body goes into the
changelog.

## Install into any repository

Needs Node 18+, git, and a root `package.json` with a semver `version`. The
`--open` flag also needs the `gh` CLI.

1. Copy `scripts/` to, for example, `tools/version-gate/`.
2. Create `CHANGELOG.md` (any header prose, entries under `## <version>`
   headings) and `release-notes.json` (`{ "releases": [] }` to start), and a
   `.changes/` folder.
3. Add `.version-gate.json` at the repository root. Every key is optional:

   ```json
   {
     "integrationBranch": "<branch feature PRs merge into>",
     "releaseBranch": "<branch releases are cut from, if it differs>",
     "remote": "origin",
     "tagPrefix": "v",
     "versionCopies": ["package-lock.json", "apps/desktop/package.json"],
     "changesDir": ".changes",
     "changelog": "CHANGELOG.md",
     "releaseNotes": "release-notes.json",
     "prepBranch": "release-prep",
     "worktreesDir": ".worktrees"
   }
   ```

   - `integrationBranch`: when absent, `VERSION_GATE_BRANCH` from the
     environment, else the remote's default branch from
     `refs/remotes/<remote>/HEAD`. A shallow CI checkout has no such ref, so name
     the branch in the file. With none of the three the gate fails; it never
     guesses a branch.
   - `releaseBranch`: when set, a PR into it fails while changesets are pending.
   - `versionCopies`: every file besides `package.json` that carries the version.
     A path, or `{ "file", "fields": [["path", "to", "field"]] }`. Lockfiles get
     `version` and `packages[""].version`. When absent: `package-lock.json` if it
     exists.
   - An unknown key or a file that is not JSON is an error.
4. Run the gate in CI, with the event passed in:

   ```yaml
   - run: node tools/version-gate/check-version.mjs lockstep
   - run: node tools/version-gate/check-version.mjs notes
   - run: node tools/version-gate/check-version.mjs gate
     env:
       GATE_EVENT: ${{ github.event_name }}
       GATE_BASE: ${{ github.base_ref }}
       GATE_REF: ${{ github.ref_name }}
       GATE_BEFORE: ${{ github.event.before }}
   ```

   Other CI systems set the same four variables: the event (`pull_request` or
   `push`), the PR's base branch, the pushed branch, and the commit the push
   replaced.
5. Optional: copy `scripts/version-files-untouched.test.mjs` into the test suite's
   glob, keeping it beside `check-version.mjs`. It runs the guard against the
   checked-out branch, so a bad branch fails locally before it is pushed.

## Commands

| Command | Checks |
| --- | --- |
| `check-version.mjs lockstep` | Every version copy equals `package.json`'s. |
| `check-version.mjs notes` | The release-notes file is valid: shape, semver, newest first, plain language. |
| `check-version.mjs guard <base-ref> [<head-ref>]` | The diff is a feature change with a valid changeset, or exactly a release prep. |
| `check-version.mjs gate` | Decides from the event whether to enforce, fetches the commit to compare with, runs `guard`. |
| `release.mjs prepare --title "<line a user reads>" [--version x.y.z]` | Writes the release into the current checkout. |
| `release.mjs prepare --title "…" --branch [<name>] [--open]` | Does it in a new worktree off the integration branch and commits; `--open` pushes and opens the PR. |

The next version is one patch above the highest of `package.json` and every
`<tagPrefix><x.y.z>` tag, local and on the remote. `--version` must be higher
than that.

## What the gate holds to

- A feature diff that touches a version field, a changelog entry or the release
  notes fails, with the instruction to add a changeset. The changelog's header
  prose above the first `## ` heading stays editable.
- A lockfile may change; only its version fields are guarded.
- A feature diff with changes and no changeset fails.
- A release prep must raise the version strictly (semver, so 0.10.0 is above
  0.9.0), change nothing in the version files but the version, consume every
  pending changeset and add none.
- A push to the integration branch is checked against the commit it replaced, so
  a direct push that bypasses review still turns the check red.
- Everything fails closed: an unreadable file, an unresolvable ref, a commit that
  cannot be fetched, an unparsable version.
- In a full checkout the gate never fetches with `--depth`, which would make the
  whole repository shallow.

## Tests

```bash
node --test tests/*.test.mjs
```

The end-to-end tests drive the real CLIs against throwaway repositories with a
local bare remote, including a depth-1 clone as CI makes one. `gh` is a stub.
