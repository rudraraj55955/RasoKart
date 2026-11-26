import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeEmailDeliveryReason,
  shouldApplyEmailDeliveryStatus,
  type EmailDeliveryStatus,
} from "./emailDelivery";

describe("password-reset email delivery status ordering", () => {
  const terminalStatuses: EmailDeliveryStatus[] = ["delivered", "bounced", "failed"];

  it("allows accepted to advance to every terminal status", () => {
    for (const status of terminalStatuses) {
      assert.equal(shouldApplyEmailDeliveryStatus("accepted", status), true);
    }
  });

  it("never lets delayed accepted callbacks downgrade terminal statuses", () => {
    for (const status of terminalStatuses) {
      assert.equal(shouldApplyEmailDeliveryStatus(status, "accepted"), false);
    }
  });

  it("lets delivered supersede failures but never lets failures downgrade delivered", () => {
    assert.equal(shouldApplyEmailDeliveryStatus("bounced", "delivered"), true);
    assert.equal(shouldApplyEmailDeliveryStatus("failed", "delivered"), true);
    assert.equal(shouldApplyEmailDeliveryStatus("delivered", "bounced"), false);
    assert.equal(shouldApplyEmailDeliveryStatus("delivered", "failed"), false);
  });

  it("does not let equally ranked failure callbacks overwrite each other", () => {
    assert.equal(shouldApplyEmailDeliveryStatus("bounced", "failed"), false);
    assert.equal(shouldApplyEmailDeliveryStatus("failed", "bounced"), false);
  });

  it("accepts same-status callbacks so a new provider event ID can be recorded", () => {
    for (const status of ["accepted", ...terminalStatuses] as EmailDeliveryStatus[]) {
      assert.equal(shouldApplyEmailDeliveryStatus(status, status), true);
    }
  });
});

describe("password-reset email delivery reason sanitization", () => {
  it("replaces ordinary provider failure text with a fixed safe summary", () => {
    assert.equal(
      sanitizeEmailDeliveryReason("Mailbox unavailable"),
      "Provider reported delivery failure",
    );
  });

  it("does not retain OTPs, credentials, reset links, hashes, or message bodies", () => {
    const sensitiveReasons = [
      "OTP 123456 expired",
      "token=reset-token-value",
      "password was hunter2",
      "reset link https://example.test/reset?code=abc",
      "hash abcdef123",
      "message body: click here",
      "Your code is 123456",
      "bare-credential-value",
    ];
    for (const reason of sensitiveReasons) {
      const sanitized = sanitizeEmailDeliveryReason(reason);
      assert.equal(sanitized, "Provider reported delivery failure");
      assert.equal(JSON.stringify(sanitized).includes(reason), false);
    }
  });
});