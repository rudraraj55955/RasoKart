/**
 * PostgreSQL integration coverage for the Pine Labs submit-step lease.
 *
 * This intentionally exercises the same conditional UPDATE/CAS predicates
 * used by merchantPortalSessions.ts. The route's process-local guard cannot
 * protect separate API server processes; PostgreSQL must provide the safety.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { and, eq, gte, isNull, lte, lt, or, sql } from "drizzle-orm";
import {
  db,
  merchantPortalSessionsTable,
  merchantsTable,
} from "@workspace/db";

const providerSlug = "pinelabs_one";
const merchantEmail = `pinelabs-lease-${Date.now()}@example.invalid`;
const leaseDurationMs = 3 * 60 * 1000;
const maxAttempts = 3;
const maxResends = 3;

describe("Pine Labs processing lease (real PostgreSQL)", () => {
  let merchantId: number;
  let sessionId: number;

  before(async () => {
    const [merchant] = await db.insert(merchantsTable).values({
      businessName: "Pine Labs lease integration test",
      contactName: "Lease Test",
      email: merchantEmail,
      phone: "9999999999",
      status: "active",
    }).returning({ id: merchantsTable.id });
    merchantId = merchant.id;

    const [session] = await db.insert(merchantPortalSessionsTable).values({
      merchantId,
      providerSlug,
      status: "AWAITING_OTP",
      encryptedSession: "enc:test-session",
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }).returning({ id: merchantPortalSessionsTable.id });
    sessionId = session.id;
  });

  after(async () => {
    await db.delete(merchantPortalSessionsTable).where(eq(merchantPortalSessionsTable.id, sessionId));
    await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
  });

  async function resetSession(values: Record<string, unknown> = {}) {
    await db.update(merchantPortalSessionsTable).set({
      status: "AWAITING_OTP",
      encryptedSession: "enc:test-session",
      otpVerificationFailureCount: 0,
      otpResendCount: 0,
      otpResendAvailableAt: null,
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
      connectedAt: null,
      lastStatusMessage: null,
      ...values,
      updatedAt: new Date(),
    }).where(eq(merchantPortalSessionsTable.id, sessionId));
  }

  async function reserve(leaseId: string, now = new Date()) {
    const [row] = await db.update(merchantPortalSessionsTable).set({
      otpVerificationFailureCount: sql`${merchantPortalSessionsTable.otpVerificationFailureCount} + 1`,
      processingLeaseId: leaseId,
      processingLeaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
    }).where(and(
      eq(merchantPortalSessionsTable.id, sessionId),
      eq(merchantPortalSessionsTable.status, "AWAITING_OTP"),
      lt(merchantPortalSessionsTable.otpVerificationFailureCount, maxAttempts),
      or(isNull(merchantPortalSessionsTable.otpExpiresAt), gte(merchantPortalSessionsTable.otpExpiresAt, now)),
      or(isNull(merchantPortalSessionsTable.processingLeaseId), lte(merchantPortalSessionsTable.processingLeaseExpiresAt, now)),
    )).returning({ id: merchantPortalSessionsTable.id });
    return row;
  }

  async function connectedWithLease(leaseId: string) {
    const [row] = await db.update(merchantPortalSessionsTable).set({
      status: "CONNECTED",
      encryptedSession: "enc:new-connected-session",
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
      connectedAt: new Date(),
    }).where(and(
      eq(merchantPortalSessionsTable.id, sessionId),
      eq(merchantPortalSessionsTable.processingLeaseId, leaseId),
    )).returning({ id: merchantPortalSessionsTable.id });
    return row;
  }

  it("gives exactly one owner to two concurrent OTP reservations", async () => {
    await resetSession();
    const [a, b] = await Promise.all([reserve("lease-a"), reserve("lease-b")]);
    assert.equal([a, b].filter(Boolean).length, 1);
    const [row] = await db.select().from(merchantPortalSessionsTable).where(eq(merchantPortalSessionsTable.id, sessionId));
    assert.equal(row.otpVerificationFailureCount, 1);
    assert.ok(["lease-a", "lease-b"].includes(row.processingLeaseId ?? ""));
  });

  it("rejects a stale commit after a newer connected session wins", async () => {
    await resetSession();
    assert.ok(await reserve("old-lease"));
    await db.update(merchantPortalSessionsTable).set({
      status: "CONNECTED",
      encryptedSession: "enc:new-session",
      processingLeaseId: "new-lease",
      processingLeaseExpiresAt: new Date(Date.now() + leaseDurationMs),
    }).where(eq(merchantPortalSessionsTable.id, sessionId));
    assert.equal(await connectedWithLease("old-lease"), undefined);
    const [row] = await db.select().from(merchantPortalSessionsTable).where(eq(merchantPortalSessionsTable.id, sessionId));
    assert.equal(row.status, "CONNECTED");
    assert.equal(row.encryptedSession, "enc:new-session");
    assert.equal(row.processingLeaseId, "new-lease");
  });

  it("allows a later request to acquire an expired lease", async () => {
    const expired = new Date(Date.now() - 1000);
    await resetSession({ processingLeaseId: "expired-lease", processingLeaseExpiresAt: expired });
    assert.ok(await reserve("later-lease"));
    const [row] = await db.select().from(merchantPortalSessionsTable).where(eq(merchantPortalSessionsTable.id, sessionId));
    assert.equal(row.processingLeaseId, "later-lease");
  });

  it("restores reserved OTP state on browser failure without touching independent resend state", async () => {
    await resetSession({ otpVerificationFailureCount: 1, otpResendCount: 2 });
    assert.ok(await reserve("browser-failed"));
    const [restored] = await db.update(merchantPortalSessionsTable).set({
      otpVerificationFailureCount: 1,
      otpResendCount: 2,
      processingLeaseId: null,
      processingLeaseExpiresAt: null,
    }).where(and(
      eq(merchantPortalSessionsTable.id, sessionId),
      eq(merchantPortalSessionsTable.processingLeaseId, "browser-failed"),
    )).returning({ id: merchantPortalSessionsTable.id });
    assert.ok(restored);
    const [row] = await db.select().from(merchantPortalSessionsTable).where(eq(merchantPortalSessionsTable.id, sessionId));
    assert.equal(row.otpVerificationFailureCount, 1);
    assert.equal(row.otpResendCount, 2);
    assert.equal(row.processingLeaseId, null);
  });

  it("keeps verification attempts, resend quota, cooldown, and expiry as separate fields", async () => {
    const cooldown = new Date(Date.now() + 60_000);
    const expiry = new Date(Date.now() + 10 * 60_000);
    await resetSession({
      otpVerificationFailureCount: 2,
      otpResendCount: 1,
      otpResendAvailableAt: cooldown,
      otpExpiresAt: expiry,
    });
    const [row] = await db.select().from(merchantPortalSessionsTable).where(eq(merchantPortalSessionsTable.id, sessionId));
    assert.equal(row.otpVerificationFailureCount, 2);
    assert.equal(row.otpResendCount, 1);
    assert.equal(row.otpResendAvailableAt?.getTime(), cooldown.getTime());
    assert.equal(row.otpExpiresAt?.getTime(), expiry.getTime());
  });
});