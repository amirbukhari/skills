# 4. The layers, and how they are measured

*PART II — THE MECHANISM · [index](README.md)*

There are **two distinct layers**, and they must not be conflated: they walk **different file sets**,
so they have **different byte totals**.

**The denominator rule (a requirement, because mixing the two produces a wrong ratio).** The
compose-layer walk (`engine/pipeline.js` `walkDir`) is broad. The enfile-layer walk
(`write-en-files.js`) skips more directories — the demo trees, `sen/`, `catalog/`, `.cache/` — so it
sees fewer files and a smaller total. **Every English-coverage and statement-collapse ratio uses the
enfile-layer total as its denominator**, because the `.en` lives in that layer. A compose-layer
figure must always be labelled as such, and **the two are never mixed inside one ratio.**

## Layer A — word-tiling / compose (the generator library)

> **RETRACTED 2026-09-04 — `.calc` is retired.** Amir: *"I dont think we do .calc anymore bro"*, then *"yeah kill that lol"*. Kept and corrected in place rather than deleted (`../../CLAUDE.md` §9) so a stale memory cannot re-derive it. **Measured 2026-09-04:** `sen/files/` holds **1,037 `.en` and zero `.calc`**, there is no `.calc` anywhere under `CORPUS`, `.cache/compose/` does not exist, and **no step of the 14-step `sdd-run --list` manifest reads or writes one**.
> This heading used to read *"(the generator library + `.calc` IR)"*. Layer A is unchanged as a **mechanism** — fan-out, LZW, generator promotion, byte-lossless tiling all still run and are still measured. What is retired is the `.calc` **serialization** of it. The composition tree survives as an in-memory IR (`expander.js`, and the recursive word dictionary in `sen/catalog/generators-lzw.json`); it simply never lands on disk as a `.calc` file.

`fanout → LZW → generators (pipeline.js) → compose.js`. Every file is byte-losslessly tiled into an
ordered stream of **words** (recurring parameterized spans that refill byte-exact) and **literal
slots** (verbatim bytes). Byte-losslessness is by construction; the discriminating measure is *how
much* is a recurring word versus residue. **Residue must be classified, never papered over** — the
buckets are non-recurring shape, free-text slot, comment/trivia, and formatting variance.

## Layer B — English source of truth (`.en` files, `enfile.js`)

The `.ts` is rendered to an editable `.en` by swapping **only verified spans** into `«English»`: data
leaves via `data-english.js` ("an object with a = `x`", "a list of …") and pure-logic simple
statements via the `cnl.js` grammar ("Let `x` be …", "When <cond>, …", "Return …"). Everything else
stays verbatim TypeScript. The `.en` files are written to `<corpus>/sen/files/<rel>.en`; the derived
there is no second derived on-disk form beside it. *(This sentence used to end "the derived `.calc` IR is relocated to a gitignored `.cache/`" — retracted 2026-09-04, see the note under Layer A above.)*

## The middle-tier gap

Layers A and B hold their byte gate. The open tier is **multi-statement function/method bodies that
recur *up to renaming***.

**Why it is hard.** The narrow anti-unifier (`operations.js`) abstracts data and literals
(`str`/`num`/`obj`/`arr`/`fn` holes) and bare identifiers (`id` hole), but it **pins member-access
names, method names, constructor names and chain-root call names as skeleton literals**. Two
procedures identical except for which property or method they touch produce *different* narrow keys
and never cluster. A **widened** axis — member/method/ctor names promoted to holes, α-equivalence up
to renaming — is what lets them cluster. That layer is specified in §5A.

## The fix is ADDITIVE, not a replacement

Identifiers and types are already generalized by the narrow axis; what is missing is
member/method/constructor generalization. **Do not widen the existing axis in place** — that weakens
byte-elimination on the narrow tier. Add a **second, coexisting layer** (§5A): keep narrow-axis
generators for byte-elimination on structural clones, *and* add member/ctor-generalized procedure
generators that claim spans currently emitted verbatim.

## Byte size is not the success axis — review surface is (§7.3)

An earlier draft concluded that physical byte compression is capped under the byte-exact gate, and
attributed it to the FLAT anti-unification path — where every per-site-unique token re-emits verbatim
into a hole and nothing cross-references. A later draft inverted it and made byte compression a gate
the `.en` had to clear.

**Both framings are retired, because the thing being measured was wrong.** Amir, 2026-08-31:
*"its not about compression, its about less of a review surface."* The LZW design is lossless *and*
structurally compressing — repeated structure becomes a single recursive word reference — but the
`.en` also carries gloss prose and span structure the `.ts` never had, so the *file* can grow while
the *reading* shrinks. Those are different quantities and only the second one is the goal.

*Measured 2026-08-31, over the 1,037-file enfile-layer walk, with the flat path deleted:* the `.en`
is **19% larger** than the `.ts` (4,830,829 B against 4,058,328 B) **and 50.2% of body statements
left the reader's view** (17,029 of 33,918, §7.3). *(That ratio first published as 63.5%, against a
denominator that counted only function bodies while the folder also folds top-level and non-function
statements; §7.3 records the correction and the invariant that now makes it fail loudly.)* The size gap was never the flat path; attributing
it there was a guess that measurement refuted. Byte size is reported. Review surface is the gate.

---
