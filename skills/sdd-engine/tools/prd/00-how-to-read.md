# How to read this document

*Front matter · [index](README.md)*

**If you are an agent picking this up cold and building:** read **Part I** (what and why), then
**Part III — the requirements register**, which is the normative build list. Everything else is
rationale you consult when a requirement is not obvious. Read **Part VI** before you make any
design decision — it is the list of things that are *not decided*, and guessing at one of them is
the most expensive mistake available here.

**Normative language.** **MUST** / **MUST NOT** are requirements; every one appears in the register
in Part III with an ID and a way to test it. **SETTLED** marks a decision that is closed — do not
re-litigate it without new measurement. **OPEN** marks a question that needs Amir; it is never
resolved by inference.

**Section labels are stable.** `§4A`, `§8B`, `§10.3` and the rest keep the identifiers they have
always had, because engine source comments, `CLAUDE.md` and past decisions all cite them. This
restructure changed the **order and the navigation**, not the labels — so a code comment reading
`PRD §8B` still resolves. The parts below are a reading order over stable sections, not a
renumbering.

**Three things this document is not.** It is not a scoreboard (Part V states gates, not readings).
It is not a status report (where implementation status is contested, that contest is an OPEN
question in Part VI, not a claim). It is not a roadmap — §6 lists work fronts, but the register in
Part III is what defines *done*.

---
