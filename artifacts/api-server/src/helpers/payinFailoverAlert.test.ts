/**
 * Unit tests for maybeFireFailoverAlert, recordChainExhaustedStart, and
 * the failover-events dedup/merging logic.
 *
 * maybeFireFailoverAlert covers:
 *   - Default threshold (no DB row) → 5
 *   - Custom threshold from system_config
 *   - NaN-producing value → falls back to default
 *   - Alert NOT fired when failureCount < threshold
 *   - Alert fired when failureCount === threshold (at boundary)
 *   - Alert fired when failureCount > threshold
 *   - Dedup guard: no second alert when one exists in the window
 *   - No alert when there are no active admin users
 *   - threshold=1 edge case
 *   - Very large window (e.g. 10000 minutes)
 *   - parseInt NaN guard for both threshold and window
 *   - Swallows errors (never throws)
 *
 * recordChainExhaustedStart covers:
 *   - Calling twice in the same outage window fires notification exactly once
 *   - Returns { isNew: true } on first call, { isNew: false } on second
 *   - After the outage marker is cleared (recovery), next call fires again
 *   - No notification when there are no active admins
 *   - Never throws even on DB errors
 *
 * failover-events merging covers:
 *   - Both chain_exhausted and threshold_alert eventKinds appear when both
 *     notification types are present
 *   - Per-admin duplicate rows are collapsed by the dedup key
 *   - Events are sorted newest-first
 *   - Recovery status is correctly correlated via outageStartedAt key
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { maybeFireFailoverAlert } from "./payinFailoverAlert";
import { recordChainExhaustedStart, maybeNotifyGatewayRecovery, buildFailoverEventList } from "./smartRouter";

// ── Silence the logger in tests ───────────────────────────────────────────────
const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ── DB mock helpers ───────────────────────────────────────────────────────────

type SelectCall = {
  /** rows returned when this mock is consumed */
  rows: Array<Record<string, unknown>>;
};

/**
 * Build a mock for db.select that returns a queue of row-sets in order.
 * Each call to db.select() consumes the next entry in `responses`.
 * Returns a tracking object so tests can assert call counts and inserted values.
 */
function buildMocks(
  selectResponses: Array<Array<Record<string, unknown>>>,
  opts: {
    /** If provided, collect insert calls here */
    insertedValues?: Array<unknown>;
    /** Override the insert to throw (simulates DB error) */
    insertThrows?: boolean;
  } = {},
) {
  let callIdx = 0;

  (db as any).select = () => {
    const rows = selectResponses[callIdx++] ?? [];
    // Return an object that supports both:
    //   await db.select().from().where()
    //   await db.select().from().where().limit()
    const queryResult = {
      from: () => ({
        where: (_cond: unknown) => {
          const r = Promise.resolve(rows);
          return Object.assign(r, {
            limit: (_n: number) => Promise.resolve(rows),
          });
        },
      }),
    };
    return queryResult;
  };

  (db as any).insert = (_table: unknown) => ({
    values: (vals: unknown) => ({
      onConflictDoNothing: async () => {
        if (opts.insertThrows) {
          throw new Error("simulated insert failure");
        }
        opts.insertedValues?.push(vals);
      },
    }),
  });
}

// ── Save originals for teardown ───────────────────────────────────────────────

const originalSelect = (db as any).select.bind(db);
const originalInsert = (db as any).insert.bind(db);
const originalDelete = (db as any).delete?.bind(db);
const originalSelectDistinct = (db as any).selectDistinct?.bind(db);

afterEach(() => {
  (db as any).select = originalSelect;
  (db as any).insert = originalInsert;
  if (originalDelete) (db as any).delete = originalDelete;
  if (originalSelectDistinct) (db as any).selectDistinct = originalSelectDistinct;
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to build standard select-response sequences
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full happy-path response sequence:
 *   [0] FAILOVER_ALERT_THRESHOLD row
 *   [1] FAILOVER_ALERT_WINDOW_MINUTES row
 *   [2] routing_logs count row
 *   [3] existing alert check (empty = no prior alert)
 *   [4] active admin users
 *   [5] PAYIN_CHAIN_EXHAUSTED_SINCE row
 */
function makeResponses({
  thresholdValue,
  windowValue,
  failureCount,
  existingAlert,
  adminUsers,
  chainMarker,
}: {
  thresholdValue?: string;
  windowValue?: string;
  failureCount: number;
  existingAlert?: boolean;
  adminUsers?: Array<{ id: number }>;
  chainMarker?: string;
}): Array<Array<Record<string, unknown>>> {
  return [
    thresholdValue !== undefined ? [{ key: "failover_alert_threshold", value: thresholdValue }] : [],
    windowValue !== undefined ? [{ key: "failover_alert_window_minutes", value: windowValue }] : [],
    [{ count: failureCount }],
    existingAlert ? [{ id: 999 }] : [],
    adminUsers ?? [{ id: 1 }, { id: 2 }],
    chainMarker !== undefined ? [{ value: chainMarker }] : [],
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("maybeFireFailoverAlert — threshold reading", () => {
  it("uses default threshold of 5 when no row is present in system_config", async () => {
    const inserted: unknown[] = [];
    // No threshold row, no window row → defaults (5, 60)
    // failureCount = 5 → should fire (5 >= 5)
    buildMocks(
      [
        [],             // no FAILOVER_ALERT_THRESHOLD row
        [],             // no FAILOVER_ALERT_WINDOW_MINUTES row
        [{ count: 5 }], // count row
        [],             // no existing alert
        [{ id: 1 }],   // one admin
        [],             // no chain marker
      ],
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal((inserted[0] as any[]).length, 1, "Should insert 1 notification (one admin)");
  });

  it("uses custom threshold read from system_config", async () => {
    const inserted: unknown[] = [];
    // Custom threshold = 10; failureCount = 9 → should NOT fire
    buildMocks(
      makeResponses({ thresholdValue: "10", windowValue: "60", failureCount: 9 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 0, "Should not fire when below custom threshold");
  });

  it("fires when failureCount equals the custom threshold", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ thresholdValue: "10", windowValue: "60", failureCount: 10 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "Should fire at exactly the custom threshold");
  });

  it("falls back to default threshold 5 when value is NaN", async () => {
    const inserted: unknown[] = [];
    // "abc" → parseInt → NaN → falls back to 5; failureCount=5 should fire
    buildMocks(
      [
        [{ key: "failover_alert_threshold", value: "abc" }],
        [],             // no window row → default 60
        [{ count: 5 }],
        [],
        [{ id: 1 }],
        [],
      ],
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "Should fire using default threshold 5 after NaN fallback");
  });

  it("falls back to default threshold 5 when value is zero (below minimum of 1)", async () => {
    const inserted: unknown[] = [];
    // "0" → parseInt(0) < 1 → falls back to 5; count=4 should NOT fire
    buildMocks(
      [
        [{ key: "failover_alert_threshold", value: "0" }],
        [],
        [{ count: 4 }],
        [],
        [{ id: 1 }],
        [],
      ],
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 0, "count 4 < default 5: should not fire");
  });

  it("falls back to default window 60 when window value is NaN", async () => {
    // Test simply verifies no crash; NaN window → default 60m; count=5 fires
    const inserted: unknown[] = [];
    buildMocks(
      [
        [],                                              // default threshold 5
        [{ key: "failover_alert_window_minutes", value: "xyz" }], // NaN window
        [{ count: 5 }],
        [],
        [{ id: 1 }],
        [],
      ],
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "Should fire with default 60m window after NaN fallback");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("maybeFireFailoverAlert — threshold gate (fire vs. no-fire)", () => {
  it("does NOT fire when failureCount is below threshold", async () => {
    const inserted: unknown[] = [];
    // default threshold 5; count = 4
    buildMocks(
      makeResponses({ failureCount: 4 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 0, "No alert when below threshold");
  });

  it("does NOT fire when failureCount is 0", async () => {
    const inserted: unknown[] = [];
    buildMocks(makeResponses({ failureCount: 0 }), { insertedValues: inserted });
    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 0);
  });

  it("fires when failureCount equals threshold (boundary)", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ failureCount: 5 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "Alert fires at threshold boundary");
  });

  it("fires when failureCount exceeds threshold", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ failureCount: 50 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "Alert fires when above threshold");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("maybeFireFailoverAlert — dedup guard", () => {
  it("does NOT fire a second alert when one already exists in the window", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ failureCount: 10, existingAlert: true }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 0, "No second alert when dedup record exists");
  });

  it("DOES fire when there is no existing alert in the window", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ failureCount: 10, existingAlert: false }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "Fires when no existing alert in window");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("maybeFireFailoverAlert — admin users", () => {
  it("inserts one notification per active admin", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({
        failureCount: 5,
        adminUsers: [{ id: 10 }, { id: 20 }, { id: 30 }],
      }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "One insert call");
    const rows = inserted[0] as Array<{ userId: number }>;
    assert.equal(rows.length, 3, "Three notification rows (one per admin)");
    assert.deepEqual(
      rows.map((r) => r.userId).sort((a, b) => a - b),
      [10, 20, 30],
    );
  });

  it("does NOT insert when there are no active admin users", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ failureCount: 5, adminUsers: [] }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 0, "No insert when admin list is empty");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("maybeFireFailoverAlert — notification payload", () => {
  it("embeds failureCount, windowMinutes, and triggerMerchantId in metadata", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({
        thresholdValue: "3",
        windowValue: "30",
        failureCount: 7,
        chainMarker: "2026-07-20T10:00:00.000Z",
      }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(42, silentLog);

    const rows = inserted[0] as Array<Record<string, unknown>>;
    assert.equal(rows.length, 2, "Two admins from makeResponses default");
    const meta = rows[0]!.metadata as Record<string, unknown>;
    assert.equal(meta.failureCount, 7);
    assert.equal(meta.windowMinutes, 30);
    assert.equal(meta.triggerMerchantId, 42);
    assert.equal(meta.outageStartedAt, "2026-07-20T10:00:00.000Z");
  });

  it("uses ISO timestamp for outageStartedAt when no chain marker row exists", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ failureCount: 5 }), // chainMarker=undefined → no row
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);

    const rows = inserted[0] as Array<Record<string, unknown>>;
    const meta = rows[0]!.metadata as Record<string, unknown>;
    assert.ok(
      typeof meta.outageStartedAt === "string" && meta.outageStartedAt.length > 0,
      "outageStartedAt should be a non-empty ISO string",
    );
  });

  it("uses '30m' window label for a sub-hour window", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ thresholdValue: "3", windowValue: "30", failureCount: 5 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    const rows = inserted[0] as Array<Record<string, unknown>>;
    assert.match(rows[0]!.body as string, /30m/);
  });

  it("uses '1h' window label for a 60-minute window", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ thresholdValue: "3", windowValue: "60", failureCount: 5 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    const rows = inserted[0] as Array<Record<string, unknown>>;
    assert.match(rows[0]!.body as string, /1h/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("maybeFireFailoverAlert — edge cases", () => {
  it("threshold=1: fires as soon as failureCount is 1", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ thresholdValue: "1", windowValue: "60", failureCount: 1 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "threshold=1 fires at count=1");
  });

  it("threshold=1: does NOT fire when failureCount is 0", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ thresholdValue: "1", windowValue: "60", failureCount: 0 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 0, "threshold=1 does not fire at count=0");
  });

  it("very large window (10000 minutes) — no crash or overflow", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      makeResponses({ thresholdValue: "2", windowValue: "10000", failureCount: 3 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "Fires correctly with a very large window");
    const rows = inserted[0] as Array<Record<string, unknown>>;
    const meta = rows[0]!.metadata as Record<string, unknown>;
    assert.equal(meta.windowMinutes, 10000);
  });

  it("NaN guard: empty string threshold → falls back to 5", async () => {
    const inserted: unknown[] = [];
    buildMocks(
      [
        [{ key: "failover_alert_threshold", value: "" }], // "" → parseInt("") → NaN
        [],
        [{ count: 5 }],
        [],
        [{ id: 1 }],
        [],
      ],
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "Empty string → NaN → falls back to 5 → fires at count 5");
  });

  it("NaN guard: float string '2.7' parses as 2, which is valid (>= 1)", async () => {
    const inserted: unknown[] = [];
    // parseInt("2.7") === 2 which IS finite and >= 1 → threshold=2
    // count=2 should fire
    buildMocks(
      makeResponses({ thresholdValue: "2.7", windowValue: "60", failureCount: 2 }),
      { insertedValues: inserted },
    );

    await maybeFireFailoverAlert(1, silentLog);
    assert.equal(inserted.length, 1, "parseInt('2.7')=2, threshold 2, count 2 → fires");
  });

  it("never throws even when db.insert fails", async () => {
    buildMocks(
      makeResponses({ failureCount: 5 }),
      { insertThrows: true },
    );

    // Should resolve without throwing
    await assert.doesNotReject(
      () => maybeFireFailoverAlert(1, silentLog),
      "Helper must not propagate insert errors",
    );
  });

  it("never throws even when db.select fails", async () => {
    (db as any).select = () => {
      throw new Error("simulated DB connection error");
    };

    await assert.doesNotReject(
      () => maybeFireFailoverAlert(1, silentLog),
      "Helper must not propagate select errors",
    );
  });
});

// =============================================================================
// recordChainExhaustedStart — dedup and fresh-outage behavior
// =============================================================================

/**
 * Build mocks for recordChainExhaustedStart (and optionally a second call).
 *
 * The function's DB call sequence per invocation (when isNew=true):
 *   INSERT systemConfigTable … onConflictDoNothing().returning()
 *   SELECT usersTable … (admin users)
 *   INSERT notificationsTable … returning()        ← via createBulkNotifications
 *
 * When isNew=false (conflict), only the first INSERT fires.
 *
 * `insertQueue` entries are consumed in order across all calls; each entry
 * specifies what to return from either call chain:
 *   { conflictNothing }  →  .onConflictDoNothing().returning()
 *   { plain }            →  .returning()  (notifications insert)
 */
function buildChainExhaustedMocks({
  insertQueue,
  selectQueue,
  notificationInserts,
}: {
  insertQueue: Array<{ conflictNothing?: Array<Record<string, unknown>>; plain?: unknown[] }>;
  selectQueue: Array<Array<{ id: number }>>;
  notificationInserts?: Array<unknown[]>;
}) {
  let insertIdx = 0;
  let selectIdx = 0;

  (db as any).insert = (_table: unknown) => ({
    values: (vals: unknown) => {
      const entry = insertQueue[insertIdx++] ?? {};
      return {
        onConflictDoNothing: () => ({
          returning: (_fields?: unknown) =>
            Promise.resolve(entry.conflictNothing ?? []),
        }),
        returning: () => {
          notificationInserts?.push(vals as unknown[]);
          return Promise.resolve(entry.plain ?? []);
        },
      };
    },
  });

  (db as any).select = (_fields?: unknown) => {
    const idx = selectIdx++;
    const rows = selectQueue[idx] ?? [];
    return {
      from: () => ({
        where: (_cond: unknown) => {
          const p = Promise.resolve(rows);
          return Object.assign(p, {
            limit: (_n: number) => Promise.resolve(rows),
          });
        },
      }),
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("recordChainExhaustedStart — dedup within same outage", () => {
  it("fires admin notification exactly once when called twice in the same outage", async () => {
    const notifInserts: Array<unknown[]> = [];

    buildChainExhaustedMocks({
      insertQueue: [
        // Call 1: marker inserted (isNew=true)
        { conflictNothing: [{ key: "PAYIN_CHAIN_EXHAUSTED_SINCE" }] },
        // Notification insert for call 1
        { plain: [] },
        // Call 2: conflict, marker already present (isNew=false)
        { conflictNothing: [] },
      ],
      selectQueue: [
        // Admin users for call 1
        [{ id: 1 }, { id: 2 }],
      ],
      notificationInserts: notifInserts,
    });

    const result1 = await recordChainExhaustedStart({
      merchantId: 7,
      amount: 1000,
      logger: silentLog as any,
    });
    const result2 = await recordChainExhaustedStart({
      merchantId: 7,
      amount: 1000,
      logger: silentLog as any,
    });

    assert.equal(result1.isNew, true, "First call should be a new outage");
    assert.equal(result2.isNew, false, "Second call should detect existing outage");
    assert.equal(
      notifInserts.length,
      1,
      "Notification batch should be inserted exactly once across both calls",
    );
  });

  it("returns { isNew: true } first call and { isNew: false } second call", async () => {
    buildChainExhaustedMocks({
      insertQueue: [
        { conflictNothing: [{ key: "PAYIN_CHAIN_EXHAUSTED_SINCE" }] },
        { plain: [] },
        { conflictNothing: [] },
      ],
      selectQueue: [[{ id: 10 }]],
    });

    const r1 = await recordChainExhaustedStart({ merchantId: 1, amount: 500 });
    const r2 = await recordChainExhaustedStart({ merchantId: 1, amount: 500 });

    assert.deepEqual(r1, { isNew: true });
    assert.deepEqual(r2, { isNew: false });
  });

  it("notification payload includes the triggering merchantId and amount", async () => {
    const notifInserts: Array<unknown[]> = [];

    buildChainExhaustedMocks({
      insertQueue: [
        { conflictNothing: [{ key: "PAYIN_CHAIN_EXHAUSTED_SINCE" }] },
        { plain: [] },
      ],
      selectQueue: [[{ id: 1 }]],
      notificationInserts: notifInserts,
    });

    await recordChainExhaustedStart({ merchantId: 42, amount: 9999 });

    assert.equal(notifInserts.length, 1);
    const rows = notifInserts[0] as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1, "One notification row for one admin");
    assert.equal(rows[0]!.userId, 1);
    assert.equal(rows[0]!.type, "gateway_chain_exhausted");
    const meta = rows[0]!.metadata as Record<string, unknown>;
    assert.equal(meta.triggerMerchantId, 42);
    assert.equal(meta.triggerAmount, 9999);
    assert.ok(
      typeof meta.exhaustedAt === "string" && meta.exhaustedAt.length > 0,
      "exhaustedAt should be a non-empty ISO string in metadata",
    );
  });

  it("sends one notification row per active admin on the first exhaustion", async () => {
    const notifInserts: Array<unknown[]> = [];

    buildChainExhaustedMocks({
      insertQueue: [
        { conflictNothing: [{ key: "PAYIN_CHAIN_EXHAUSTED_SINCE" }] },
        { plain: [] },
      ],
      selectQueue: [[{ id: 10 }, { id: 20 }, { id: 30 }]],
      notificationInserts: notifInserts,
    });

    await recordChainExhaustedStart({ merchantId: 5, amount: 100 });

    const rows = notifInserts[0] as Array<{ userId: number }>;
    assert.equal(rows.length, 3, "One row per admin");
    assert.deepEqual(
      rows.map((r) => r.userId).sort((a, b) => a - b),
      [10, 20, 30],
    );
  });

  it("does NOT notify when there are no active admins even on a new outage", async () => {
    const notifInserts: Array<unknown[]> = [];

    buildChainExhaustedMocks({
      insertQueue: [
        { conflictNothing: [{ key: "PAYIN_CHAIN_EXHAUSTED_SINCE" }] },
      ],
      selectQueue: [[]],   // empty admin list
      notificationInserts: notifInserts,
    });

    const result = await recordChainExhaustedStart({ merchantId: 1, amount: 200 });

    assert.equal(result.isNew, true);
    assert.equal(notifInserts.length, 0, "No notification insert when admin list is empty");
  });

  it("never throws even when the DB insert for notifications fails", async () => {
    buildChainExhaustedMocks({
      insertQueue: [
        { conflictNothing: [{ key: "PAYIN_CHAIN_EXHAUSTED_SINCE" }] },
      ],
      selectQueue: [[{ id: 1 }]],
    });

    // Override: make the notification insert throw
    const realInsert = (db as any).insert;
    let insertCallCount = 0;
    (db as any).insert = (table: unknown) => {
      const callIdx = ++insertCallCount;
      if (callIdx === 1) {
        // First insert is systemConfig — let it succeed via the real mock
        return realInsert(table);
      }
      // Second insert is notifications — simulate failure
      return {
        values: (_vals: unknown) => ({
          returning: () => { throw new Error("notifications insert failed"); },
        }),
      };
    };

    await assert.doesNotReject(
      () => recordChainExhaustedStart({ merchantId: 1, amount: 100, logger: silentLog as any }),
      "Must not propagate notification insert errors",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

// =============================================================================
// recordChainExhaustedStart — new outage fires fresh notification after
// maybeNotifyGatewayRecovery actually clears the marker
// =============================================================================

/**
 * Build the stateful mock set for the three-phase recovery cycle.
 *
 * The key property: `markerPresent` is a mutable flag shared across the mock
 * implementations. Phase-3 can only return isNew=true if `db.delete` actually
 * cleared the flag during phase 2 — removing the delete call from the
 * production helper would cause `markerPresent` to remain true and phase 3
 * would return isNew=false, failing the test.
 *
 *   Phase 1 — recordChainExhaustedStart:
 *     insert.onConflictDoNothing(): markerPresent=false → sets it true, returns [{key}]
 *     select: admin users → [{id:1}]
 *     insert.returning(): outage-1 notification batch
 *
 *   Phase 2 — maybeNotifyGatewayRecovery:
 *     select (idx=1): marker lookup → returns row because markerPresent=true
 *     delete.where(): clears markerPresent=false  ← the critical stateful step
 *     selectDistinct: routing logs → [] (no merchants)
 *     select (idx=2): admin users → [{id:1}]
 *     insert.returning(): recovery notification batch
 *
 *   Phase 3 — recordChainExhaustedStart:
 *     insert.onConflictDoNothing(): markerPresent=false (cleared) → sets it true, returns [{key}]
 *     select: admin users → [{id:1}]
 *     insert.returning(): outage-2 notification batch
 */
function buildRecoveryTestMocks(notificationInserts: Array<unknown[]>) {
  // ── Shared mutable state ──────────────────────────────────────────────────
  let markerPresent = false;
  const markerIso = new Date().toISOString();

  // select call index — used to identify the marker lookup (always selectIdx===1)
  let selectIdx = 0;

  // ── insert mock ───────────────────────────────────────────────────────────
  (db as any).insert = (_table: unknown) => ({
    values: (vals: unknown) => ({
      // onConflictDoNothing path: systemConfigTable marker insert
      onConflictDoNothing: () => ({
        returning: (_fields?: unknown) => {
          if (markerPresent) {
            // Marker already set — conflict, no-op
            return Promise.resolve([]);
          }
          markerPresent = true;
          return Promise.resolve([{ key: "PAYIN_CHAIN_EXHAUSTED_SINCE" }]);
        },
      }),
      // Plain returning path: notificationsTable insert (via createBulkNotifications)
      returning: () => {
        notificationInserts.push(vals as unknown[]);
        return Promise.resolve([]);
      },
    }),
  });

  // ── select mock ───────────────────────────────────────────────────────────
  (db as any).select = (_fields?: unknown) => {
    const idx = selectIdx++;
    return {
      from: () => ({
        where: (_cond: unknown) => {
          // idx===1 is maybeNotifyGatewayRecovery's systemConfig marker lookup.
          // All other selects are admin-user queries.
          let rows: Array<Record<string, unknown>>;
          if (idx === 1) {
            rows = markerPresent
              ? [{ key: "PAYIN_CHAIN_EXHAUSTED_SINCE", value: markerIso }]
              : [];
          } else {
            rows = [{ id: 1 }];
          }
          const p = Promise.resolve(rows);
          return Object.assign(p, { limit: (_n: number) => Promise.resolve(rows) });
        },
      }),
    };
  };

  // ── selectDistinct mock (routing logs, no merchants affected) ─────────────
  (db as any).selectDistinct = () => ({
    from: () => ({
      where: () => Promise.resolve([]),
    }),
  });

  // ── delete mock — THIS IS THE CRITICAL STEP ───────────────────────────────
  // Only when db.delete is called does markerPresent get cleared.
  // If maybeNotifyGatewayRecovery is changed to skip the delete, phase 3
  // will still see markerPresent=true and return { isNew: false }, failing
  // the assertion below.
  (db as any).delete = () => ({
    where: () => {
      markerPresent = false;
      return Promise.resolve();
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("recordChainExhaustedStart — new outage fires fresh notification after maybeNotifyGatewayRecovery", () => {
  it("fires a second notification when maybeNotifyGatewayRecovery clears the marker", async () => {
    const notifInserts: Array<unknown[]> = [];
    buildRecoveryTestMocks(notifInserts);

    // Phase 1: outage starts
    const r1 = await recordChainExhaustedStart({
      merchantId: 10,
      amount: 500,
      logger: silentLog as any,
    });
    assert.equal(r1.isNew, true, "Phase 1 should be a new outage");

    // Phase 2: recovery — actually calls maybeNotifyGatewayRecovery which deletes the marker
    await maybeNotifyGatewayRecovery(silentLog as any);

    // Phase 3: new outage after marker was cleared by recovery
    const r2 = await recordChainExhaustedStart({
      merchantId: 11,
      amount: 750,
      logger: silentLog as any,
    });
    assert.equal(r2.isNew, true, "Phase 3 should be a new outage (marker was cleared by recovery)");

    // 3 notification batches: outage-1 alert + recovery admin alert + outage-2 alert
    assert.equal(notifInserts.length, 3, "Three notification batches: outage1 + recovery + outage2");
  });

  it("recovery notification has type gateway_recovered", async () => {
    const notifInserts: Array<unknown[]> = [];
    buildRecoveryTestMocks(notifInserts);

    await recordChainExhaustedStart({ merchantId: 10, amount: 500 });
    await maybeNotifyGatewayRecovery(silentLog as any);
    await recordChainExhaustedStart({ merchantId: 11, amount: 750 });

    // notifInserts[1] is the recovery batch (index 0=outage1, 1=recovery, 2=outage2)
    const recoveryBatch = notifInserts[1] as Array<Record<string, unknown>>;
    assert.ok(recoveryBatch.length > 0, "Recovery notification batch should not be empty");
    assert.equal(recoveryBatch[0]!.type, "gateway_recovered");
  });

  it("outage-2 alert carries the new merchant's id and amount", async () => {
    const notifInserts: Array<unknown[]> = [];
    buildRecoveryTestMocks(notifInserts);

    await recordChainExhaustedStart({ merchantId: 10, amount: 500 });
    await maybeNotifyGatewayRecovery(silentLog as any);
    await recordChainExhaustedStart({ merchantId: 99, amount: 8888 });

    const outage1Batch = notifInserts[0] as Array<Record<string, unknown>>;
    const outage2Batch = notifInserts[2] as Array<Record<string, unknown>>;

    const meta1 = outage1Batch[0]!.metadata as Record<string, unknown>;
    const meta2 = outage2Batch[0]!.metadata as Record<string, unknown>;

    assert.equal(meta1.triggerMerchantId, 10);
    assert.equal(meta1.triggerAmount, 500);
    assert.equal(meta2.triggerMerchantId, 99);
    assert.equal(meta2.triggerAmount, 8888);

    assert.ok(typeof meta1.exhaustedAt === "string" && meta1.exhaustedAt.length > 0);
    assert.ok(typeof meta2.exhaustedAt === "string" && meta2.exhaustedAt.length > 0);
  });
});

// =============================================================================
// buildFailoverEventList — the production merge helper used by the route
// =============================================================================

/**
 * These tests exercise buildFailoverEventList directly — the same function
 * the /api/smart-routing/failover-events route calls. Any regression in
 * event-kind mapping, per-admin dedup, sort order, or recovery correlation
 * will be caught here rather than through a local replica.
 */
describe("buildFailoverEventList — both chain_exhausted and threshold_alert", () => {
  type ChainRow = { id: number; metadata: Record<string, unknown> | null; createdAt: Date };
  type RecovRow = { metadata: Record<string, unknown> | null; createdAt: Date };

  it("includes both chain_exhausted and threshold_alert when both types are present", () => {
    const t1 = new Date("2026-08-01T10:00:00.000Z");
    const t2 = new Date("2026-08-01T11:00:00.000Z");

    const events = buildFailoverEventList({
      chainRows: [{ id: 10, metadata: { triggerMerchantId: 5, exhaustedAt: t1.toISOString() }, createdAt: t1 }],
      thresholdRows: [{ id: 20, metadata: { failureCount: 7, windowMinutes: 60, triggerMerchantId: 3 }, createdAt: t2 }],
      recoveryRows: [],
    });

    assert.equal(events.length, 2, "Both event kinds should appear");
    assert.equal(events.filter(e => e.eventKind === "chain_exhausted").length, 1);
    assert.equal(events.filter(e => e.eventKind === "threshold_alert").length, 1);
  });

  it("deduplicates per-admin notification rows (same event, two admin recipients)", () => {
    const t = new Date("2026-08-02T09:00:00.000Z");

    const events = buildFailoverEventList({
      chainRows: [
        { id: 10, metadata: { triggerMerchantId: 5, exhaustedAt: t.toISOString() }, createdAt: t },
        { id: 11, metadata: { triggerMerchantId: 5, exhaustedAt: t.toISOString() }, createdAt: t }, // same event, second admin
      ],
      thresholdRows: [
        { id: 20, metadata: { failureCount: 8, triggerMerchantId: 3 }, createdAt: t },
        { id: 21, metadata: { failureCount: 8, triggerMerchantId: 3 }, createdAt: t }, // same event, second admin
      ],
      recoveryRows: [],
    });

    assert.equal(events.length, 2, "Four rows should collapse to two events (one per kind)");
    assert.equal(events.find(e => e.eventKind === "chain_exhausted")!.id, 10, "First row id kept for chain");
    assert.equal(events.find(e => e.eventKind === "threshold_alert")!.id, 20, "First row id kept for threshold");
  });

  it("two distinct chain_exhausted events (different merchants) are NOT collapsed", () => {
    const t1 = new Date("2026-08-01T08:00:00.000Z");
    const t2 = new Date("2026-08-01T09:00:00.000Z");

    const events = buildFailoverEventList({
      chainRows: [
        { id: 1, metadata: { triggerMerchantId: 1, exhaustedAt: t1.toISOString() }, createdAt: t1 },
        { id: 2, metadata: { triggerMerchantId: 2, exhaustedAt: t2.toISOString() }, createdAt: t2 },
      ],
      thresholdRows: [],
      recoveryRows: [],
    });

    assert.equal(events.length, 2, "Different merchants → different events, not deduped");
  });

  it("events are sorted newest-first", () => {
    const older = new Date("2026-08-01T08:00:00.000Z");
    const newer = new Date("2026-08-01T10:00:00.000Z");

    const events = buildFailoverEventList({
      chainRows: [{ id: 1, metadata: { triggerMerchantId: 1, exhaustedAt: older.toISOString() }, createdAt: older }],
      thresholdRows: [{ id: 2, metadata: { failureCount: 5, triggerMerchantId: 1 }, createdAt: newer }],
      recoveryRows: [],
    });

    assert.equal(events[0]!.eventKind, "threshold_alert", "Newer threshold_alert should come first");
    assert.equal(events[1]!.eventKind, "chain_exhausted", "Older chain_exhausted should come second");
  });

  it("returns empty list when both sources are empty", () => {
    const events = buildFailoverEventList({ chainRows: [], thresholdRows: [], recoveryRows: [] });
    assert.equal(events.length, 0);
  });

  it("handles threshold_alert with no triggerMerchantId in metadata (uses 0 as fallback key)", () => {
    const t = new Date("2026-08-01T12:00:00.000Z");
    const events = buildFailoverEventList({
      chainRows: [],
      thresholdRows: [
        { id: 30, metadata: { failureCount: 6 }, createdAt: t },
        { id: 31, metadata: { failureCount: 6 }, createdAt: t }, // same event, different admin
      ],
      recoveryRows: [],
    });
    assert.equal(events.length, 1, "Rows with no triggerMerchantId should still dedup correctly");
    assert.equal(events[0]!.id, 30);
  });

  it("chain_exhausted and threshold_alert with identical timestamp have distinct dedup keys", () => {
    const t = new Date("2026-08-03T07:00:00.000Z");

    const events = buildFailoverEventList({
      chainRows: [{ id: 100, metadata: { triggerMerchantId: 7, triggerAmount: 2500, exhaustedAt: t.toISOString() }, createdAt: t }],
      thresholdRows: [{ id: 200, metadata: { failureCount: 12, windowMinutes: 30, triggerMerchantId: 7, outageStartedAt: t.toISOString() }, createdAt: t }],
      recoveryRows: [],
    });

    assert.equal(events.length, 2, "Same timestamp must not collapse chain vs threshold");
    assert.equal(events.find(e => e.eventKind === "chain_exhausted")!.id, 100);
    assert.equal(events.find(e => e.eventKind === "threshold_alert")!.id, 200);
  });

  it("chain_exhausted status is resolved when exhaustedAt matches a recovery row outageStartedAt", () => {
    const exhaustedAt = "2026-08-04T06:00:00.000Z";
    const createdAt = new Date(exhaustedAt);
    const recoveredAt = "2026-08-04T06:30:00.000Z";

    const events = buildFailoverEventList({
      chainRows: [{ id: 1, metadata: { triggerMerchantId: 5, exhaustedAt }, createdAt }],
      thresholdRows: [],
      recoveryRows: [{ metadata: { outageStartedAt: exhaustedAt, recoveredAt, durationSeconds: 1800 }, createdAt: new Date(recoveredAt) }] as RecovRow[],
      now: new Date(recoveredAt).getTime() + 1000,
    });

    assert.equal(events.length, 1);
    assert.equal(events[0]!.status, "resolved");
    assert.equal(events[0]!.resolvedAt, recoveredAt);
    assert.equal(events[0]!.durationSeconds, 1800);
  });

  it("threshold_alert status is resolved when outageStartedAt matches a recovery row", () => {
    const outageStartedAt = "2026-08-04T07:00:00.000Z";
    const createdAt = new Date(outageStartedAt);
    const recoveredAt = "2026-08-04T07:45:00.000Z";

    const events = buildFailoverEventList({
      chainRows: [],
      thresholdRows: [{ id: 1, metadata: { failureCount: 9, windowMinutes: 60, triggerMerchantId: 3, outageStartedAt }, createdAt }],
      recoveryRows: [{ metadata: { outageStartedAt, recoveredAt, durationSeconds: 2700 }, createdAt: new Date(recoveredAt) }] as RecovRow[],
      now: new Date(recoveredAt).getTime() + 1000,
    });

    assert.equal(events[0]!.status, "resolved");
    assert.equal(events[0]!.resolvedAt, recoveredAt);
    assert.equal(events[0]!.durationSeconds, 2700);
  });

  it("status is ongoing when no recovery row matches and event is recent", () => {
    const recentTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago

    const events = buildFailoverEventList({
      chainRows: [{ id: 1, metadata: { triggerMerchantId: 1, exhaustedAt: recentTime.toISOString() }, createdAt: recentTime }],
      thresholdRows: [],
      recoveryRows: [],
      now: Date.now(),
    });

    assert.equal(events[0]!.status, "ongoing");
    assert.equal(events[0]!.resolvedAt, null);
  });

  it("status becomes resolved (stale auto-close) when event is older than 2 hours with no recovery", () => {
    const staleTime = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 hours ago

    const events = buildFailoverEventList({
      chainRows: [{ id: 1, metadata: { triggerMerchantId: 1, exhaustedAt: staleTime.toISOString() }, createdAt: staleTime }],
      thresholdRows: [],
      recoveryRows: [],
      now: Date.now(),
    });

    assert.equal(events[0]!.status, "resolved", "Events older than 2h with no recovery are auto-closed");
    assert.ok(events[0]!.note?.includes("Auto-closed"), "Note should mention auto-close");
  });

  it("chain_exhausted without exhaustedAt in metadata stays ongoing (no recovery key to match)", () => {
    const recentTime = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

    const events = buildFailoverEventList({
      chainRows: [{ id: 1, metadata: { triggerMerchantId: 1 /* no exhaustedAt */ }, createdAt: recentTime }],
      thresholdRows: [],
      recoveryRows: [{ metadata: { outageStartedAt: "2026-01-01T00:00:00.000Z", recoveredAt: "2026-01-01T01:00:00.000Z", durationSeconds: 3600 }, createdAt: new Date() }] as RecovRow[],
      now: Date.now(),
    });

    // No exhaustedAt → recovery lookup returns null → event stays ongoing (recent)
    assert.equal(events[0]!.status, "ongoing");
  });
});
