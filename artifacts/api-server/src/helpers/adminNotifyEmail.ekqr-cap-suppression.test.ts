/**
 * Behavioral unit tests for notifyAdminsOfEkqrCapFull — opt-out suppression.
 *
 * Covers:
 *   - sendMail is never invoked when every active admin has ekqrCapAlertEmails=false
 *   - The daily dedup claim IS retained when no admins are opted in (this is a
 *     configuration state, not a transient failure — the claim prevents repeated
 *     DB work on every cap-exceeded request throughout the day)
 *   - db.update (releaseClaim) is NOT called in the opted-out path
 *   - The dedup early-return (already sent today) path is also exercised
 *   - The function never throws regardless of outcome
 *
 * Mocking strategy:
 *   db.execute is mocked to control the atomic upsert claim result.
 *   db.select  is mocked with sequential responses (email channel, in-app channel).
 *   db.update  is mocked to confirm releaseClaim is NOT called in opted-out paths.
 *   _sendMail is injected as a stub parameter so no real SMTP is hit.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { notifyAdminsOfEkqrCapFull } from "./adminNotifyEmail";

// ── DB mock helpers ────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Mock db.execute (used by the atomic upsert claim).
 * Returns a QueryResult shape matching Drizzle's node-postgres driver:
 *   { rows: [...] }
 * claimGranted=true → rows: [{value: TODAY}] (claim won)
 * claimGranted=false → rows: [] (already sent today, suppressed)
 */
function mockExecute(claimGranted: boolean) {
  (db as any).execute = (_sql: unknown) =>
    Promise.resolve({ rows: claimGranted ? [{ value: TODAY }] : [] });
}

/**
 * Mock db.select with sequential responses.
 * Each call to db.select() consumes the next entry in `responses`.
 * Used to serve different rows to the email channel and in-app channel.
 */
function mockSelectSequential(responses: Array<Array<Record<string, unknown>>>) {
  let callIdx = 0;
  (db as any).select = (_fields?: unknown) => {
    const rows = responses[callIdx++] ?? [];
    const chain: any = {
      from: () => chain,
      where: (_cond: unknown) => Promise.resolve(rows),
    };
    return chain;
  };
}

/** Track db.update calls (claim release). */
function mockUpdate(tracker: { calls: number }) {
  (db as any).update = (_table: unknown) => ({
    set: (_vals: unknown) => ({
      where: (_cond: unknown) => {
        tracker.calls++;
        return Promise.resolve({ rowCount: 1 });
      },
    }),
  });
}

// ── Save originals for teardown ────────────────────────────────────────────────

const originalExecute = (db as any).execute?.bind(db);
const originalSelect  = (db as any).select?.bind(db);
const originalUpdate  = (db as any).update?.bind(db);

afterEach(() => {
  if (originalExecute) (db as any).execute = originalExecute;
  if (originalSelect)  (db as any).select  = originalSelect;
  if (originalUpdate)  (db as any).update  = originalUpdate;
});

// ── Shared fixture ─────────────────────────────────────────────────────────────

const SAMPLE_OPTS = {
  todayTotal: 100_000,
  dailyLimit: 100_000,
  resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
};

const noSend = async (_args: unknown) => ({ ok: false } as any);

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("notifyAdminsOfEkqrCapFull — all admins opted out (ekqrCapAlertEmails=false)", () => {
  it("does not call sendMail when the opted-in recipient list is empty", async () => {
    mockExecute(true); // claim granted
    // email channel → no opted-in recipients; in-app channel → no opted-in recipients
    mockSelectSequential([[], []]);
    const tracker = { calls: 0 };
    mockUpdate(tracker);

    const sendCalls: unknown[] = [];
    const spySend = async (args: unknown) => {
      sendCalls.push(args);
      return { ok: true } as any;
    };

    await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS, spySend);

    assert.equal(sendCalls.length, 0, "sendMail must not be called when no admins opted in");
  });

  it("retains the daily claim when no admins are opted in (not a transient failure)", async () => {
    // No opted-in recipients = configuration state, not a transient failure.
    // The claim must be KEPT so the function doesn't retry on every cap-exceeded request.
    mockExecute(true);
    mockSelectSequential([[], []]);
    const tracker = { calls: 0 };
    mockUpdate(tracker);

    await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS, noSend);

    assert.equal(
      tracker.calls,
      0,
      "db.update (releaseClaim) must NOT be called when no admins are opted in — claim is kept for the day",
    );
  });

  it("suppresses correctly regardless of how many admins exist, when all have opted out", async () => {
    // getAdminEmails() applies WHERE ekqrCapAlertEmails=true at the DB level;
    // even with many admin rows, the result is empty when all opted out.
    mockExecute(true);
    mockSelectSequential([[], []]);
    const tracker = { calls: 0 };
    mockUpdate(tracker);

    await notifyAdminsOfEkqrCapFull(
      { todayTotal: 500_000, dailyLimit: 500_000, resetsAt: SAMPLE_OPTS.resetsAt },
      noSend,
    );

    assert.equal(tracker.calls, 0, "No releaseClaim written when all admins opted out");
  });

  it("dedup guard suppresses before reaching recipient check (already sent today)", async () => {
    mockExecute(false); // claim denied — already sent today
    let selectCallCount = 0;
    (db as any).select = () => {
      selectCallCount++;
      return { from: () => ({ where: () => Promise.resolve([]) }) };
    };
    const tracker = { calls: 0 };
    mockUpdate(tracker);

    const sendCalls: unknown[] = [];
    const spySend = async (args: unknown) => { sendCalls.push(args); return { ok: true } as any; };

    await notifyAdminsOfEkqrCapFull(SAMPLE_OPTS, spySend);

    assert.equal(selectCallCount, 0, "db.select must not be called when dedup guard fires");
    assert.equal(sendCalls.length, 0, "sendMail must not be called when dedup guard fires");
    assert.equal(tracker.calls, 0, "releaseClaim must not be called when dedup guard fires");
  });

  it("never throws when the opted-out path is taken", async () => {
    mockExecute(true);
    mockSelectSequential([[], []]);
    mockUpdate({ calls: 0 });

    await assert.doesNotReject(
      () => notifyAdminsOfEkqrCapFull(SAMPLE_OPTS, noSend),
      "notifyAdminsOfEkqrCapFull must never throw — errors are swallowed internally",
    );
  });

  it("never throws when db.execute rejects (DB connectivity error)", async () => {
    (db as any).execute = () => Promise.reject(new Error("simulated DB connection error"));

    await assert.doesNotReject(
      () => notifyAdminsOfEkqrCapFull(SAMPLE_OPTS, noSend),
      "notifyAdminsOfEkqrCapFull must swallow DB errors and not propagate",
    );
  });
});
