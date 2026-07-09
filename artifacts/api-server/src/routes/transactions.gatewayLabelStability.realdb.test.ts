/**
 * Integration test: GET /api/transactions — stable white-label gateway
 * labels for merchant users (real DB, no mocks).
 *
 * The label for a given provider is derived from the date it was FIRST
 * used by the merchant across ALL of that merchant's transactions — not
 * from whatever happens to be present in the current filtered/paginated
 * result set. This test proves that guarantee end-to-end:
 *
 *  1. Seeds a dedicated merchant with two providers (connections), used in
 *     a fixed chronological order (providerA used first, providerB second).
 *  2. Fetches deposits under different date-range filters and confirms the
 *     same provider always maps to the same "Payment Gateway X" letter,
 *     regardless of which subset of transactions the filter surfaces.
 *  3. Fetches page 1 and page 2 (via a small page size) and confirms the
 *     label for a given provider's transactions is identical across pages.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  merchantsTable,
  merchantConnectionsTable,
  transactionsTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

function get(
  server: http.Server,
  path: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
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
    req.end();
  });
}

function generateUtr(prefix: string): string {
  return `TESTUTR_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

describe(
  "GET /api/transactions — gateway label stability across filters and pagination (real DB)",
  () => {
    let server: http.Server;
    let token: string;
    let merchantId: number;
    let userId: number;
    let connectionAId: number;
    let connectionBId: number;

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      const email = `gwlabel-test-${Date.now()}@example.com`;
      const [merchant] = await db.insert(merchantsTable).values({
        businessName: "Gateway Label Stability Test Merchant",
        contactName: "Test Contact",
        email,
        phone: "9999999999",
        status: "approved",
        verificationStatus: "approved",
      }).returning();
      merchantId = merchant!.id;

      const [user] = await db.insert(usersTable).values({
        email,
        passwordHash: "not-a-real-hash",
        name: "Gateway Label Test Merchant",
        role: "merchant",
        merchantId,
      }).returning();
      userId = user!.id;
      token = generateToken({ userId, role: "merchant" });

      const [connA] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "phonepe",
        isActive: true,
      }).returning();
      connectionAId = connA!.id;

      const [connB] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "paytm",
        isActive: true,
      }).returning();
      connectionBId = connB!.id;

      // providerA (phonepe) used first, chronologically well before providerB (paytm).
      const oldDate = new Date("2024-01-01T00:00:00Z");
      const midDate = new Date("2024-06-01T00:00:00Z");
      const recentDate = new Date("2024-09-01T00:00:00Z");

      await db.insert(transactionsTable).values([
        {
          merchantId,
          connectionId: connectionAId,
          type: "deposit",
          status: "success",
          amount: "100.00",
          utr: generateUtr("A1"),
          createdAt: oldDate,
        },
        {
          merchantId,
          connectionId: connectionBId,
          type: "deposit",
          status: "success",
          amount: "200.00",
          utr: generateUtr("B1"),
          createdAt: midDate,
        },
        // Additional recent transactions for both providers, used to build
        // out a second page and to test date-filtered subsets.
        {
          merchantId,
          connectionId: connectionAId,
          type: "deposit",
          status: "success",
          amount: "150.00",
          utr: generateUtr("A2"),
          createdAt: recentDate,
        },
        {
          merchantId,
          connectionId: connectionBId,
          type: "deposit",
          status: "success",
          amount: "250.00",
          utr: generateUtr("B2"),
          createdAt: recentDate,
        },
      ]).returning();
    });

    after(async () => {
      await db.delete(transactionsTable).where(eq(transactionsTable.merchantId, merchantId));
      await db.delete(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, merchantId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
      await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("assigns the earliest-used provider 'Payment Gateway A' and the second 'Payment Gateway B'", async () => {
      const res = await get(server, "/api/transactions?limit=20", token);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const data = res.body["data"] as Array<{ utr: string; connectionProvider?: string; [k: string]: unknown }>;

      const a1 = data.find((tx) => tx.utr.includes("_A1_"));
      const b1 = data.find((tx) => tx.utr.includes("_B1_"));
      assert.ok(a1, "expected the phonepe (first-used) transaction to be present");
      assert.ok(b1, "expected the paytm (second-used) transaction to be present");

      const labelA = (a1 as any).payinGatewayLabel;
      const labelB = (b1 as any).payinGatewayLabel;

      assert.equal(labelA, "Payment Gateway A", "provider used first overall should be labeled Payment Gateway A");
      assert.equal(labelB, "Payment Gateway B", "provider used second overall should be labeled Payment Gateway B");
    });

    it("keeps the same label for a provider regardless of the active date filter", async () => {
      // Filter that only surfaces the RECENT transactions (both providers present,
      // but the earliest-use ordering must still be derived from full history).
      const recentOnly = await get(
        server,
        "/api/transactions?dateFrom=2024-08-01&dateTo=2024-09-30&limit=20",
        token,
      );
      assert.equal(recentOnly.status, 200, JSON.stringify(recentOnly.body));
      const recentData = recentOnly.body["data"] as Array<{ utr: string; [k: string]: unknown }>;

      const a2 = recentData.find((tx) => tx.utr.includes("_A2_"));
      const b2 = recentData.find((tx) => tx.utr.includes("_B2_"));
      assert.ok(a2, "expected the phonepe recent transaction in the filtered window");
      assert.ok(b2, "expected the paytm recent transaction in the filtered window");

      const labelA2 = (a2 as any).payinGatewayLabel;
      const labelB2 = (b2 as any).payinGatewayLabel;

      // Even though within this filtered window phonepe and paytm transactions
      // occur on the exact same date, phonepe must still be "A" because it was
      // used FIRST overall (Jan 2024), independent of this filter's window.
      assert.equal(labelA2, "Payment Gateway A", "phonepe must remain Gateway A under a date filter that excludes its earliest use");
      assert.equal(labelB2, "Payment Gateway B", "paytm must remain Gateway B under a date filter that excludes its earliest use");
    });

    it("keeps the same label for a provider's transactions across page 1 and page 2", async () => {
      const page1 = await get(server, "/api/transactions?limit=1&page=1&type=deposit", token);
      const page2 = await get(server, "/api/transactions?limit=1&page=2&type=deposit", token);
      assert.equal(page1.status, 200, JSON.stringify(page1.body));
      assert.equal(page2.status, 200, JSON.stringify(page2.body));

      const page1Data = page1.body["data"] as Array<{ utr: string; [k: string]: unknown }>;
      const page2Data = page2.body["data"] as Array<{ utr: string; [k: string]: unknown }>;
      assert.equal(page1Data.length, 1, "expected exactly one row on page 1 with limit=1");
      assert.equal(page2Data.length, 1, "expected exactly one row on page 2 with limit=1");

      // Results are ordered by createdAt DESC, so page 1 (most recent, ties broken by
      // insertion) and page 2 land on distinct rows among our recent A2/B2 transactions.
      // Whichever provider each page lands on, its label must match the label that same
      // provider receives when queried directly (asserted above): phonepe -> A, paytm -> B.
      for (const tx of [...page1Data, ...page2Data]) {
        const label = (tx as any).payinGatewayLabel;
        if (tx.utr.includes("_A")) {
          assert.equal(label, "Payment Gateway A", `phonepe transaction ${tx.utr} must be labeled Gateway A on any page`);
        } else if (tx.utr.includes("_B")) {
          assert.equal(label, "Payment Gateway B", `paytm transaction ${tx.utr} must be labeled Gateway B on any page`);
        }
      }
    });
  },
);
