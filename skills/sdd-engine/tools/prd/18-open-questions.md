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

## Q-2 — Is the LZW core front DONE? This document contradicts itself. · CLARIFY · one measurement

**The contradiction, verbatim from two places in this file:**

| says | where |
|---|---|
| the live path **is** the LZW dictionary; "the flat anti-unification layer is deleted"; tiers are realized as real composition at depth | §5 (both status lines), §4A ("the requirement"), §4B ("the STANDING STATE, not a roadmap item") |
| the live path **is still** flat anti-unification, and replacing it is the core front; the composition capability "already exists on the abandoned path and is being lost" | §2 P1 ("Deviation to fix"), §6 front 0, §6 front 4 |

**Both cannot be true.** The requirement is not in doubt — **R-MECH-1** and **R-COMP-7** stand
either way. What is unknown is whether they currently hold.

**What closing it requires:** one measurement, not a reading. Run the render and report
`generators.maxDepth` and which vocabulary `enfile.js` actually loaded. If `maxDepth ≥ 2` through
`generators-lzw.json`, the §5/§4A claims are right and §2 P1's "deviation to fix" plus §6 fronts 0
and 4 are stale text to cut. If not, the reverse. **Do not settle it by reading the code** — that
method has produced a confident wrong answer here before.

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
