# 5C. Language and grammar — how a word becomes a sentence

*PART II — THE MECHANISM · [index](README.md)*

§5 says how structure is *discovered*. This section says how it is *read*. A rendered `.en` clause
is produced by exactly two layers, and knowing which layer owns a given site is the whole of the
design.

## The two layers

| | **Skeleton NAMES** | **Per-site PRODUCTIONS** |
|---|---|---|
| granularity | one per mined word | one per statement kind |
| where | `<corpus>/sen/catalog/word-names.json`, applied in `namedLabel` | `spanProse` in `engine/enfile.js` |
| sees | the canonical skeleton only | the actual AST at the actual site — identifiers, callees, literals |
| population | the whole nameable-word queue | **a handful of statement kinds** |
| ceiling | the skeleton share of corpus bytes — a hard cap | everything a statement can say about itself |

**Productions are the larger and cheaper half, and that is the central finding.** Fourteen
statement kinds reaches further than the entire nameable-word queue, because a production reads the
site and a name cannot. Naming is a background trickle against the queue; productions are the line
of work.

## The admission rule for naming (verbatim, decidable)

> **Name a leaf only where `spanProse` has nothing site-specific to say.**

Applied to the highest-frequency words, this rule **refuses the large majority and admits few** —
and that ratio is the rule working, not failing.
The reason a refusal is *correct* and not laziness: where `spanProse` can quote the real identifier
and the real callee — ``await `invoices` from `softDeleteRecordsForRun` `` — a static skeleton name
is a **REGRESSION**. It replaces two true facts about this site with one generic phrase about a
thousand sites. An unnamed word is honest; a vacuous name is noise that looks like progress.

## Names key on content, never on word id

A name's key is **`sha256(canonical skeleton)[0:16]`**, axis-prefixed — never the word's dictionary
id, which is an artifact of mining order and changes when anything upstream changes.

**The property that must hold: mining-parameter changes orphan NOTHING, and a canonicalizer change
orphans exactly the skeletons it altered.** Because names key on the content hash of the canonical
skeleton (never on the word id), retuning `MAXWIN`, `MIN_COUNT` or `MIN_SKEL` cannot orphan a name —
the skeletons are unchanged. A canonicalizer change *does* orphan the names of the skeletons it
altered, and **that is correct behaviour, not a failure**: those skeletons genuinely became different
skeletons, and a name that followed them across the change would be asserting a meaning nobody
verified.

## The steady state — orphan, never delete

Names outlive the words they were written for, so the naming catalog is append-and-orphan:

1. A name whose skeleton no longer exists moves to the **`orphans` ledger**. It is never deleted.
2. Before generating any new name, the authoring pass **matches against orphans first**.
3. A match produces a **re-adoption PROPOSAL** written to the rename queue (`results/name-queue.json`,
   derived/gitignored), scored by token edit distance. **It is never applied automatically.**
4. **Queue length is a first-class metric**, reported beside byte-identity.

> **Auto-re-attachment is the producer/consumer drift bug (§2.2) in a new costume.** A name silently
> re-attaching to a skeleton that merely *resembles* the one it was written for is a producer
> asserting a meaning no consumer verified — and the failure is silent by construction, because a
> wrong name renders as confident prose. The proposal step exists so a human is the consumer.

## Names are cosmetic by CONSTRUCTION, not by test

`compileChunk` recovers a payload with `chunk.lastIndexOf(PAY_OPEN)` / `chunk.lastIndexOf(PAY_CLOSE)`
and **never reads the label region at all**. A wrong name therefore yields wrong prose and
**byte-identical output**. This is a structural property of the compiler, not a property maintained
by a test — the test would be the weaker guarantee (§10).

## The hole taxonomy — a per-site predicate, not a per-type policy

Holes are the domain meaning: they carry the identifiers, literals, and type names the skeleton
generalized away. The cut that matters is **word-like vs code-bearing**:

- **word-like** — a hole whose contents read as a noun in a sentence: `` `invoices` ``, `` `./helpers` ``,
  `` `HttpStatusCode.NotAcceptable` ``. These **stay verbatim** and are quoted into the clause. They are
  already the clearest possible words; §3 backs literals staying verbatim.
- **code-bearing** — a hole whose contents are an expression with its own syntax: index arithmetic,
  chained ternaries, inline object construction. These are code, and a template that splices one into
  a sentence produces **code wearing a sentence's clothes**.

**The cut runs ACROSS hole types, not along them.** An identifier hole is usually word-like and
sometimes not; a literal hole is usually word-like and sometimes an inline object. So the rule is a
**per-site predicate on the hole's contents**, evaluated at render time — never a policy attached to
the hole's type. The English-completeness scanner (§7) is the mechanical form of that predicate:
strip the quoted verbatim regions, and if TypeScript syntax remains, the clause failed.

## The honesty rule for productions

If a production cannot say something **true** about a site, it emits the vacuous clause and that
site is **counted** (§7). A production retires a vacuous clause by saying something true about the
site — **never** by rewording the placeholder into something that merely escapes the frozen list.

---
