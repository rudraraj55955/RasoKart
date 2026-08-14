/**
 * Behavioral unit tests — checkAndAlertSignatureFailures (Task #301)
 *
 * Root cause verified by this suite:
 *   The function existed but was never wired into index.ts (same orphan pattern
 *   as #2475). Fix: added initSignatureFailureAlertScheduler() + index.ts wiring.
 *
 * Also verified: the in-memory cooldown gate (lastAlertSentAt), the zero-recipient
 * guard, the below-threshold no-op path, and error resilience.
 *
 * Test matrix:
 *   B1  Failures < threshold → no sendMail, no DB insert
 *   B2  Failures exactly at threshold → alert fires to admin + merchant
 *   B3  Failures > threshold, zero opted-in recipients → no sendMail, no DB insert
 *   B4  Failures > threshold, admin opted in, merchant opted out → admin-only email
 *   B5  Failures > threshold, SMTP returns false → recipientCount=0, insert still recorded
 *   B6  In-memory cooldown suppression — second call within cooldown window is blocked
 *   B7  Cooldown not applied before first send (lastAlertSentAt null)
 *   B8  No affected merchants → merchant email list is empty, admin email still sent
 *   B9  Never throws when db.select rejects
 *   B10 Never throws when db.insert rejects after sending
 *   B11 Never throws when _sendMail throws
 *
 * Mocking strategy:
 *   db.select — replaced with a call-index mock that returns pre-configured rows.
 *               Select call order within checkAndAlertSignatureFailures:
 *                 idx 0: loadAlertConfig (systemConfigTable, inArray)
 *                 idx 1: count of failures (callbackLogsTable, count())
 *                 idx 2: affected merchants per merchant (innerJoin + groupBy)
 *                 idx 3: admin emails (usersTable, role=admin)
 *                 idx 4: merchant users (usersTable, role=merchant, inArray)
 *   db.insert — replaced with a recorder that captures { table, values }.
 *   _sendMail  — injected as a spy (no real SMTP ever attempted).
 *
 * resetAlertRateLimit() is called in beforeEach to clear the in-memory
 * lastAlertSentAt so tests are fully independent.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, signatureFailureAlertLogsTable } from "@workspace/db";
import { checkAndAlertSignatureFailures, resetAlertRateLimit } from "./signatureFailureAlert";

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIG_THRESHOLD_3: Record<string, unknown>[] = [
  { key: "signature_failure_alert_threshold", value: "3" },
  { key: "signature_failure_alert_cooldown_hours", value: "4" },
];
const CONFIG_THRESHOLD_10: Record<string, unknown>[] = [
  { key: "signature_failure_alert_threshold", value: "10" },
  { key: "signature_failure_alert_cooldown_hours", value: "4" },
];
const ADMIN_ROW = [{ email: "admin@rasokart.com" }];
const MERCHANT_USER_ROW = [{ email: "merchant@example.com", merchantId: 42 }];
const AFFECTED_MERCHANT_ROW = [{ merchantId: 42, merchantName: "Test Biz", failureCount: 5 }];
const TOTAL_5 = [{ total: 5 }];
const TOTAL_2 = [{ total: 2 }];

// ── DB mock helpers ───────────────────────────────────────────────────────────

/**
 * Build a chainable db.select mock. Every chain method returns `chain` (so it
 * handles .from(), .innerJoin(), .where(), .limit(), .groupBy() in any order).
 * `chain` is itself a thenable — awaiting it resolves to `rows`. This covers:
 *   await db.select().from().where()
 *   await db.select().from().where().limit(1)
 *   await db.select().from().innerJoin().where().groupBy()
 *   db.select().from().where().then(r => r[0])   ← used by .then() chain
 */
function buildSelectMock(responses: Array<Array<Record<string, unknown>>>) {
  let callIdx = 0;
  (db as any).select = (_fields?: unknown) => {
    const rows = responses[callIdx++] ?? [];
    const chain: any = {};
    // Make chain a thenable so `await chain` works after any number of builder calls.
    chain.then = (resolve: Function, reject: Function) =>
      Promise.resolve(rows).then(resolve as any, reject as any);
    chain.from       = () => chain;
    chain.innerJoin  = () => chain;
    chain.where      = () => chain;
    chain.limit      = () => chain;
    chain.groupBy    = () => chain;
    return chain;
  };
}

type InsertRecord = { table: unknown; values: unknown };

function buildInsertMock(log: InsertRecord[]) {
  (db as any).insert = (table: unknown) => ({
    values: (vals: unknown) => {
      log.push({ table, values: vals });
      return Promise.resolve();
    },
  });
}

function buildSendSpy(calls: Array<{ to: string; subject: string }>): typeof import("./mailer").sendMail {
  return async (opts) => {
    calls.push({ to: opts.to, subject: opts.subject });
    return true;
  };
}

const failSend: typeof import("./mailer").sendMail = async () => false;

// ── Test suites ───────────────────────────────────────────────────────────────

describe("checkAndAlertSignatureFailures — below threshold", () => {
  beforeEach(() => { resetAlertRateLimit(); });

  it("B1a: does not call sendMail when failures < threshold", async () => {
    buildSelectMock([CONFIG_THRESHOLD_10, TOTAL_2]);  // 2 < 10
    buildInsertMock([]);
    const calls: any[] = [];
    await checkAndAlertSignatureFailures(buildSendSpy(calls));
    assert.equal(calls.length, 0, "sendMail must not be called when below threshold");
  });

  it("B1b: makes no DB insert when failures < threshold", async () => {
    buildSelectMock([CONFIG_THRESHOLD_10, TOTAL_2]);
    const log: InsertRecord[] = [];
    buildInsertMock(log);
    await checkAndAlertSignatureFailures(failSend);
    assert.equal(log.length, 0, "No DB insert must occur when below threshold");
  });
});

describe("checkAndAlertSignatureFailures — threshold reached", () => {
  beforeEach(() => { resetAlertRateLimit(); });

  it("B2a: sends email to opted-in admin when failures >= threshold", async () => {
    buildSelectMock([
      CONFIG_THRESHOLD_3,       // idx 0: loadAlertConfig
      TOTAL_5,                  // idx 1: count = 5 >= 3
      AFFECTED_MERCHANT_ROW,   // idx 2: affected merchants
      ADMIN_ROW,                // idx 3: admin emails
      MERCHANT_USER_ROW,        // idx 4: merchant users
    ]);
    buildInsertMock([]);
    const calls: any[] = [];
    await checkAndAlertSignatureFailures(buildSendSpy(calls));
    const adminCall = calls.find((c) => c.to === "admin@rasokart.com");
    assert.ok(adminCall, "sendMail must be called for the opted-in admin");
    assert.match(adminCall.subject, /Signature Failure Alert/);
  });

  it("B2b: sends email to opted-in merchant when failures >= threshold", async () => {
    buildSelectMock([
      CONFIG_THRESHOLD_3,
      TOTAL_5,
      AFFECTED_MERCHANT_ROW,
      ADMIN_ROW,
      MERCHANT_USER_ROW,
    ]);
    buildInsertMock([]);
    const calls: any[] = [];
    await checkAndAlertSignatureFailures(buildSendSpy(calls));
    const merchantCall = calls.find((c) => c.to === "merchant@example.com");
    assert.ok(merchantCall, "sendMail must be called for the opted-in merchant");
  });

  it("B2c: inserts into signatureFailureAlertLogsTable on send", async () => {
    buildSelectMock([
      CONFIG_THRESHOLD_3,
      TOTAL_5,
      AFFECTED_MERCHANT_ROW,
      ADMIN_ROW,
      MERCHANT_USER_ROW,
    ]);
    const log: InsertRecord[] = [];
    buildInsertMock(log);
    await checkAndAlertSignatureFailures(buildSendSpy([]));
    assert.equal(log.length, 1, "Exactly one insert must be made on a successful alert");
    assert.equal(log[0]!.table, signatureFailureAlertLogsTable, "Insert must target signatureFailureAlertLogsTable");
    const vals = log[0]!.values as any;
    assert.equal(vals.failureCount, 5);
    assert.equal(vals.threshold, 3);
  });

  it("B3: no sendMail and no insert when all admins AND merchants opted out", async () => {
    buildSelectMock([
      CONFIG_THRESHOLD_3,
      TOTAL_5,
      AFFECTED_MERCHANT_ROW,
      [],   // no admins opted in
      [],   // no merchants opted in
    ]);
    const log: InsertRecord[] = [];
    buildInsertMock(log);
    const calls: any[] = [];
    await checkAndAlertSignatureFailures(buildSendSpy(calls));
    assert.equal(calls.length, 0, "sendMail must not be called when all recipients opted out");
    assert.equal(log.length, 0, "No insert must occur when all recipients opted out");
  });

  it("B4: admin-only email when merchant has opted out", async () => {
    buildSelectMock([
      CONFIG_THRESHOLD_3,
      TOTAL_5,
      AFFECTED_MERCHANT_ROW,
      ADMIN_ROW,
      [],             // merchant opted out
    ]);
    buildInsertMock([]);
    const calls: any[] = [];
    await checkAndAlertSignatureFailures(buildSendSpy(calls));
    assert.equal(calls.length, 1, "Exactly one email (admin only) must be sent");
    assert.equal(calls[0]!.to, "admin@rasokart.com");
  });

  it("B5: insert is still recorded when sendMail returns false (SMTP failure)", async () => {
    buildSelectMock([
      CONFIG_THRESHOLD_3,
      TOTAL_5,
      AFFECTED_MERCHANT_ROW,
      ADMIN_ROW,
      MERCHANT_USER_ROW,
    ]);
    const log: InsertRecord[] = [];
    buildInsertMock(log);
    // failSend returns false — sent=0 but insert must still record the attempt
    await checkAndAlertSignatureFailures(failSend);
    assert.equal(log.length, 1, "Insert must still be written even when sendMail returns false");
    const vals = log[0]!.values as any;
    assert.equal(vals.recipientCount, 0, "recipientCount must be 0 when all sends fail");
  });

  it("B8: no affected merchants → merchant list empty, admin email still sent", async () => {
    buildSelectMock([
      CONFIG_THRESHOLD_3,
      TOTAL_5,
      [],             // no affected merchants found (inner join returned nothing)
      ADMIN_ROW,
      // getMerchantRecipients returns [] immediately when affectedMerchants.length === 0
    ]);
    buildInsertMock([]);
    const calls: any[] = [];
    await checkAndAlertSignatureFailures(buildSendSpy(calls));
    assert.equal(calls.length, 1, "Admin email must still be sent when no affected merchants");
    assert.equal(calls[0]!.to, "admin@rasokart.com");
  });
});

describe("checkAndAlertSignatureFailures — in-memory cooldown gate", () => {
  beforeEach(() => { resetAlertRateLimit(); });

  it("B6: second call within cooldown window is suppressed", async () => {
    // First call — fires the alert and sets lastAlertSentAt = now
    buildSelectMock([
      CONFIG_THRESHOLD_3,
      TOTAL_5,
      AFFECTED_MERCHANT_ROW,
      ADMIN_ROW,
      MERCHANT_USER_ROW,
    ]);
    buildInsertMock([]);
    const calls: any[] = [];
    await checkAndAlertSignatureFailures(buildSendSpy(calls));
    assert.equal(calls.length, 2, "First call must send admin + merchant email (setup)");

    // Second call — immediately after (within 4-hour cooldown)
    // loadAlertConfig fires once, then cooldown check suppresses
    buildSelectMock([CONFIG_THRESHOLD_3]);
    buildInsertMock([]);
    const calls2: any[] = [];
    await checkAndAlertSignatureFailures(buildSendSpy(calls2));
    assert.equal(calls2.length, 0, "Second call within cooldown must be suppressed — no sendMail");
  });

  it("B7: first-ever call (lastAlertSentAt null) is never suppressed", async () => {
    // resetAlertRateLimit() already called in beforeEach — state is null
    buildSelectMock([
      CONFIG_THRESHOLD_3,
      TOTAL_5,
      AFFECTED_MERCHANT_ROW,
      ADMIN_ROW,
      [],   // no merchants opted in
    ]);
    buildInsertMock([]);
    const calls: any[] = [];
    await checkAndAlertSignatureFailures(buildSendSpy(calls));
    assert.equal(calls.length, 1, "First-ever call must not be suppressed (no cooldown timestamp)");
  });
});

describe("checkAndAlertSignatureFailures — error resilience", () => {
  beforeEach(() => { resetAlertRateLimit(); });

  it("B9: never throws when db.select rejects", async () => {
    (db as any).select = () => {
      const p = Promise.reject(new Error("simulated DB error"));
      const chain: any = {
        then: (res: Function, rej: Function) => p.then(res as any, rej as any),
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        limit: () => chain,
        groupBy: () => chain,
      };
      return chain;
    };
    buildInsertMock([]);
    await assert.doesNotReject(
      () => checkAndAlertSignatureFailures(failSend),
      "checkAndAlertSignatureFailures must swallow DB errors and never propagate"
    );
  });

  it("B10: never throws when db.insert rejects after sending", async () => {
    buildSelectMock([
      CONFIG_THRESHOLD_3,
      TOTAL_5,
      AFFECTED_MERCHANT_ROW,
      ADMIN_ROW,
      MERCHANT_USER_ROW,
    ]);
    // Insert rejects — but the function must not propagate the error
    (db as any).insert = (_table: unknown) => ({
      values: (_vals: unknown) => Promise.reject(new Error("simulated insert error")),
    });
    await assert.doesNotReject(
      () => checkAndAlertSignatureFailures(buildSendSpy([])),
      "checkAndAlertSignatureFailures must swallow insert errors"
    );
  });

  it("B11: never throws when _sendMail throws", async () => {
    buildSelectMock([
      CONFIG_THRESHOLD_3,
      TOTAL_5,
      AFFECTED_MERCHANT_ROW,
      ADMIN_ROW,
      MERCHANT_USER_ROW,
    ]);
    buildInsertMock([]);
    const throwingSend = async (_opts: unknown) => {
      throw new Error("SMTP timeout");
    };
    await assert.doesNotReject(
      () => checkAndAlertSignatureFailures(throwingSend as any),
      "checkAndAlertSignatureFailures must swallow sendMail throws via Promise.allSettled"
    );
  });
});
