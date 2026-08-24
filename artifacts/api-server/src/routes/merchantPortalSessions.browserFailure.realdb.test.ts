/**
 * Integration coverage for submit-step recovery after a browser runtime failure.
 *
 * This exercises the authenticated HTTP route, not just the lease SQL:
 *   1. reserve an OTP attempt through submit-step;
 *   2. inject a BrowserRuntimeUnavailableError from the registered adapter;
 *   3. verify the sanitized 503 and restored lease/lifecycle state;
 *   4. submit again and verify the session can be reserved again.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { and, eq } from "drizzle-orm";
import {
  db,
  merchantPortalSessionsTable,
  merchantsTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { generateToken } from "../middlewares/auth";
import { getAdapter } from "../helpers/connectorEngine/adapters/registry";
import { BrowserRuntimeUnavailableError } from "../helpers/connectorEngine/browserPool";

type HttpResult = {
  status: number;
  body: Record<string, unknown>;
};

function post(
  server: http.Server,
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<HttpResult> {
  const address = server.address() as { port: number };
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        response.on("end", () => {
          try {
            resolve({ status: response.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: response.statusCode!, body: { _raw: raw } });
          }
        });
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

describe("merchant portal submit-step browser failure recovery (real DB)", () => {
  let server: http.Server;
  let merchantId: number;
  let userId: number;
  let sessionId: number;
  let token: string;
  const providerSlug = "pinelabs_one";
  const email = `portal-browser-failure-${Date.now()}@example.invalid`;
  const adapter = getAdapter(providerSlug);

  before(async () => {
    assert.ok(adapter, "Pine Labs adapter must be registered");

    const [merchant] = await db.insert(merchantsTable).values({
      businessName: "Browser failure recovery test",
      contactName: "Browser Failure Test",
      email,
      phone: "9999999999",
      status: "active",
    }).returning({ id: merchantsTable.id });
    merchantId = merchant.id;

    const [user] = await db.insert(usersTable).values({
      email,
      name: "Browser Failure Test",
      role: "merchant",
      merchantId,
    }).returning({ id: usersTable.id });
    userId = user.id;
    token = generateToken({ userId, role: "merchant" });

    const [session] = await db.insert(merchantPortalSessionsTable).values({
      merchantId,
      providerSlug,
      status: "AWAITING_OTP",
      encryptedSession: "enc:test-browser-failure-session",
      otpVerificationFailureCount: 1,
      otpResendCount: 2,
      otpResendAvailableAt: new Date(Date.now() - 1_000),
      otpExpiresAt: new Date(Date.now() + 10 * 60 * 1_000),
    }).returning({ id: merchantPortalSessionsTable.id });
    sessionId = session.id;

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  after(async () => {
    if (adapter && originalSubmitStep) {
      adapter.submitStep = originalSubmitStep;
    }
    await db.delete(merchantPortalSessionsTable).where(eq(merchantPortalSessionsTable.id, sessionId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const originalSubmitStep = adapter?.submitStep;

  it("returns sanitized 503, restores reservations, and permits a retry", async () => {
    assert.ok(adapter);
    assert.ok(originalSubmitStep);

    let calls = 0;
    adapter.submitStep = async () => {
      calls++;
      if (calls === 1) {
        throw new BrowserRuntimeUnavailableError();
      }
      return {
        status: "FAILED",
        failReason: "INVALID_OTP",
        failDetail: "The OTP is invalid.",
      };
    };

    const path = `/api/merchant/portal-sessions/${providerSlug}/submit-step`;
    const failed = await post(server, path, token, { otp: "123456" });

    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, {
      status: "FAILED",
      errorCode: "BROWSER_RUNTIME_UNAVAILABLE",
      message: "Browser automation is temporarily unavailable. Please try again later or contact support.",
      nextStep: null,
    });
    assert.equal(JSON.stringify(failed.body).includes("BrowserRuntimeUnavailableError"), false);
    assert.equal(JSON.stringify(failed.body).includes("/"), false);

    const [restored] = await db
      .select()
      .from(merchantPortalSessionsTable)
      .where(and(
        eq(merchantPortalSessionsTable.id, sessionId),
        eq(merchantPortalSessionsTable.merchantId, merchantId),
      ));
    assert.equal(restored.otpVerificationFailureCount, 1);
    assert.equal(restored.otpResendCount, 2);
    assert.equal(restored.processingLeaseId, null);
    assert.equal(restored.processingLeaseExpiresAt, null);
    assert.ok(restored.otpResendAvailableAt);
    assert.ok(restored.otpExpiresAt);

    const retried = await post(server, path, token, { otp: "654321" });
    assert.equal(retried.status, 200);
    assert.equal(calls, 2);
    assert.equal(retried.body.status, "AWAITING_OTP");
    assert.equal(retried.body.errorCode, "INVALID_OTP");
    assert.equal(retried.body.attemptsRemaining, 1);

    const [afterRetry] = await db
      .select()
      .from(merchantPortalSessionsTable)
      .where(eq(merchantPortalSessionsTable.id, sessionId));
    assert.equal(afterRetry.otpVerificationFailureCount, 2);
    assert.equal(afterRetry.otpResendCount, 2);
    assert.equal(afterRetry.processingLeaseId, null);
    assert.equal(afterRetry.processingLeaseExpiresAt, null);
  });
});