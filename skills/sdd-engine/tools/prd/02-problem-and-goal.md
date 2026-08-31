# 1. Problem & goal

*PART I — WHAT THIS IS · [index](README.md)*

We have a large real TypeScript corpus. (Two layer-specific byte totals exist and are reconciled in §4 — never use a bare "corpus size" number.) Most of it is not novel — it is the same shapes, the same procedures, the same data structures, re-typed with different names. Today that repetition sits on disk as raw code, over and over.

**The success definition, in plain terms:**

> **Repeated code — whether it repeats inside one file or across files — must never appear as raw code.** Recurring structure is mined *deterministically* into a **recursive dictionary of words (generators)**, and the English source is each file **re-emitted as a stream of those words**. Because bigger words are defined in terms of smaller words, the source is genuinely **shorter** (repeated structure → a single word reference) **and** losslessly `.en → .ts` **byte-identical**. The **whole repo stays the real, editable source** — you edit the English (`.en`), the `.ts` is derived.

**The core mechanism is LZW dictionary construction over the AST — this is the design, stated up front (§5).** Parse each source file to its AST; walk **bottom-up from the leaves**; run the **dictionary-building (encoding) half of LZW** over that node stream. LZW's defining property is that *every new dictionary entry is an existing entry plus one more symbol* — so the dictionary is **recursive by construction**: larger patterns are defined in terms of smaller patterns already in it. **Each dictionary entry is a word is a generator.** Because entries reference earlier entries, **generators reference generators automatically** — composition is *emergent* from LZW, not bolted on, and the ARCHETYPE→SKELETON→IDIOM→LEAF hierarchy is the emergent **dictionary depth**, not hand-labeled levels.

**Two things the compressor does not settle, and §5C does.** A dictionary makes a file *short*; it
does not make it *read*. Two layers turn a word into a sentence — **skeleton names** (word-level,
content-hashed, cosmetic by construction) and **per-site productions** (statement-level, reading the
real AST). The measured finding is that productions are the larger and cheaper half: ~14 statement
kinds out-reach the whole nameable-word queue, because a name caps at the skeleton share of corpus bytes and a production
can quote the site. See §5C for the design and §7.0 for the scoreboard.

**The compiling half is DONE, and should not be read as a roadmap item.** "Write the `.en` and get
the file" is **already true for every file in the corpus** (§4B). Everything now in flight is a question about
how the `.en` *reads*.

So "English source" here is not translation and not documentation. It is a *lossless compressor's dictionary made readable*: LZW factors the repo into a recursive word dictionary; the English re-emits each file as a short word stream; and a byte-exact gate guarantees the derived code is the exact bytes we started from. LZW is **lossless *and* compressing** — real compression under byte-exactness is exactly what the mechanism delivers. The metric that matters is **real (lossless) compression via recursive word reuse plus statement-collapse**, not how much prose we produce.

---
