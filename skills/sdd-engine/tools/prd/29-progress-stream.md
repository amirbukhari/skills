# §5D.5 — The NDJSON progress stream

*Amir, 2026-09-01: `render` and `mine` should be able to emit progress and the byte-identity gate
result as a structured stream for Kraken's SDD panel, with the prose output kept working.*

## 1. What it is

`engine/progress.js`, schema **`sdd-progress/v1`**. With `--json`, `write-en-files.js` and
`build-lzw-generators.js` write **one JSON document per line on stdout** and move their prose to
**stderr**. Without the flag, nothing changes — not one byte.

    {"schema":"sdd-progress/v1","step":"render","event":"start","seq":0,"ms":605,"totalFiles":1037,…}
    {"schema":"sdd-progress/v1","step":"render","event":"file","seq":1,…,"rel":"src/app.ts","done":1,"total":1037,"byteIdentical":true}
    {"schema":"sdd-progress/v1","step":"render","event":"gate","seq":1038,…,"name":"byte-identity","requirement":"R-REND-1","pass":true,"passed":1037,"failed":0,"failures":[]}
    {"schema":"sdd-progress/v1","step":"render","event":"summary","seq":1039,…}
    {"schema":"sdd-progress/v1","step":"render","event":"end","seq":1040,…,"ok":true,"exitCode":0}

Every line carries `schema`, `step`, `event`, `seq` and `ms`. `seq` is monotonic from 0 per process,
so a consumer detects a dropped or reordered line without needing timestamps.

The event vocabulary is **closed**: `start`, `phase`, `file`, `gate`, `summary`, `end`, `error`. A
name invented at a call site is a name no consumer knows, so `emit` refuses anything else.

## 2. This contradicts sdd-run.js, and the contradiction is resolved rather than papered over

`sdd-run.js`'s header opens with *"WHY A WRAPPER AND NOT `--json` ON ELEVEN SCRIPTS"*, and argues
that adding an output mode to each script means editing every one of them "including the
byte-identity path, where a change is a regression risk for no functional gain."

**That argument is still right about what it was arguing, and it was left in place.** What it does
not cover is **progress**. `sdd-run` spawns a child and reads its output when the child exits, so a
5-second render and a 5-minute one are indistinguishable until they finish. An envelope cannot say
what is happening meanwhile; that needs a stream. The two answer different questions and are wired
to agree — a progress `end` event's `ok` is `exitCode === 0`, the same rule `sdd-run`'s envelope
applies. Use `sdd-run` to **run** a step; pass `-- --json` through to **watch** one.

**The eleven-scripts argument still stands for the other nine.** Two scripts grew a flag because two
scripts are the ones a panel watches. Nothing else should, without a reason as concrete.

## 3. The gate is a first-class event, and it can be false

R-REND-1 calls byte-identity *"the floor and it never regresses"*, and R-PIN-6 says a build that
cannot walk the whole tree *"MUST fail loudly … it never emits a smaller plausible number"*. Both
are now events a UI can switch on rather than prose it must parse, and both name the requirement
they enforce. `failures` is a **list of files**, not a count: the file that failed is the one a panel
needs to name.

Per §10.3, a gate that cannot be shown to FIRE is not a gate, so the test drives the mine's gate
false with an empty `SOURCE` and asserts the whole failing sequence — `gate.pass:false` with
populated `problems`, an `error` event citing R-PIN-6, `end.ok:false`, exit 1. **The render gate's
false branch is not forced**, and that is stated rather than glossed: a byte-identity failure cannot
be manufactured from outside the renderer, since every span is byte-gated by construction. What the
test pins there is the shape and the true value; the falsifiability is demonstrated on the gate
mechanism through the mine.

## 4. Why one module and not two emitters

Two scripts writing the same shape from two places is the producer/consumer drift shape (§8B) with
the UI as the consumer — the event that gains a field in one script and not the other is exactly the
bug that shape produces. One module, imported by both, and one test asserting both.

## 5. Measured

- `engine/progress.test.js`: **8 assertions**, run as subprocesses against temporary roots, which is
  how a UI runs them and the only way to observe the real stdout/stderr split.
- **The prose is byte-identical between modes** — 1,515 bytes over the fixture, asserted equal, so
  `--json` provably *moves* the prose rather than changing it.
- Without `--json`: 0 JSON documents on stdout, 0 bytes on stderr.
- render `--json` over the real corpus: 1,041 lines, byte-identity 1037/1037, exit 0.
- mine `--json`: 1,049 lines, phases `parse` / `build` / `write`, gate pass, exit 0.
- No corpus was written by any test: render runs `--dry-run` with no `--out`, the mine writes into a
  temp `CORPUS`. The real catalog's checksum is unchanged.
