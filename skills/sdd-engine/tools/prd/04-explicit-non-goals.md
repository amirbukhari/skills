# 3. Explicit NON-goals

*PART I — WHAT THIS IS · [index](README.md)*

- **Line-by-line English translation is a failure mode, not the goal.** If a statement can only be rendered as a one-to-one English restatement of the code, that means *no shared generator was found* — the pattern is bespoke. We render it verbatim and count it as residue. We do not dress arithmetic, one-off calls, or novel logic up as prose (`data-english.js` keeps every atom in a `` `backtick` `` escape precisely so this stays honest).
- **Coverage-% is not the north-star metric.** A high English-% achieved by paraphrasing unique code would be worthless. The real target is *repeated code collapsed to a generator call* (§7).
- **Line-by-line translation is the failure; real compression is the goal.** The success axis is **real lossless compression through recursive word reuse** *plus* statement-collapse — *not* prose length. (Superseded claim, corrected: an earlier draft said "byte-shrink is physically capped ~4.5% under the byte-exact gate." **That cap is a property of the FLAT anti-unification approach only** — where every per-site token re-emits verbatim into a hole. **LZW is lossless *and* compressing**, so real byte compression under byte-exactness is achievable and *is* a goal, delivered by recursive word references, not by paraphrase. The current `.en` being larger than the `.ts` is a symptom of the flat-path defect (§4A), not a law.)
- **No cherry-picked showcase/demo files.** Measurement runs over the whole corpus; the `demo`/`coined-demo` trees are excluded from the walk (`write-en-files.js` SKIP set). Per-module verify results include the failures, not just the wins.

---


This part is the design. §5 is the pipeline; §4 is how the pipeline is *measured*, which is a
separate concern that has been conflated with it before. §4A/§4B, §5A, §5B, §5C and §5D each own one
layer of the mechanism. Every requirement extracted from this part appears in the Part III register.
