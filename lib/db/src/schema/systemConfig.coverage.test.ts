/**
 * System Config Coverage Test
 *
 * Enforces that every key in SYSTEM_CONFIG_KEYS is accounted for in exactly
 * one of two places:
 *
 *   1. SYSTEM_CONFIG_DEFAULTS  — seeded on every server start; value must be
 *                                safe as a production default.
 *   2. SYSTEM_CONFIG_NO_DEFAULT_KEYS — explicit opt-out with a documented
 *                                reason (credential or runtime-state).
 *
 * A key that falls through both sets is a silent config drift risk: the DB
 * row is never written, so the runtime falls back to whatever hardcoded value
 * the consumer chose — invisible in the admin UI and never audited.
 *
 * Run:
 *   cd lib/db && node --import tsx/esm --test src/schema/systemConfig.coverage.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SYSTEM_CONFIG_KEYS,
  SYSTEM_CONFIG_DEFAULTS,
  SYSTEM_CONFIG_NO_DEFAULT_KEYS,
} from "./systemConfig.ts";

const allValues = Object.values(SYSTEM_CONFIG_KEYS) as string[];
const defaultKeys = new Set(Object.keys(SYSTEM_CONFIG_DEFAULTS));

describe("SYSTEM_CONFIG coverage", () => {
  it("every key in SYSTEM_CONFIG_KEYS has a default or an explicit no-default entry", () => {
    const missing = allValues.filter(
      (k) => !defaultKeys.has(k) && !SYSTEM_CONFIG_NO_DEFAULT_KEYS.has(k),
    );
    assert.deepStrictEqual(
      missing,
      [],
      `Keys missing from both SYSTEM_CONFIG_DEFAULTS and SYSTEM_CONFIG_NO_DEFAULT_KEYS:\n` +
        missing.map((k) => `  - ${k}`).join("\n") +
        `\n\nFor each key above, either:\n` +
        `  • add a default value to SYSTEM_CONFIG_DEFAULTS in systemConfig.ts, OR\n` +
        `  • add it to SYSTEM_CONFIG_NO_DEFAULT_KEYS with a comment explaining why\n` +
        `    (valid reasons: "credential" or "runtime-state").`,
    );
  });

  it("no key appears in both SYSTEM_CONFIG_DEFAULTS and SYSTEM_CONFIG_NO_DEFAULT_KEYS", () => {
    const doubled = allValues.filter(
      (k) => defaultKeys.has(k) && SYSTEM_CONFIG_NO_DEFAULT_KEYS.has(k),
    );
    assert.deepStrictEqual(
      doubled,
      [],
      `Keys listed in BOTH sets — remove from SYSTEM_CONFIG_NO_DEFAULT_KEYS:\n` +
        doubled.map((k) => `  - ${k}`).join("\n"),
    );
  });

  it("every entry in SYSTEM_CONFIG_NO_DEFAULT_KEYS references a known SYSTEM_CONFIG_KEYS value", () => {
    const known = new Set(allValues);
    const dangling = [...SYSTEM_CONFIG_NO_DEFAULT_KEYS].filter(
      (k) => !known.has(k),
    );
    assert.deepStrictEqual(
      dangling,
      [],
      `SYSTEM_CONFIG_NO_DEFAULT_KEYS contains stale values not found in SYSTEM_CONFIG_KEYS:\n` +
        dangling.map((k) => `  - ${k}`).join("\n") +
        `\n\nRemove these entries or add the corresponding keys back to SYSTEM_CONFIG_KEYS.`,
    );
  });
});
