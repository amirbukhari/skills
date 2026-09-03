## 8B. THE ARTIFACT CONTRACT — location, header, and enforcement (2026-08-31)

*PART IV — CONTRACTS, CONFIGURATION AND LAYOUT · [index](README.md)*

> This section was previously documentation, so it was not a contract. It is now **executable**:
> `engine/artifact-contract.js` is the single resolver and validator, and
> `engine/artifact-location.test.js` fails the build if any rule below stops holding.

### The location rule

**The engine tree is ENGINE CODE + PRD ONLY.** It is generic, corpus-agnostic and publishable, and
its remote is PUBLIC. It holds no bytes derived from anyone's corpus. Every artifact resolves from
the corpus root the engine was pointed at — `AC.pathFor(kind, corpusRoot)` — and lives with the
corpus:

| home | path | for |
|---|---|---|
| `tracked` | `<corpus>/sen/catalog/` | SOURCE-PROTECTED (§8A): expensive or hand-authored, must survive a cleanup |
| `cache` | `<corpus>/.cache/spec-derived/` | purely derived, regenerable by one command |

`sen/catalog/` rather than root `catalog/` is deliberate: the corpus `.gitignore` ignores root
`catalog/*`, so a SOURCE-PROTECTED artifact placed there would be **silently untracked** — which is
precisely how one gets lost.

**Why this rule exists.** The engine tree was found holding corpus-derived artifacts in a repo whose
remote is public: a dictionary in which the majority of leaf skeletons carried **verbatim function
and property names** from a private codebase (holes generalize *arguments*, never the callee or
property name), and a coverage artifact carrying **real corpus file paths and literal source lines**.
An artifact is corpus data, and corpus data lives with the corpus — not because of tidiness, but
because the engine tree is publishable and the corpus is not.

### The header — every artifact carries one

```
schema           "sdd-repo-dsl/<kind>/<n>"   versioned identity; bump n on ANY shape change
artifactVersion  <n>                          split out so a consumer can range-check
corpus           <absolute path>              corpus-pinned kinds only
generated        <ISO date>
fingerprint      sha256(canonical body without header)[0:16]
```

Current strings — **authoritative, for cross-repo consumers that cannot import the validator**:

| kind | schema | home | file | consumer must read |
|---|---|---|---|---|
| generators-lzw | `sdd-repo-dsl/generators-lzw/1` | tracked | `generators-lzw.json` | `wide`, `narrow`, `gap` |
| mined-library | `sdd-repo-dsl/mined-library/1` | tracked | `mined-library.json` | `leaves`, `composites` |
| word-names | `sdd-repo-dsl/word-names/1` | tracked | `word-names.json` | `names`, `orphans` |
| corpus-coverage | `sdd-repo-dsl/corpus-coverage/1` | cache | `corpus-coverage.json` | `rollup`, `files` |
| gate | `sdd-repo-dsl/gate/1` | cache | `gate.json` | `pass`, `thresholds` |

`word-names` entries are **v1** `{sym, en, sites, named}`, keyed by `sha256(sym)[0:16]` axis-prefixed.
The **v0** shape `{name, hint, tier}` is retired and its producers are archived.

### The enforcement rule — refuse loudly, never fall back silently

A consumer that cannot verify what it is reading **REFUSES**, naming what it expected and what it
got. `catch { return null }` is the bug class, not the safety net: it converts *"your vocabulary is
missing"* into *"your corpus contains no patterns"*, which reads as a measurement rather than a
failure. Validation is the DEFAULT path — `AC.load` is the only read helper, so a new consumer must
go out of its way to be unsafe. A genuinely-correct fallback is passed explicitly (`{optional:true}`)
and returns a **reason**, never a bare null.

Two silent fallbacks were removed when this landed: `loadIndex`'s `catch { idx._lzw = null }`, which
disabled the entire generator layer without a word, and `word-names.load`'s `catch { return {} }`,
which is drift incident 5's silent half.

### The composite id contract (settled — do not guess again)

Compose-layer **composites carry NO `id` field.** They identify by `name` (`g_<len>_<6hex>`) plus
`entryId`; only `leaves` carry `id` (`p_<8hex>`). Any consumer keying a composite on `.id` is wrong
by construction and gets `undefined` for every one of them. Use `AC.idOf(record)`, which returns
`.id` for leaves and `.name` for composites. The id spaces are **disjoint with zero overlap**:
`word-names` keys are `w:`/`n:<16hex>` over the LZW dictionary, compose-layer leaves are `p_<8hex>`.
**Names key the LZW dictionary; the panel surfaces key the compose layer** — so a naming UI must read
the LZW dictionary directly, not the compose library.

### The failure modes this rule exists to prevent

Every one of these has happened, and every one has the **same shape**: a producer changed, a consumer
kept reading, **nothing failed**, and a human eventually noticed a wrong number.

1. A payload written in one encoding, read by a decoder expecting another.
2. **The miner and the renderer walking different file sets** — the miner cannot mine what it never
   sees, so the gap is reported as un-collapsed structure rather than as a walk mismatch. This one
   accounted for the large majority of un-collapsed bodies at the time.
3. An artifact published before a switch, read against the corpus after it.
4. An artifact written to one directory and read from another.
5. **A shape change where the `schema` field already recorded it and nothing checked the field.** The
   most damning of the set: the contract existed as data and was never consulted, which is precisely
   why it is now executable.
6. A count describing one layer while the compile path runs through a different one.

### The guard

`engine/artifact-location.test.js` (5 assertions, mutation-checked three ways): no artifact resolves
inside the engine tree; each lands in the home its protection level demands; no corpus-derived file
sits on disk in the engine tree; **no source line names a corpus artifact relative to `__dirname`**;
every artifact is contract-valid at its corpus location. It is mutation-checked per §10.3 — and it is worth
recording that on its first run it caught call sites that a careful reading of the same code had
missed, which is the §10 argument in one line.

---


### HELD, NOT FORGOTTEN: the two corpus-ROOT artifacts are outside this contract (ruling 2026-09-03)

Two live artifacts sit at the **corpus root** rather than in either §8B home, so they carry no
`AC.stamp` header and are read by path:

| artifact | producer | read by |
|---|---|---|
| `<CORPUS>/files-index.json` | `build-files-index.js` | Kraken's SDD panel — the *"Read — narrate any file as plain language"* surface |
| `<CORPUS>/archetype-index.json` | `build-archetypes.js` | Kraken's archetype panel / the §5F drift check |

**Registering them is HELD by Amir's ruling, and the reason is not tidiness — it is that
registration MOVES THEM.** `AC.pathFor` resolves a registered kind into `sen/catalog/` or
`.cache/spec-derived/`, and the corpus root is exactly the path both Kraken panels read. So the
registration and the Kraken change are **one coordinated change across two repositories**, and
Kraken's `feature/sdd-panel` is not even PR'd yet. Doing the engine half alone breaks both surfaces
and leaves the artifact written to one place and read from another — which is the failure this
project already diagnosed once for the archetype index (§5F §6, where the PRD was stale and the
consumer was right).

**So: do not register these unilaterally.** It needs Amir's sign-off with the Kraken side moving in
step. `build-files-index.js` deliberately claims no registry entry and says so in its header; that
is the current, correct state, not an omission to clean up.

*Recorded because the same question has now been raised, parked, and re-raised twice. The next
session to notice the missing header should read this instead of "fixing" it.*

## 8C. Corpus pinning — publisher and consumer rules

**The failure mode these rules exist to make impossible.** With more than one corpus in play and no
stamp binding an artifact to its tree, a consumer has no way to tell whose numbers it is rendering.
A correct, fresh mine can be **shadowed** by a higher-numbered file from a different project, and
nothing is capped and nothing is stale — the reporting layer is faithfully rendering *another
corpus's artifact*. **The reporting layer cannot be trusted while a number can arrive without
provenance.** The following are non-negotiable.

1. **Every generated artifact carries a corpus stamp.** `schema`, `artifactVersion` and `corpus` (the
   absolute root it was mined from) are written on the artifact itself, never inferred from its path
   or filename. **A filename is not provenance** — two corpora produce identically-named files.
2. **One publisher, and it refuses a mismatch.** Artifacts are written by a single publisher, which
   refuses to publish a library whose declared `corpus` is not the tree it is being published into,
   and writes the artifact **beside the corpus it describes** rather than into a shared catalog.
   Putting the artifact with its corpus is what makes wrong-repo substitution *structurally
   impossible* rather than merely unlikely.
3. **A consumer refuses a non-matching artifact and never falls back.** Resolution matches the
   selected corpus against the artifact's `corpus`. On no match the consumer returns an honest miss
   naming **what it looked for and where it looked**, and renders nothing. Serving another corpus's
   numbers is forbidden: a number without provenance is indistinguishable from a correct one once it
   reaches a screen, which is exactly how this class of failure stays invisible.
4. **An absent stamp is UNKNOWN, not WRONG.** An unstamped artifact is not condemned — it is unusable
   *for reporting* until republished through rule 2. It is never silently adopted as an answer.
5. **Version shadowing is explicit: highest `vN` wins, unversioned sorts lowest — but version rank
   NEVER overrides rule 3.** Filter by corpus first, then take the highest `N` among the matches.
   Rank applied before provenance is the precise mechanism that shadows a correct mine with a stale
   one.
6. **An artifact declares only what it carries.** The publisher asserts that any summary count it
   writes equals what is actually present in the body, and refuses to write when they disagree or when
   the value cannot be verified at all. **Silent under-reporting is banned:** a build that cannot walk
   the whole tree fails loudly or marks itself `complete: false` — it never emits a smaller plausible
   number for a consumer to render as truth.

---

---

## §8B.9 — the day the required-key contract paid for itself

*Added 2026-09-03, at Amir's instruction to say this plainly rather than leave it in a commit message.*

`word-names.json` held **3,582 hand-authored chunk names** and 6 leaf names. It lived in exactly one
place on disk, inside `Examples/`, which the repo `.gitignore` excludes — so it had **no git history
at all**. The only other copy on disk was an 8 KB snapshot that *predated the names it would have had
to restore*.

`reconcile-names.js` stamped its output as `{ names, orphans }`. The registry `requires` a `chunks`
key. A successful APPLY would therefore have written a `word-names.json` with all 3,582 chunk names
**absent — not orphaned, absent** — with nothing anywhere to restore them from.

It never got the chance:

```
ArtifactContractError: artifact contract REFUSED: word-names at (stamp)
  expected: body key "chunks" (registry: requires)
  got:      absent — refusing to publish an artifact its own consumers cannot read
```

**One row in the registry prevented the irreversible loss of the entire naming effort.** Not a test,
not a review, not a backup — a `requires` entry doing exactly the boring thing it was written to do,
on a write nobody had flagged as dangerous.

Three things worth extracting, because the near-miss is more instructive than the save:

1. **The refusal was the only signal.** Every other check was green. Byte-identity read 1037/1037
   throughout, because a name is cosmetic to compilation (§2.2) — the floor we assert first is
   structurally blind to this failure. The tool's own report said `newly orphaned names ....... 2`
   while 974 chunk names had already silently stopped resolving.
2. **The fix order is the whole lesson.** The tempting repair is to add `chunks` to the stamp and move
   on — one line, contract satisfied, tests green. That is precisely the catastrophe: it converts a
   loud refusal into a silent drop, because the orphan half was still unwired. The key went in
   **last**, after census, orphaning, scoring and queue all covered chunks. *Amir, 2026-09-03: "fix it
   per §5C, do NOT paper it."*
3. **`absent is a state, present-but-wrong is a bug`** (§8B) is what made the refusal possible at all.
   A schema that tolerated a missing key to be helpful would have published.

The deeper defect the refusal exposed was in the **record schema**, not the tool. A leaf record stores
the skeleton it names; a chunk record stored `{en, len, note}` against a one-way hash of its leaves.
§5C rule 2 scores an orphan by edit distance over its skeleton — so re-adoption for chunks was not
unimplemented, it was **unimplementable**. Chunk records now carry `leaves`, which is the change that
stops this recurring rather than the one that recovered it.
