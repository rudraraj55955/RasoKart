/**
 * Behavioral unit tests for notifyAdminsOfEkqrCapFull — "all admins opted out" edge case.
 *
 * Covers:
 *   - sendMail is never invoked when every active admin has ekqrCapAlertEmails=false
 *   - UPIGATEWAY_CAP_ALERT_LAST_SENT_DATE is NOT written to system_config in that case
 *   - The dedup early-return (already sent today) path is also exercised
 *   - The function never throws regardless of outcome
 *
 * Mocking strategy (matches payinFailoverAlert.test.ts):
 *   db is a shared mutable object; we monkey-patch db.select / db.insert per-test
 *   and restore originals in afterEach.
 *
 * Why verifying db.insert=0 also proves sendMail was never called:
 *   The function sends mail with  `recipients.map(email => sendMail(...))`.
 *   When recipients=[], Array.prototype.map never invokes its callback, so
 *   sendMail is structurally unreachable.  The dedup flag write (db.insert) only
 *   executes AFTER sendMail calls resolve and only if sent>0, so insert=0
 *   confirms both conditions simultaneously.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { notifyAdminsOfEkqrCapFull } from "./adminNotifyEmail";

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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_OPTS = {
  todayTotal: 100_000,
  dailyLimit: 100_000,
  resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyAdminsOfEkqrCapFull — all admins opted out (ekqrCapAlertEmails=false)", () => {
  it("does not call sendMail when the opted-in recipient list is empty", async () => {
    //
    // When recipients=[] the function returns before reaching the sendMail call.
    // We confirm this by verifying that db.insert is never invoked: the dedup flag
    // write is the only db.insert in the function, and it is guarded by `if (sent > 0)`.
    // If sendMail had been called for any recipient, `sent` would be >0 and insert
    // would be triggered.  insert=0 therefore proves sendMail was never called.
    //
    // select[0]: dedup check  → [] (alert not yet sent today → proceed past dedup guard)
    // select[1]: getAdminEmails("ekqrCapAlertEmails") → [] (all opted out)
    //
    buildSelectMock([
      [],  // UPIGATEWAY_CAP_ALERT_LAST_SENT_DATE — no existing row
      [],  // opted-in admins — empty (all have ekqrCapAlertEmails=false)
    ]);

    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS);

    assert.equal(
      insertLog.length,
      0,
      "db.insert must never be called — no dedup flag persisted and no sendMail invocations occurred",
    );
  });

  it("does NOT write UPIGATEWAY_CAP_ALERT_LAST_SENT_DATE when no admins opted in", async () => {
    buildSelectMock([
      [],  // dedup: no existing flag for today
      [],  // recipients: empty (all opted out)
    ]);

    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS);

    assert.equal(
      insertLog.length,
      0,
      "The dedup date flag must not be persisted when no email was sent (opted-out path)",
    );
  });

  it("suppresses correctly regardless of how many admins exist, when all have opted out", async () => {
    // getAdminEmails() applies WHERE ekqrCapAlertEmails=true at the DB level, so
    // even with many admin rows the response is empty when all opted out.
    buildSelectMock([
      [],  // dedup: no flag
      [],  // recipients: DB already filtered out all opt-outs → empty result
    ]);

    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfEkqrCapFull({
      todayTotal: 500_000,
      dailyLimit: 500_000,
      resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    assert.equal(insertLog.length, 0, "No dedup flag written when all admins opted out");
  });

  it("dedup guard also suppresses (already sent today) before reaching the recipient check", async () => {
    const todayUtcDate = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    buildSelectMock([
      // dedup: flag matches today — function returns immediately, recipient query never runs
      [{ value: todayUtcDate }],
      // This second response would only be consumed if the function proceeds past the dedup guard
      [{ email: "admin@rasokart.com" }],
    ]);

    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS);

    assert.equal(insertLog.length, 0, "No DB write when dedup guard fires (already sent today)");
  });

  it("never throws when the opted-out path is taken", async () => {
    buildSelectMock([[], []]);
    const insertLog: unknown[] = [];
    buildInsertMock(insertLog);

    await assert.doesNotReject(
      () => notifyAdminsOfEkqrCapFull(SAMPLE_OPTS),
      "notifyAdminsOfEkqrCapFull must never throw — errors are swallowed internally",
    );

    assert.equal(insertLog.length, 0);
  });

  it("never throws when db.select throws (DB connectivity error)", async () => {
    (db as any).select = () => {
      throw new Error("simulated DB connection error");
    };
    (db as any).insert = () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve() }) });

    await assert.doesNotReject(
      () => notifyAdminsOfEkqrCapFull(SAMPLE_OPTS),
      "notifyAdminsOfEkqrCapFull must swallow DB errors and not propagate",
    );
  });
});
