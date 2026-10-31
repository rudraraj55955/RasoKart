import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyExistingCommand, hashCanonicalFinancePayload } from "./whiteLabelCommandPolicy";
test("fresh reservation and replay classification", () => {
  assert.equal(classifyExistingCommand(undefined, "a"), "reserved");
  assert.equal(classifyExistingCommand({ payloadHash: "a", status: "completed" }, "a"), "replay");
});
test("changed payload is a conflict even after completion", () => {
  assert.equal(classifyExistingCommand({ payloadHash: "a", status: "completed" }, "b"), "conflict");
});
test("pending and unknown statuses never replay as completed", () => {
  for (const status of ["reserved", "processing", "failed", "unknown"]) {
    assert.equal(classifyExistingCommand({ payloadHash: "a", status }, "a"), "in_progress");
  }
});
test("canonical payload hashing is deterministic", () => {
  const hash = hashCanonicalFinancePayload('{"amount":"10.00"}');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, hashCanonicalFinancePayload('{"amount":"11.00"}'));
});
