/**
 * Integration test: legacy deposits (connectionId = NULL, provider set directly)
 * always receive a non-null payinGatewayLabel (real DB, no mocks).
 *
 * "Legacy" rows are deposits that were recorded before the merchant-connections
 * table was introduced. They store the provider string directly on the
 * transactions row and have a NULL connectionId. The server uses COALESCE in
 * getStableProviderToLabel() and in the detail route to pick up that field,
 * so the label must never be blank for these rows.
 *
 * Test contracts:
 *
 *  CONTRACT 1 — legacy list label: a transaction with connectionId=NULL and
 *    provider='cashfree' included in GET /api/transactions has a non-null
 *    payinGatewayLabel.
 *
 *  CONTRACT 2 — legacy detail label: GET /api/transactions/:id for the same
 *    legacy row also returns a non-null payinGatewayLabel.
 *
 *  CONTRACT 3 — label consistency: a second transaction for the SAME merchant,
 *    same provider string ('cashfree'), but routed through a real connection
 *    row (non-null connectionId), must map to the SAME label letter as the
 *    legacy row. Both rows represent the same effective gateway so they should
 *    always display the same label.
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
  return `TESTUTR_LEGACY_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

describe(
  "Legacy deposits (connectionId=NULL, provider set directly) always get a non-null payinGatewayLabel (real DB)",
  () => {
    let server: http.Server;
    let token: string;
    let merchantId: number;
    let userId: number;
    let connectionId: number;

    // UTRs are generated once so we can locate the right rows in responses.
    const legacyUtr = generateUtr("LEGACY");
    const connectedUtr = generateUtr("CONN");

    // IDs populated during before() for the detail-endpoint tests.
    let legacyTxId: number;
    let connectedTxId: number;

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      const email = `legacy-deposit-test-${Date.now()}@example.com`;
      const [merchant] = await db.insert(merchantsTable).values({
        businessName: "Legacy Deposit Test Merchant",
        contactName: "Test Contact",
        email,
        phone: "9999999996",
        status: "approved",
        verificationStatus: "approved",
      }).returning();
      merchantId = merchant!.id;

      const [user] = await db.insert(usersTable).values({
        email,
        passwordHash: "not-a-real-hash",
        name: "Legacy Deposit Test User",
        role: "merchant",
        merchantId,
      }).returning();
      userId = user!.id;
      token = generateToken({ userId, role: "merchant" });

      // Legacy transaction: connectionId = NULL, provider stored directly on the row.
      // This simulates a deposit recorded before merchant-connections existed.
      const [legacyTx] = await db.insert(transactionsTable).values({
        merchantId,
        connectionId: null,
        provider: "cashfree",
        type: "deposit",
        status: "success",
        amount: "100.00",
        utr: legacyUtr,
        createdAt: new Date("2024-01-01T00:00:00Z"),
      }).returning();
      legacyTxId = legacyTx!.id;

      // Connection row for the same provider ('cashfree'), added/used AFTER the
      // legacy deposit.  Used to verify label consistency (CONTRACT 3).
      const [conn] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "cashfree",
        isActive: true,
      }).returning();
      connectionId = conn!.id;

      const [connectedTx] = await db.insert(transactionsTable).values({
        merchantId,
        connectionId,
        type: "deposit",
        status: "success",
        amount: "200.00",
        utr: connectedUtr,
        createdAt: new Date("2024-06-01T00:00:00Z"),
      }).returning();
      connectedTxId = connectedTx!.id;
    });

    after(async () => {
      await db.delete(transactionsTable).where(eq(transactionsTable.merchantId, merchantId));
      await db.delete(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, merchantId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
      await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("CONTRACT 1 — GET /api/transactions: legacy row (connectionId=NULL, provider='cashfree') has a non-null payinGatewayLabel", async () => {
      const res = await get(server, "/api/transactions?limit=20", token);
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const data = res.body["data"] as Array<Record<string, unknown>>;
      const legacyRow = data.find((tx) => String(tx["utr"]) === legacyUtr);
      assert.ok(legacyRow, `expected the legacy transaction (utr=${legacyUtr}) to appear in the list`);

      const label = legacyRow["payinGatewayLabel"];
      assert.ok(
        label != null && label !== "",
        `legacy deposit must have a non-null, non-empty payinGatewayLabel; got: ${JSON.stringify(label)}`,
      );
    });

    it("CONTRACT 2 — GET /api/transactions/:id: legacy row (connectionId=NULL, provider='cashfree') has a non-null payinGatewayLabel", async () => {
      const res = await get(server, `/api/transactions/${legacyTxId}`, token);
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const label = res.body["payinGatewayLabel"];
      assert.ok(
        label != null && label !== "",
        `detail endpoint for legacy deposit must return a non-null, non-empty payinGatewayLabel; got: ${JSON.stringify(label)}`,
      );
    });

    it("CONTRACT 3 — same provider string maps to the same label letter for both the legacy row and the connection-backed row", async () => {
      const res = await get(server, "/api/transactions?limit=20", token);
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const data = res.body["data"] as Array<Record<string, unknown>>;
      const legacyRow = data.find((tx) => String(tx["utr"]) === legacyUtr);
      const connectedRow = data.find((tx) => String(tx["utr"]) === connectedUtr);

      assert.ok(legacyRow, `expected the legacy transaction (utr=${legacyUtr}) in the list`);
      assert.ok(connectedRow, `expected the connection-backed transaction (utr=${connectedUtr}) in the list`);

      const legacyLabel = legacyRow["payinGatewayLabel"];
      const connectedLabel = connectedRow["payinGatewayLabel"];

      // Both transactions represent the same effective provider ('cashfree').
      // getStableProviderToLabel uses COALESCE so they resolve to the same key
      // and therefore must receive the same letter.
      assert.equal(
        legacyLabel,
        connectedLabel,
        `legacy row label (${JSON.stringify(legacyLabel)}) must match connection-backed row label (${JSON.stringify(connectedLabel)}) — both are cashfree`,
      );

      // Also confirm the shared label is non-null.
      assert.ok(
        legacyLabel != null && legacyLabel !== "",
        `shared gateway label must be non-null and non-empty; got: ${JSON.stringify(legacyLabel)}`,
      );

      // Both detail endpoints must agree with the list label.
      const legacyDetail = await get(server, `/api/transactions/${legacyTxId}`, token);
      const connectedDetail = await get(server, `/api/transactions/${connectedTxId}`, token);
      assert.equal(legacyDetail.status, 200, JSON.stringify(legacyDetail.body));
      assert.equal(connectedDetail.status, 200, JSON.stringify(connectedDetail.body));

      assert.equal(
        legacyDetail.body["payinGatewayLabel"],
        legacyLabel,
        "detail endpoint must agree with list endpoint for the legacy row",
      );
      assert.equal(
        connectedDetail.body["payinGatewayLabel"],
        connectedLabel,
        "detail endpoint must agree with list endpoint for the connection-backed row",
      );
    });
  },
);
