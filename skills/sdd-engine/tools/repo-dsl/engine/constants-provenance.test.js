"use strict";
/* engine/constants-provenance.test.js — §8B constants provenance.
 *
 * A mine run with MIN_COUNT/MIN_SKEL/MAXWIN overridden produces a different artifact from a default
 * run. Until `constantsOverridden`, the artifact could not say so, and a tuning sweep's output was
 * indistinguishable from the corpus's settled numbers.
 *
 * The two properties that made this safe to add, and which this file exists to keep true:
 *   1. A DEFAULT run's fingerprint does not move. If it did, every stored artifact would need
 *      re-stamping and the field would be a migration rather than a note.
 *   2. The field is FINGERPRINTED (body, not header), so deleting the override claim breaks the
 *      seal. That is the exact edit the field exists to catch; a provenance note that can be
 *      quietly removed is not provenance. Same reasoning as `modelCalls`.
 */
const assert = require("assert");
const AC = require("./artifact-contract");

let pass = 0;
const ok = (name, fn) => { fn(); console.log("  ok  " + name); pass++; };

const BODY = () => ({ wide: [], narrow: [], gap: [] });
const OPTS = { corpus: "/tmp/constants-provenance", generated: "2026-09-01" };
const DEFAULTS = {
  MIN_COUNT: { value: 1, default: 1 },
  MIN_SKEL: { value: 8, default: 8 },
  MAXWIN: { value: 100000, default: 100000 },
};
const stamp = (constants) =>
  AC.stamp("generators-lzw", BODY(), constants === undefined ? OPTS : { ...OPTS, constants });

ok("a DEFAULT run records nothing and moves no fingerprint", () => {
  const bare = stamp(undefined);
  const dflt = stamp(DEFAULTS);
  assert.ok(!("constantsOverridden" in dflt), "a default run must not carry the field at all");
  assert.strictEqual(dflt.fingerprint, bare.fingerprint,
    "declaring default constants changed the fingerprint — every stored artifact would need re-stamping");
});

ok("only the constants that DIFFER are recorded", () => {
  const a = stamp({ ...DEFAULTS, MIN_SKEL: { value: 4, default: 8 } });
  assert.deepStrictEqual(a.constantsOverridden, { MIN_SKEL: { value: 4, default: 8 } },
    "an override record must name the changed constant and nothing else");
});

ok("several overrides are recorded together, key-sorted for a stable fingerprint", () => {
  const a = stamp({ MAXWIN: { value: 64, default: 100000 }, MIN_COUNT: { value: 2, default: 1 } });
  assert.deepStrictEqual(Object.keys(a.constantsOverridden), ["MAXWIN", "MIN_COUNT"]);
  const b = stamp({ MIN_COUNT: { value: 2, default: 1 }, MAXWIN: { value: 64, default: 100000 } });
  assert.strictEqual(a.fingerprint, b.fingerprint, "insertion order must not change the seal");
});

ok("an overridden artifact still validates and carries its corpus pin", () => {
  const a = stamp({ ...DEFAULTS, MIN_COUNT: { value: 2, default: 1 } });
  assert.ok(AC.validate("generators-lzw", a, "(memory)", { corpus: OPTS.corpus }));
});

/* THE MUTATION THAT JUSTIFIES THE PLACEMENT. Strip the claim and the seal must break. If this
 * passed, the field would belong in the header and would be worthless as provenance. */
ok("DELETING the override claim breaks the fingerprint seal", () => {
  const a = stamp({ ...DEFAULTS, MIN_SKEL: { value: 4, default: 8 } });
  const tampered = { ...a };
  delete tampered.constantsOverridden;
  assert.throws(() => AC.validate("generators-lzw", tampered, "(tampered)", { corpus: OPTS.corpus }),
    /fingerprint/i, "a hand-edit removing the override record went undetected");
});

ok("EDITING an override value breaks the seal too", () => {
  const a = stamp({ ...DEFAULTS, MIN_SKEL: { value: 4, default: 8 } });
  const tampered = JSON.parse(JSON.stringify(a));
  tampered.constantsOverridden.MIN_SKEL.value = 8;          // "it was never overridden, honest"
  assert.throws(() => AC.validate("generators-lzw", tampered, "(tampered)", { corpus: OPTS.corpus }),
    /fingerprint/i, "a hand-edit rewriting the override value went undetected");
});

/* FAIL-CLOSED on a malformed claim: an unparseable override record reads as "nothing was
 * overridden" to a scanner, which is worse than absent. */
ok("a malformed constants record is REFUSED, not coerced", () => {
  for (const bad of [[], "MIN_SKEL=4", 7, { MIN_SKEL: 4 }, { MIN_SKEL: { value: 4 } }, { MIN_SKEL: null }]) {
    assert.throws(() => AC.stamp("generators-lzw", BODY(), { ...OPTS, constants: bad }),
      /constants/i, `stamp accepted a malformed constants record: ${JSON.stringify(bad)}`);
  }
});

console.log(`\n${pass} assertions passed — override provenance is recorded, sealed, and fail-closed.`);
