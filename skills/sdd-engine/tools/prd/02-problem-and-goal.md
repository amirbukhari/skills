# 1. Problem & goal

*PART I — WHAT THIS IS · [index](README.md)*

We have a large real TypeScript corpus. (Two layer-specific byte totals exist and are reconciled in §4 — never use a bare "corpus size" number.) Most of it is not novel — it is the same shapes, the same procedures, the same data structures, re-typed with different names. Today that repetition sits on disk as raw code, over and over.

**The success definition, in plain terms:**

> **Repeated code — whether it repeats inside one file or across files — must never appear as raw code.** Recurring structure is mined *deterministically* into a **recursive dictionary of words (generators)**, and the English source is each file **re-emitted as a stream of those words**. Because bigger words are defined in terms of smaller words, the source is genuinely **shorter** (repeated structure → a single word reference) **and** losslessly `.en → .ts` **byte-identical**. The **whole repo stays the real, editable source** — you edit the English (`.en`), the `.ts` is derived.

**The core mechanism is LZW dictionary construction over the AST — this is the design, stated up front (§5).** Parse each source file to its AST; walk **bottom-up from the leaves**; run the **dictionary-building (encoding) half of LZW** over that node stream. LZW's defining property is that *every new dictionary entry is an existing entry plus one more symbol* — so the dictionary is **recursive by construction**: larger patterns are defined in terms of smaller patterns already in it. **Each dictionary entry is a word is a generator.** Because entries reference earlier entries, **generators reference generators automatically** — composition is *emergent* from LZW, not bolted on, and the ARCHETYPE→SKELETON→IDIOM→LEAF hierarchy is the emergent **dictionary depth**, not hand-labeled levels.

**Two things the compressor does not settle, and §5C does.** A dictionary makes a file *short*; it
does not make it *read*. Two layers turn a word into a sentence — **skeleton names** (word-level,
content-hashed, and **authoritative** — a hand-edit to a name changes the code, §5D.3 note 1) and **per-site productions** (statement-level, reading the
real AST). The measured finding is that productions are the larger and cheaper half: ~14 statement
kinds out-reach the whole nameable-word queue, because a name caps at the skeleton share of corpus bytes and a production
can quote the site. See §5C for the design and §7.0 for the scoreboard.

**The compiling half is DONE, and should not be read as a roadmap item.** "Write the `.en` and get
the file" is **already true for every file in the corpus** (§4B). Everything now in flight is a question about
how the `.en` *reads*.

So "English source" here is not translation and not documentation. It is a *lossless compressor's dictionary made readable*: LZW factors the repo into a recursive word dictionary; the English re-emits each file as a short word stream; and a byte-exact gate guarantees the derived code is the exact bytes we started from. LZW is **lossless *and* compressing** — real compression under byte-exactness is exactly what the mechanism delivers. But compression is the **mechanism, not the goal**. **Amir, 2026-08-31, verbatim:** *"its not about compression, its about less of a review surface. I need to be able to review less code because im reviewing deterministic code generators which are made of preexisting patterns from my code base."* The metric that matters is therefore **review surface — statements a human must still read as code** (§7, "Review surface is the metric"); recursive word reuse and statement-collapse are how it falls. *This paragraph used to name lossless compression itself as the metric; that was the mechanism wearing the goal's clothes.*

---


## 1B. WHAT THE LANGUAGE IS FOR — Amir, 2026-09-04, verbatim

**Added 2026-09-04 on Amir's instruction, after a session framed repo-dependence as a defect.** His
words, spelling as he wrote it, quoted rather than paraphrased (CLAUDE.md §7 — every reframe in this
project has cost a rework):

> *"I want to be able to type English and get deterministic code. If grammer rules is the answer
> then that's what we do. And we do our naming of our patterns in a way that fits the grammer then"*

> *"No we want repo specific code. It's not supposed to be a standalone language"*

> *"After the language is made though I should be able to author new files with it though in the
> same repo"*

### 1B.1 `.en` IS REPO-SPECIFIC BY DESIGN, AND THAT IS NOT A LIMITATION

The `.en` dialect is **deliberately not a standalone, general-purpose language.** Leaning on this
repo's mined vocabulary, its archetypes, its phrasebook and its productions is **the design
working** — it is what makes the language *his* rather than general-purpose, and it is the direct
consequence of §3's *"deterministic code generators which are made of preexisting patterns from my
code base"*.

**So repo-independence is NOT a goal and must never be reported as one.** A `.en` that could be
compiled without this repo's dictionary would be a *different* product, not a better one. Where any
section reads as though portability were a virtue here, this section governs.

**The distinction that does matter** — and the one to use when auditing what the compiler depends
on — is not repo-dependence but:

| | | |
|---|---|---|
| **REPO-LEVEL** | vocabulary, archetypes, patterns and productions shared **across** the corpus and derived from many files | **correct and desired** — the design working |
| **PER-FILE RESIDUE** | the specific file's own stored AST, id map, hole values, provenance row, or its original `.ts` in any form | would make a round trip a **lookup** rather than a generation, and byte-identity would then prove nothing about writing NEW code |

Only the second is a problem. An audit of the compile path belongs in that shape; see §1B.4.

### 1B.2 AUTHORING NEW FILES IN THIS REPO IS THE DELIVERABLE

**The round trip over existing files is EVIDENCE, not the product.** `compileFileEn(renderFileEn(src))
=== src` over all 1,037 files shows the grammar is faithful to code that already exists. It is a
correctness gate on the mechanism.

**The product is the other thing, and it is a goal in its own right, not an implication of the gate:
a person writes a NEW `.en` in this repo, out of patterns this repo already knows, and gets correct
`.ts`.** Anything that only ever holds for files the renderer produced does not deliver this.

**§1's "The compiling half is DONE" paragraph (above) is about the gate, not about this.** It is accurate as
written — *"already true for every file in the corpus"* — and it is left exactly as it stands; it
must not be read as saying the authoring goal is met. The two claims are about different inputs:
one is about `.en` files the renderer wrote, this one is about `.en` files a person writes.

### 1B.3 THE PURPOSE IS REVIEW SURFACE — ALREADY RULED, CROSS-REFERENCED NOT RESTATED

Amir's compression ruling is **already in this PRD in four places** and is not repeated here: §1
above (`02-problem-and-goal.md`), §3 (`04-explicit-non-goals.md`, *"REVIEW-SURFACE REDUCTION is the
goal — not byte compression"*), §4 (`06-layers-and-measurement.md`) and §5 (`05-architecture.md`). Byte counts,
coverage-% and English-% are **instruments, not targets** — also already ruled: §3 *"Coverage-% is
not the north-star metric"*, §7 (`15-success-criteria.md`) *"Explicitly not a metric: English-%"*, R-MEAS-6 *"MUST be reported
and MUST NOT be optimised"*. §R-ARCH-16B carries the map of which instrument scores which work.
**This section adds nothing to that and exists only to point at it**, per the standing rule that a
metric is never replaced, only accompanied.

### 1B.4 STATUS IS A SEPARATE SENTENCE FROM INTENT

Everything above is **intent**. What the engine does today is a measured question and is recorded as
measurement, never mixed into the statements of purpose above. The current readings live in
`ASSUMPTIONS.md` under `authoring-status`, with the command that produced each one.
