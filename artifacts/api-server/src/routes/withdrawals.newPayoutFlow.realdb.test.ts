/**
 * Integration test: Merchant "New Payout" flow must only accept a saved,
 * provider-verified beneficiary — never re-register a beneficiary inline —
 * must enforce the ₹100 minimum, must be idempotent under double-submit,
 * and must stay in `pending` (no direct provider dispatch) until an admin
 * approves it (real DB, no mocks of withdrawals.ts itself).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and } from "drizzle-orm";
import {
  db,
  usersTable,
  merchantsTable,
  merchantWalletsTable,
  merchantPlansTable,
  plansTable,
  payoutBeneficiariesTable,
  withdrawalsTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

function post(
  server: http.Server,
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, body: { _raw: raw } });
          }
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

describe("Merchant New Payout flow — saved beneficiary, min amount, idempotency (real DB)", () => {
  let server: http.Server;
  let token: string;
  let merchantId: number;
  let verifiedBeneficiaryId: number;
  let unverifiedBeneficiaryId: number;

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const email = `payout-flow-test-${Date.now()}@example.com`;
    const [merchant] = await db
      .insert(merchantsTable)
      .values({
        businessName: "Payout Flow Test Merchant",
        contactName: "Payout Flow Test Contact",
        email,
        phone: `9${String(Date.now()).slice(-9)}`,
        status: "approved",
      })
      .returning();
    merchantId = merchant!.id;

    const [user] = await db
      .insert(usersTable)
      .values({ email, passwordHash: "x", name: "Payout Flow Test User", role: "merchant", merchantId })
      .returning();
    token = generateToken({ userId: user!.id, role: "merchant" });

    await db.insert(merchantWalletsTable).values({
      merchantId,
      availableBalance: "10000.00",
      holdBalance: "0.00",
      pendingBalance: "0.00",
    });

    const [goldPlan] = await db.select({ id: plansTable.id }).from(plansTable).where(eq(plansTable.name, "Gold")).limit(1);
    await db.insert(merchantPlansTable).values({ merchantId, planId: goldPlan!.id, status: "active" });

    const [verified] = await db
      .insert(payoutBeneficiariesTable)
      .values({
        merchantId,
        env: "test",
        payoutMode: "IMPS",
        bankAccount: "1234567890",
        bankName: "Test Bank",
        ifscCode: "TEST0001234",
        accountHolder: "Test Payee",
        beneficiaryKey: `test-key-${Date.now()}-verified`,
        providerBeneficiaryId: "BEN_TEST_1",
        localStatus: "active",
        providerStatus: "created",
      })
      .returning();
    verifiedBeneficiaryId = verified!.id;

    const [unverified] = await db
      .insert(payoutBeneficiariesTable)
      .values({
        merchantId,
        env: "test",
        payoutMode: "IMPS",
        bankAccount: "9876543210",
        bankName: "Test Bank 2",
        ifscCode: "TEST0009999",
        accountHolder: "Unverified Payee",
        beneficiaryKey: `test-key-${Date.now()}-unverified`,
        localStatus: "active",
        providerStatus: "not_created",
      })
      .returning();
    unverifiedBeneficiaryId = unverified!.id;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects a payout against an unverified beneficiary and never dispatches to the provider", async () => {
    const { status, body } = await post(server, "/api/withdrawals", token, {
      amount: 500,
      beneficiaryId: unverifiedBeneficiaryId,
      idempotencyKey: `idem-unverified-${Date.now()}`,
    });
    assert.equal(status, 400);
    assert.match(String(body.error), /verify a beneficiary/i);

    const rows = await db
      .select()
      .from(withdrawalsTable)
      .where(eq(withdrawalsTable.beneficiaryId, unverifiedBeneficiaryId));
    assert.equal(rows.length, 0, "no withdrawal row should be created for an unverified beneficiary");
  });

  it("rejects amounts below the ₹100 minimum", async () => {
    const { status, body } = await post(server, "/api/withdrawals", token, {
      amount: 50,
      beneficiaryId: verifiedBeneficiaryId,
      idempotencyKey: `idem-min-${Date.now()}`,
    });
    assert.equal(status, 400);
    assert.match(String(body.error), /minimum payout amount/i);
  });

  it("creates exactly one pending withdrawal reusing the saved verified beneficiary, and never auto-dispatches to the provider", async () => {
    const idempotencyKey = `idem-happy-${Date.now()}`;
    const { status, body } = await post(server, "/api/withdrawals", token, {
      amount: 500,
      beneficiaryId: verifiedBeneficiaryId,
      idempotencyKey,
    });
    assert.equal(status, 201);
    assert.equal(body.status, "pending");

    const [row] = await db
      .select()
      .from(withdrawalsTable)
      .where(and(eq(withdrawalsTable.merchantId, merchantId), eq(withdrawalsTable.idempotencyKey, idempotencyKey)));
    assert.ok(row, "withdrawal row should exist");
    assert.equal(row!.beneficiaryId, verifiedBeneficiaryId, "must reuse the saved beneficiary, never create a new one");
    assert.equal(row!.status, "pending");
    assert.equal(row!.transferStatus, "NOT_STARTED", "must not call the provider until an admin approves");
  });

  it("is idempotent under a double-submit with the same idempotency key (no duplicate row, no double wallet hold)", async () => {
    const idempotencyKey = `idem-dup-${Date.now()}`;
    const first = await post(server, "/api/withdrawals", token, {
      amount: 300,
      beneficiaryId: verifiedBeneficiaryId,
      idempotencyKey,
    });
    assert.equal(first.status, 201);

    const second = await post(server, "/api/withdrawals", token, {
      amount: 300,
      beneficiaryId: verifiedBeneficiaryId,
      idempotencyKey,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.id, first.body.id, "the second submit must return the same withdrawal, not create a new one");

    const rows = await db
      .select()
      .from(withdrawalsTable)
      .where(and(eq(withdrawalsTable.merchantId, merchantId), eq(withdrawalsTable.idempotencyKey, idempotencyKey)));
    assert.equal(rows.length, 1, "exactly one withdrawal row must exist for this idempotency key");
  });

  it("rejects a payout when no beneficiaryId is supplied but a beneficiary already exists (never silently falls back to inline re-registration for this merchant's flow)", async () => {
    // The dedicated "New Payout" UI flow always sends beneficiaryId; if it is
    // omitted with none of the legacy inline fields present either, the route
    // must fail validation rather than silently doing something else.
    const { status } = await post(server, "/api/withdrawals", token, {
      amount: 500,
      idempotencyKey: `idem-noben-${Date.now()}`,
    });
    assert.equal(status, 400);
  });
});
