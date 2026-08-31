# 2. Non-negotiable principles

*PART I — WHAT THIS IS · [index](README.md)*

1. **Pattern discovery IS LZW dictionary construction over the bottom-up AST node stream — deterministic, zero model calls.** The miner parses each file to its AST, linearizes it bottom-up (leaves first), and runs the encoding half of LZW to build a **recursive word dictionary**: each entry = a prior entry + one symbol, so every word is defined in terms of smaller words and **generators reference generators by construction** (§5). Each hole records the exact source span it abstracted, so expansion rebuilds the site's **original bytes**; LZW is lossless, so byte-exactness and compression coexist. See `engine/pipeline.js`, `engine/lzw.js`, `engine/enlzw.js`, `engine/fanout.js`. *(`engine/compose.js` is retired to `archive/`; it was the flat composer.)*
   *Status, measured 2026-08-31 (§Q-2):* **this is what the live path does.** `enfile.js` loads the
   recursive dictionary and nothing else. **Real corpus (§Q-8): 5,731 spans, all recursive,
   composition depth 62, 1,037/1,037 byte-identical.** *(The 20/20 at depth 3 first cited here was
   the synthetic fixture §Q-2 was closed on.)* This line used to read *"Deviation to fix (§4A): the current live path uses
   flat anti-unification … this is the root defect"*. That was true when written and had since gone
   stale, which is why §Q-2 existed; it is corrected rather than deleted so the old claim cannot be
   re-derived from a stale memory.

2. **The LLM may only propose NAMES — never anything correctness-relevant.** The "librarian" pass (`refine-language.js`) proposes readable names for mined `g_<len>_<hash>` generators and is **gated on byte-identity + coverage invariance**: a rename that changes a single output byte or lowers coverage is rejected. Names are cosmetic by construction.

3. **A byte-exact gate on every span.** Nothing is ever *guessed* into English. A span is swapped for English only when it re-compiles to its exact source bytes — verified at render time (`engine/enfile.js` render pass; `engine/data-english.js` `dataByteExact`; `engine/cnl.js` compile↔render). Anything that doesn't verify stays verbatim TypeScript. Consequence: **English coverage varies; byte-identity does not.** `compileFileEn(renderFileEn(src)) === src` holds for *every* file.

4. **Composition is mandatory — and it is EMERGENT from LZW, not bolted on.** Because each LZW dictionary entry is a prior entry plus one symbol (§2.1), generators reference generators automatically: the vocabulary is a **recursive hierarchy, not a flat list**, and the ARCHETYPE→SKELETON→IDIOM→LEAF tiering *is* the emergent dictionary depth. A generator's expansion invokes lower generators, down to leaf atoms; higher tiers expand *through* lower tiers. A **flat vocabulary** (every generator expanding directly to raw TS, holes = verbatim bytes — what the current live path produces) is the **degenerate failure mode**, not an acceptable simplification: it means LZW recursion was replaced by flat clone detection (§4A). The flat path is permitted **only as a fallback for genuinely-unique one-offs** that recur nowhere. Composition inherits the same guarantees — every nested expansion is deterministic and the fully-expanded result passes the byte-exact gate (§2.3). See §4A (current defect) and §5/§5B (requirement).

---
