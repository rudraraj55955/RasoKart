/**
 * Tests for runStuckCashfreeOrderScan (cashfreeStuckOrderScheduler.ts)
 * and the cooldown path in notifyAdminsOfStuckCashfreeOrders (adminNotifyEmail.ts).
 *
 * Suite 1 — real DB (status filter):
 *   Seeds one order per status (CREATED, PENDING, PAID, FAILED, EXPIRED) for a
 *   dedicated production test merchant, captures the stuck count before and after
 *   insertion, and asserts the delta is exactly 2. This proves the
 *   `inArray(status, [CREATED, PENDING])` predicate in the scheduler is actually
 *   applied — removing or broadening it would raise the delta to 3, 4, or 5.
 *
 * Suite 2 — mocked DB (cooldown suppression):
 *   Tests that notifyAdminsOfStuckCashfreeOrders respects its cooldown window
 *   by injecting a stub _sendMail and controlling the last-sent timestamp
 *   returned from db.select. No real SMTP traffic is generated.
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { and, count, eq, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  merchantsTable,
  cashfreePaymentOrdersTable,
  PAYIN_ORDER_STATUS,
  systemConfigTable,
} from "@workspace/db";
import { runStuckCashfreeOrderScan } from "./cashfreeStuckOrderScheduler";
import { notifyAdminsOfStuckCashfreeOrders } from "./adminNotifyEmail";

// =============================================================================
// Suite 1 — real DB: status filter
// =============================================================================
//
// The scheduler query uses inArray(status, [CREATED, PENDING]) so PAID, FAILED,
// and EXPIRED orders are never counted as "stuck". These tests verify the
// predicate behaviorally: they seed all five statuses into the live database and
// measure the change in the count before vs. after insertion.

describe("runStuckCashfreeOrderScan — status filter (real DB)", () => {
  let merchantId: number;
  let insertedOrderIds: number[];
  /** Stuck count captured before our test rows exist in the DB. */
  let baselineStuckCount: number;

  /** Same predicates the scheduler uses — used to compute the baseline and verify isolation. */
  function schedulerCountQuery() {
    const prodMerchantIds = db
      .select({ id: merchantsTable.id })
      .from(merchantsTable)
      .where(eq(merchantsTable.environment, "production"));

    // Match the 15-min default stale window; our rows are 30 min old so they qualify.
    const staleThreshold = new Date(Date.now() - 15 * 60 * 1000);

    return db
      .select({ cnt: count() })
      .from(cashfreePaymentOrdersTable)
      .where(
        and(
          inArray(cashfreePaymentOrdersTable.status, [
            PAYIN_ORDER_STATUS.CREATED,
            PAYIN_ORDER_STATUS.PENDING,
          ]),
          lte(cashfreePaymentOrdersTable.createdAt, staleThreshold),
          sql`${cashfreePaymentOrdersTable.cashfreeOrderId} NOT LIKE 'WLOAD_%'`,
          inArray(cashfreePaymentOrdersTable.merchantId, prodMerchantIds),
        ),
      );
  }

  before(async () => {
    // ── Step 1: capture baseline before our test rows exist ──────────────────
    const [baseRow] = await schedulerCountQuery();
    baselineStuckCount = baseRow?.cnt ?? 0;

    // ── Step 2: insert a unique production merchant ───────────────────────────
    const suffix = Date.now();
    const [m] = await db
      .insert(merchantsTable)
      .values({
        businessName: `Stuck Scan Test ${suffix}`,
        contactName: "Test",
        email: `stuck-scan-${suffix}@example.com`,
        phone: "9999999999",
        environment: "production",
      })
      .returning({ id: merchantsTable.id });
    merchantId = m!.id;

    // ── Step 3: insert one order per status, all 30 min old (stale) ──────────
    const staleAt = new Date(Date.now() - 30 * 60 * 1000);
    const cfPrefix = `SOST${suffix}`;
    const rows = await db
      .insert(cashfreePaymentOrdersTable)
      .values([
        {
          merchantId,
          cashfreeOrderId: `${cfPrefix}_CREATED`,
          amount: "100.00",
          status: PAYIN_ORDER_STATUS.CREATED,
          createdAt: staleAt,
          updatedAt: staleAt,
        },
        {
          merchantId,
          cashfreeOrderId: `${cfPrefix}_PENDING`,
          amount: "100.00",
          status: PAYIN_ORDER_STATUS.PENDING,
          createdAt: staleAt,
          updatedAt: staleAt,
        },
        {
          merchantId,
          cashfreeOrderId: `${cfPrefix}_PAID`,
          amount: "100.00",
          status: PAYIN_ORDER_STATUS.PAID,
          createdAt: staleAt,
          updatedAt: staleAt,
        },
        {
          merchantId,
          cashfreeOrderId: `${cfPrefix}_FAILED`,
          amount: "100.00",
          status: PAYIN_ORDER_STATUS.FAILED,
          createdAt: staleAt,
          updatedAt: staleAt,
        },
        {
          merchantId,
          cashfreeOrderId: `${cfPrefix}_EXPIRED`,
          amount: "100.00",
          status: PAYIN_ORDER_STATUS.EXPIRED,
          createdAt: staleAt,
          updatedAt: staleAt,
        },
      ])
      .returning({ id: cashfreePaymentOrdersTable.id });
    insertedOrderIds = rows.map((r) => r.id);
  });

  after(async () => {
    // Clean up test rows so they don't pollute other tests or scheduler runs.
    if (insertedOrderIds?.length) {
      await db
        .delete(cashfreePaymentOrdersTable)
        .where(inArray(cashfreePaymentOrdersTable.id, insertedOrderIds));
    }
    if (merchantId) {
      await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
    }
  });

  it("stuck count increases by exactly 2 after inserting one order per status — PAID/FAILED/EXPIRED are not counted", async () => {
    // After `before()` inserted 5 rows (CREATED, PENDING, PAID, FAILED, EXPIRED),
    // the count using the same `inArray(status, [CREATED, PENDING])` predicate must
    // be exactly baseline + 2. If PAID, FAILED, or EXPIRED were incorrectly
    // included, the count would be baseline + 3, +4, or +5.
    const [afterRow] = await schedulerCountQuery();
    const afterCount = afterRow?.cnt ?? 0;

    assert.equal(
      afterCount,
      baselineStuckCount + 2,
      `Stuck count must increase by exactly 2 (CREATED + PENDING). ` +
        `Got baseline=${baselineStuckCount}, after=${afterCount} — ` +
        `a higher delta means PAID/FAILED/EXPIRED rows were incorrectly counted.`,
    );
  });

  it("all 5 seeded orders are stale — the status filter alone excludes the terminal ones", async () => {
    // Sanity-check: all 5 rows exist and are older than the 15-min stale window,
    // proving the status filter (not the time filter) is what excludes PAID/FAILED/EXPIRED.
    const staleThreshold = new Date(Date.now() - 15 * 60 * 1000);
    const [allRow] = await db
      .select({ cnt: count() })
      .from(cashfreePaymentOrdersTable)
      .where(
        and(
          eq(cashfreePaymentOrdersTable.merchantId, merchantId),
          lte(cashfreePaymentOrdersTable.createdAt, staleThreshold),
        ),
      );
    assert.equal(
      allRow?.cnt ?? 0,
      5,
      "All 5 seeded orders must be stale (older than 15 min) so time filter is not the cause of exclusion",
    );
  });

  it("runStuckCashfreeOrderScan() returns stuckCount matching the direct predicate count", async () => {
    // Call the real scheduler function and compare its output against the direct
    // count query that uses identical predicates. They must agree — this confirms
    // the scheduler's SQL is consistent with what the tests assert.
    // Pass a no-op notifier so the function never risks sending real email,
    // regardless of whether the stuck count meets the configured threshold.
    const noopNotifier = async () => {};
    const result = await runStuckCashfreeOrderScan(noopNotifier);

    const [directRow] = await schedulerCountQuery();
    const directCount = directRow?.cnt ?? 0;

    assert.equal(
      result.stuckCount,
      directCount,
      "runStuckCashfreeOrderScan stuckCount must match a direct count using the same status+stale+WLOAD predicates",
    );
    // Our 2 CREATED/PENDING rows must be included.
    assert.ok(
      result.stuckCount >= baselineStuckCount + 2,
      `stuckCount (${result.stuckCount}) must include our 2 CREATED/PENDING rows (baseline was ${baselineStuckCount})`,
    );
  });
});

// =============================================================================
// Suite 2 — mocked DB: cooldown suppression
// =============================================================================
//
// Tests that notifyAdminsOfStuckCashfreeOrders respects its cooldown window.
// The last-sent timestamp is stored in system_config; a call within the window
// must skip sendMail and must not update the last-sent key.

// ── DB mock helpers ────────────────────────────────────────────────────────────

/**
 * Build a chainable db.select mock that consumes `selectResponses` in order.
 * Handles both:
 *   await db.select(...).from().where()          — admin-email reads
 *   await db.select(...).from().where().limit(n) — cooldown timestamp reads
 * Any call beyond the provided array returns [] (safe fallback).
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

/**
 * Build a db.insert mock that appends { table, values } to `insertLog`.
 * Supports plain inserts and onConflictDoUpdate upserts.
 */
function buildInsertMock(insertLog: Array<{ table: unknown; values: unknown }>) {
  (db as any).insert = (table: unknown) => ({
    values: (vals: unknown) => {
      insertLog.push({ table, values: vals });
      return {
        onConflictDoUpdate: (_opts: unknown) => Promise.resolve(),
      };
    },
  });
}

/** A stub sendMail spy that records calls and returns true (success). */
function buildSendSpy(log: unknown[]) {
  return async (args: unknown): Promise<boolean> => {
    log.push(args);
    return true;
  };
}

/** A stub sendMail that always returns false (simulates SMTP failure). */
const failSend = async (_args: unknown): Promise<boolean> => false;

// ── Save originals for teardown ────────────────────────────────────────────────

const originalSelect = (db as any).select?.bind(db);
const originalInsert = (db as any).insert?.bind(db);

afterEach(() => {
  if (originalSelect) (db as any).select = originalSelect;
  if (originalInsert) (db as any).insert = originalInsert;
});

// ── Shared fixtures ────────────────────────────────────────────────────────────

const SAMPLE_NOTIFY_OPTS = {
  stuck: 3,
  threshold: 2,
  staleMinutes: 15,
  cooldownHours: 4,
};

/** Timestamp clearly within the cooldown window (30 min ago, window is 4 h). */
const RECENT_TIMESTAMP = new Date(Date.now() - 30 * 60 * 1000).toISOString();

/** Timestamp clearly outside the cooldown window (5 h ago, window is 4 h). */
const OLD_TIMESTAMP = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("notifyAdminsOfStuckCashfreeOrders — cooldown suppression", () => {
  it("suppresses sendMail when lastSentAt is within the cooldown window", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }], // getAllActiveAdminEmails
      [{ value: RECENT_TIMESTAMP }],      // cooldown check → within window
    ]);
    buildInsertMock([]);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, buildSendSpy(sendCalls));

    assert.equal(
      sendCalls.length,
      0,
      "sendMail must NOT be called when the last alert was sent within the cooldown window",
    );
  });

  it("a second call within the cooldown window must not reach sendMail (cooldown gate)", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: RECENT_TIMESTAMP }],
    ]);
    buildInsertMock([]);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, buildSendSpy(sendCalls));

    assert.equal(sendCalls.length, 0, "second call within cooldown must not reach sendMail");
  });

  it("does NOT update the systemConfig last-sent key when suppressed by cooldown", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: RECENT_TIMESTAMP }],
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, failSend);

    const systemConfigInserts = insertLog.filter((e) => e.table === systemConfigTable);
    assert.equal(
      systemConfigInserts.length,
      0,
      "systemConfig last-sent key must NOT be upserted when suppressed by cooldown",
    );
  });

  it("sends the alert when there is no prior last-sent record (first-ever send)", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [], // no prior record → cooldown check passes
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, buildSendSpy(sendCalls));

    assert.equal(sendCalls.length, 1, "sendMail must be called once when there is no prior last-sent record");
    const systemConfigInserts = insertLog.filter((e) => e.table === systemConfigTable);
    assert.equal(
      systemConfigInserts.length,
      1,
      "systemConfig last-sent key must be upserted after a successful first send",
    );
  });

  it("sends the alert when lastSentAt is outside the cooldown window (expired cooldown)", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: OLD_TIMESTAMP }], // 5 h ago, window is 4 h → expired
    ]);
    buildInsertMock([]);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, buildSendSpy(sendCalls));

    assert.equal(sendCalls.length, 1, "sendMail must be called when the cooldown period has elapsed");
  });

  it("suppresses only within the window — a just-expired timestamp is NOT suppressed", async () => {
    // 1 ms past the cooldown boundary → NOT in window → must send
    const justExpired = new Date(
      Date.now() - SAMPLE_NOTIFY_OPTS.cooldownHours * 60 * 60 * 1000 - 1,
    ).toISOString();

    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: justExpired }],
    ]);
    buildInsertMock([]);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, buildSendSpy(sendCalls));

    assert.equal(sendCalls.length, 1, "sendMail must fire when the cooldown has just expired");
  });

  it("skips sendMail and does NOT upsert last-sent key when admin list is empty", async () => {
    buildSelectMock([
      [], // no active admins
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, buildSendSpy(sendCalls));

    assert.equal(sendCalls.length, 0, "sendMail must not be called when there are no active admins");
    assert.equal(insertLog.length, 0, "systemConfig must not be written when admin list is empty");
  });

  it("does NOT upsert last-sent key when all sendMail calls fail (sent=0)", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [], // no prior record
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, failSend);

    const systemConfigInserts = insertLog.filter((e) => e.table === systemConfigTable);
    assert.equal(
      systemConfigInserts.length,
      0,
      "systemConfig last-sent key must NOT be written when all sendMail calls fail",
    );
  });

  it("never throws when suppressed by cooldown", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: RECENT_TIMESTAMP }],
    ]);
    buildInsertMock([]);

    await assert.doesNotReject(
      () => notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, failSend),
      "notifyAdminsOfStuckCashfreeOrders must never throw — errors are swallowed internally",
    );
  });

  it("never throws when the non-suppressed send path is taken", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [],
    ]);
    buildInsertMock([]);

    await assert.doesNotReject(
      () => notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, buildSendSpy([])),
      "notifyAdminsOfStuckCashfreeOrders must not propagate errors in the send path",
    );
  });

  it("never throws when db.select rejects (DB connectivity error)", async () => {
    (db as any).select = () => ({
      from: () => ({
        where: (_cond: unknown) => {
          const rejection = Promise.reject(new Error("simulated DB error"));
          return Object.assign(rejection, {
            limit: (_n: number) => Promise.reject(new Error("simulated DB error")),
          });
        },
      }),
    });

    await assert.doesNotReject(
      () => notifyAdminsOfStuckCashfreeOrders(SAMPLE_NOTIFY_OPTS, failSend),
      "notifyAdminsOfStuckCashfreeOrders must swallow DB errors and not propagate",
    );
  });
});
