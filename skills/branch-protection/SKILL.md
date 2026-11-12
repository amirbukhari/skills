---
name: branch-protection
description: Keep a GitHub repository's branch protection in a checked-in JSON file, compare it with the live settings, and apply the "require branches to be up to date" setting without overwriting anything else. Use when required status checks drift from what CI actually runs, when the "branch is out of date" rule needs turning on or off for a busy branch, when auditing protection without admin rights, or when the user asks for branch protection as code.
---

# branch-protection

Compares live branch protection with a file in the repository and prints, per
field, what is wanted and what is there. With `--apply` it writes exactly one
setting: `required_status_checks.strict` ("Require branches to be up to date
before merging").

## Why it writes one field only

Without repository admin, the protection endpoints return 404 and only the
required check names are visible. Required reviews, push restrictions and
admin enforcement cannot be read. The full update endpoint replaces all of them,
so a body built from what a non-admin can see would wipe what it cannot see.
The tool only sends `PATCH …/protection/required_status_checks` with
`{ "strict": … }`, which changes nothing else. The list of required checks is
recorded and compared, and never written.

## The file

`.github/branch-protection.json`:

```json
{
  "repo": "owner/name",
  "branches": {
    "<branch>": {
      "required_status_checks": {
        "strict": false,
        "checks": [
          { "context": "test (ubuntu-latest)", "app_id": 15368 }
        ]
      }
    }
  }
}
```

`repo` is optional. `app_id` is part of a check's identity: `15368` pins the
check to GitHub Actions, and the same name from another app is a different
requirement.

## Run it

Needs Node 18+ and the `gh` CLI, logged in.

```bash
node <skill>/scripts/branch-protection.mjs             # read-only
node <skill>/scripts/branch-protection.mjs --apply     # needs repository admin
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--config <file>` | The desired-state file. | `.github/branch-protection.json` at the root of the checkout it runs in |
| `--repo <owner/name>` | The repository. | `repo` in the file, else what `gh repo view` reports for the checkout |
| `--apply` | Send the `strict` patch. | off |

Output per branch:

```
trunk
  drift   required_status_checks.strict
          want false
          have true
  ok      required_status_checks.checks (recorded, never written)
  --apply would PATCH required_status_checks {"strict":false}
```

`have unknown (needs admin)` is the normal answer for a non-admin. `--apply`
without admin is refused before any write is sent and exits 1. With the setting
already matching, `--apply` sends nothing. An unknown flag or an unreadable file
exits 2 before any request.

## Install into any repository

Copy `scripts/` to, for example, `tools/branch-protection/`, add the JSON file,
and optionally a test in the repository's own suite that the recorded `checks`
equal the job names CI produces, so renaming a CI job cannot silently leave a
required check that never reports.

## Tests

```bash
node --test tests/*.test.mjs
```

The CLI tests run against a stub `gh` that records every call. They touch no
network.
