# §Q Open questions — none of these may be resolved by inference

*PART VI — WHAT IS NOT DECIDED · [index](README.md)*

**Read this part before making any design decision.** Everything here is genuinely undecided.
Guessing at one of them and building on the guess is the most expensive mistake available in this
project, and it has happened. Each entry says who can close it and what closing it requires.

**Severity.** **BLOCKING** — work that depends on it must stop and ask. **DESIGN** — needs a written
design pass, then confirmation. **CLARIFY** — a contradiction or gap in this document that someone
must settle so the register stops being ambiguous.

---

## Q-1 — Direction of truth: does English ever become authoritative? · BLOCKING · Amir

**The question.** §1's thesis is that the `.en` is the source and the `.ts` is derived. **What is
built is the opposite.** Whether the project actually flips — and when — is not decided and has
never been scheduled.

Stated in full in **§1B.5**, which is the only place it lives. In short: the original direction may
have wanted English as the authoritative source with TypeScript derived from it. **That is not
decided and not built.** Two roots (`SOURCE`/`CORPUS`) is the design that ships.

**What closing it requires:** Amir's decision on direction, plus **R-PAY-6** closed first (word ids
renumber on every re-mine, so a flip would let one re-mine silently invalidate every `.en`), plus a
human having actually authored a `.en` and reviewed the compiled `.ts` as a diff.

**Downstream of it, and therefore also open:** when `sen/`'s wipe gate must harden from *"explicit
flag"* to *"refuse"* (§1B.3 says "at the flip"; the flip has no defined trigger).

## Q-2 — ~~Is the LZW core front DONE?~~ **CLOSED 2026-08-31 by measurement. The LZW path is live.**

**Answer: the live `.en` path runs through the recursive LZW dictionary. It is not flat
anti-unification.** The §5/§4A/§4B claims were right; §2 P1's *"Deviation to fix"* and §6 fronts 0
and 4 were **stale text**, and have been rewritten. Kept here rather than deleted so a stale memory
elsewhere cannot re-derive the contradiction.

**The measurement.** A synthetic 4-file corpus was built specifically to force composition —
repeated statement runs, with longer runs *containing* shorter ones, so each dictionary entry is a
prior entry plus one symbol. Mined and rendered in a throwaway directory (`SOURCE=CORPUS=<tmp>`), so
no real mine was spent:

| | |
|---|---|
| generator spans emitted | **20, all recursive** |
| flat-fallback spans | **0** — and see the structural finding below |
| composition depth, **live `.en` path** (`generators.maxDepth`) | **3** — clears R-COMP-7's `≥ 2` |
| composition depth, mined dictionary | 5, across 20 composites / 40 edges |
| byte-identity | **4/4** |

**Why a synthetic corpus is the right instrument here, and what it does not prove.** Q-2 asks which
*code path* is live — a property of the engine, not of any corpus — and a 4-file fixture answers
that exactly. It does **not** establish depth or coverage numbers for the real corpus; those need a
real mine, which is Amir's call to spend. **What is settled is the mechanism. What is unmeasured is
the magnitude.**

**Two findings the measurement produced, both now fixed:**

1. **R-COMP-6 was not met, and R-COMP-7 could not be evaluated.** The register requires the manifest
   to expose `generators.maxDepth`, `.composites` and `.compositionEdges`. The producer wrote
   `maxCompositionDepth` and neither of the other two — so the gate that makes *"flatness visible as
   a regression"* was comparing `undefined`, which is neither pass nor fail. This is the §8B drift
   shape with the PRD itself as the consumer: the spec named fields the producer never wrote. All
   three are now emitted, and `maxDepth` (deepest span the **live path** emitted) is kept distinct
   from `dictionaryMaxDepth` (how deep the **mined dictionary** goes), because conflating them would
   let a deep dictionary report a composing renderer that never composed.
2. **The "flat-fallback 0 (0% fallback)" metric was a tautology.** `tier` is set to `"recursive"` at
   exactly one place in `enfile.js` and `"flat"` nowhere, so the flat counters are **structurally**
   zero, not measured-zero — precisely the number R-MECH-8 forbids publishing. The counters are
   retained as a **tripwire** for a re-introduced flat producer and are no longer reported as a
   coverage figure. `enfile.js` also carried a comment describing a *"pass 0b FALLBACK ONLY: the FLAT
   generators.json"* that **is not implemented below it**; corrected in place rather than deleted,
   because the comment outlived its code and a reader was entitled to believe it.

**What is still open, and it is narrower than Q-2 was — see Q-8.**

## Q-3 — The archetype/word hybrid: how does a slot bind to a word? · DESIGN · Amir + a design pass

**Direction is SETTLED** (Amir: *"it needs to be a pattern/words archetype hybrid"*) and the
requirements are R-ARCH-1..8. **The mechanics are not designed.** Five specific unknowns, stated in
§5D and repeated here so they are visible from the open-questions list:

1. **How a slot binds to a word** — does an archetype slot reference a dictionary word id directly,
   or declare a hole type the word layer fills at render time?
2. **Whether an archetype is itself a dictionary entry** — the top of the same recursive hierarchy
   (the natural reading of §2 P4, where tier *is* dictionary depth), or a separate template layer
   above it? Different failure modes.
3. **Who wins a contested span** — the concrete arbitration order between archetype slots and mined
   words, beyond "it must be deterministic" (R-ARCH-5).
4. **Whether hand-authored grammars survive at all**, or the archetype reduces to a slot *skeleton*
   with every fill mined.
5. **What replaces per-site productions** — `spanProse`'s productions (§5C) currently carry the
   readability tier-1 grammars would have; how the two divide the work is undecided.

**What closing it requires:** write the design, get it confirmed, then build. **No wiring should be
built on a guess.**

## Q-4 — Does the legacy `<CORPUS>/catalog/` tree survive? · CLARIFY · Amir

`<CORPUS>/catalog/` (STEP-4: `operation-idioms.json`, `function-archetypes.json`, and the
hand-curated `coined-words.json`) is a different tree from `<CORPUS>/sen/catalog/` (§1B.4, R-ART-3).
It is explicitly out of scope for the `sen/` wipe (R-CFG-10) and is still read by
`engine/operation-idioms.test.js`, which joins the corpus root directly rather than going through
`AC.pathFor` — deliberately, with a comment saying so.

**Undecided:** whether it is retired, migrated under the artifact contract, or kept indefinitely as
a separate hand-curated tree. Until it is decided, **do not merge or conflate the two catalogs.**
`coined-words.json` is hand-curated and not reproducible by any mine, so a wrong answer here loses
work permanently.

## Q-5 — Which gate threshold is normative? The constants table disagrees with the code. · CLARIFY

§8 records the gate corpus-coverage threshold as **≥ 20%** and then notes that *"the `--min` flag
default in code is 80"*. Those are different requirements, and the table states both without saying
which binds. The worst-file threshold is separately recorded as **disabled (null)** with no per-file
floor enforced.

**What closing it requires:** one decision — the PRD value, the code default, or a deliberate
"coverage is not a gate any more" — and then the losing number deleted rather than annotated. A
constant with two values is not a constant.

## Q-6 — Two requirements that are readings of current behaviour, not requirements · CLARIFY

Flagged rather than silently promoted or cut:

- **`MAXWIN` is "64, which is the point past which the parameter is inert"** (§4B, R-MINE-2). *Inert*
  is an observation about the longest node stream in a particular corpus, not a property of the
  design. On a corpus with longer streams the number would bind. Keep 64 as the value; confirm
  whether "inert" is meant as a permanent claim.
- **`minCount` appears twice with different values** — `MIN_COUNT = 1` for word promotion
  (§4B, §8, R-MINE-1) and `minCount ≥ 2` for middle-tier body candidacy (§5A, §7.3, R-WIDE-3).
  They are two different thresholds in two different modules, and this document has never said so in
  one place. Confirm the reading, so nobody "fixes" one to match the other.

## Q-7 — Implied but never stated: where does the naming worksheet go? · CLARIFY

The register has no requirement for the naming worksheet's location because the document states
none. `name-words-lzw.js` currently writes its worksheet **into the engine tree**, which is a
straight violation of the location rule (**R-ART-1**: engine code + PRD only, no corpus-derived
bytes). Either the worksheet is corpus-derived and belongs under `<corpus>/.cache/spec-derived/`, or
it is not, and the document should say why.

**This is a gap surfaced by reorganizing, not a new requirement — it is not in the register.**

---

## Q-8 — Does composition depth clear the bar on the REAL corpus? · CLARIFY · one real mine · Amir's call to spend it

Q-2 settled the mechanism: the live path composes, and `generators.maxDepth` is now a field that
actually exists, so R-COMP-7 is evaluable. **The magnitude is unmeasured.** On a 4-file fixture the
live path reached depth 3 while the dictionary reached 5 — most spans (16 of 20) were still depth 1.

**The open question is not "does it compose" but "how much of the real corpus renders through depth
≥ 2".** The gap between dictionary depth and live-path depth is the interesting number: a deep word
buys nothing until a file actually renders through it, and that gap is where §6 front 3's
whole-repo leverage would show up or fail to.

**What closing it requires:** `npm run mine && npm run name && npm run render`, then read
`generators.maxDepth`, `.dictionaryMaxDepth` and `.depthHistogram` from `en-index.json`. That is a
full mine — tens of minutes — so it is **Amir's call when to spend it**, not something to kick off
unasked. Nothing else is blocked on it: the requirements stand either way.
