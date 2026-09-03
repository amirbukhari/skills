# Name re-adoption batch — 2026-09-03

**27 decisions, in one pass.** Assembled at Amir's instruction rather than dribbled out one at a
time. Nothing here has been applied. §5C/R-LANG-7: the tool never auto-attaches, and since
`a5501a7` a chunk label is an **input to compilation** — so every approval below needs a render
in the same unit of work, not afterwards.

---

## A. EXACT RESTORATIONS — 19

These are **not** guesses. A chunk key is `sha256(ordered leaf skeletons)`, so a key that
resolves today is provably the same word the name was authored for. They were orphaned by the
2026-09-02 22:51 body-slot re-mine and restored by the MIN_SKEL=1 re-mine; all 19 carry
skeletons recovered from a pre-body-slot catalog. Ranked above the fuzzy half for that reason.

**1. `set state.freshbooksaccountid`**  — `wc:6cb104c44d6ebe8b`  
`‹id›.‹m› = ‹id›.‹m›;  |  ‹id›.‹m› = ‹id›.‹m›;`

**2. `add to page`**  — `wc:e7547ca5a67e85c2`  
`‹id› += ‹num›;  |  const‹gap›‹id›‹gap›=‹gap›‹expr›;`

**3. `await prepare invoice splits for freshbooks into fbinvoices`**  — `wc:4e3c02ef0d925600`  
`const‹gap›‹id›‹gap›=‹gap›‹expr›;  |  ‹id›.‹m› = (‹obj›);`

**4. `set state.nextpage`**  — `wc:528c9c46d8ff50b8`  
`‹id›.‹m› = ‹id›.‹m›.‹m›.‹m›.‹m›;  |  ‹id›.‹m› = ‹id›.‹m›;`

**5. `get batch from splice`**  — `wc:c9c00ca5cf95941f`  
`const ‹id› = ‹id›.‹m›(‹args›);  |  ‹expr›;  |  ‹id›.‹m›(‹args›);  |  await ‹id›(‹args›);`

**6. `await save on manager`**  — `wc:751c5cce70fde92b`  
`await ‹id›.‹m›(‹args›);  |  ‹id›(‹args›);`

**7. `set body`**  — `wc:45c6827f68eae76a`  
`‹id› = ‹id›.‹m›;  |  ‹id› = ‹id›.‹m›;`

**8. `set billingaddress.organization`**  — `wc:0420608ce63ba29b`  
`‹expr›;  |  ‹id›.‹m› = ‹str›;  |  ‹id›.‹m› = null;  |  ‹id›.‹m› = ‹id›.‹m› ?? ‹id›.‹m›.‹m›;  |  ‹id›.‹m› = ‹id›.‹m› ?? ‹id›.‹m›;  |  ‹id›.‹m› = ‹id›.‹m› ?? ‹id›.‹m›;  …`

**9. `set billingaddress.organization`**  — `wc:0f905b837a7d41c8`  
`‹id›.‹m› = ‹id›;  |  ‹id›.‹m› = ‹id›.‹m› ?? ‹id›.‹m›;  |  ‹id›.‹m› = ‹id›.‹m›.‹m›;  |  ‹id›.‹m› = ‹id›.‹m›;  |  ‹id›.‹m› = ‹id›.‹m›.‹m›.‹m›;  |  ‹id›.‹m› = ‹id›.‹m›.‹m…`

**10. `set billingaddress.organization`**  — `wc:d9799dbd55a54ac6`  
`‹id›.‹m› = ‹id›;  |  ‹id›.‹m› = ‹str›;  |  ‹id›.‹m› = null;  |  ‹id›.‹m› = ‹id›.‹m› ?? ‹id›.‹m›.‹m›;  |  ‹id›.‹m› = ‹id›.‹m› ?? ‹id›.‹m›;  |  ‹id›.‹m› = ‹id›.‹m›;  |  …`

**11. `set organization`**  — `wc:6ae2cb879919c433`  
`‹id› = ‹id›;  |  ‹id› = ‹str›;  |  ‹id› = null;  |  ‹id› = ‹id›.‹m› ?? ‹id›.‹m›.‹m›;  |  ‹id› = ‹id›.‹m› ?? ‹id›;  |  ‹id› = ‹id›.‹m›;  |  ‹id› = ‹id›.‹m›;`

**12. `set organization`**  — `wc:02f941a05f61e0a4`  
`‹id› = ‹id›;  |  ‹id› = ‹id›.‹m› ?? ‹id›;  |  ‹id› = ‹id›.‹m›.‹m›;  |  ‹id› = ‹id›.‹m›.‹m›.‹m›;  |  ‹id› = ‹id›.‹m›.‹m›.‹m›.‹m›;  |  ‹id› = ‹id›.‹m›;`

**13. `call set on acc.notedatemap`**  — `wc:0ea8aef254d193e5`  
`‹id›.‹m›.‹m›(‹args›);  |  ‹id›.‹m›.‹m›(‹args›);  |  ‹id›.‹m›.‹m›(‹args›);  |  ‹id›.‹m›.‹m›(‹args›);  |  ‹id›.‹m›.‹m›(‹args›);`

**14. `get batch from splice`**  — `wc:d2a8075c767483d7`  
`const ‹id› = ‹id›.‹m›(‹args›);  |  ‹expr›;  |  ‹id›.‹m›(‹args›);  |  await ‹id›(‹args›);  |  ‹id›.‹m›(‹args›);`

**15. `log a message “dorun processing id: …”`**  — `wc:cb47b9e140c0e8da`  
`‹id›.‹m›(‹args›);  |  ‹id›.‹m› = ‹id›.‹m›;  |  await ‹id›.‹m›(‹args›);  |  ‹id›(‹args›);`

**16. `get liftqb from get query builder`**  — `wc:f6e55009031ef65c`  
`const ‹id› = ‹id›(‹args›);  |  const‹gap›‹id›‹gap›=‹gap›‹expr›;  |  ‹expr›;`

**17. `call dispatch`**  — `wc:ca8d59b32af0113f`  
`‹id›(‹args›);  |  const ‹bind› = ‹id›;  |  const‹gap›‹id›‹gap›=‹gap›‹expr›;`

**18. `log a message “rerun invalid for …”`**  — `wc:28569930c05e58ee`  
`‹id›.‹m›(‹args›);  |  ‹id›.‹m› = ‹id›.‹m›;`

**19. `set country`**  — `wc:e66c5e73eb2bda6b`  
`‹id› = ‹id›.‹m›.‹m›.‹m›.‹m›;  |  ‹id› = ‹id›.‹m›;`
---

## B. FUZZY PROPOSALS — 8

Scored by token-level edit distance over skeletons (§5C rule 2). Each is a **guess** that an
in-use unnamed chunk is the same thing as an orphaned name. Drift is how far the skeletons differ;
`n` is how many sites the unnamed chunk covers. All are `n=1`, so each approval affects one site.

| # | drift | len | proposed name |
|---|---|---|---|
| 1 | 4.8% | 6 | `import errorresponse` |
| 2 | 10.9% | 7 | `stop early when subscriptionids.length is 0` |
| 3 | 11.1% | 9 | `import deeppartial from typeorm` |
| 4 | 14.4% | 7 | `import nullable from ./helpers` |
| 5 | 16.1% | 3 | `set state.token` |
| 6 | 17.5% | 4 | `get subscriptionids from distinct` |
| 7 | 18.2% | 2 | `set state.nextpage` |
| 8 | 18.2% | 3 | `describe the shape money with amount and code` |

---

## Three things to decide before approving, not after

**1. `set state.nextpage` is in BOTH lists — A#4 and B#7.** The orphan itself is exactly restored,
*and* a different unnamed chunk is being proposed the same name. Approving both would put one name
on two distinct skeletons. The exact restoration should win and **B#7 should be withdrawn**; that
is a recommendation, not something the tool decided.

**2. Three names in list A are already duplicated across distinct skeletons**, and were before any
of tonight's work — this is inherited, not introduced:

| times | name | keys |
|---|---|---|
| 3 | `set billingaddress.organization` | `wc:0420608c…`, `wc:0f905b83…`, `wc:d9799dbd…` |
| 2 | `set organization` | `wc:6ae2cb87…`, `wc:02f941a0…` |
| 2 | `get batch from splice` | `wc:c9c00ca5…`, `wc:d2a8075c…` |

A name is a *spelling of one word*, so two skeletons sharing one spelling is either a real
duplication in the corpus or a naming error from the worksheet pass. Restoring them re-creates the
ambiguity exactly as it was. Worth a look, not a blocker.

**3. The remaining 955 chunk orphans stay orphaned and that is correct.** They keep their
skeletons, they are never deleted (§5C rule 1), and they will be proposed automatically if their
skeleton returns. Nothing needs doing about them.

## What has NOT been done

- Nothing applied. `word-names.json` is unchanged by this document.
- No `SDD_DERIVE_CHECK=0`. The escape hatch exists and has not been used.
- No render. Approvals and a render must land together.
