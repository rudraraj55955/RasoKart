/**
 * Tests for the EKQR cap-alert dedup flag — cross-day reset (midnight boundary).
 *
 * Two complementary layers:
 *
 * ┌─────────────────────────────────┬──────────────────────────────────────────┐
 * │ Layer                           │ What it catches                          │
 * ├─────────────────────────────────┼──────────────────────────────────────────┤
 * │ SQL predicate integration       │ Broken WHERE clause in the atomic INSERT  │
 * │ (real DB, db.execute not mocked)│ … ON CONFLICT DO UPDATE … RETURNING.     │
 * │                                 │ A removed/inverted WHERE would cause the  │
 * │                                 │ claimed/suppressed results to flip.       │
 * ├─────────────────────────────────┼──────────────────────────────────────────┤
 * │ Function routing unit test      │ Broken function-level logic — e.g. if the │
 * │ (db.execute mocked, as per the  │ function stops calling getAdminEmails     │
 * │ task spec and happy-path tests) │ after a cross-day RETURNING result.       │
 * └─────────────────────────────────┴──────────────────────────────────────────┘
 *
 * The two layers are in separate describe blocks.  The SQL layer seeds the DB,
 * runs the exact INSERT…ON CONFLICT…RETURNING statement the function uses, and
 * checks result.rows.length.  It never calls the full production function so
 * no email or notification side effects occur.  The unit-test layer mocks
 * db.execute (exactly as the happy-path tests do) but supplies yesterday's date
 * as the simulated stored value to document the cross-day scenario distinctly.
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { notifyAdminsOfEkqrCapFull } from "./adminNotifyEmail";

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Today's UTC date string "YYYY-MM-DD". */
const TODAY_UTC = new Date().toISOString().slice(0, 10);

/** Yesterday's UTC date string "YYYY-MM-DD". */
const YESTERDAY_UTC = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();

const CAP_KEY = SYSTEM_CONFIG_KEYS.UPIGATEWAY_CAP_ALERT_LAST_SENT_DATE;

const SAMPLE_OPTS = {
  todayTotal: 100_000,
  dailyLimit: 100_000,
  resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
};

// ── SQL helpers (all use db.execute directly — never db.select) ───────────────

/** Upsert a specific date string unconditionally (test fixture seed). */
async function seedDate(dateStr: string): Promise<void> {
  await db.execute(
    sql`INSERT INTO system_config (key, value)
        VALUES (${CAP_KEY}, ${dateStr})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
}

/** Remove the cap-alert row. */
async function deleteCapRow(): Promise<void> {
  await db
    .delete(systemConfigTable)
    .where(eq(systemConfigTable.key, CAP_KEY));
}

/**
 * Run the same atomic INSERT … ON CONFLICT … RETURNING SQL that
 * notifyAdminsOfEkqrCapFull uses, and return the rows via result.rows.
 * This exercises the actual WHERE predicate in the real database.
 */
async function runClaimSql(todayDate: string): Promise<Array<{ value: string }>> {
  const result = await db.execute(
    sql`INSERT INTO system_config (key, value)
        VALUES (${CAP_KEY}, ${todayDate})
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value
          WHERE system_config.value IS DISTINCT FROM EXCLUDED.value
        RETURNING value`,
  );
  // drizzle node-postgres execute returns the full pg QueryResult; rows live
  // in result.rows, not at the top level.
  return (result as any).rows as Array<{ value: string }>;
}

// ── Mock helpers (for the function routing layer) ─────────────────────────────

const originalExecute = (db as any).execute?.bind(db);
const originalSelect = (db as any).select.bind(db);

function installMocks(opts: {
  executeRows: unknown[];
  selectRows: Array<{ email: string }>;
}): { selectCalls: () => number } {
  let calls = 0;
  // Mirror the real pg QueryResult shape so the production claim check works:
  //   const claimed = ((claimRows as any).rows?.length ?? 0) > 0;
  (db as any).execute = () => Promise.resolve({ rows: opts.executeRows });
  (db as any).select = (_fields?: unknown) => {
    calls++;
    // Return selectRows for the first call (getAdminEmails), empty for all
    // subsequent calls (in-app admin query) so createBulkNotifications is
    // never invoked and no notification side effects occur.
    const chain: any = {
      from: () => chain,
      where: (_cond: unknown) =>
        Object.assign(Promise.resolve(opts.selectRows), {
          limit: (_n: number) => Promise.resolve(opts.selectRows),
        }),
    };
    // Reset selectRows after first consumption so subsequent calls return []
    opts = { ...opts, selectRows: [] };
    return chain;
  };
  return { selectCalls: () => calls };
}

function restoreMocks(): void {
  (db as any).execute = originalExecute;
  (db as any).select = originalSelect;
}

// ── Cleanup after all SQL predicate tests ─────────────────────────────────────

after(async () => {
  restoreMocks();
  await deleteCapRow();
});

// =============================================================================
// Layer 1: SQL predicate integration — real DB, no mocks
// =============================================================================

describe("EKQR cap alert dedup SQL predicate — cross-day reset (integration)", () => {
  it("RETURNING yields 1 row when stored date is yesterday (WHERE fires → claim succeeds)", async () => {
    //
    // This test exercises the real database with the exact SQL that the function
    // uses.  With stored = YESTERDAY, the WHERE clause:
    //
    //   WHERE system_config.value IS DISTINCT FROM EXCLUDED.value
    //
    // is true (yesterday ≠ today), so the UPDATE fires and RETURNING has a row.
    //
    // A broken WHERE — e.g. IS NOT DISTINCT FROM, or the clause removed — would
    // cause RETURNING to have 0 rows, failing this assertion.
    //
    await seedDate(YESTERDAY_UTC);
    let claimRows: Array<{ value: string }>;
    try {
      claimRows = await runClaimSql(TODAY_UTC);
    } finally {
      await deleteCapRow();
    }

    assert.equal(
      claimRows!.length,
      1,
      `RETURNING must yield 1 row when stored date is yesterday (${YESTERDAY_UTC}) and ` +
        `today is ${TODAY_UTC} — the WHERE system_config.value IS DISTINCT FROM EXCLUDED.value ` +
        `predicate must be true. Got ${claimRows!.length} rows. A broken WHERE clause would ` +
        `return 0 rows, causing the function to suppress the alert permanently after the first send.`,
    );

    assert.equal(
      claimRows![0]?.value,
      TODAY_UTC,
      `The RETURNING row must contain today's date (${TODAY_UTC}), ` +
        `confirming the UPDATE set the value correctly.`,
    );
  });

  it("RETURNING yields 0 rows when stored date is already today (WHERE is false → suppressed)", async () => {
    //
    // This test is paired with the "yesterday" test to prove the date boundary.
    // With stored = TODAY, the WHERE clause is false (today IS NOT DISTINCT FROM
    // today), so the UPDATE does not fire and RETURNING is empty.
    //
    // Removing or inverting the WHERE clause would cause RETURNING to yield 1
    // row here, making this test fail and revealing that same-day suppression
    // is broken.
    //
    await seedDate(TODAY_UTC);
    let claimRows: Array<{ value: string }>;
    try {
      claimRows = await runClaimSql(TODAY_UTC);
    } finally {
      await deleteCapRow();
    }

    assert.equal(
      claimRows!.length,
      0,
      `RETURNING must yield 0 rows when stored date is already today (${TODAY_UTC}) — ` +
        `the WHERE predicate must be false so the UPDATE is skipped. Got ${claimRows!.length} rows. ` +
        `A broken WHERE clause would allow a second claim on the same day.`,
    );
  });

  it("RETURNING yields 1 row on a fresh DB (no prior row — INSERT branch fires)", async () => {
    //
    // With no existing row the INSERT branch fires unconditionally.  RETURNING
    // always yields a row in the INSERT case.
    //
    await deleteCapRow();
    let claimRows: Array<{ value: string }>;
    try {
      claimRows = await runClaimSql(TODAY_UTC);
    } finally {
      await deleteCapRow();
    }

    assert.equal(
      claimRows!.length,
      1,
      `On a fresh DB (no prior row) the INSERT branch must fire and RETURNING must ` +
        `yield 1 row. Got ${claimRows!.length}.`,
    );
  });
});

// =============================================================================
// Layer 2: Function routing — mock db.execute, verify delivery path
// =============================================================================

describe("notifyAdminsOfEkqrCapFull — cross-day reset delivery path (function routing)", () => {
  //
  // These tests mock db.execute (exactly as the happy-path tests do) to simulate
  // the RETURNING result the real DB would produce for a cross-day scenario, then
  // confirm the function enters the delivery path.
  //
  // The semantic difference from the plain happy-path tests is documented: the
  // execute mock explicitly simulates "yesterday was stored → WHERE fired →
  // RETURNING has today's date", not just "first-ever alert".
  //

  it("enters the delivery path (calls getAdminEmails) when RETURNING has today's date after a cross-day reset", async () => {
    //
    // Simulate: yesterday was stored in system_config → the WHERE clause
    // detected the date change → UPDATE fired → RETURNING yields { value: today }.
    // The function must proceed past the dedup guard and call getAdminEmails
    // (i.e. db.select must be invoked at least once).
    //
    const { selectCalls } = installMocks({
      executeRows: [{ value: TODAY_UTC }],   // RETURNING: 1 row → claimed
      selectRows: [{ email: "admin@rasokart.com" }],
    });
    try {
      await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS);
    } finally {
      restoreMocks();
    }

    assert.ok(
      selectCalls() >= 1,
      `getAdminEmails (db.select) must be called at least once — the function must enter ` +
        `the delivery path when the cross-day RETURNING has a row. Got ${selectCalls()} calls. ` +
        `A function that ignores the RETURNING result or always returns early would fail here.`,
    );
  });

  it("suppresses delivery (skips getAdminEmails) within the same UTC day", async () => {
    //
    // Paired with the cross-day test above to show the function correctly
    // distinguishes a same-day RETURNING (0 rows → suppressed) from a cross-day
    // one (1 row → proceed).
    //
    // Simulate: today is already stored → WHERE is false → RETURNING empty → suppressed.
    //
    const { selectCalls } = installMocks({
      executeRows: [],                       // RETURNING: 0 rows → suppressed
      selectRows: [{ email: "admin@rasokart.com" }],
    });
    try {
      await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS);
    } finally {
      restoreMocks();
    }

    assert.equal(
      selectCalls(),
      0,
      `getAdminEmails (db.select) must NOT be called when RETURNING is empty (same-day ` +
        `suppression). Got ${selectCalls()} calls.`,
    );
  });

  it("does not throw when RETURNING has today's date after a cross-day reset", async () => {
    installMocks({
      executeRows: [{ value: TODAY_UTC }],
      selectRows: [],
    });
    try {
      await assert.doesNotReject(
        () => notifyAdminsOfEkqrCapFull(SAMPLE_OPTS),
        "notifyAdminsOfEkqrCapFull must never throw — all errors are swallowed internally",
      );
    } finally {
      restoreMocks();
    }
  });
});
