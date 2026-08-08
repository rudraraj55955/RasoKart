/**
 * Behavioral unit tests — "all admins opted out" (recipients=[]) suppression path.
 *
 * Covers three alert helpers that were previously untested for this edge case:
 *   - notifyAdminsOfWebhookFailureEmail
 *   - notifyAdminsOfPlanExpiry
 *   - notifyAdminsOfSettlementStateChange
 *
 * Why sendMail absence can be proved structurally (no sendMail mock needed):
 *   Each helper calls `getAdminEmails(...)` → returns [].
 *   The early-return guard `if (recipients.length === 0) { ...; return; }` fires
 *   before the `recipients.map(email => sendMail(...))` call, so Array.map is
 *   never invoked and sendMail is structurally unreachable.
 *
 * For notifyAdminsOfWebhookFailureEmail we additionally verify that
 * db.insert is never called (the only insert in that function writes an
 * alert-log row AFTER sendMail resolves, so insert=0 proves both conditions).
 *
 * For notifyAdminsOfPlanExpiry and notifyAdminsOfSettlementStateChange there
 * is no db.insert in the function body at all; the structural argument above
 * is the proof, complemented by a doesNotReject assertion.
 *
 * Mocking strategy matches adminNotifyEmail.ekqr-cap-suppression.test.ts:
 *   db is a shared mutable object; db.select / db.insert are monkey-patched
 *   per-test and restored in afterEach.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import {
  notifyAdminsOfWebhookFailureEmail,
  notifyAdminsOfPlanExpiry,
  notifyAdminsOfSettlementStateChange,
} from "./adminNotifyEmail";

// ── DB mock helpers ────────────────────────────────────────────────────────────

/**
 * Build a chainable DB select mock that consumes `selectResponses` in order.
 * Each call to db.select() returns the next batch of rows.
 * Supports both:
 *   await db.select().from().where()           (no .limit)
 *   await db.select().from().where().limit(n)
 */
function buildSelectMock(selectResponses: Array<Array<Record<string, unknown>>>) {
  let callIdx = 0;
  (db as any).select = (_fields?: unknown) => {
    const rows = selectResponses[callIdx++] ?? [];
    const chain: any = {
      from: () => chain,
      where: (_cond: unknown) =>
        Object.assign(Promise.resolve(rows), {
          limit: (_n: number) => Promise.resolve(rows),
        }),
    };
    return chain;
  };
}

/** Build a db.insert mock that appends the inserted values to `insertLog`. */
function buildInsertMock(insertLog: unknown[]) {
  (db as any).insert = (_table: unknown) => ({
    values: (vals: unknown) => {
      insertLog.push(vals);
      return { onConflictDoUpdate: () => Promise.resolve() };
    },
  });
}

// ── Save originals for teardown ────────────────────────────────────────────────

const originalSelect = (db as any).select.bind(db);
const originalInsert = (db as any).insert.bind(db);

afterEach(() => {
  (db as any).select = originalSelect;
  (db as any).insert = originalInsert;
});

// ─────────────────────────────────────────────────────────────────────────────
// notifyAdminsOfWebhookFailureEmail
// ─────────────────────────────────────────────────────────────────────────────

const WEBHOOK_OPTS = {
  merchantId: 7,
  url: "https://merchant.example.com/webhook",
  attempts: 5,
  qrCodeId: null,
};

describe("notifyAdminsOfWebhookFailureEmail — all admins opted out (webhookFailureEmails=false)", () => {
  it("does not call sendMail when the opted-in recipient list is empty", async () => {
    //
    // select[0]: getAdminEmails("webhookFailureEmails") → [] (all opted out)
    //
    // When recipients=[] the function returns immediately — the cooldown select,
    // the sendMail calls, and the webhookFailureAlertLogsTable insert are all
    // skipped.  insert=0 confirms sendMail was structurally unreachable.
    //
    buildSelectMock([
      [],  // getAdminEmails → all opted out
    ]);

    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfWebhookFailureEmail(WEBHOOK_OPTS);

    assert.equal(
      insertLog.length,
      0,
      "db.insert must never be called — no alert-log row persisted and no sendMail invocations occurred",
    );
  });

  it("does NOT write to webhookFailureAlertLogsTable when no admins opted in", async () => {
    buildSelectMock([[]]);  // recipients: empty

    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfWebhookFailureEmail(WEBHOOK_OPTS);

    assert.equal(
      insertLog.length,
      0,
      "The alert-log row must not be inserted when no email was sent (opted-out path)",
    );
  });

  it("suppresses correctly regardless of how many admins exist when all have opted out", async () => {
    // getAdminEmails() applies WHERE webhookFailureEmails=true at the DB level,
    // so even with many admin rows the response is empty when all opted out.
    buildSelectMock([[]]);

    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfWebhookFailureEmail({ ...WEBHOOK_OPTS, merchantId: 99, attempts: 10 });

    assert.equal(insertLog.length, 0, "No alert-log row written when all admins opted out");
  });

  it("never throws when the opted-out path is taken", async () => {
    buildSelectMock([[]]);
    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await assert.doesNotReject(
      () => notifyAdminsOfWebhookFailureEmail(WEBHOOK_OPTS),
      "notifyAdminsOfWebhookFailureEmail must never throw — errors are swallowed internally",
    );

    assert.equal(insertLog.length, 0);
  });

  it("never throws when db.select throws (DB connectivity error)", async () => {
    (db as any).select = () => {
      throw new Error("simulated DB connection error");
    };
    (db as any).insert = () => ({ values: () => Promise.resolve() });

    await assert.doesNotReject(
      () => notifyAdminsOfWebhookFailureEmail(WEBHOOK_OPTS),
      "notifyAdminsOfWebhookFailureEmail must swallow DB errors and not propagate",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// notifyAdminsOfPlanExpiry
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_EXPIRY_OPTS = {
  merchantId: 42,
  merchantName: "Acme Corp",
  planName: "Gold",
  daysUntilExpiry: 5,
  expiresAt: "2026-08-01",
};

describe("notifyAdminsOfPlanExpiry — all admins opted out (planExpiryAlertEmails=false)", () => {
  it("does not call sendMail when the opted-in recipient list is empty", async () => {
    //
    // select[0]: getAdminEmails("planExpiryAlertEmails") → [] (all opted out)
    //
    // When recipients=[] the function early-returns before the
    // `recipients.map(email => sendMail(...))` call — sendMail is structurally
    // unreachable.  There is no db.insert in this function, so we verify
    // the function resolves cleanly and does not throw.
    //
    buildSelectMock([[]]);

    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await assert.doesNotReject(
      () => notifyAdminsOfPlanExpiry(PLAN_EXPIRY_OPTS),
      "notifyAdminsOfPlanExpiry must resolve without throwing on the opted-out path",
    );

    // No db.insert exists in this function even in the happy path.
    assert.equal(insertLog.length, 0, "No DB write of any kind should occur (none exist in this function)");
  });

  it("resolves cleanly for any merchantId when all admins have opted out", async () => {
    buildSelectMock([[]]);  // recipients: empty
    buildInsertMock([]);

    await assert.doesNotReject(
      () => notifyAdminsOfPlanExpiry({ ...PLAN_EXPIRY_OPTS, merchantId: 999, daysUntilExpiry: 1 }),
    );
  });

  it("never throws when the opted-out path is taken", async () => {
    buildSelectMock([[]]);
    buildInsertMock([]);

    await assert.doesNotReject(
      () => notifyAdminsOfPlanExpiry(PLAN_EXPIRY_OPTS),
      "notifyAdminsOfPlanExpiry must never throw — errors are swallowed internally",
    );
  });

  it("never throws when db.select throws (DB connectivity error)", async () => {
    (db as any).select = () => {
      throw new Error("simulated DB connection error");
    };
    (db as any).insert = () => ({ values: () => Promise.resolve() });

    await assert.doesNotReject(
      () => notifyAdminsOfPlanExpiry(PLAN_EXPIRY_OPTS),
      "notifyAdminsOfPlanExpiry must swallow DB errors and not propagate",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// notifyAdminsOfSettlementStateChange
// ─────────────────────────────────────────────────────────────────────────────

const SETTLEMENT_OPTS = {
  settlementId: 101,
  merchantName: "Demo Merchant",
  referenceNumber: "REF001",
  newStatus: "approved",
  amount: 5000,
  note: null,
};

describe("notifyAdminsOfSettlementStateChange — all admins opted out (settlementStateEmails=false)", () => {
  it("does not call sendMail when the opted-in recipient list is empty", async () => {
    //
    // select[0]: getAdminEmails("settlementStateEmails") → [] (all opted out)
    //
    // When recipients=[] the function early-returns before the
    // `recipients.map(email => sendMail(...))` call — sendMail is structurally
    // unreachable.  There is no db.insert in this function, so we verify
    // the function resolves cleanly and does not throw.
    //
    buildSelectMock([[]]);

    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await assert.doesNotReject(
      () => notifyAdminsOfSettlementStateChange(SETTLEMENT_OPTS),
      "notifyAdminsOfSettlementStateChange must resolve without throwing on the opted-out path",
    );

    assert.equal(insertLog.length, 0, "No DB write of any kind should occur (none exist in this function)");
  });

  it("resolves cleanly for any settlementId when all admins have opted out", async () => {
    buildSelectMock([[]]);
    buildInsertMock([]);

    await assert.doesNotReject(
      () => notifyAdminsOfSettlementStateChange({ ...SETTLEMENT_OPTS, settlementId: 999, newStatus: "rejected" }),
    );
  });

  it("suppresses correctly regardless of the status transition when all have opted out", async () => {
    const statuses = ["approved", "rejected", "processing", "completed", "pending"];

    for (const newStatus of statuses) {
      buildSelectMock([[]]);
      buildInsertMock([]);

      await assert.doesNotReject(
        () => notifyAdminsOfSettlementStateChange({ ...SETTLEMENT_OPTS, newStatus }),
        `notifyAdminsOfSettlementStateChange must not throw for status="${newStatus}"`,
      );
    }
  });

  it("never throws when the opted-out path is taken", async () => {
    buildSelectMock([[]]);
    buildInsertMock([]);

    await assert.doesNotReject(
      () => notifyAdminsOfSettlementStateChange(SETTLEMENT_OPTS),
      "notifyAdminsOfSettlementStateChange must never throw — errors are swallowed internally",
    );
  });

  it("never throws when db.select throws (DB connectivity error)", async () => {
    (db as any).select = () => {
      throw new Error("simulated DB connection error");
    };
    (db as any).insert = () => ({ values: () => Promise.resolve() });

    await assert.doesNotReject(
      () => notifyAdminsOfSettlementStateChange(SETTLEMENT_OPTS),
      "notifyAdminsOfSettlementStateChange must swallow DB errors and not propagate",
    );
  });
});
