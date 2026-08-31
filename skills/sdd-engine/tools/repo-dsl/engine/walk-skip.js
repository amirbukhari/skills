"use strict";
/**
 * walk-skip.js — the ONE canonical directory-skip set for walking a corpus.
 *
 * WHY THIS FILE EXISTS. CLAUDE.md §8 names the duplication as a standing landmine: the skip set
 * was copy-pasted into every walker, the copies drifted, and that drift once hid 696 of 937
 * un-collapsed bodies. Measured 2026-08-31, the count had grown from the 13 files recorded there
 * to 18, in THREE distinct live shapes:
 *
 *   FULL     the 12 below                       build-lzw-generators, write-en-files,
 *                                               measure-english, measure-uncollapsed,
 *                                               name-words-lzw, uncollapsed-density.test
 *   MINIMAL  node_modules .git demo coined-demo  measure-bespoke-composites, measure-callgraph,
 *                                               measure-logic-english, measure-operations,
 *                                               data-english.test
 *   NO .worktrees                               test-gen-roundtrip, test-lzw-roundtrip
 *
 * The MINIMAL walkers did not exclude `sen`, `spec`, `catalog`, `.cache`, `dist`, `build` or
 * `coverage` — so they were free to walk the rendered English tree and the artifact trees and
 * count generated files as source. **Exposure was measured at ZERO before this was changed** (no
 * `.ts` under any of those trees in the corpus at the time), so no published number was wrong.
 * The defect was latent, not active, and it is fixed here so it cannot become active silently.
 *
 * WHY BOTH `sen` AND `spec` ARE LISTED. `spec` is the pre-rename name of the English tree. A
 * corpus that has not been renamed yet must still be excluded, so both names stay. This is the
 * one shape `engine/corpus-root.test.js` deliberately exempts from its root-literal guard — the
 * exemption keys on the literal text `SKIP = new Set(`, which is why the export below is spelled
 * that way and must keep being spelled that way.
 *
 * SCOPE. This is the CORPUS walk. `verify-register.js` walks the ENGINE tree instead and needs a
 * different set (it skips `archive`, and has no reason to skip build outputs); it is deliberately
 * not migrated here. One set that fits both walks would fit neither.
 */

/* Frozen: a walker must not be able to mutate the shared set out from under every other walker. */
const SKIP = new Set([
  "node_modules", ".git", ".worktrees",
  "dist", "build", "coverage",
  "sen", "spec", "catalog", ".cache",
  "demo", "coined-demo",
]);
SKIP.add = () => { throw new Error("walk-skip: the canonical SKIP set is shared and immutable — do not mutate it; pass an extra set to your own walker instead"); };
SKIP.delete = () => { throw new Error("walk-skip: the canonical SKIP set is shared and immutable"); };
SKIP.clear = () => { throw new Error("walk-skip: the canonical SKIP set is shared and immutable"); };

module.exports = { SKIP };
