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

