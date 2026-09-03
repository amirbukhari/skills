# 10. Test integrity — what a test is allowed to assert against

*PART V — ACCEPTANCE · [index](README.md)*

`enfile.test.js` and `enfile-label-sanitize.test.js` asserted against **committed mined data** —
artifacts the engine itself had produced. A test that compares the engine's output to the engine's
own earlier output cannot fail for the reason it claims to check: it proves only that the engine
still agrees with itself. Both passed continuously, proved nothing, and revealed it only when the
data they leaned on was deleted and they went red for a reason unrelated to correctness. The
byte-exact gate (§2.3) is the whole guarantee this project sells; a self-confirming test of it is
worse than no test, because it reports confidence that was never earned.

1. **Correctness asserts against real source, through a round-trip.** The oracle is the corpus
   itself: `compileFileEn(renderFileEn(src)) === src` over actual files on disk. A test of engine
   correctness must never take a mined artifact as its expected value.
2. **A mined artifact may be an INPUT, never the ORACLE.** Feeding a catalog into a test is fine —
   grading the engine against a catalog the engine wrote is not.
3. **Every guard is mutation-checked at authoring time.** Disable the assertion, confirm the test
   goes red *with the message it promises*, restore, confirm green. State that it was done in the
   merge request. An unmutated guard is a guess about whether it guards anything.
4. **Pinning an inventory is legitimate; pinning an answer is not.** A drift guard (§“prefer a drift
   guard to a frozen value”) pins the *current inventory* so each addition becomes a decision someone
   makes. That is not self-confirmation, because a failure is a decision point and the pin is updated
   in the same commit with a stated reason — unlike a mined artifact silently reused as truth.
5. **Sample deterministically rather than skipping.** Where a full-corpus assertion is too slow for
   the loop, take a fixed, evenly-spread sample so the test is cheap, reproducible, and still asserts
   against real source — the full-corpus run stays the build's own gate. A test that skips is honest;
   a test that narrows its oracle to make itself pass is not.

---

## THE STANDING LESSON: EXERCISING IT CATCHES WHAT READING IT CANNOT (2026-09-03)

This file's whole subject is what a test may assert against. The rule below is the reason the file
exists, and it earned its place three separate times in one night.

> **A claim about runtime behaviour needs a measurement, not a reading of the code — and that
> applies to the author's own code, in the same session, minutes after writing it.**

The three, in the order they happened:

1. **The `reconcile-names.js` denominator.** The script iterated the 6-entry **leaf** ledger and
   reported a confident *"2 newly orphaned"* against a corpus where **974 chunk names had died**. It
   was not wrong about what it looked at; it looked at the wrong collection and **said nothing about
   the rest**. Reading it would never have shown this — the loop is correct. Running it against a
   corpus whose chunk names had actually been orphaned did, immediately.
   **Rule it produced:** a check must **assert its own denominator**. Silence about the remainder is
   the defect, not the absence of a finding.

2. **The author's own comment contradicting the author's own branch.** The first working version of
   the hole-repair path honoured an atomic edit and was then **refused by its own enclosing
   heading** — rule 2 satisfied one level down and cancelled one level up. A comment written in the
   same commit claimed the edit *"remains expressible at the child"* while the branch immediately
   below it was making that false. Neither the comment nor the code read as wrong. Running the test
   printed the refusal.
   **Rule it produced:** a comment asserting a *behaviour* is a hypothesis until a test exercises
   it. Prose in the same file is not corroboration; it is the same author guessing twice.

3. **The BODY_SLOT staleness claim, believed by two sessions.** Two independent sessions concluded
   the live catalog predated the body-slot canon — one from a peer's measurement, one from reading
   mtimes and commit dates — and reached **opposite** orderings of the same two timestamps, both
   wrong. The catalog holds **25,064 `type:"body"` hole markers**; one `grep` settled in seconds
   what hours of clock-reading had gotten backwards, because the marker's *presence* is behavioural
   evidence and a timestamp is not.
   **Rule it produced:** when an artifact's provenance is in question, ask what the artifact
   **contains**, not when it was written.

4. **A guard with a shelf life — sound when written, silently vacated by a change beside it.**
   `engine/canon-fingerprint.test.js` proved that `MIN_SKEL` is not part of the canon by probing
   `MIN_SKEL="1"` against a default of 8. When the default itself became 1 (`5e080ec`), that probe
   began asserting **that the dial equals itself** — green forever, through any breakage, having
   been perfectly sound the day it was written. Reported by skills-4a, 2026-09-03.
   **Rule it produced:** this is the one class in this list that care at authoring time cannot
   prevent. The other three could not fire *as written*; this one could fire and then **stopped
   being able to**, because the ground moved under a correct test. So **a test that probes a
   non-default value must state the default it is contrasting with**, and changing a default means
   auditing every guard that mentions it. A guard has a shelf life.

5. **A MEASUREMENT that read low — a different cost from a guard that cannot fire, and the only
   one on this list that spends your time rather than its own.**
   `statement-kind-coverage.test.js` produces the **production work order**: which of the fourteen
   statement kinds to build first. It classified each site by `spanActions(...).actions[0]` — but
   `spanActions` returns `{ actions, guards }`, and a guard-shaped `if` speaks through **guards**.
   An entire clause channel was counted as silence. All **775** `IfStatement` sites it reported as
   "no clause" carry a guard clause; **zero** are genuinely silent, and among the ones it scored as
   nothing were *"no data in this file"* and *"incorrectly formatted file"*. `IfStatement` was the
   work order's top priority on the strength of that column; corrected, it is 417 generic and 77%
   site-specific — mid-tier. Found by skills-4a, 2026-09-03 (`0769400`), one step before building
   productions against 775 sites that already spoke.
   **Rule it produced — and why it is filed apart from 1–4.** Those four were **guards** that could
   not fire, and *a guard that cannot fire wastes itself*. This was a **measurement that
   undercounted**, and a bad measurement does not fail in place: **it sends the work somewhere it
   wasn't needed.** Failing silent and measuring low are different costs, and only the second one
   spends your time. The mechanism — *a producer with two channels and a consumer reading one* — is
   ruled as a checklist step in **§8B.9.1**, with all three of its instances named; it is not
   restated here. The lesson that belongs here is the *direction* of the failure: **a low number is
   reassuring, so nothing prompts the second look that a crash would have forced.**
   **And there is a worse grade of the same thing, found in this section's own neighbour (§10, the
   rejected archetype classifier): a number that reads not low but PLAUSIBLE.** That classifier hit
   0.6% unclassified with beautiful aggregates and was confidently wrong about real files. The
   distinction, drawn with skills-4a: **a low number invites a second look; a plausible one closes
   the question.** Where a bad measurement sends the work to the wrong place, a plausible one sends
   the wrong answer onward as fact — and the aggregate is then actively working against you, because
   the only thing that can catch it is inspecting individual rows you have no reason to suspect.

6. **A measurement whose SUBJECT was quietly substituted — green, correct, and answering a
   question nobody asked.** Reported by skills-4a against their own headline number, 2026-09-03,
   and it indicts one of mine in the same breath.
   *"byte-identity 1037/1037"* has been asserted before every measurement all night, as the floor.
   `test-lzw-roundtrip.js` renders each file **fresh in memory** and compiles that back; **it never
   reads `sen/files/**.en`.** *Verified independently rather than accepted:* its only
   `readFileSync` on the corpus reads the `.ts` source. So the floor was 1037/1037 **while 405
   persisted `.en` were stale and refusing to compile** — both true, no contradiction, and the
   assertion is *structurally incapable* of seeing the difference. **The same substitution is in my
   own scale number:** the folder/program round-trip of 1038/1038 is also an in-memory render, so
   it measures the renderer too, and I reported it in a sentence about the corpus.
   **THE GENERAL FORM — ONE NAME OVER TWO PROPERTIES.** State it this way, because it is not a
   fact about this codebase and the instance is the weaker half of the lesson:

   > A single name comes to cover two distinct properties. Every use of it is locally correct.
   > Readers substitute whichever property they had in mind, **and nothing ever contradicts them**,
   > because both properties are true — of different subjects. The name is the defect; no
   > individual assertion is wrong.

   This is a *third* failure class, distinct from the two above it. A guard that cannot fire
   (1–4) is silent. A measurement that reads low (5) is wrong in a known direction. **This one is
   right, every time, about something other than what you asked.** It therefore survives review,
   re-runs, and independent reproduction — two lanes measured `1037/1037` and both got it, because
   the number was never in question; only its subject was.

   **Two instances, same night, same shape:**

   | name | property A | property B | who substituted which |
   |---|---|---|---|
   | *"byte-identity 1037/1037"* | a **fresh render** round-trips | the **corpus on disk** compiles | both lanes read B; the test measures A |
   | *"the only check that can see this class"* | **internal consistency** (heading ↔ children) | **currency** (equals today's render) | both lanes read one check as covering both |

   **The rule, and it is a step rather than a caution:** an assertion has a **subject**, and the
   subject is whatever it actually read — not the thing you were thinking about when you wrote it.
   **Name the subject in the assertion's own text** ("a FRESH render round-trips", not
   "byte-identity"; "headings are self-consistent", not "the corpus is fine"). When two checks seem
   to disagree about one property, **suspect first that it is two properties** — that diagnosis was
   right both times tonight, and the alternative diagnosis on offer was "one of them is blind",
   which was wrong both times.

   **A corollary, measured while checking the above, and it is the part that would have bitten
   next.** skills-4a's read was that `enfile.test.js`'s persisted-corpus assertion is *"the only
   check in the tree that can see this class at all."* **That is false, and the check it overlooks
   is strictly MORE sensitive.** `engine/en-idempotence.test.js` HALF 1 asserts that every
   persisted `.en` *is exactly what a fresh render produces*, and it fails too:

   | detector | sees | count |
   |---|---|---|
   | `en-idempotence.test.js` HALF 1 | persisted `.en` ≠ fresh render | **438** |
   | `enfile.test.js` corpus assertion | persisted `.en` refuses to compile | **405** |
   | *the gap* | **drifted but still compiles byte-identically** | **33** — invisible to `enfile.test.js` |

   (599 identical + 33 drifted-but-compiling = the 632 that compile clean. The numbers reconcile.)
   **And I had missed it as well, in the same direction:** my affected-test sweep listed the tests I
   judged *related to my change* rather than the tests that *read the artifact in question*, so the
   more sensitive of the two never ran. **Rule:** when an artifact is suspect, enumerate the
   consumers that READ it — `grep` for the read, do not recall them — and run all of them. Choosing
   detectors by topic is how two sessions independently concluded that the weaker detector was the
   only one.

**The shape they share:** every one of these failed in the **reassuring** direction — a confident
zero, a comment agreeing with itself, two sessions agreeing with each other. §3's *"a guard that
cries wolf gets ignored, then removed"* has a mirror, and it is worse: **a check that cannot fire,
or a claim that cannot be contradicted, reports success no matter what is true.**

---

## THE SAME DEFECT ONE LAYER UP — INSTRUCTIONS, NOT TESTS

Filed here rather than in an operations doc, because it is this section's failure mode exactly:
**invisible until exercised, and reassuring while invisible.**

Twice on 2026-09-03, within three hours, two parallel sessions were handed instructions that were
each **coherent in isolation and jointly inconsistent about one shared operation** — first the
`ALLOW_ORPHANS` name APPLY, then the `MIN_SKEL=1` re-mine. One lane's instruction said *proceed*;
the other's said *parked*. Neither lane could see the contradiction from inside its own instruction
set, and **the only detector either time was one lane acting** — which is to say, the contradiction
was discovered by being executed. The first time it completed before the objection landed (the
outcome was safe: 3,582 chunk names preserved, 0 lost, `5bb65f5`). The second time the lane held,
reported the *pattern* rather than the individual call, and was right to.

*Amir, 2026-09-03, taking it as his own:* **"Twice in three hours I handed the two of you
instructions that were each coherent alone and jointly contradictory about one shared operation
(this re-mine, and `ALLOW_ORPHANS` before it), and both times the only detector was one of you
moving. That's my coordination failure, not yours."** And on the holding: **"I'd rather lose ten
minutes than have that class of thing land silently."**

**The protocol, effective 2026-09-03:**

> Any instruction touching **shared state** — the catalog, the corpus, a render, a re-mine — is
> issued to **every** lane in the **same message**. A shared-state instruction that names only one
> lane is **incomplete**: the lane receiving it does not act on it, and says so.

*Amir, 2026-09-03, accepting the corollary onto the record in his own words:* **"a shared-state
protocol that yields whenever the merits look good is a habit that happened not to have cost
anything yet. The near-riskless re-mine was correctly held. The protocol holds even when holding is
obviously unnecessary — that's the only version of it that's worth anything."**

The corollary is the load-bearing half, because it is the one that costs something: **this cuts
against acting even when the merits are clear.** The `MIN_SKEL=1` re-mine was close to riskless —
zero names orphaned across four full mines, byte-identity held, the catalog regenerable — and it was
still correctly held, precisely because a protocol that yields whenever the merits look good is not
a protocol. A lane that would act on a favourable reading of an incomplete instruction has no
detector at all; it has a habit that happened not to have cost anything yet.

### THE MIRROR OF THE SWEEP — a shared doc left `MM` across lanes

`CLAUDE.md` §7 documents the **sweep**: committing a path whose working-tree copy holds a peer's
work takes it into your commit. **This is its mirror, and it is not covered there.** Cross-referenced
rather than restated; the rule below is the addition.

Both lanes hit it on the same two files on 2026-09-03 (`10-language-and-grammar.md`,
`16-test-integrity.md`). A private-index commit correctly **excludes** a peer's uncommitted edits —
that is what it is for — but the result is that **your paragraphs exist in the commit only, while
the working tree still holds their version without them.** One ordinary `git add` from either lane
then stages your work out of existence, in the reverse direction from the sweep.

> **A shared PRD or notes file is committed by whoever edits it, promptly, and is never left `MM`
> across lanes.** If you must leave it, say so to the other lane by name and file.

**The detector is the sweep detector run the other way round:** after committing, grep your own
marker in the **worktree** and at **HEAD**. `worktree: 0 / HEAD: 1` means your text is committed and
missing from the live file — merge it forward. `worktree: 1 / HEAD: 0` is the ordinary uncommitted
case. Both lanes caught their own instance this way.

**And a mechanism worth naming, because I got it wrong while following the recipe correctly.**
`CLAUDE.md` §7 requires a `git add` on the committed paths after `update-ref`, to settle the
**shared** index. I ran it **with `GIT_INDEX_FILE` still exported**, so it settled the *private*
index and left the shared one stale — the file stayed `MM`, which is the exact state the step exists
to clear. The step is only load-bearing when the variable is gone:

```sh
unset GIT_INDEX_FILE
git add -- <the paths you just committed>
git status --short -- <those paths>     # must be empty
```

**A required step that silently no-ops is worse than a missing one**, because the recipe was
followed and the check appeared to pass — the same shape as §16's guards that cannot fire, in a
procedure instead of a test.

**Grep a string you have CONFIRMED EXISTS in the peer's file, never your own paraphrase of their
message.** *2026-09-03:* I searched for `"inline value-span prose"` — my wording from a peer's
summary — got zero hits in worktree, HEAD **and** their own commit, and briefly read their work as
missing. It was present the whole time at `10-language-and-grammar.md:316`, worded differently.
`CLAUDE.md` §7 already forbids grepping a commit **subject** for this reason; a paraphrase of a
peer's prose is the same defect with a friendlier disguise, and it fails in the alarming direction
rather than the reassuring one.

## THE ASYMMETRY: AN ALARMING ERROR SURVIVES LONGER THAN A REASSURING ONE (2026-09-03)

Amir's statement of it, after a night in which four separate false alarms were raised, relayed and
acted on before any of them was checked:

> **The alarming error survives longer than the reassuring one, because nobody argues with bad news.**

This is the generalisation of class 6 (*one name over two properties*) rather than a new class. What
makes it operational is the direction: a detector reporting catastrophe is granted a credibility that
the same detector reporting success would never get, **because catastrophe feels like diligence**.
The night's four, all of which ran alarming and all of which were wrong:

| claim | reality | who caught it |
|---|---|---|
| a peer's §16 table is uncommitted, "one careless commit from gone" | committed and pushed two moves earlier; the measurement's subject was a stale parent | the peer |
| 163 file labels are concatenations of their children | **5**. The detector tested "contains the child's label", which fires on `2 constants and 1 shape` overlapping a child labelled `1 shape` — two honest claims, not a concatenation. 30× over | the other lane's stricter detector |
| a paraphrase of a peer's prose returns zero hits, so their work is missing | present the whole time, worded differently (`10-language-and-grammar.md:316`) | re-reading the file |
| 139,871 of 150,313 payload holes resolve to no template | **0**. The probe found a `.words` table nested under ONE axis and used it for both, so every hole on the other axis "failed" | the 93% figure being implausible on its face |

**The rule that comes out of it is not "check your detector".** It is that *a detector reporting
catastrophe must clear the same bar as one reporting success*, and nothing enforces that today
because nobody asks a bad number to justify itself.

### THE STALE-SUBJECT ALARM — THE ONE *BOTH* LANES COMMITTED, HOURS APART

Two of the four rows above are the same defect, raised by different lanes, in the same direction,
with almost the same wording:

| lane | claim | reality |
|---|---|---|
| s1 → s2 | "your §16 table is still UNCOMMITTED, one careless commit from gone" | committed and pushed in `c513235` before the message was written |
| s2 → s1 | "`ASSUMPTIONS.md`, `16-test-integrity.md`, `19-open-technical-fronts.md` are absent at HEAD — 249 lines one careless `git add -A` from gone" | all three present at HEAD in `8a04c53`, pushed, `git diff --numstat HEAD` empty |

**The mechanism is that the probe is correct and its subject expires.** `git diff --numstat` against
HEAD is a true statement about the HEAD it ran against, and in a shared tree the other lane commits
between the probe and the message. The alarm then travels with the authority of a measurement while
describing a state that no longer exists.

**Why it recurred despite being named once already:** a worktree-vs-HEAD probe *reads as diligence*.
It is the detector CLAUDE.md §7 asks for, so running it feels like following the recipe, and nobody
re-runs it after sending — the very asymmetry above, applied to the tool built to catch the asymmetry.

**The fix is one line of protocol, not a better probe.** Re-run the probe *immediately before*
sending, and quote the HEAD sha it was measured against, so a stale claim is falsifiable by
inspection rather than by the recipient's memory. A stale-subject alarm costs the recipient a full
verification cycle, and both lanes paid it tonight.

### AND THE ONE THAT RAN THE OTHER WAY — WHICH IS WHY IT SURVIVED LONGEST

The inside/outside split of the goal number was published as **93,162 inside / 35,491 outside** and
relayed to Amir. It never summed to the 138,387 headline it sat beneath, and nobody noticed —
including its author, across two reports. Re-measured with the frozen strip applied it was
**102,886 / 35,491**: the inside term was ~10,000 low, **in the flattering direction**.

It is the only one of the five that erred reassuringly, and it is the only one that was relayed
twice before being caught. That is the asymmetry stated from the other side: *the reassuring error
survives because nobody argues with good news either — they repeat it.*

The mechanism was a measurement whose subject had quietly changed: the split counted **decoded hole
text**, while the headline counted the **stripped page**. Two different populations under one name,
which is class 6 again, and the arithmetic that would have exposed it — *do the parts sum to the
whole?* — was never performed because neither part looked wrong on its own.

## A PROJECTED REDUCTION AND A MEASURED ONE ARE TWO PROPERTIES (2026-09-03)

Both lanes hit this within an hour of each other, in **opposite directions**, which is what makes it
a rule rather than an anecdote.

- **Too high.** The English-hole work projected its value from a table of constructs-per-hole-type:
  8,321 (`str`) + 9,167 (`obj`/`arr`) = **17,488**. Measured on the stripped page after re-encoding
  all 9,724 corpus payloads: **26,182**. The projection missed that rendering an object also converts
  the string literals *nested inside* it — `{ headers: { accept: '*/*' } }` takes its own braces and
  every quoted value with it.
- **Too low.** ~~The interior-production spike priced if-blocks at **−1,795** by charging itself for
  `if (`, `)` and the braces. Those are **skeleton**: they live in the dictionary and never reach the
  page. Corrected: **−2,215**.~~ In that lane's own words, *"I priced a model of the measurement
  instead of the measurement."*

  **REFUTED IN PLACE, 2026-09-03, per §9 — and this bullet is now the sharpest instance in the
  section rather than an example of the fix.** The braces are **not** skeleton. Measured
  corpus-wide: the `if (` and `)` are skeleton, the braces are **hole text**, and hole text is on
  the page.

  ```
  if‹gap›(‹id›.length < ‹num›)‹gap›‹body›       braces in skeleton 0 / hole text 1,822
  ```

  So the net is `4408 → 5811`, **+1,403** — if-blocks **lose**. `function` decl moves
  −445 → −193. Corrected table below.

  **Why this is the worst instance and not merely a stale number: a section about mis-priced
  projections was citing a mis-priced projection as the moment pricing got honest.** The
  −1,795 → −2,215 correction is quoted here as the lane's turn from pricing a model to pricing
  the measurement. It wasn't. It priced a *second model*, more carefully — and the extra care is
  precisely what made it credible enough to be relayed and written into the PRD as settled.

  **THE CLAUSE THAT WOULD HAVE CAUGHT IT: A CORRECTION IS A NEW PROJECTION.** It inherits none of
  the trust it earns by being a correction. This one went from wrong to
  **wrong-in-the-other-direction while looking like convergence**, and nobody re-derived it
  *because it had already been fixed once*. The relaying lane recorded that it passed −2,215 on
  with **more** confidence than it had given −1,795, *for the sole reason that it was a
  correction*. That is a reporting rule as much as an engineering one, and it is the mechanism by
  which a single bad number reached three documents.

  **AND THE SITE COUNT IS ITSELF AN INSTANCE.** The refutation was first reported as being in *two*
  places, from a targeted grep of §16 — because §16 was the file under review. It was in three;
  the third inverted an argument rather than a number. **A claim's blast radius is the number of
  times it was RELAYED, not the number of places you remember writing it.** The sweep costs one
  grep. Both lanes had by then audited a *file* rather than a *claim*.

  **WHAT FOUND IT, WHICH RE-READING DID NOT.** The pricing code was read three times, once
  *specifically* to correct it, and found nothing. What found it in seconds was a stubbed
  `compileChild` that returned the inner statements and produced `if (c) throw new Error(...)`
  with the braces **visibly gone** — a test written afterwards, for a different purpose, that
  could fail. That is the argument for writing the test that could fail over the test that
  confirms, and it belongs next to the merged rule below.

**The rule.** A projection counts *holes*; a reduction counts *what actually leaves the page*. They
are two properties, and the projection is the one that gets quoted. A projected number is publishable
only alongside the measurement that confirms it — and when a projection comes in **low**, that is not
good news to bank, it is a signal the model of the page is wrong. The −18.9% above was predicted
end-to-end (112,205) *before* the render and the render returned 112,205 exactly; that is the
standard, not the 50% surprise that prompted it.

## BYTE MASS IS THE WRONG TARGETING METRIC (2026-09-03)

The arrow-opener population was selected as the next target off **3,855 fragments and 333 KB** — the
largest byte mass on the board. Measured per kind, it is worth **exactly zero**:

| kind | sites | byte-exact | `body=skel` | now | after | NET |
|---|---|---|---|---|---|---|
| `IfStatement` | 1822 | 1809 (99%) | 1809/1809 | 4408 | ~~2193~~ **5811** | ~~−2215~~ **+1403** |
| `const =` arrow/fn | 1535 | 1524 (99%) | **0/1524** | 8367 | 8367 | **0** |
| `function` decl | 130 | 126 (97%) | 126/126 | 580 | ~~135~~ **387** | ~~−445~~ **−193** |
| call w/ arrow arg | 384 | 380 (99%) | **0/380** | 2636 | 2406 | **−230** |

**The `after` column was wrong for the same reason twice, and the reason has a name (below): it was
named `after` and it computed what the model INTENDED to exclude, not what the page would carry.**
The line responsible, quoted rather than described, because quoting is what makes a §16 row
checkable:

```js
if (types[i] === "body") continue;   // "becomes the child slot: empty text"
```

The comment is the whole defect. The body hole does not become empty text — it carries the block,
braces included, and the braces stay on the page. **Not one kind in this table moves into the
positive column, and `IfStatement` moves out of it.**

The mechanism generalises (2,030 of 2,049 byte-exact, 0 wrong bytes); **the value does not.** The
entire arrow signature — `(`, `)`, `:`, `=>`, `[`, `]`, `{`, `}` — is *one* `fn` hole, so nothing
comes off the page and a payload mark is added.

**What decides value is the granularity the existing skeleton already reaches**, and that is readable
per kind from `expandKey` output *before anyone builds anything*. The negative result is pinned by an
assertion that fires if that row ever starts paying, so the target cannot be re-selected off the byte
table.

**One qualification, or the row will be misread.** `NET 0` for arrows is a property of **the current
canon** coining a single `fn` hole over the whole signature — *not* a property of arrows. A canon
splitting `fn` into `‹params›`/`‹ret›`/`‹body›` would move that row to PAYS with no renderer change
at all. Record it as *"0 under the current canon"*. Recording it as *"0 by construction"* is class 6
committed in the act of documenting class 6.

## `gap` — THE ONE INSTANCE THAT PREDATES US (2026-09-03)

`gap` is the most-used hole type in the corpus: **81,390 holes**. It is universally read as "the
whitespace between two statements". Measured:

- whitespace-only: **81,314** (99.91%)
- **not whitespace: 76** — every one a *comment*

```
"\n  // created: Date;\n  // createdUserId: number;\n  // modified: Date |"
" // eslint-disable-line max-len\n  "
"\n  // console.log(uri);\n  "
```

Those 76 holes carry **87 constructs** in the goal metric, so "a `gap` hole is construct-free" is
false. The two lanes met this population from opposite ends on the same night — one counting
non-whitespace `gap` holes corpus-wide (76), the other counting if-block spikes that failed because
*a gap held a comment* (9) — and they are the same defect: **"the bytes between two statements" and
"whitespace" are two properties under one name**, and the name has carried both since `gap` was
coined.

It is the only instance of the shape identified this session that **predates the session**, which is
the reason to expect more of them in the older layers rather than fewer. Any claim of the form
"these N bytes carry zero constructs" must keep its denominator visible — *whitespace-only in 1,809
of 1,822*, never *"whitespace"*.

## A LABEL OVER A MEASUREMENT (2026-09-03)

> **A name says what something is *about*. It does not say what it *reads*.**

**The merged row. Each lane supplied one half on the same night, one layer apart, and they are not
two lessons.** One was a **test** named for a property it never read; the other a **measurement**
named for an intent it never checked. Filed together because the merged rule is the one that
generalises, and because either half alone reads as a local slip.

### HALF ONE — the test you would cite is not always the test that would catch it

**Third occurrence of the currency-vs-consistency split, on the same pair of tests.** The first two
were the 405-vs-438 gap (`SDD_DERIVE_CHECK`'s internal-consistency question read as
`en-idempotence`'s currency question) and the 33 `consistent ∧ ¬current` files. This one arrived as a
challenge to a report, and the challenge was right for the wrong reason.

**The question asked:** *"Did the byte-identity assertion run AFTER the render, not just
'throughout'?"* — hunting a missing after-assertion.

**The answer:** it had run. `round-trip-fixpoint` was 5/5 before *and* after, 1037/1037 both cells.

**The actual weakness, which the question would not have found:** `round-trip-fixpoint`
**never opens a persisted `.en`**. Both of its cells render fresh from `.ts`:

```js
en1 = EN.renderFileEn(source, index).en;   /* ts -> en */
ts1 = EN.compileFileEn(en1, index);        /* en -> ts */
en2 = EN.renderFileEn(ts1, index).en;      /* ts -> en again */
if (ts1 === source) tsFix++;
if (en2 === en1) enFix++;                  /* two FRESH renders compared to each other */
```

So a render that wrote **corrupt bytes to disk** would leave this test green in both cells, before
and after, because the bytes it writes are never read back. The test is correctly scoped and its own
header says so — currency against disk belongs to `en-idempotence.test.js` HALF 1 — but *its name is
the one a reader reaches for* when asked "is the corpus byte-identical?", and its label ("`en -> ts
-> en` is the identity on every file in the corpus") does nothing to stop them.

**What actually covers the on-disk claim** is two other things: `en-idempotence` HALF 1 (the persisted
`.en` *is* what a fresh render produces) and `write-en-files.js`'s own pre-write gate (each `.en`
verified `.en -> .ts` byte-identical *before* it is written). Both were green. **Two** further checks were then run
directly to close it, in different sessions against the same disk — each opening every persisted
`.en` and compiling it against source:

| run by | at | result |
|---|---|---|
| the payload lane | `527fcb1` | 1037/1037 byte-identical, 0 wrong bytes, 0 refused |
| the interior lane, independently | `a7d2d55` | 1037/1037 byte-identical, 0 wrong bytes, 0 refused, 1037/1037 with a `.ts` counterpart |

**Two lanes, one disk, one independently derived number is worth more than one lane's**, and it was
the gap the second lane had itself named as unrun. Re-run at `633127d` either side of the dispatch
landing: 1037/1037, 0 wrong bytes, 0 refused, 0 unmatched.

**Read the defect as the NAME, not the test.** `round-trip-fixpoint` is correctly scoped, its header
says so, and a reader who takes this row as *"round-trip-fixpoint is broken"* will delete a good
test.

**The rule.** When asserting a property of an artifact on disk, cite the test that *opens the
artifact*, not the test whose name matches the property. A test's name describes what it is about; it
does not describe what it reads. And the corollary for reviewers: *"did the assertion run after?"* is
a weaker question than *"which file does that assertion open?"* — the first can be satisfied by a
test that could never fail.

### HALF TWO — the column named `after` computed what the model intended to exclude

The interior-production pricing table (above, now corrected) carried a column named `after`, meaning
*the constructs the page would carry after the change*. It computed something else. The line, quoted
rather than described:

```js
if (types[i] === "body") continue;   // "becomes the child slot: empty text"
```

**`after` was the name; "what I intend to exclude" was the computation.** The body hole does not
become empty text — it carries the block, braces included, and the braces stay on the page. The
column read 2193 where the page would read 5811, and the sign of the whole front flipped: −2,215
became **+1,403**.

**What makes it the same defect as half one, one level up:** in both, a name asserted a *subject*
and a reader inferred a *reading*. `round-trip-fixpoint` is about the round-trip fixpoint and reads
two fresh in-memory renders. `after` is about the after-state and reads the model's exclusion list.
Neither name is a lie about what it is about; both are silent about what they touch, and **silence
is where the reader supplies the wrong answer.**

### THE OPERATIONAL FORM

- Name a check for **what it opens**, not for what it concerns. `round-trip-fixpoint-in-memory`
  would have ended half one before it began.
- For a derived column, name the **derivation**, not the intent — `after-excluding-body-holes`, not
  `after`. A name that states its own exclusions cannot hide one.
- **When citing a property of an artifact, cite the check that opens the artifact.** Reviewer's
  question: not *"did it run?"* but *"which file did it open?"*
- And the finding that generalises furthest, because it cost the most: **re-reading found neither
  half.** The pricing code was read three times, once specifically to correct it. What found it was
  a stubbed `compileChild` producing `if (c) throw new Error(...)` with the braces visibly gone — a
  test written afterwards, for a different purpose, **that could fail.** Half one was found the same
  way: not by re-reading `round-trip-fixpoint`, but by running the check it does not perform.
  Reading a thing confirms what you already believe it says. **Write the test that could fail.**

## THE GOAL METRIC'S OWN DENOMINATOR OMITTED 24% OF THE CODE (2026-09-03)

`the-goal.test.js` printed **"1035 of 1035 non-empty files"**, and that was relayed upward as
complete coverage of the corpus. It is complete coverage of the files that were **rendered**.
`write-en-files.js` walks `p.endsWith(".ts") && !p.endsWith(".d.ts")` — so it takes `.ts` and **not
`.tsx`** — and the source tree holds **332 `.tsx` files** (the `hydra-ui` React components) that are
never rendered, never compiled and never measured.

*"No TypeScript survives on any page"* was therefore being asserted over a population that silently
excluded ~24% of the TypeScript in the tree. **This is class 7 — a summary that structurally cannot
report the bad case — committed inside the goal artifact itself**, which is the one artifact written
specifically so that no metric could stand in for the goal again.

**Fixed in the report only.** The test now prints the excluded count and its extension, inline and on
its own line, and the failure message reads *"of 1035 non-empty RENDERED files; 332 source files are
outside this metric"*. The strip list, the assertions and the constructs count are untouched — the
change can only ever make the artifact read worse and more honest.

Two deliberate choices in that fix:

- **The count is computed, never pinned.** Printing the literal `332` would be shorter and would go
  stale silently while reading green — the exact defect this section keeps finding. It is derived
  from both trees on every run.
- **A plain `.ts` with no `.en` is counted separately and shouted**, because that would be a
  *rendering gap* rather than a scope boundary. Measured **0** today. Conflating the two would put a
  real gap and an intended exclusion under one name, which is class 6.

**Whether `.tsx` should be rendered is not decided here** and is held open for Amir. The scope call is
probably deliberate — the mandate is engine-only and these are React components — but *probably right
and written down nowhere* is what the exclusion had been resting on, and the metric implied the
question was already answered.
