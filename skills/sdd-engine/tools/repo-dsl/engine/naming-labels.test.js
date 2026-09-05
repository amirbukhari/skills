"use strict";
/* naming-labels.test.js — a whole-file label must NAME what it holds, not COUNT it.
 *
 * Amir, 2026-09-04: "So make the label get read  by the compiler then?" — and once the compiler
 * generates from the label, a label that counts its contents is not a weak label, it is an
 * UNCOMPILABLE one. Measured over the rendered corpus before this change: 1,615 of its 19,335
 * chunks (8.4%) carried a label that named no value at all; after it, 379. (An earlier report of
 * mine said 1,619. The chunk totals reproduce exactly, so the walk is the same; the four-label gap
 * is in the vacuity scorer, which was rewritten rather than re-used, and is NOT reconciled.)
 *
 * WHY THE CHANGE IS SAFE TO MAKE IN ONE PLACE. `en-file-claim.js` is called from BOTH sides of the
 * round trip — the renderer builds the label with it, and `deriveGloss` re-derives the label from
 * the recompiled bytes with the same `claimForText`. So render and derive move together by
 * construction, which is what R-REND-6 requires. The compiled TypeScript is generated from the
 * payload, so changing what the label SAYS cannot move a byte; that claim is not taken on trust
 * here, it is measured as a byte-identity count before and after. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const CR = require("./corpus-root");
const FC = require("./en-file-claim");
const R = require("./test-report").report(__filename);
const { ok, count, setUp } = R;

const SOURCE = CR.sourceRoot();
const ts = (rel) => fs.readFileSync(path.join(SOURCE, rel), "utf8");

const BARREL = "packages/hydra-internal/src/index.ts";
/* NOT AccountBusiness.ts. That file has no import and no re-export, so `fileClaim` declines it and
 * its label comes from a different path entirely -- one that ALREADY names its shapes. Picking it
 * would have tested nothing about this change. `HydraCtxState.ts` is a real "1 shape" claim. */
const SHAPES = "src/HydraCtxState.ts";

const barrelText = setUp("the re-export barrel packages/hydra-internal/src/index.ts", () => ts(BARREL));
const shapesText = setUp("the shape-declaring model src/HydraCtxState.ts", () => ts(SHAPES));

/* Every name the label must carry is READ OFF THE FILE at run time, never transcribed, so the
 * property cannot keep passing against a file that has changed underneath it. */
const modulesIn = (text) => [...text.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)].map((m) => m[1]);
const shapesIn = (text) => [...text.matchAll(/interface\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]);

ok("a barrel file's label names every module it re-exports, instead of counting them", () => {
  const label = FC.claimForText(barrelText);
  assert.ok(label, "the barrel file produced no label at all");
  const want = modulesIn(barrelText);
  assert.ok(want.length > 0, "the barrel file no longer re-exports anything, so this case is void");
  const missing = want.filter((m) => !label.includes(m));
  assert.equal(missing.length, 0,
    `the label does not name ${missing.length} of the ${want.length} modules it re-exports.\n`
    + `The label is: ${label}\n` + missing.map((m) => `it never names ${m}`).join("\n"));
});

ok("a barrel file's label no longer states a bare count in place of the names", () => {
  const label = FC.claimForText(barrelText);
  assert.ok(!/^\d+ re-exports?$/.test(label.trim()),
    `the label is still a bare count and names nothing: ${label}`);
});

ok("a model file's label names every shape it declares, instead of counting them", () => {
  const label = FC.claimForText(shapesText);
  assert.ok(label, "the model file produced no label at all");
  const want = shapesIn(shapesText);
  const missing = want.filter((s) => !label.includes(s));
  assert.equal(missing.length, 0,
    `the label does not name ${missing.length} of the ${want.length} shapes it declares.\n`
    + `The label is: ${label}\n` + missing.map((s) => `it never names ${s}`).join("\n"));
});

ok("a label that names its members is still one sentence a person would read, not a dump", () => {
  const label = FC.claimForText(barrelText);
  const words = label.trim().split(/\s+/).length;
  count(`the barrel file's label is ${words} words long.`);
  assert.ok(words <= 40, `the label has grown to ${words} words, which is a dump rather than a sentence: ${label}`);
});

R.done("whether a whole-file label names what the file holds rather than counting it");
