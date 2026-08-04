import { createHmac } from "crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifyUpigatewayWebhookSignature } from "./upigatewayPayin";

const SECRET = "test-webhook-secret-key";

function makeHash(
  client_txn_id: string,
  txn_id: string,
  amount: string,
  status: string,
  secret = SECRET,
): string {
  const canonical = [client_txn_id, txn_id, amount, status].join("|");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

describe("verifyUpigatewayWebhookSignature", () => {
  it("returns true for a valid signature", () => {
    const body = {
      client_txn_id: "ORDER123",
      txn_id: "UPI456",
      amount: "500.00",
      status: "SUCCESS",
      hash: makeHash("ORDER123", "UPI456", "500.00", "SUCCESS"),
    };
    assert.equal(verifyUpigatewayWebhookSignature(body, SECRET), true);
  });

  it("returns false when amount is tampered", () => {
    const body = {
      client_txn_id: "ORDER123",
      txn_id: "UPI456",
      amount: "9999.00", // tampered
      status: "SUCCESS",
      hash: makeHash("ORDER123", "UPI456", "500.00", "SUCCESS"),
    };
    assert.equal(verifyUpigatewayWebhookSignature(body, SECRET), false);
  });

  it("returns false when status is tampered", () => {
    const body = {
      client_txn_id: "ORDER123",
      txn_id: "UPI456",
      amount: "500.00",
      status: "FAILURE", // tampered
      hash: makeHash("ORDER123", "UPI456", "500.00", "SUCCESS"),
    };
    assert.equal(verifyUpigatewayWebhookSignature(body, SECRET), false);
  });

  it("returns false when client_txn_id is tampered", () => {
    const body = {
      client_txn_id: "EVIL999", // tampered
      txn_id: "UPI456",
      amount: "500.00",
      status: "SUCCESS",
      hash: makeHash("ORDER123", "UPI456", "500.00", "SUCCESS"),
    };
    assert.equal(verifyUpigatewayWebhookSignature(body, SECRET), false);
  });

  it("returns false when txn_id is tampered", () => {
    const body = {
      client_txn_id: "ORDER123",
      txn_id: "EVIL999", // tampered
      amount: "500.00",
      status: "SUCCESS",
      hash: makeHash("ORDER123", "UPI456", "500.00", "SUCCESS"),
    };
    assert.equal(verifyUpigatewayWebhookSignature(body, SECRET), false);
  });

  it("returns false when hash field is missing", () => {
    const body: Record<string, string> = {
      client_txn_id: "ORDER123",
      txn_id: "UPI456",
      amount: "500.00",
      status: "SUCCESS",
      // no hash
    };
    assert.equal(verifyUpigatewayWebhookSignature(body, SECRET), false);
  });

  it("returns false when hash is an empty string", () => {
    const body = {
      client_txn_id: "ORDER123",
      txn_id: "UPI456",
      amount: "500.00",
      status: "SUCCESS",
      hash: "",
    };
    assert.equal(verifyUpigatewayWebhookSignature(body, SECRET), false);
  });

  it("returns false when the webhook secret is wrong", () => {
    const body = {
      client_txn_id: "ORDER123",
      txn_id: "UPI456",
      amount: "500.00",
      status: "SUCCESS",
      hash: makeHash("ORDER123", "UPI456", "500.00", "SUCCESS", "wrong-secret"),
    };
    assert.equal(verifyUpigatewayWebhookSignature(body, SECRET), false);
  });

  it("confirms canonical field order is client_txn_id|txn_id|amount|status", () => {
    // A signature built with the wrong field order must be rejected.
    // Wrong order: txn_id|client_txn_id|amount|status
    const wrongOrderCanonical = ["UPI456", "ORDER123", "500.00", "SUCCESS"].join("|");
    const wrongHash = createHmac("sha256", SECRET).update(wrongOrderCanonical).digest("hex");
    const body = {
      client_txn_id: "ORDER123",
      txn_id: "UPI456",
      amount: "500.00",
      status: "SUCCESS",
      hash: wrongHash,
    };
    assert.equal(verifyUpigatewayWebhookSignature(body, SECRET), false);
  });

  it("uses empty string for missing canonical fields (does not throw)", () => {
    // Body is missing client_txn_id and txn_id entirely.
    // Signature built with empty strings for those fields should verify.
    const body = {
      amount: "100.00",
      status: "SUCCESS",
      hash: makeHash("", "", "100.00", "SUCCESS"),
    };
    assert.equal(verifyUpigatewayWebhookSignature(body, SECRET), true);
  });
});
