# 6. Open technical fronts

*PART VI — WHAT IS NOT DECIDED · [index](README.md)*

**These are work items, not questions.** A front is something to build; §Q is something to decide.
Front 0 and front 4 both assert an implementation status that §5/§4A contradict — see **§Q-2** before
acting on either.

**0. THE CORE FRONT — replace flat anti-unification with LZW dictionary construction (§4A).** This supersedes and subsumes fronts 1–4 below: they were framed around the flat generator layer, which is itself the defect. The required work, as explicit requirements:
   - **Pattern discovery MUST be LZW dictionary construction over the bottom-up AST node stream** (§5 core pipeline), *not* flat anti-unification / clone detection.
   - **Generators MUST be able to reference other generators** (recursive words, `members[]`/`hierarchyDepth`); the flat, holes-are-verbatim-TS path is retained **only as a fallback for genuinely-unique one-offs** that recur nowhere.
   - **Byte-identity is preserved** — LZW losslessness is exactly what makes real compression compatible with the byte-exact gate (§2.3).
   - **Success is real (lossless) compression via recursive word reuse + statement-collapse** (§7), not line-by-line translation.
   Build on the compose-layer seed (`compose.js`, `lzw.js`, `mined-library.json`) — SOURCE-PROTECTED (§8A) — not on `generators.json`. Then point `enfile.js` at the recursive dictionary and expand nested word references recursively.

1. **Finish the member/ctor-generalized procedure layer (specified in §5A).** The additive widened axis has begun landing (5,623 statements collapsed); the remaining work is to promote the rest of the WIDE-axis recurring bodies. The `type`-name hole is admitted only when the type is not load-bearing for refill — concretely, when replacing it with a `‹type›` hole still yields a byte-exact `fillOf` at every site (the same gate as every other hole), never on a subjective judgement. Hard constraint unchanged: every widened generator must **refill byte-exact** at every site.
2. **The language front: per-site productions in `spanProse` (§5C), scored by §7.** This is where the remaining readability lives. It replaced an earlier front that chased a file-count metric toward a ceiling nobody had measured, by routes that all amounted to *punch more holes until things match* — the §4A defect. A readability number bought that way is not readability.
3. **Whole-repo statement reduction, not per-file coverage.** Cross-file repetition carries the leverage (composites built from composites, at depth). Drive down `netStatementReduction`-eligible residue across the whole corpus (the §7 metric), not a per-file average.
4. **Close the composition gap — point `.en` compilation at the composing layer (§4A, §5B).** Either wire `enfile.js` to expand compose-layer composites recursively, or rebuild the middle-tier generators as composites carrying `members[]`/`hierarchyDepth`. Success = the live `.en` path compiles through generators-calling-generators (manifest `generators.maxDepth ≥ 2`), not the flat `generators.json`. This is the highest-value front — the capability already exists on the abandoned path and is being lost.
5. **Measurement discipline.** Keep the measure-first scripts (`measure-bytes.js`, `measure-middle-tier.js`, `measure-windows.js`, `measure-operations.js`, `measure-callgraph.js`) as the source of truth; refresh the stale `gate.json` snapshot so the gate reflects the current library.
