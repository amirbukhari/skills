# 1B. THE TWO ROOTS — `SOURCE` and `CORPUS`, and the `sen/` folder

*PART IV — CONTRACTS, CONFIGURATION AND LAYOUT · [index](README.md)*

**Status: BUILT, not proposed.** This section records what is actually implemented on disk and is
the engine's real configuration model. **It is the only root design.** An earlier proposal for three
roots (`EN_ROOT` / `TS_ROOT` / `BUILD_ROOT`) is **superseded and removed** — Amir, 2026-08-31:
*"The PRD still has a TON of stale data in it. like the 3 folders shit."* Two roots is the design;
what remains open about the *direction of truth* is §1B.5, stated in full there and nowhere else.

## 1B.1 Two environment variables, and only two

| var | role | contents |
|---|---|---|
| **`SOURCE`** | the **READ** root | the `.ts` tree the engine walks, parses and mines. **Never written by any tool.** |
| **`CORPUS`** | the **WRITE** root | holds `sen/` (the rendered English + the mined catalog artifacts) and every generated/derived tree (`.cache/`, root rollups). |

Amir, verbatim: *"Okay so it needs to be 2 different environment variables. One is where we read from
and one is where we write too. I need it to be this way because I should be able to copy the contents
of one codebase into a new one. and then I should be able to flip the path and then have both env
files point at the same corpus for reading and writing"*

**They are independent.** Each is settable and defaultable on its own, with no crosstalk:

- **Same directory** — `SOURCE=X CORPUS=X`. Self-hosting. This is today's behaviour and the shipped
  default (`Examples/hydra-source`), and it is why the distinction was invisible for so long.
- **Different directories** — `SOURCE=old CORPUS=new`. Render a copied or forked codebase into a
  fresh tree without writing a byte into the tree being read. This is the case that required two
  variables rather than one, and it is the reason `CORPUS` could not simply be renamed `SOURCE`.

Precedence, **per root, resolved in exactly one module** (`tools/repo-dsl/engine/corpus-root.js`):

```
--source=… / --corpus=…   (flag, relative to cwd)
  > SOURCE= / CORPUS=     (process env, relative to cwd)
  > <engine>/.env         (relative to the engine root)
  > engine-relative default   Examples/hydra-source
```

A root that is **set but missing refuses loudly**, naming the root, the resolved absolute path, and
**which layer supplied it**. There is no silent fallback to a default when an explicit setting is
wrong — a wrong path that silently becomes the right one is how a measurement gets attributed to the
wrong tree (§8B, incident 3).

## 1B.2 `spec/` is renamed `sen/` (lowercase)

Amir: *"the .en files go into the corpus folder. right now we have it called spec but it should be
called sen"*, then *"rename that folder SEN"*, then *"lowercase"*.

The **whole** folder was renamed inside `CORPUS`, substructure preserved and every file's content
byte-identical — verified by comparing a file manifest hash before and after:

```
<CORPUS>/sen/files/       the rendered .en, mirroring the SOURCE tree
<CORPUS>/sen/catalog/     the §8B tracked artifact home (generators-lzw, mined-library, word-names)
<CORPUS>/sen/skeletons/   derived
<CORPUS>/sen/archetypes/  derived
```

**`sen` is not a third root.** It is a folder *name*, spelled in exactly one place —
`LAYOUT.sen` in `engine/corpus-root.js` — and consumed everywhere else through `CR.senDir()` or
`AC.HOMES.tracked`. It is not configurable, and it should not become configurable: its position is
defined by `CORPUS`, and a second knob for one fact is a second source of truth (R-PIN-7).

Variable names stay uppercase by convention (`SOURCE`, `CORPUS`); the folder on disk is lowercase
`sen`. Note that §8A/§8B prose written before today still says `<corpus>/sen/catalog/`; that path
now reads `<corpus>/sen/catalog/`, and the code is the authority.

## 1B.3 `sen/` is wipable — behind an explicit flag, never otherwise

Amir: *"the SEN folder with the catalog is supposed to be wipable"*.

It is, and the gate is deliberate rather than incidental:

- Wiping `sen/` requires an **explicit flag the user types**. Never a default, never silent, never a
  side effect of a cheaper cleanup, and never triggered by an engine change alone.
- **No flag = refuse**, and the refusal must *name what it would have deleted*, with file and byte
  counts, so the cost of the wipe is visible before it is paid.
- The wipe must not touch `<CORPUS>/catalog/` — the **legacy STEP-4 tree** at the corpus root. That
  is a separate and still-undetermined question, explicitly out of scope. See §1B.4.
- **`SOURCE` is never wipable, by this or any tool.** It is read-only input, full stop. The
  protection must hold *structurally* even in the self-hosting case where `SOURCE === CORPUS`, not
  by the cleaner happening to be pointed elsewhere.

Owner: `tools/repo-dsl/sdd-clean.js`, gated on `--wipe-sen` **and** `--go`. It lives in the
**engine**, not in the corpus. It used to be `<corpus>/sdd-clean.js`; on 2026-08-31 Amir wiped the
corpus by hand and the cleaner went into the wastebasket along with the tree it existed to clean.
A tool that deletes a tree must not live inside it — and a fresh corpus should need no scripts
copied into it. Amir on that wipe: *"it was a deliberate wipe. I shouldnt see any of those files
show up again unless I run the command"* — which is the requirement stated as an operating habit.

**Why a wipe is tolerable at all.** `sen/catalog/` holds SOURCE-PROTECTED artifacts (§8A) that a
`.en` cannot compile without — wiping them is closer to wiping source than to clearing a cache. What
makes the gated wipe acceptable **today** is that `sen/` is entirely **re-derivable from `SOURCE`**:
the `.en` is rendered from the `.ts`, not the reverse. If that ever inverts (§1B.5), this gate must
harden from *"explicit flag"* to *"refuse"*.


## 1B.4 The two catalogs are different things

`<CORPUS>/catalog/` (legacy STEP-4: `operation-idioms.json`, `function-archetypes.json`, and the
hand-curated `coined-words.json`) is **not** `<CORPUS>/sen/catalog/` (the §8B tracked artifact home).
They are separately produced, separately consumed, and separately protected. Do not merge or
conflate them without a decision. `sen/catalog/` was chosen over the root `catalog/` precisely
because the corpus `.gitignore` ignores root `catalog/*`, so a SOURCE-PROTECTED artifact put there
would be silently untracked (§8B).

## 1B.5 OPEN — the direction of truth is not settled

**Unresolved. Do not resolve it by inference, and do not treat the two roots as having settled it.**

§1 states the thesis: the English is the source and the `.ts` is derived. **What is built is the
opposite** — the `.ts` in `SOURCE` is authoritative, the `.en` in `CORPUS/sen/` is generated from
it, and `sen/` is therefore wipable (§1B.3). Nothing in the two-root work moves the project across
that line; it makes the two directions cheap to point at different trees, which is a **precondition**
for a flip, not the flip.

**Full-corpus byte-identity is necessary and NOT sufficient to flip**, for two specific reasons:

1. **The gate only tests machine-rendered `.en`.** It asserts `compile(render(ts)) === ts`. A
   *hand-edited* `.en` — the entire point of a flip — exercises paths the gate has never run. Until
   a human has edited a `.en`, compiled it, and reviewed the resulting `.ts` as a normal diff,
   "English is the source" is an assertion about a path nobody has walked.
2. **THE BLOCKER — `.en` payloads reference word ids, and the ids move.** See **R-PAY-6**: ids are
   array indices renumbered by every re-mine, so a `.en` is decodable only against the exact
   dictionary it was rendered with. Harmless today, because the `.ts` is authoritative and a `.en`
   can always be re-rendered. After a flip it is fatal: one re-mine silently invalidates every `.en`,
   and the failure is a compile producing **wrong bytes, not an error**. **Nothing may flip until
   R-PAY-6 is closed.**

**And whatever happens, the `.ts` stays generated AND committed** — like generated clients or
protobufs: authored elsewhere, checked in anyway. A broken compiler then costs a rebuild, never the
code. The failure this ordering exists to prevent is a cleanup treating `src/` as derived output
while the `.en` still cannot be trusted to reproduce it — deleting the only copy on the strength of a
gate that never tested hand-authored input. This effort has already destroyed irreplaceable
artifacts once.

**Any session that touches direction-of-truth must ask Amir which direction is current before
assuming.** This gap was silently forgotten once already; it is written here so it cannot be again.


## 1B.6 Acceptance test — the one-file rule

Amir, verbatim, 2026-08-31, and this is a **rule**, not a preference:

> *"if you need to make more than 1 file change to alter the directory we are pointing at then we
> have done this wrong and need to fix it"*

**Repointing any one root — `SOURCE` or `CORPUS` — must be a ONE-FILE change: one line in
`<engine>/.env`.** It holds per root, independently. Any future change to how roots are found must
preserve it, and it is enforced executably, not by review:
`tools/repo-dsl/engine/corpus-root.test.js` greps the live tree and fails if a root literal, a
corpus-rooted `spec` join, or a second spelling of `sen` reappears anywhere outside the resolver
and `.env`.

---


**This part states GATES, not readings.** A number here is a threshold or a definition. Nothing in
this part is a status report; where status is contested, that is §Q-2.
