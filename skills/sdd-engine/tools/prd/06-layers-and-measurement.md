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

## Layer A — word-tiling / compose (the generator library + `.calc` IR)

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
`.calc` IR is relocated to a gitignored `.cache/`.

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

## Compression is achievable under the byte-exact gate — the flat path is why it looked otherwise

An earlier draft concluded that physical byte compression is capped under the byte-exact gate.
**That holds only for the FLAT anti-unification path**, where every per-site-unique token — names,
types, member and method names, URLs, field keys — re-emits verbatim into a hole and nothing
cross-references. **The intended LZW design is lossless *and* compressing:** repeated structure is
replaced by a single recursive word reference, so a file reusing a deep word does not re-emit that
structure at all. Byte-identity is preserved either way; compression is what the correct mechanism
adds on top. Any observation that the `.en` is larger than the `.ts` is a symptom to attribute, not a
law to accept.

---
