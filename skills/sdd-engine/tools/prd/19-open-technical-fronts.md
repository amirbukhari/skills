# 6. Open technical fronts

*PART VI — WHAT IS NOT DECIDED · [index](README.md)*

**These are work items, not questions.** A front is something to build; §Q is something to decide.

**Fronts 0 and 4 are RETIRED — closed by measurement on 2026-08-31, see §Q-2.** Both were framed
around replacing a flat anti-unification layer that is not what the live path runs. Their text is
kept below, struck through, because "the core front" was cited across this document and a reader
who remembers it is owed the reason it is gone rather than a silent absence.

~~**0. THE CORE FRONT — replace flat anti-unification with LZW dictionary construction.**~~
**RETIRED — the replacement already happened.** Measured: the live `.en` path loads only
`generators-lzw.json`, emits 20/20 recursive spans with zero flat spans, and composes to depth 3
with byte-identity held (§Q-2). Nothing live reads `generators.json`; the four remaining mentions of
it in the tree are prose. The four requirements this front carried are **not** retired with it —
they are R-MECH-1, R-MECH-7, R-COMP-1..3 and the compression goal in R-MEAS-6, and they hold as
standing requirements rather than as work to schedule.

What survives as actual work is narrower and lives in **§Q-8**: how much of the *real* corpus
renders through depth ≥ 2, which needs one real mine.

1. **Finish the member/ctor-generalized procedure layer (specified in §5A).** The additive widened axis has begun landing (5,623 statements collapsed); the remaining work is to promote the rest of the WIDE-axis recurring bodies. The `type`-name hole is admitted only when the type is not load-bearing for refill — concretely, when replacing it with a `‹type›` hole still yields a byte-exact `fillOf` at every site (the same gate as every other hole), never on a subjective judgement. Hard constraint unchanged: every widened generator must **refill byte-exact** at every site.
2. **The language front: per-site productions in `spanProse` (§5C), scored by §7.** This is where the remaining readability lives. It replaced an earlier front that chased a file-count metric toward a ceiling nobody had measured, by routes that all amounted to *punch more holes until things match* — the §4A defect. A readability number bought that way is not readability.
3. **Whole-repo statement reduction, not per-file coverage.** Cross-file repetition carries the leverage (composites built from composites, at depth). Drive down `netStatementReduction`-eligible residue across the whole corpus (the §7 metric), not a per-file average.
4. ~~**Close the composition gap — point `.en` compilation at the composing layer.**~~ **RETIRED.**
   The premise — *"the capability already exists on the abandoned path and is being lost"* — measured
   false. `enfile.js` already compiles through generators-calling-generators: `generators.maxDepth`
   on the live path is 3, not 0 or 1 (§Q-2). The success criterion this front named,
   `generators.maxDepth ≥ 2`, is met and is now a standing gate (R-COMP-7) rather than a target.
   Its one genuine residue — the manifest did not expose the field the gate reads — is fixed.
5. **Measurement discipline.** Keep the measure-first scripts (`measure-bytes.js`, `measure-middle-tier.js`, `measure-windows.js`, `measure-operations.js`, `measure-callgraph.js`) as the source of truth; refresh the stale `gate.json` snapshot so the gate reflects the current library.
