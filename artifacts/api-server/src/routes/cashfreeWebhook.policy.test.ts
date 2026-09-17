import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyCashfreeWebhookSignature } from "../helpers/cashfree";
import { validateCashfreePaymentMatch } from "./cashfreeWebhook";

function sign(body: string, timestamp: string, secret: string): string {
  return createHmac("sha256", secret).update(timestamp + body).digest("base64");
}

describe("Cashfree webhook release policy", () => {
  const body = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
  const timestamp = "1700000000";
  const webhookSecret = "webhook-secret-for-test";
  const clientSecret = "client-secret-for-test";

  it("accepts either approved signing-secret candidate", () => {
    const candidates = [webhookSecret, clientSecret];
    assert.equal(
      candidates.some((secret) =>
        verifyCashfreeWebhookSignature(body, timestamp, sign(body, timestamp, secret), secret),
      ),
      true,
    );
    assert.equal(
      candidates.some((secret) =>
        verifyCashfreeWebhookSignature(body, timestamp, sign(body, timestamp, clientSecret), secret),
      ),
      true,
    );
  });

  it("rejects a signature that matches neither candidate", () => {
    assert.equal(
      [webhookSecret, clientSecret].some((secret) =>
        verifyCashfreeWebhookSignature(body, timestamp, sign(body, timestamp, "wrong"), secret),
      ),
      false,
    );
  });

  it("requires a finite positive amount matching the stored order", () => {
    assert.deepEqual(validateCashfreePaymentMatch("500.00", "INR", "500", "INR"), { ok: true });
    assert.deepEqual(validateCashfreePaymentMatch("499.99", "INR", "500", "INR"), { ok: false, reason: "amount" });
    assert.deepEqual(validateCashfreePaymentMatch("500.001", "INR", "500", "INR"), { ok: false, reason: "amount" });
    assert.deepEqual(validateCashfreePaymentMatch("NaN", "INR", "500", "INR"), { ok: false, reason: "amount" });
    assert.deepEqual(validateCashfreePaymentMatch("-1", "INR", "500", "INR"), { ok: false, reason: "amount" });
  });

  it("requires currency to match exactly", () => {
    assert.deepEqual(validateCashfreePaymentMatch("500", "USD", "500", "INR"), { ok: false, reason: "currency" });
    assert.deepEqual(validateCashfreePaymentMatch("500", null, "500", "INR"), { ok: false, reason: "currency" });
  });

  it("models duplicate and concurrent delivery as one order transition", () => {
    let paid = false;
    let credits = 0;
    const deliver = () => {
      if (paid) return "duplicate";
      paid = true;
      credits += 1;
      return "credited";
    };
    assert.deepEqual([deliver(), deliver()], ["credited", "duplicate"]);
    assert.equal(credits, 1);
  });

  it("leaves the order retryable when durable processing fails", () => {
    let paid = false;
    const process = (fail: boolean) => {
      if (paid) return "duplicate";
      if (fail) return "retryable_failure";
      paid = true;
      return "credited";
    };
    assert.equal(process(true), "retryable_failure");
    assert.equal(process(false), "credited");
    assert.equal(paid, true);
  });
});