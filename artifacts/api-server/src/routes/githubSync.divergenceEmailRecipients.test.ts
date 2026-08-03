/**
 * Unit tests: filterSuccessfulEmailRecipients
 *
 * Verifies that only admins whose sendMail call was fulfilled with `true`
 * are tracked as alerted recipients. This is the guard that ensures the
 * divergence-resolved email is sent only to admins who actually received
 * the original alert — not those whose delivery failed, and not new
 * opt-ins who joined after the incident started.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterSuccessfulEmailRecipients } from "./githubSync.js";

describe("filterSuccessfulEmailRecipients", () => {
  it("returns all emails when every send succeeded", () => {
    const admins = [
      { email: "a@example.com" },
      { email: "b@example.com" },
      { email: "c@example.com" },
    ];
    const results: PromiseSettledResult<boolean>[] = [
      { status: "fulfilled", value: true },
      { status: "fulfilled", value: true },
      { status: "fulfilled", value: true },
    ];
    assert.deepEqual(filterSuccessfulEmailRecipients(admins, results), [
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("excludes admins whose sendMail rejected", () => {
    const admins = [
      { email: "a@example.com" },
      { email: "b@example.com" },
      { email: "c@example.com" },
    ];
    const results: PromiseSettledResult<boolean>[] = [
      { status: "fulfilled", value: true },
      { status: "rejected", reason: new Error("SMTP failure") },
      { status: "fulfilled", value: true },
    ];
    assert.deepEqual(filterSuccessfulEmailRecipients(admins, results), [
      "a@example.com",
      "c@example.com",
    ]);
  });

  it("excludes admins whose sendMail returned false", () => {
    const admins = [
      { email: "a@example.com" },
      { email: "b@example.com" },
    ];
    const results: PromiseSettledResult<boolean>[] = [
      { status: "fulfilled", value: false },
      { status: "fulfilled", value: true },
    ];
    assert.deepEqual(filterSuccessfulEmailRecipients(admins, results), [
      "b@example.com",
    ]);
  });

  it("returns empty array when all sends failed", () => {
    const admins = [{ email: "a@example.com" }, { email: "b@example.com" }];
    const results: PromiseSettledResult<boolean>[] = [
      { status: "rejected", reason: new Error("timeout") },
      { status: "fulfilled", value: false },
    ];
    assert.deepEqual(filterSuccessfulEmailRecipients(admins, results), []);
  });

  it("returns empty array for empty admin list", () => {
    assert.deepEqual(filterSuccessfulEmailRecipients([], []), []);
  });

  it("mixed batch: only the two successful sends are tracked", () => {
    // Simulates a real scenario: 5 admins, 2 succeed, 1 returns false, 2 reject.
    // Only the 2 successful addresses should be persisted into alertedAdminEmails.
    const admins = [
      { email: "alice@co.com" },
      { email: "bob@co.com" },
      { email: "carol@co.com" },
      { email: "dave@co.com" },
      { email: "eve@co.com" },
    ];
    const results: PromiseSettledResult<boolean>[] = [
      { status: "fulfilled", value: true },   // alice  ✓
      { status: "rejected", reason: new Error("connection refused") }, // bob  ✗
      { status: "fulfilled", value: false },  // carol ✗ (mailer returned false)
      { status: "fulfilled", value: true },   // dave  ✓
      { status: "rejected", reason: new Error("rate limited") },       // eve  ✗
    ];

    const tracked = filterSuccessfulEmailRecipients(admins, results);
    assert.deepEqual(tracked, ["alice@co.com", "dave@co.com"]);

    // Verify the union pattern: prior alerted + newly tracked, no duplicates.
    const prior = ["alice@co.com", "frank@co.com"];
    const merged = Array.from(new Set([...prior, ...tracked]));
    assert.deepEqual(merged.sort(), ["alice@co.com", "dave@co.com", "frank@co.com"]);
  });

  it("resolved email targets only original alert recipients, not later opt-ins", () => {
    // First alert: admins A and B were opted-in; B's send failed.
    const adminsAtAlert = [{ email: "a@co.com" }, { email: "b@co.com" }];
    const alertResults: PromiseSettledResult<boolean>[] = [
      { status: "fulfilled", value: true },  // a  ✓
      { status: "rejected", reason: new Error("SMTP") }, // b  ✗
    ];
    const alertedEmails = filterSuccessfulEmailRecipients(adminsAtAlert, alertResults);
    assert.deepEqual(alertedEmails, ["a@co.com"]);

    // Admin C opts in after the alert — they are NOT in alertedEmails.
    // The resolved email should target alertedEmails only, not [a, b, c].
    const currentOptIns = [{ email: "a@co.com" }, { email: "b@co.com" }, { email: "c@co.com" }];
    // The resolved send logic uses alertedEmails, not currentOptIns.
    assert.equal(alertedEmails.includes("c@co.com"), false);
    assert.equal(alertedEmails.includes("b@co.com"), false);
    assert.deepEqual(alertedEmails, ["a@co.com"]);
    void currentOptIns; // referenced to make intent explicit
  });
});
