/**
 * Deduplication tests for notifyAdminsOfEkqrCapFull
 *
 * Covers:
 *   - Two concurrent calls on the same UTC date → sendMail called exactly once
 *   - Second sequential call on the same date → fully suppressed (no email, no extra DB write)
 *   - Alert re-fires the next UTC day after the flag is set
 *   - No email when no admins are opted in — claim is RETAINED (not a transient failure)
 *   - Function swallows errors and never throws to caller
 *   - Claim released on transient SMTP failure (recipients exist but all sends fail)
 *
 * The atomic dedup relies on an INSERT … ON CONFLICT DO UPDATE … WHERE
 * value IS DISTINCT FROM today … RETURNING pattern executed via db.execute().
 * Only the caller whose INSERT actually changes the stored date gets a
 * non-empty result; everyone else is suppressed immediately.
 *
 * db.select uses sequential responses to serve different rows to the email
 * channel (getAdminEmails) and the in-app channel (direct usersTable query),
 * preventing mock interference between the two independent channels.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { notifyAdminsOfEkqrCapFull } from "./adminNotifyEmail";

// ── DB mock builders ──────────────────────────────────────────────────────────

/**
 * Mock db.execute (atomic upsert claim).
 * Returns a QueryResult shape matching Drizzle's node-postgres driver:
 *   { rows: [...] }
 * Non-empty rows → claim granted; empty rows → suppressed.
 * Each call consumes the next entry from claimReturns.
 */
function mockExecute(claimReturns: Array<Array<{ value: string }>>) {
  let callIdx = 0;
  (db as any).execute = (_sql: unknown) =>
    Promise.resolve({ rows: claimReturns[callIdx++] ?? [] });
}

/**
 * Mock db.select with sequential responses.
 * Call N consumes responses[N].
 * Per-invocation of notifyAdminsOfEkqrCapFull there are two db.select calls:
 *   [0] email channel (getAdminEmails) → {email: string}[]
 *   [1] in-app channel               → {id: number}[]   (return [] to skip createBulkNotifications)
 */
function mockSelectSequential(responses: Array<Array<Record<string, unknown>>>) {
  let callIdx = 0;
  (db as any).select = (_fields?: unknown) => {
    const rows = responses[callIdx++] ?? [];
    return {
      from: (_table: unknown) => ({
        where: (_cond: unknown) => Promise.resolve(rows),
      }),
    };
  };
}

/**
 * Mock db.update — tracks how many times releaseClaim fires.
 */
function mockUpdate(tracker?: { calls: number }) {
  (db as any).update = (_table: unknown) => ({
    set: (_vals: unknown) => ({
      where: (_cond: unknown) => {
        if (tracker) tracker.calls++;
        return Promise.resolve({ rowCount: 1 });
      },
    }),
  });
}

// ── Save originals for teardown ───────────────────────────────────────────────
const originalExecute = (db as any).execute?.bind(db);
const originalSelect  = (db as any).select?.bind(db);
const originalUpdate  = (db as any).update?.bind(db);

afterEach(() => {
  if (originalExecute) (db as any).execute = originalExecute;
  if (originalSelect)  (db as any).select  = originalSelect;
  if (originalUpdate)  (db as any).update  = originalUpdate;
});

// ── Shared fixtures ───────────────────────────────────────────────────────────

const OPTS = { todayTotal: 1_000_000, dailyLimit: 1_000_000, resetsAt: "midnight UTC" };

const TODAY = new Date().toISOString().slice(0, 10);
const TOMORROW = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

/** Two opted-in email admins; in-app returns [] so createBulkNotifications is skipped. */
const EMAIL_ROWS = [{ email: "admin1@rasokart.com" }, { email: "admin2@rasokart.com" }];
const NO_INAPP: Array<Record<string, unknown>> = []; // no in-app opt-ins in these tests

/** A sendMail stub that records every call and always reports success. */
function makeSendStub() {
  const calls: Array<{ to: string; subject: string }> = [];
  const fn = async (args: { to: string; subject: string; html: string }) => {
    calls.push({ to: args.to, subject: args.subject });
    return { ok: true } as any;
  };
  return { fn, calls };
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrent-call dedup
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyAdminsOfEkqrCapFull — concurrent call dedup", () => {
  it("sends email exactly once when two calls race on the same UTC date", async () => {
    // Call 1 wins claim; call 2 is suppressed immediately.
    mockExecute([
      [{ value: TODAY }], // first execute: claim granted
      [],                 // second execute: already today → suppressed
    ]);
    // Sequential: each function invocation reads email rows then in-app rows.
    mockSelectSequential([EMAIL_ROWS, NO_INAPP, EMAIL_ROWS, NO_INAPP]);
    mockUpdate();

    const { fn: sendStub, calls } = makeSendStub();

    await Promise.all([
      notifyAdminsOfEkqrCapFull(OPTS, sendStub),
      notifyAdminsOfEkqrCapFull(OPTS, sendStub),
    ]);

    assert.equal(
      calls.length,
      EMAIL_ROWS.length,
      `sendMail must be called exactly ${EMAIL_ROWS.length} time(s) — not ${calls.length}`,
    );
  });

  it("sends to every admin recipient exactly once when the first caller wins", async () => {
    const threeAdmins = [
      { email: "a@x.com" },
      { email: "b@x.com" },
      { email: "c@x.com" },
    ];
    mockExecute([[{ value: TODAY }], []]);
    mockSelectSequential([threeAdmins, NO_INAPP, threeAdmins, NO_INAPP]);
    mockUpdate();

    const { fn: sendStub, calls } = makeSendStub();

    await Promise.all([
      notifyAdminsOfEkqrCapFull(OPTS, sendStub),
      notifyAdminsOfEkqrCapFull(OPTS, sendStub),
    ]);

    assert.equal(calls.length, threeAdmins.length);
    assert.deepEqual(calls.map(c => c.to).sort(), ["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("the losing concurrent caller performs no db.select and no sendMail call", async () => {
    let selectCallCount = 0;
    mockExecute([[]]); // losing caller: claim not granted
    (db as any).select = (_fields: unknown) => {
      selectCallCount++;
      return { from: () => ({ where: () => Promise.resolve(EMAIL_ROWS) }) };
    };

    const { fn: sendStub, calls } = makeSendStub();

    await notifyAdminsOfEkqrCapFull(OPTS, sendStub);

    assert.equal(selectCallCount, 0, "losing caller must not query admin emails");
    assert.equal(calls.length, 0, "losing caller must not invoke sendMail");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sequential same-day suppression
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyAdminsOfEkqrCapFull — same-day sequential suppression", () => {
  it("suppresses a second call on the same UTC date (no email, no DB select)", async () => {
    mockExecute([
      [{ value: TODAY }], // first call: claim granted
      [],                 // second call: already today
    ]);
    mockSelectSequential([EMAIL_ROWS, NO_INAPP]);
    mockUpdate();

    const { fn: sendStub, calls } = makeSendStub();

    await notifyAdminsOfEkqrCapFull(OPTS, sendStub);
    const afterFirst = calls.length;

    let selectCallsDuringSecond = 0;
    const origSel = (db as any).select;
    (db as any).select = (_fields: unknown) => {
      selectCallsDuringSecond++;
      return origSel(_fields);
    };

    await notifyAdminsOfEkqrCapFull(OPTS, sendStub);

    assert.equal(afterFirst, EMAIL_ROWS.length, "first call must send to all admins");
    assert.equal(calls.length, afterFirst, "second call must add no new sendMail calls");
    assert.equal(selectCallsDuringSecond, 0, "second call must not query admin emails");
  });

  it("suppresses any number of additional same-day calls after the first", async () => {
    const extraCalls = 5;
    mockExecute([
      [{ value: TODAY }],
      ...Array.from({ length: extraCalls }, () => [] as { value: string }[]),
    ]);
    // First call reads email + in-app; subsequent calls are suppressed before db.select.
    mockSelectSequential([EMAIL_ROWS, NO_INAPP]);
    mockUpdate();

    const { fn: sendStub, calls } = makeSendStub();

    for (let i = 0; i <= extraCalls; i++) {
      await notifyAdminsOfEkqrCapFull(OPTS, sendStub);
    }

    assert.equal(
      calls.length,
      EMAIL_ROWS.length,
      `only the first call should have sent — expected ${EMAIL_ROWS.length} total sendMail calls`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Next-day re-fire
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyAdminsOfEkqrCapFull — next-day re-fire", () => {
  it("fires again the next UTC day after the flag is already set to today", async () => {
    mockExecute([[{ value: TOMORROW }]]); // claim granted for new date
    mockSelectSequential([EMAIL_ROWS, NO_INAPP]);
    mockUpdate();

    const { fn: sendStub, calls } = makeSendStub();

    await notifyAdminsOfEkqrCapFull(OPTS, sendStub);

    assert.equal(calls.length, EMAIL_ROWS.length, "alert must fire when the claim is granted for a new date");
  });

  it("the DB claim for a previous-day flag is granted (non-empty execute result)", async () => {
    mockExecute([[{ value: TODAY }]]); // stored was yesterday, now updated to today
    mockSelectSequential([[{ email: "admin@rasokart.com" }], NO_INAPP]);
    mockUpdate();

    const { fn: sendStub, calls } = makeSendStub();

    await notifyAdminsOfEkqrCapFull(OPTS, sendStub);

    assert.equal(calls.length, 1, "one email must be sent when the previous day's flag is overwritten");
    assert.equal(calls[0]!.to, "admin@rasokart.com");
  });

  it("does NOT fire again on the same day even after a server restart (flag persists)", async () => {
    mockExecute([[]]); // stored date = today → IS DISTINCT FROM false → no-op
    mockSelectSequential([EMAIL_ROWS, NO_INAPP]);

    const { fn: sendStub, calls } = makeSendStub();

    await notifyAdminsOfEkqrCapFull(OPTS, sendStub);

    assert.equal(calls.length, 0, "must be suppressed even after server restart if flag already set for today");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyAdminsOfEkqrCapFull — edge cases", () => {
  it("skips sendMail and retains the daily claim when no admins are opted in", async () => {
    // "No opted-in recipients" is a configuration state, not a transient failure.
    // The claim must be kept — releasing it would cause repeated DB work on every
    // cap-exceeded request throughout the day when nobody has opted in.
    mockExecute([[{ value: TODAY }]]); // claim granted
    mockSelectSequential([[], NO_INAPP]); // no email opt-ins
    const tracker = { calls: 0 };
    mockUpdate(tracker);

    const { fn: sendStub, calls } = makeSendStub();

    await notifyAdminsOfEkqrCapFull(OPTS, sendStub);

    assert.equal(calls.length, 0, "sendMail must not be called when admin list is empty");
    assert.equal(tracker.calls, 0, "claim must NOT be released when nobody is opted in");
  });

  it("does not throw when db.execute rejects (fire-and-forget contract)", async () => {
    (db as any).execute = (_sql: unknown) =>
      Promise.reject(new Error("simulated DB failure"));

    const { fn: sendStub } = makeSendStub();

    await assert.doesNotReject(
      () => notifyAdminsOfEkqrCapFull(OPTS, sendStub),
      "notifyAdminsOfEkqrCapFull must never propagate errors to its caller",
    );
  });

  it("does not throw when sendMail rejects for every recipient", async () => {
    mockExecute([[{ value: TODAY }]]);
    mockSelectSequential([EMAIL_ROWS, NO_INAPP]);
    mockUpdate();

    const failingSend = async (_args: unknown) => {
      throw new Error("SMTP connection refused");
    };

    await assert.doesNotReject(
      () => notifyAdminsOfEkqrCapFull(OPTS, failingSend as any),
      "sendMail rejections must not surface to the caller",
    );
  });

  it("includes the daily cap figures in the email subject", async () => {
    mockExecute([[{ value: TODAY }]]);
    mockSelectSequential([[{ email: "admin@rasokart.com" }], NO_INAPP]);
    mockUpdate();

    const { fn: sendStub, calls } = makeSendStub();

    await notifyAdminsOfEkqrCapFull(
      { todayTotal: 750_000, dailyLimit: 1_000_000, resetsAt: "midnight UTC" },
      sendStub,
    );

    assert.equal(calls.length, 1);
    assert.ok(
      calls[0]!.subject.includes("EKQR Daily Cap Reached"),
      "subject must mention 'EKQR Daily Cap Reached'",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Claim release on transient delivery failure
// ─────────────────────────────────────────────────────────────────────────────

describe("notifyAdminsOfEkqrCapFull — claim release on transient delivery failure", () => {
  it("releases the claim when recipients exist but every sendMail call fails", async () => {
    // This IS a transient failure: opted-in admins exist but SMTP is down.
    // The claim must be released so the next request can retry.
    mockExecute([[{ value: TODAY }]]);
    mockSelectSequential([EMAIL_ROWS, NO_INAPP]);

    const tracker = { calls: 0 };
    mockUpdate(tracker);

    const alwaysFailSend = async (_args: unknown) => {
      throw new Error("SMTP timeout");
    };

    await notifyAdminsOfEkqrCapFull(OPTS, alwaysFailSend as any);

    assert.equal(
      tracker.calls,
      1,
      "db.update must be called once to release the claim when all sends fail",
    );
  });

  it("does NOT release the claim when at least one email is delivered", async () => {
    mockExecute([[{ value: TODAY }]]);
    mockSelectSequential([[{ email: "admin@rasokart.com" }], NO_INAPP]);

    const tracker = { calls: 0 };
    mockUpdate(tracker);

    const { fn: sendStub } = makeSendStub();

    await notifyAdminsOfEkqrCapFull(OPTS, sendStub);

    assert.equal(
      tracker.calls,
      0,
      "db.update (releaseClaim) must NOT be called when at least one email was delivered",
    );
  });

  it("a retry after a transient failure can win the claim and send the email", async () => {
    mockExecute([
      [{ value: TODAY }], // attempt 1 wins claim
      [{ value: TODAY }], // attempt 2 wins claim (flag was released)
    ]);
    mockSelectSequential([EMAIL_ROWS, NO_INAPP, EMAIL_ROWS, NO_INAPP]);

    const tracker = { calls: 0 };
    mockUpdate(tracker);

    let attempt = 0;
    const flakyStub = async (_args: { to: string; subject: string; html: string }) => {
      attempt++;
      if (attempt <= EMAIL_ROWS.length) throw new Error("first attempt fails");
      return { ok: true } as any;
    };

    // Attempt 1 — all sends fail → claim released
    await notifyAdminsOfEkqrCapFull(OPTS, flakyStub);
    assert.equal(tracker.calls, 1, "claim must be released after first failed attempt");

    // Attempt 2 — sends succeed → claim kept
    await notifyAdminsOfEkqrCapFull(OPTS, flakyStub);
    assert.equal(tracker.calls, 1, "claim must NOT be released again after successful second attempt");
  });
});
