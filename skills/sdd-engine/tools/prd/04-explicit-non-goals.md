# 3. Explicit NON-goals

*PART I — WHAT THIS IS · [index](README.md)*

- **Line-by-line English translation is a failure mode, not the goal.** If a statement can only be rendered as a one-to-one English restatement of the code, that means *no shared generator was found* — the pattern is bespoke. We render it verbatim and count it as residue. We do not dress arithmetic, one-off calls, or novel logic up as prose (`data-english.js` keeps every atom in a `` `backtick` `` escape precisely so this stays honest).
- **Coverage-% is not the north-star metric.** A high English-% achieved by paraphrasing unique code would be worthless. The real target is *repeated code collapsed to a generator call* (§7).
- **Line-by-line translation is the failure; REVIEW-SURFACE REDUCTION is the goal — not byte compression.** Amir, 2026-08-31, verbatim: *"its not about compression, its about less of a review surface. I need to be able to review less code because im reviewing deterministic code generators which are made of preexisting patterns from my code base."* The success axis is **how many statements a human no longer has to read**, because they folded into a deterministic generator mined from code he already reviewed. Byte size was only ever a proxy for that, and measurement showed it is the wrong one (§7.3).
- **Superseded claims, kept so a stale memory cannot re-derive them.** An early draft said "byte-shrink is physically capped ~4.5% under the byte-exact gate"; a later one made real byte compression *the* goal and blamed the `.en` being larger on the flat path (§4A). **Both are retired.** *Measured 2026-08-31:* the flat path is gone — 5,731 generator spans, all recursive, zero flat fallbacks, live composition depth 62 — and the `.en` is still **19% larger** than the `.ts` (4,830,829 B against 4,058,328 B over the 1,037-file enfile-layer walk). The size gap was never the flat path. It is gloss prose and span structure, bytes the `.ts` does not carry, which §7A.5 accepts as honest. On the same run **63.5% of body statements left the reader's view** (§7.3). More bytes, far less to review — which is exactly why bytes are not the metric.
- **No cherry-picked showcase/demo files.** Measurement runs over the whole corpus; the `demo`/`coined-demo` trees are excluded from the walk (`write-en-files.js` SKIP set). Per-module verify results include the failures, not just the wins.

---


This part is the design. §5 is the pipeline; §4 is how the pipeline is *measured*, which is a
separate concern that has been conflated with it before. §4A/§4B, §5A, §5B, §5C and §5D each own one
layer of the mechanism. Every requirement extracted from this part appears in the Part III register.
