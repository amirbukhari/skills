# Glossary — the eight terms that carry the design

*Front matter · [index](README.md)*

| term | means |
|---|---|
| **word** = **generator** = **dictionary entry** | one LZW entry: a prior entry plus one symbol, with typed holes. The three names are the same thing seen from mining, rendering and compiling. |
| **hole** | a typed slot inside a word, recording the exact source span it abstracted. Holes carry the domain meaning; they stay verbatim TypeScript. |
| **the fold** | the universal invariant: a construct is replaced by a higher-tier form **only** when that form refills to the exact source span. |
| **byte-exact gate** | the per-span check that enforces the fold at render time. A span that fails it stays verbatim TypeScript, loudly. |
| **byte-identity** | `compileFileEn(renderFileEn(src)) === src`. The floor, for every file, always. |
| **tier** | dictionary *depth*, emergent from LZW recursion — never a hand-assigned label. |
| **SOURCE / CORPUS** | the two roots: the `.ts` tree that is read, and the tree that is written (holding `sen/`). |
| **residue** | bytes no word claimed. Must be classified (non-recurring shape · free-text slot · comment/trivia · formatting variance), never papered over. |

---
