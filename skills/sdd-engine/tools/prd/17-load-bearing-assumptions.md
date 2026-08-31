# 9. Load-bearing assumptions

*PART V — ACCEPTANCE · [index](README.md)*

Premises this PRD relies on but has not independently verified — surfaced so they are visible rather
than silent.

1. **A candidate count is not a verified-collapse count.** The WIDE-axis measurement tools report
   *cluster candidates*; only sites whose refill passes the byte-exact gate become real generator
   spans. The two differ by construction and are **not comparable**. Any claim about "how much is
   left" must come from the frozen classifier in §7.3, never from a candidate count.
2. **`S` (total body statements) is stable enough to be a denominator.** It is recomputed on each
   render run, so a large refactor of the corpus would move it. The statement-collapse ratio is only
   comparable between runs **over the same corpus revision**.
3. **Metrics are not portable between corpora.** Every path and byte total is relative to the
   resolved corpus root with its SKIP set. Moving to another tree requires re-deriving `S` and both
   byte totals before any ratio means anything.
4. **Documenting a risk is not a control.** An artifact recorded as stale in a document will still be
   served, because nothing downstream reads the document. Every guarantee in this PRD must be
   enforced by code that refuses, or it is not a guarantee. This assumption has already failed once
   and is the reason §8B is executable rather than descriptive.

---
