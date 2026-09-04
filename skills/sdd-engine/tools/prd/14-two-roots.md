# 1B. THE TWO ROOTS — `SOURCE` and `CORPUS`, and the `sen/` folder

*PART IV — CONTRACTS, CONFIGURATION AND LAYOUT · [index](README.md)*

**Status: BUILT, not proposed.** This section records what is actually implemented on disk and is
the engine's real configuration model. **It is the only root design.** An earlier proposal for three
roots (`EN_ROOT` / `TS_ROOT` / `BUILD_ROOT`) is **superseded and removed** — Amir, 2026-08-31:
*"The PRD still has a TON of stale data in it. like the 3 folders shit."* Two roots is the design;
the *direction of truth* is **RULED** — §1B.5, stated in full there and nowhere else. *(That line
used to read "what remains open about the direction of truth is §1B.5". **Retracted 2026-09-04:**
Q-1 closed 2026-09-03 and §1B.5 now records the ruling rather than an open question.)*

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
`sen`. *(A sentence here previously claimed a path "now reads" what it already said — a botched
find-replace that asserted nothing. Deleted rather than guessed at: `artifact-contract.js` HOMES is
the authority, and it resolves `tracked` to `<corpus>/sen/catalog/`.)*

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

## 1B.5 RULED — the direction of truth is BOTH directions

**Q-1 is CLOSED (2026-09-03).** Answered **2026-08-31 by Amir (YES)**; the mechanics landed in
`a5501a7`; the last blocker — §2.2 — was ruled the same day. See `18-open-questions.md`, Q-1.

**Amir's ruling, §5D.0 statement 4:** the lifecycle runs in **BOTH directions**. Mine the codebase
first to generate the `.en`; hand-edit the `.en`; it goes back into the codebase. And the reverse
must also hold — edit the codebase, re-mine, get the `.en` back matching. ***"Neither direction is
the derived one."*** Statement 7 gives the reason: *"so that it can be editable."*

So there is **no flip**, and the two roots were never a precondition for one. `SOURCE` is the READ
root and `CORPUS` the WRITE root because a render needs somewhere to put its output — that is a
plumbing fact, not a claim about which side is authoritative. The bootstrap is **TS-first**: you
start with TypeScript and mine the language out of the repo. After that neither side is derived.

**The two reasons this section gave for "not sufficient to flip" are still true, and are now
BLOCKERS of a decided direction rather than evidence of an open one:**

1. **A human must actually author a `.en` and review the compiled `.ts` as a diff.** Unchanged, and
   nobody has done it. *(Narrowed since: the gate is no longer the only thing exercising the
   English. `engine/sentence-authority.test.js` edits real corpus `.en` and asserts the edit reaches
   the TypeScript — 21 assertions, green 2026-09-04. That is the machine walking the path; a human
   walking it is still owed.)*
2. **R-PAY-6 — `.en` payloads reference word ids, and the ids move.** Ids are array indices
   renumbered by every re-mine, so a `.en` is decodable only against the dictionary it was rendered
   with, and a re-mine silently invalidates every `.en` — wrong bytes, not an error. **§5E.3.2's
   content-addressed ids are the named fix.** This is the one blocker that has not moved.

**And whatever happens, the `.ts` stays generated AND committed** — like generated clients or
protobufs: authored elsewhere, checked in anyway. A broken compiler then costs a rebuild, never the
code. The failure this ordering exists to prevent is a cleanup treating `src/` as derived output
while the `.en` still cannot be trusted to reproduce it — deleting the only copy on the strength of a
gate that never tested hand-authored input. This effort has already destroyed irreplaceable
artifacts once. **Bidirectionality makes this MORE load-bearing, not less:** with neither side
derived, neither side is disposable.

**RETRACTED 2026-09-04 — this section asserted the opposite for four days.** It was headed
*"1B.5 OPEN — the direction of truth is not settled"* and read:

> **Unresolved. Do not resolve it by inference, and do not treat the two roots as having settled
> it.**
>
> §1 states the thesis: the English is the source and the `.ts` is derived. **What is built is the
> opposite** — the `.ts` in `SOURCE` is authoritative, the `.en` in `CORPUS/sen/` is generated from
> it […] which is a **precondition** for a flip, not the flip. […] **Any session that touches
> direction-of-truth must ask Amir which direction is current before assuming.**

**Superseded by Q-1's closure on 2026-09-03**, one day after that text was last accurate. Three
things in it are wrong: it frames the answer as a **one-way flip** when both directions are
first-class; it says **ask Amir** when Amir had already answered on 2026-08-31; and it treats
R-PAY-6 as proof the question is *open* when Q-1 lists it as a blocker of a decided one.

**Why this retraction is filed here and not only in Q-1.** `CLAUDE.md` §6 carried the same stale
ruling and cited **this section** as its detail link. §6 was fixed on 2026-09-04 (`d13d13b`) and now
defers to the PRD — so leaving §1B.5 stale would have left the identical trap one hop away, in the
file the fix points readers at. A summary corrected against a stale source is not corrected.

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
