import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePayoutWebhookEvent } from "./whiteLabelWebhookEventGuard";
const stored = { transferId: "rk123", providerTransferId: "cf456", status: "PENDING" };
test("matching new event accepted, duplicate ignored", () => {
  assert.equal(evaluatePayoutWebhookEvent(stored, { transferId: "rk123", providerTransferId: "cf456", status: "SUCCESS" }), "accept");
  assert.equal(evaluatePayoutWebhookEvent({ ...stored, status: "SUCCESS" }, { transferId: "rk123", providerTransferId: "cf456", status: "SUCCESS" }), "duplicate");
});
test("conflicting transfer identifiers fail closed", () => {
  assert.equal(evaluatePayoutWebhookEvent(stored, { transferId: "wrong", providerTransferId: "cf456", status: "SUCCESS" }), "conflict");
  assert.equal(evaluatePayoutWebhookEvent(stored, { transferId: "rk123", providerTransferId: "wrong", status: "SUCCESS" }), "conflict");
  assert.equal(evaluatePayoutWebhookEvent(stored, { transferId: null, providerTransferId: "cf456", status: "SUCCESS" }), "conflict");
});
test("terminal status cannot regress due to late webhook", () => {
  assert.equal(evaluatePayoutWebhookEvent({ ...stored, status: "SUCCESS" }, { transferId: "rk123", providerTransferId: "cf456", status: "FAILED" }), "stale");
  assert.equal(evaluatePayoutWebhookEvent({ ...stored, status: "FAILED" }, { transferId: "rk123", providerTransferId: "cf456", status: "PENDING" }), "stale");
});
