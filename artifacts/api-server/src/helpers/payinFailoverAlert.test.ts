/**
 * Unit tests for maybeFireFailoverAlert
 *
 * Covers:
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
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { maybeFireFailoverAlert } from "./payinFailoverAlert";

// ── Silence the logger in tests ───────────────────────────────────────────────
const silentLog = {
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

afterEach(() => {
  (db as any).select = originalSelect;
  (db as any).insert = originalInsert;
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
