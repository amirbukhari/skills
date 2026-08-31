#!/usr/bin/env node
"use strict";
/**
 * new-archetype.js — THE FORWARD COMMAND. "this is what you call to make a new entity in that
 * pattern, and it makes it and gets translated/built into the source codebase." (Amir, PRD §5D.0
 * statement 2.)
 *
 * THE ENGLISH IS EMITTED FIRST AND THE TYPESCRIPT IS DERIVED FROM IT (PRD §5E.8 mechanic 1). That
 * ordering is the whole point and it is not cosmetic: emitting the .ts first and hoping a later
 * render finds its way back to the same sentence makes AT-ARCH-1 a coincidence. Emitting the
 * sentence first makes it an identity the pipeline MAINTAINS.
 *
 *   sentence --parse--> model --emit--> .ts        the forward pass
 *   .ts --extract--> model' --render--> sentence'  the backward pass
 *   AT-ARCH-1: sentence' === sentence              CHECKED BEFORE ANYTHING IS WRITTEN
 *
 * The check runs on every invocation, not in a test only. If a new entity cannot be re-mined back
 * to the sentence that authored it, the command REFUSES and writes nothing — because the alternative
 * is a file in the corpus that the next mine will silently disagree with, which is the drift class
 * §8B exists to stop, one level up.
 *
 * ZERO MODEL CALLS (R-MECH-4). §5D.1's panel is labelled "no model call; nothing is written to the
 * corpus" until Compile, and this is the engine behind that.
 *
 * USAGE — non-interactive, no prompts, structured stdout, so a UI can drive it unchanged:
 *   node new-archetype.js --sentence "<English>" [--out <dir>] [--json] [--dry-run]
 *   node new-archetype.js --sentence-file <path> ...
 *   echo "<English>" | node new-archetype.js --stdin --json
 *
 * With --json, stdout carries EXACTLY ONE JSON document and nothing else; prose goes to stderr.
 * Exit 0 = written (or --dry-run verified), 2 = refused, with the reason in `error`.
 */
const fs = require("fs");
const path = require("path");
const S = require("./engine/entity-sentence");
const G = require("./engine/generate");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const JSON_OUT = has("--json");
const DRY = has("--dry-run");

const say = (m) => process.stderr.write(m + "\n");
function done(payload, code = 0) {
  if (JSON_OUT) process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  else if (payload.error) say("REFUSED: " + payload.error);
  process.exit(code);
}

function readSentence() {
  if (has("--stdin")) return fs.readFileSync(0, "utf8");
  const f = val("--sentence-file");
  if (f) return fs.readFileSync(f, "utf8");
  const s = val("--sentence");
  if (s) return s;
  return null;
}

const raw = readSentence();
if (!raw || !raw.trim()) {
  done({ ok: false, error: "no input — pass --sentence <text>, --sentence-file <path>, or --stdin" }, 2);
}
const sentence = raw.replace(/\s+/g, " ").trim();

let model, tsSource, remined;
try {
  model = S.parseEntitySentence(sentence);
  tsSource = G.emitEntityCanonical(model, {
    enumModule: val("--enum-module", "./enums"),
    targetModule: val("--target-module") ? ((t) => val("--target-module") + "/" + t) : undefined,
  });
} catch (e) {
  done({ ok: false, error: e.message, stage: "compile" }, 2);
}

/* AT-ARCH-1, ENFORCED HERE AND NOT ONLY IN A TEST. */
try { remined = S.sentenceFromSource(tsSource, model.className + ".ts"); }
catch (e) { done({ ok: false, error: "generated file does not re-mine: " + e.message, stage: "AT-ARCH-1", typescript: tsSource }, 2); }

if (remined !== sentence) {
  done({ ok: false, stage: "AT-ARCH-1",
    error: "the generated TypeScript does not re-mine to the sentence that authored it — refusing to write it",
    authored: sentence, remined, typescript: tsSource }, 2);
}

/* Structural sanity on the emitted TypeScript, so a refusal happens here rather than at `tsc`. */
const structural = G.structuralEntityCheck(tsSource);

const outDir = val("--out");
const written = [];
if (!DRY && outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const enPath = path.join(outDir, model.className + ".en");
  const tsPath = path.join(outDir, model.className + ".ts");
  /* .en FIRST, then the .ts derived from it — the ordering §5E.3.6 argues for, made literal in the
   * write order so a crash between the two leaves the English, never an orphan .ts. */
  fs.writeFileSync(enPath, sentence + "\n");
  fs.writeFileSync(tsPath, tsSource);
  written.push(enPath, tsPath);
}

done({
  ok: true,
  archetype: "Entity",
  className: model.className, table: model.table,
  counts: { columns: model.members.filter((m) => m.role === "column").length,
            relations: model.members.filter((m) => m.role === "relation").length },
  atArch1: { checked: true, identical: true },
  structural,
  sentence, typescript: tsSource,
  written, dryRun: DRY || !outDir,
  modelCalls: 0,
});
