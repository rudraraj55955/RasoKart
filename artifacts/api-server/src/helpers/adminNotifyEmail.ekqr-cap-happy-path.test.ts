/**
 * Happy-path unit tests for notifyAdminsOfEkqrCapFull — opted-in admins present.
 *
 * Mirrors the mocking strategy in adminNotifyEmail.ekqr-cap-suppression.test.ts.
 *
 * Covers:
 *   - The function proceeds through the dedup guard, fetches opted-in recipients,
 *     and reaches the sendMail dispatch when at least one admin is opted in
 *   - The atomic dedup INSERT (db.execute) IS called on a first invocation
 *   - A second call within the same UTC day is suppressed when db.execute returns 0 rows:
 *     the function returns before getAdminEmails (db.select) is ever called
 *   - The function never throws regardless of outcome
 *
 * Why db.execute is the right signal for "dedup flag written":
 *   notifyAdminsOfEkqrCapFull uses a single atomic
 *   INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING
 *   to both write the flag AND gate the send in one round-trip.
 *   A non-empty RETURNING result (>0 rows) means "claimed — first alert of the day".
 *   An empty result means "already claimed today — suppressed".
 *   There is no separate db.insert after the send; db.execute IS the flag write.
 *
 * Why we track db.select call count instead of mocking sendMail:
 *   sendMail is a named ESM export (non-writable Module Namespace Object property)
 *   and cannot be monkey-patched in a plain Node.js test.  Instead we confirm the
 *   dispatch path was reached by counting db.select calls:
 *     - dedup succeeds  → db.select called 1 time (getAdminEmails)
 *     - dedup suppresses → db.select called 0 times (early return before recipient lookup)
 *   When db.select returns opted-in emails the function structurally must invoke
 *   sendMail — it is the only code between the recipient lookup and the logger.info
 *   at the end of the try block.  sendMail errors are swallowed by Promise.allSettled.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { notifyAdminsOfEkqrCapFull } from "./adminNotifyEmail";

// ── DB mock helpers ─────────────────────────────────────────────────────────

/**
 * Mock db.execute to return a fixed rows array and record every call.
 *
 * The function calls db.execute exactly once with the atomic dedup INSERT.
 * Pass `rows = [{ value: TODAY_UTC }]` → claim succeeds (first alert of day).
 * Pass `rows = []`                     → already sent today (suppressed).
 */
function buildExecuteMock(executeLog: unknown[], rows: unknown[]) {
  (db as any).execute = (_query: unknown) => {
    executeLog.push(_query);
    return Promise.resolve(rows);
  };
}

/**
 * Build a chainable db.select mock that consumes `selectResponses` in order
 * and increments `selectCallCount` on every invocation.
 * Supports:
 *   await db.select().from().where()
 *   await db.select().from().where().limit(n)
 */
function buildSelectMock(
  selectResponses: Array<Array<Record<string, unknown>>>,
  counter: { calls: number },
) {
  let callIdx = 0;
  (db as any).select = (_fields?: unknown) => {
    counter.calls++;
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

// ── Save originals for teardown ──────────────────────────────────────────────

const originalExecute = (db as any).execute?.bind(db);
const originalSelect = (db as any).select.bind(db);

afterEach(() => {
  (db as any).execute = originalExecute;
  (db as any).select = originalSelect;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const SAMPLE_OPTS = {
  todayTotal: 100_000,
  dailyLimit: 100_000,
  resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
};

const TODAY_UTC = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

// ── Tests ────────────────────────────────────────────────────────────────────

describe("notifyAdminsOfEkqrCapFull — happy path (at least one admin opted in)", () => {
  it("proceeds to the sendMail dispatch when dedup claim succeeds and one admin is opted in", async () => {
    //
    // db.execute returns [{ value: today }] → claim succeeded → proceed past dedup guard
    // db.select (getAdminEmails) is called and returns one opted-in admin
    //
    // The function has no code path between the getAdminEmails result and the
    // sendMail dispatch other than the recipients.length===0 early-return guard.
    // With one recipient, that guard is skipped, so sendMail is structurally reached.
    //
    // We confirm db.select was called (= getAdminEmails ran = dispatch path reached).
    //
    const executeLog: unknown[] = [];
    buildExecuteMock(executeLog, [{ value: TODAY_UTC }]);

    const selectCounter = { calls: 0 };
    buildSelectMock([[{ email: "admin@rasokart.com" }]], selectCounter);

    await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS);

    assert.ok(
      selectCounter.calls >= 1,
      `getAdminEmails (db.select) must be called at least once — confirms the function ` +
        `passed the dedup guard and reached the recipient lookup / sendMail dispatch (got ${selectCounter.calls})`,
    );
  });

  it("reaches the sendMail dispatch for all opted-in admins when multiple exist", async () => {
    buildExecuteMock([], [{ value: TODAY_UTC }]);

    const selectCounter = { calls: 0 };
    buildSelectMock(
      [[
        { email: "admin1@rasokart.com" },
        { email: "admin2@rasokart.com" },
        { email: "admin3@rasokart.com" },
      ]],
      selectCounter,
    );

    await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS);

    assert.ok(
      selectCounter.calls >= 1,
      `getAdminEmails (db.select) must be called at least once — confirms dispatch path reached (got ${selectCounter.calls})`,
    );
  });

  it("writes the dedup flag — db.execute IS called on the first invocation", async () => {
    //
    // "Writing the dedup flag" = db.execute was called with the atomic INSERT
    // INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING.
    // There is no separate db.insert after the send; db.execute is the only flag write.
    //
    const executeLog: unknown[] = [];
    buildExecuteMock(executeLog, [{ value: TODAY_UTC }]);

    const selectCounter = { calls: 0 };
    buildSelectMock([[{ email: "admin@rasokart.com" }]], selectCounter);

    await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS);

    assert.equal(
      executeLog.length,
      1,
      "db.execute must be called exactly once — it is the atomic INSERT that both writes " +
        "UPIGATEWAY_CAP_ALERT_LAST_SENT_DATE and gates further processing in a single round-trip",
    );
  });

  it("suppresses a second call within the same UTC day — db.select is never reached", async () => {
    //
    // db.execute returns [] → the WHERE clause on the INSERT…ON CONFLICT was false:
    // the stored date already equals today → suppressed.
    // The function must return immediately without ever calling getAdminEmails (db.select).
    //
    buildExecuteMock([], []); // 0 rows → already claimed today

    const selectCounter = { calls: 0 };
    // Safe fallback rows (should never be consumed on the suppressed path)
    buildSelectMock([[{ email: "admin@rasokart.com" }]], selectCounter);

    await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS);

    assert.equal(
      selectCounter.calls,
      0,
      "getAdminEmails (db.select) must NOT be called when the dedup guard suppresses the alert — " +
        "the function returns before reaching the recipient lookup",
    );
  });

  it("does not throw when the happy path completes successfully", async () => {
    buildExecuteMock([], [{ value: TODAY_UTC }]);

    const selectCounter = { calls: 0 };
    buildSelectMock([[{ email: "admin@rasokart.com" }]], selectCounter);

    await assert.doesNotReject(
      () => notifyAdminsOfEkqrCapFull(SAMPLE_OPTS),
      "notifyAdminsOfEkqrCapFull must never throw — errors are swallowed internally",
    );
  });

  it("does not throw when db.execute throws (DB connectivity error)", async () => {
    (db as any).execute = () => {
      throw new Error("simulated DB connection error");
    };
    // db.select should never be reached, but provide a safe mock just in case
    const selectCounter = { calls: 0 };
    buildSelectMock([], selectCounter);

    await assert.doesNotReject(
      () => notifyAdminsOfEkqrCapFull(SAMPLE_OPTS),
      "notifyAdminsOfEkqrCapFull must swallow db.execute errors",
    );
  });
});
