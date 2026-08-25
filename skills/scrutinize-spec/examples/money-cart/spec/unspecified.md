# Unspecified — deliberately NOT contractual

These are choices the generator is free to make. They are declared here so the
spec does not grow toward the size of the code, and so a regeneration that
changes any of them is **not** a drift or a defect. If it is not in a module's
`spec-codegen` block, a contract, or the standards, and it is listed below, it is
not part of the source of truth.

- **Generated identifier names** — helper/intrinsic function names, local
  variable names, and parameter spelling *inside* the generated code (the
  public function names in the contracts are fixed; internal names are not).
- **Internal decomposition** — whether an intrinsic is emitted inline or as a
  shared helper, and the order in which helper functions appear in a file.
- **Constant embodiment** — whether a `{"const": ...}` value is inlined as a
  literal or hoisted into a named binding, as long as the runtime value matches
  `constants.md`.
- **File header / comments** — any banner, provenance comment, or formatting
  whitespace at the top of a generated file.
- **Module require style** — how a generated module imports another
  (`require('./money.js')` vs a bundled form), as long as the fixtures pass.
- **Line-item iteration order** — the order `sum_line_items` visits items; the
  sum is order-independent, so any order is correct.
- **Error/exception behaviour on invalid input** — undefined by standards C3;
  the generator may do anything (throw, return NaN) for inputs that violate the
  declared parameter types, and no fixture constrains it.
