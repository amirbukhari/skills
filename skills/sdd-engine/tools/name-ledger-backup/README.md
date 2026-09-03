# Name ledger backup — the only version-controlled copy of the hand-authored names

**Why this directory exists.** On 2026-09-03 a throwaway-corpus experiment established that
`word-names.json` — carrying **3,582 hand-authored chunk names** and 6 leaf names — existed in
exactly one place on disk, inside `Examples/`, which `.gitignore:32` excludes from version control.
It therefore had **no git history**. The only other copy was an 8 KB pre-worksheet snapshot that
*predates the names it would have to restore*.

At the same time it was measured that `reconcile-names.js` will orphan **974 of the 3,582** chunk
names on a canon re-mine while reporting `newly orphaned names ....... 2`, and that its APPLY path
stamps `{ names, orphans }` — omitting `chunks` entirely. A successful APPLY would have written a
`word-names.json` with **all 3,582 chunk names absent, not orphaned**, with nothing to restore from.

Only the §8B required-key contract stopped it:

```
ArtifactContractError: artifact contract REFUSED: word-names at (stamp)
  expected: body key "chunks" (registry: requires)
  got:      absent — refusing to publish an artifact its own consumers cannot read
```

A single artifact-contract row prevented irreversible loss of the entire naming effort. This backup
exists so that guard is not the *only* thing standing between a routine command and that loss.

## What is here

| file | md5 | contents |
|---|---|---|
| `word-names.2026-09-03.json` | `2cd40101e53186d0d7d0b9d3f8f19161` | the live ledger: 6 leaf names, 0 orphans, **3,582 chunk names** |
| `word-names.pre-worksheet-2026-09-02T11-31-24-317Z.json` | `a146580d5c3eec9e457c8a975a7db94c` | the pre-existing 8 KB snapshot, kept for completeness — it PREDATES the 3,582 and cannot restore them |
| `word-names.2026-09-03-enriched.json` | `8779fdb28e3cf1ea92a90200c6dce615` | after `enrich-chunk-leaves.js`: all **3,582 chunk records now carry the leaf skeletons they name**, 974 of them recovered from a pre-body-slot catalog and marked `leavesFrom`. No `en` label changed, no record dropped |
| `word-names.2026-09-03-reconciled.json` | `c1bcfa0c2ee2e79024fb7eafc461f997` | after `reconcile-names.js APPLY`: the 974 that stopped resolving at the 2026-09-02 22:51 re-mine moved into `orphans`, all carrying their skeletons. 2,608 resolving + 974 orphaned = **3,582 preserved, 0 lost** |

These are a CHAIN, not alternatives. Each row is the input to the next, and every one of them is
restorable independently — which is the property that made it safe to run a guard-lifting write at
all. Byte-identity read **1037/1037 before and after**, so no step in the chain moved a single byte
of rendered prose.

**Why the enriched row matters more than it looks.** A chunk record used to be `{en, len, note}`
keyed by a one-way hash of its leaves, so it held no recoverable description of the thing it named.
§5C rule 2 scores an orphan by edit distance over its skeleton — with no skeleton, re-adoption for
chunks was not unimplemented, it was **unimplementable**. Those 974 were one write away from being
names nothing could ever propose back. The 974 leaves were recovered from a catalog that happened to
still exist in a scratch directory, which is luck rather than a strategy; storing `leaves` on the
record is what retires the luck.

`MD5SUMS` carries both. Verify with `md5sum -c MD5SUMS` from this directory.

## Why a copy here and not an un-ignore in place

`.gitignore:32` ignores the directory `skills/sdd-engine/Examples/`. Git cannot re-include a file
beneath an excluded **directory** without also re-including the directory chain above it, so a
targeted un-ignore for this one file is not expressible — the negation would have to open
`Examples/` itself and then re-exclude everything else, which broadens the tracked surface to the
whole 71 MB corpus (including a 34 MB regenerable catalog) and risks committing artifacts that are
deliberately untracked. A tracked copy achieves the requirement — the names are in version control —
without touching the ignore rules at all.

**The tradeoff, stated rather than hidden:** this copy does not update itself. It is a snapshot, and
it will go stale the moment names are authored. Re-copy it in the same commit as any authoring pass:

```sh
cp Examples/hydra-source/sen/catalog/word-names.json \
   tools/name-ledger-backup/word-names.$(date +%F).json
cd tools/name-ledger-backup && md5sum *.json > MD5SUMS
```

## Restoring

```sh
# from the repo root, with the file you want:
cp skills/sdd-engine/tools/name-ledger-backup/word-names.2026-09-03.json \
   skills/sdd-engine/Examples/hydra-source/sen/catalog/word-names.json
md5sum skills/sdd-engine/Examples/hydra-source/sen/catalog/word-names.json
# expect 2cd40101e53186d0d7d0b9d3f8f19161
```

Names key on the **content hash of the canonical skeleton**, never on the word id
(`10-language-and-grammar.md:42`), so restoring this file after a re-mine re-attaches every name
whose skeleton still exists. Names whose skeleton genuinely moved will not re-attach — that is
correct behaviour per §5C, and it is the orphan/re-adoption path's job, not this file's.
