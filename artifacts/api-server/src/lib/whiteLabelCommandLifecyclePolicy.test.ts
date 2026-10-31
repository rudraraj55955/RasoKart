import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedCommandTransition } from "./whiteLabelCommandLifecyclePolicy";
test("only freshly reserved commands can be finalized", () => {
  assert.equal(allowedCommandTransition("reserved", "completed"), true);
  assert.equal(allowedCommandTransition("reserved", "failed"), true);
  assert.equal(allowedCommandTransition("reserved", "requires_reconciliation"), true);
  assert.equal(allowedCommandTransition("completed", "completed"), false);
  assert.equal(allowedCommandTransition("failed", "completed"), false);
  assert.equal(allowedCommandTransition("requires_reconciliation", "completed"), false);
});
