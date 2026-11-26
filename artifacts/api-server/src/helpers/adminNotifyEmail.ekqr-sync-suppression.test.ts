/**
 * Behavioral unit tests — cooldown suppression path for notifyAdminsOfStuckEkqrQrCodes.
 *
 * Why this file exists:
 *   notifyAdminsOfStuckEkqrQrCodes reads the last-sent timestamp via db.select +
 *   db.insert/db.insert(onConflictDoUpdate), NOT via the atomic db.execute pattern
 *   used by notifyAdminsOfEkqrCapFull. If mocks ever drifted from the real
 *   implementation the cooldown suppression tests would silently stop exercising
 *   the real code path, allowing a spam regression to go undetected.
 *
 * Covers:
 *   1. Alert is suppressed when lastSentAt is within the cooldown window
 *   2. A suppression log row is written to ekqrSyncAlertLogsTable (suppressed=true)
 *   3. The systemConfig last-sent key is NOT updated when suppressed
 *   4. sendMail is never called when suppressed
 *   5. Alert is NOT suppressed when there is no prior record (first-ever send)
 *   6. Alert is NOT suppressed when lastSentAt is outside the cooldown window
 *   7. The boundary condition (just-expired cooldown) is handled correctly
 *   8. The function never throws — errors are swallowed internally
 *
 * Mocking strategy:
 *   db.select  is mocked with sequential responses — first call serves getAdminEmails,
 *              second call serves the cooldown timestamp read (.limit(1) path).
 *              Any further calls return [] (safe fallback).
 *   db.insert  is mocked to capture { table, values } without touching a real DB.
 *   _sendMail  is injected as a spy stub (no real SMTP is ever attempted).
 *
 * Table-identity assertions:
 *   The insert mock captures the table reference passed to db.insert(table). Tests
 *   assert the table object is the real ekqrSyncAlertLogsTable or systemConfigTable
 *   exported from @workspace/db, not just a matching values shape.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db, ekqrSyncAlertLogsTable, systemConfigTable } from "@workspace/db";
import { notifyAdminsOfStuckEkqrQrCodes } from "./adminNotifyEmail";

// ── DB mock helpers ─────────────────────────────────────────────────────────────

/**
 * Build a chainable db.select mock that consumes `selectResponses` in order.
 * Handles both:
 *   await db.select().from().where()           — getAdminEmails path
 *   await db.select().from().where().limit(n)  — cooldown timestamp read path
 * Any call beyond the provided responses returns [] (safe fallback).
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
 * Supports:
 *   db.insert(table).values(vals)                         — plain insert
 *   db.insert(table).values(vals).onConflictDoUpdate(...) — upsert
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

/** A stub sendMail that records calls without touching SMTP. */
function buildSendSpy(log: unknown[]) {
  return async (args: unknown): Promise<boolean> => {
    log.push(args);
    return true;
  };
}

/** A stub sendMail that always returns false (simulates SMTP failure). */
const failSend = async (_args: unknown): Promise<boolean> => false;

// ── Save originals for teardown ─────────────────────────────────────────────────

const originalSelect = (db as any).select?.bind(db);
const originalInsert = (db as any).insert?.bind(db);

afterEach(() => {
  if (originalSelect) (db as any).select = originalSelect;
  if (originalInsert) (db as any).insert = originalInsert;
});

// ── Shared fixture ──────────────────────────────────────────────────────────────

const SAMPLE_OPTS = {
  stuck: 5,
  threshold: 3,
  staleMinutes: 30,
  cooldownHours: 4,
};

/** Timestamp clearly within the cooldown window (30 minutes ago, window is 4 hours). */
const RECENT_TIMESTAMP = new Date(Date.now() - 30 * 60 * 1000).toISOString();

/** Timestamp clearly outside the cooldown window (5 hours ago, window is 4 hours). */
const OLD_TIMESTAMP = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("notifyAdminsOfStuckEkqrQrCodes — cooldown suppression", () => {

  // ── Suppressed within window ────────────────────────────────────────────────

  it("suppresses the alert when lastSentAt is within the cooldown window", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: RECENT_TIMESTAMP }],
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, buildSendSpy(sendCalls));

    assert.equal(sendCalls.length, 0, "sendMail must not be called when within cooldown window");
    assert.equal(insertLog.length, 1, "Only the suppression log insert should fire");
    const row = insertLog[0]!.values as Record<string, unknown>;
    assert.equal(row["suppressed"], true, "Log row must have suppressed=true");
  });

  it("writes a suppression log row to ekqrSyncAlertLogsTable (not systemConfigTable) when suppressed", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: RECENT_TIMESTAMP }],
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend);

    assert.equal(insertLog.length, 1, "Exactly one insert when suppressed");
    // Table-identity assertion: must target ekqrSyncAlertLogsTable, not systemConfigTable
    assert.strictEqual(
      insertLog[0]!.table,
      ekqrSyncAlertLogsTable,
      "Insert must target ekqrSyncAlertLogsTable, not systemConfigTable or any other table"
    );
  });

  it("suppression log row carries the correct fields", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: RECENT_TIMESTAMP }],
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend);

    const row = insertLog[0]!.values as Record<string, unknown>;
    assert.equal(row["suppressed"], true);
    assert.equal(row["stuckCount"], SAMPLE_OPTS.stuck);
    assert.equal(row["threshold"], SAMPLE_OPTS.threshold);
    assert.equal(row["staleMinutes"], SAMPLE_OPTS.staleMinutes);
    assert.equal(row["cooldownHours"], SAMPLE_OPTS.cooldownHours);
    assert.equal(row["recipientCount"], 0);
    assert.deepEqual(row["recipientEmails"], []);
  });

  it("does NOT update the systemConfig last-sent key when suppressed", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: RECENT_TIMESTAMP }],
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend);

    const systemConfigInserts = insertLog.filter(e => e.table === systemConfigTable);
    assert.equal(
      systemConfigInserts.length,
      0,
      "systemConfig last-sent key must NOT be updated when suppressed"
    );
  });

  // ── Not suppressed — no prior record ───────────────────────────────────────

  it("does NOT suppress and calls sendMail when there is no prior record", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [], // no prior last-sent record
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, buildSendSpy(sendCalls));

    assert.equal(sendCalls.length, 1, "sendMail must be called once for the opted-in admin");
    // No suppressed=true log row must exist
    const suppressedRows = insertLog.filter(e => {
      const v = e.values as Record<string, unknown>;
      return e.table === ekqrSyncAlertLogsTable && v["suppressed"] === true;
    });
    assert.equal(suppressedRows.length, 0, "No suppressed=true log row when not suppressed");
  });

  it("writes a suppressed=false log row to ekqrSyncAlertLogsTable when not suppressed", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [],
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, buildSendSpy([]));

    const logRow = insertLog.find(e => {
      const v = e.values as Record<string, unknown>;
      return e.table === ekqrSyncAlertLogsTable && v["suppressed"] === false;
    });
    assert.ok(logRow !== undefined, "A suppressed=false log row must be inserted when cooldown clears");
  });

  it("updates the systemConfig last-sent key when mail is sent successfully", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [],
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, buildSendSpy([]));

    const systemConfigInserts = insertLog.filter(e => e.table === systemConfigTable);
    assert.equal(
      systemConfigInserts.length,
      1,
      "systemConfig last-sent key must be upserted after a successful send"
    );
  });

  it("does NOT update systemConfig when every sendMail call fails (sent=0)", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [],
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);

    // failSend returns false → sent=0 → `if (sent > 0)` guard prevents systemConfig upsert
    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend);

    const systemConfigInserts = insertLog.filter(e => e.table === systemConfigTable);
    assert.equal(
      systemConfigInserts.length,
      0,
      "systemConfig last-sent key must NOT be upserted when all sends fail"
    );
  });

  // ── Not suppressed — expired cooldown ──────────────────────────────────────

  it("does NOT suppress when lastSentAt is outside the cooldown window", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: OLD_TIMESTAMP }],
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, buildSendSpy(sendCalls));

    assert.equal(sendCalls.length, 1, "sendMail must be called when the cooldown has expired");
    const suppressedRows = insertLog.filter(e => {
      const v = e.values as Record<string, unknown>;
      return e.table === ekqrSyncAlertLogsTable && v["suppressed"] === true;
    });
    assert.equal(suppressedRows.length, 0, "No suppressed=true row when cooldown has expired");
  });

  it("suppresses only with an in-window timestamp, not a just-expired one", async () => {
    // 1 ms past the window — lastSentAt <= cooldownCutoff, so NOT suppressed
    const justExpired = new Date(
      Date.now() - SAMPLE_OPTS.cooldownHours * 60 * 60 * 1000 - 1
    ).toISOString();

    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: justExpired }],
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, buildSendSpy(sendCalls));

    assert.equal(sendCalls.length, 1, "sendMail must fire when the cooldown just expired");
    const suppressedRows = insertLog.filter(e => {
      const v = e.values as Record<string, unknown>;
      return e.table === ekqrSyncAlertLogsTable && v["suppressed"] === true;
    });
    assert.equal(suppressedRows.length, 0, "A just-expired cooldown must NOT trigger suppression");
  });

  // ── Never-throws contract ───────────────────────────────────────────────────

  it("never throws when the suppressed path is taken", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: RECENT_TIMESTAMP }],
    ]);
    buildInsertMock([]);

    await assert.doesNotReject(
      () => notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend),
      "notifyAdminsOfStuckEkqrQrCodes must never throw — errors are swallowed internally"
    );
  });

  it("never throws when the non-suppressed path is taken", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [],
    ]);
    buildInsertMock([]);

    await assert.doesNotReject(
      () => notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend),
      "notifyAdminsOfStuckEkqrQrCodes must never throw when cooldown check passes"
    );
  });

  it("never throws when db.select rejects (DB connectivity error)", async () => {
    // Return a chainable builder that rejects at the terminal .where() step so
    // the chain can be constructed before the rejection surfaces inside the
    // function's try/catch. A bare Promise.reject() would synchronously throw
    // on the .from() call, leaving the original rejected Promise unhandled.
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
      () => notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend),
      "notifyAdminsOfStuckEkqrQrCodes must swallow DB errors and not propagate"
    );
  });

  it("never throws when db.insert rejects during suppression log write", async () => {
    buildSelectMock([
      [{ email: "admin@rasokart.com" }],
      [{ value: RECENT_TIMESTAMP }],
    ]);
    (db as any).insert = () => ({
      values: () => Promise.reject(new Error("simulated insert error")),
    });

    await assert.doesNotReject(
      () => notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend),
      "notifyAdminsOfStuckEkqrQrCodes must swallow insert errors and not propagate"
    );
  });
});

// ── All admins opted out ────────────────────────────────────────────────────────
//
// When getAdminEmails returns [] the function must return immediately at the
// zero-recipient guard (adminNotifyEmail.ts line 802-805) without ever:
//   - reading the cooldown timestamp (second db.select)
//   - inserting into ekqrSyncAlertLogsTable (neither suppressed nor send log)
//   - upserting the systemConfig last-sent key
//   - calling sendMail
//
// This is the critical behavioural contract for Task #2471.  Every test below
// seeds the first selectResponse as [] to simulate all admins having
// ekqr_sync_alert_emails = false.

describe("notifyAdminsOfStuckEkqrQrCodes — all admins opted out", () => {

  it("does not call sendMail when all admins have opted out", async () => {
    buildSelectMock([
      [], // getAdminEmails → zero opted-in recipients
    ]);
    buildInsertMock([]);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, buildSendSpy(sendCalls));

    assert.equal(
      sendCalls.length,
      0,
      "sendMail must never be called when no admins are opted in",
    );
  });

  it("makes no DB inserts when all admins have opted out", async () => {
    buildSelectMock([
      [], // getAdminEmails → zero recipients
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend);

    assert.equal(
      insertLog.length,
      0,
      "No inserts (suppression log, send log, or systemConfig update) must occur when all admins have opted out",
    );
  });

  it("does not update the systemConfig last-sent key when all admins have opted out", async () => {
    buildSelectMock([
      [], // getAdminEmails → zero recipients
    ]);
    const insertLog: Array<{ table: unknown; values: unknown }> = [];
    buildInsertMock(insertLog);

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend);

    const systemConfigInserts = insertLog.filter(e => e.table === systemConfigTable);
    assert.equal(
      systemConfigInserts.length,
      0,
      "systemConfig last-sent key must NOT be touched when all admins have opted out",
    );
  });

  it("skips the cooldown check entirely when all admins have opted out", async () => {
    // Track how many times db.select is called.
    // The zero-recipient guard fires after the FIRST select (getAdminEmails).
    // The cooldown check would require a SECOND select.
    // If the count stays at 1 the guard fired before cooldown was consulted.
    let selectCallCount = 0;
    (db as any).select = (_fields?: unknown) => {
      selectCallCount++;
      const rows = selectCallCount === 1 ? [] : [{ value: RECENT_TIMESTAMP }];
      const chain: any = {
        from: () => chain,
        where: (_cond: unknown) =>
          Object.assign(Promise.resolve(rows), {
            limit: (_n: number) => Promise.resolve(rows),
          }),
      };
      return chain;
    };
    buildInsertMock([]);

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend);

    assert.equal(
      selectCallCount,
      1,
      "Only one db.select call (getAdminEmails) must occur; cooldown check must be skipped when no recipients",
    );
  });

  it("does not fire even when the cooldown has fully expired and all admins have opted out", async () => {
    // Simulate: cooldown expired (old timestamp would normally allow a send),
    // but all admins opted out → still no send.
    buildSelectMock([
      [], // getAdminEmails → zero recipients (cooldown check is never reached)
      [{ value: OLD_TIMESTAMP }], // would be the cooldown row — never consumed
    ]);
    buildInsertMock([]);
    const sendCalls: unknown[] = [];

    await notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, buildSendSpy(sendCalls));

    assert.equal(
      sendCalls.length,
      0,
      "sendMail must not fire when all admins opt out, even if the cooldown window has fully expired",
    );
  });

  it("never throws when all admins have opted out", async () => {
    buildSelectMock([
      [], // zero recipients
    ]);
    buildInsertMock([]);

    await assert.doesNotReject(
      () => notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend),
      "notifyAdminsOfStuckEkqrQrCodes must never throw when all admins have opted out",
    );
  });

  it("never throws when all admins have opted out and db.select rejects", async () => {
    (db as any).select = () => ({
      from: () => ({
        where: (_cond: unknown) => {
          const rejection = Promise.reject(new Error("simulated DB error on opt-out path"));
          return Object.assign(rejection, {
            limit: (_n: number) => Promise.reject(new Error("simulated DB error on opt-out path")),
          });
        },
      }),
    });
    buildInsertMock([]);

    await assert.doesNotReject(
      () => notifyAdminsOfStuckEkqrQrCodes(SAMPLE_OPTS, failSend),
      "notifyAdminsOfStuckEkqrQrCodes must swallow DB errors on the opt-out path",
    );
  });
});
