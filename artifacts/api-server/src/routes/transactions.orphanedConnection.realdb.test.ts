/**
 * Integration test: orphaned connectionId (connection row hard-deleted while
 * transactions still reference it) — the payinGatewayLabel must not go blank.
 *
 * When a merchant_connections row is hard-deleted, the LEFT JOIN in
 * getStableProviderToLabel and in the detail route produces NULL for
 * merchantConnectionsTable.provider.  The COALESCE / nullish-coalesce fallback
 * to transactions.provider is the only remaining safety net.  This test
 * exercises that path so any future change to the fallback is an explicit,
 * visible decision.
 *
 * Test contracts:
 *
 *  CONTRACT 1 — orphaned list label:
 *    A transaction that had a valid connectionId which was subsequently
 *    hard-deleted still appears in GET /api/transactions with a non-null,
 *    non-empty payinGatewayLabel, because transactions.provider acts as
 *    the fallback.
 *
 *  CONTRACT 2 — orphaned detail label:
 *    GET /api/transactions/:id for the same orphaned row also returns a
 *    non-null, non-empty payinGatewayLabel.
 *
 *  CONTRACT 3 — label continuity after deletion:
 *    A second transaction for the same merchant that still has a live
 *    connection row (provider = 'cashfree') must map to the SAME label
 *    letter as the orphaned row, because both resolve to the same
 *    effective provider string via their respective fallback paths.
 *
 *  CONTRACT 4 — null-provider orphan degrades gracefully:
 *    A transaction whose connection row is deleted AND which has no
 *    transactions.provider fallback (provider = NULL) returns
 *    payinGatewayLabel = null — the documented graceful-degradation
 *    behaviour rather than a runtime error.
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
  return `TESTUTR_ORPHAN_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

describe(
  "Orphaned connectionId (connection row deleted) — payinGatewayLabel must not go blank (real DB)",
  () => {
    let server: http.Server;
    let token: string;
    let merchantId: number;
    let userId: number;

    // UTRs generated once so we can reliably locate the right rows.
    const orphanedUtr = generateUtr("ORPHANED");
    const liveUtr = generateUtr("LIVE");
    const noProviderUtr = generateUtr("NOPROV");

    let orphanedTxId: number;
    let liveTxId: number;
    let noProviderTxId: number;

    // The connection id that will be hard-deleted to create the orphan scenario.
    let deletedConnectionId: number;
    // A second connection that stays live for CONTRACT 3.
    let liveConnectionId: number;
    // A third connection (no-provider fallback) that will be deleted for CONTRACT 4.
    let noProviderConnectionId: number;

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      const email = `orphan-conn-test-${Date.now()}@example.com`;
      const [merchant] = await db.insert(merchantsTable).values({
        businessName: "Orphan Connection Test Merchant",
        contactName: "Test Contact",
        email,
        phone: "9999999994",
        status: "approved",
        verificationStatus: "approved",
      }).returning();
      merchantId = merchant!.id;

      const [user] = await db.insert(usersTable).values({
        email,
        passwordHash: "not-a-real-hash",
        name: "Orphan Connection Test User",
        role: "merchant",
        merchantId,
      }).returning();
      userId = user!.id;
      token = generateToken({ userId, role: "merchant" });

      // --- Connection that will be deleted to simulate hard-deletion ---
      const [deletedConn] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "cashfree",
        isActive: true,
      }).returning();
      deletedConnectionId = deletedConn!.id;

      // Transaction referencing the soon-to-be-deleted connection.
      // Also has transactions.provider set so the fallback works.
      const [orphanedTx] = await db.insert(transactionsTable).values({
        merchantId,
        connectionId: deletedConnectionId,
        provider: "cashfree",      // fallback when connection row is gone
        type: "deposit",
        status: "success",
        amount: "150.00",
        utr: orphanedUtr,
        createdAt: new Date("2024-03-01T00:00:00Z"),
      }).returning();
      orphanedTxId = orphanedTx!.id;

      // Hard-delete the connection NOW (before inserting the live cashfree
      // connection below) — merchant_connections has a UNIQUE(merchant_id,
      // provider) constraint, so two coexisting cashfree rows for the same
      // merchant would violate it on a fresh DB.
      await db.delete(merchantConnectionsTable).where(eq(merchantConnectionsTable.id, deletedConnectionId));

      // --- Live connection (stays alive) for CONTRACT 3 ---
      const [liveConn] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "cashfree",
        isActive: true,
      }).returning();
      liveConnectionId = liveConn!.id;

      const [liveTx] = await db.insert(transactionsTable).values({
        merchantId,
        connectionId: liveConnectionId,
        provider: "cashfree",
        type: "deposit",
        status: "success",
        amount: "250.00",
        utr: liveUtr,
        createdAt: new Date("2024-04-01T00:00:00Z"),
      }).returning();
      liveTxId = liveTx!.id;

      // --- Connection for no-provider-fallback scenario (CONTRACT 4) ---
      const [noProvConn] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "razorpay",
        isActive: true,
      }).returning();
      noProviderConnectionId = noProvConn!.id;

      // Transaction referencing the above connection; provider column left NULL
      // so there is no fallback after the connection is deleted.
      const [noProvTx] = await db.insert(transactionsTable).values({
        merchantId,
        connectionId: noProviderConnectionId,
        provider: null,            // no fallback available
        type: "deposit",
        status: "success",
        amount: "50.00",
        utr: noProviderUtr,
        createdAt: new Date("2024-05-01T00:00:00Z"),
      }).returning();
      noProviderTxId = noProvTx!.id;

      // Hard-delete the no-provider connection so its JOIN produces NULL.
      // (deletedConnectionId was already removed above, before liveConn was
      // inserted, to satisfy the UNIQUE(merchant_id, provider) constraint.)
      await db.delete(merchantConnectionsTable).where(eq(merchantConnectionsTable.id, noProviderConnectionId));
    });

    after(async () => {
      await db.delete(transactionsTable).where(eq(transactionsTable.merchantId, merchantId));
      // liveConnectionId was not deleted in before(); clean it up now.
      await db.delete(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, merchantId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
      await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("CONTRACT 1 — GET /api/transactions: orphaned row (connection deleted, provider fallback present) has a non-null payinGatewayLabel", async () => {
      const res = await get(server, "/api/transactions?limit=50", token);
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const data = res.body["data"] as Array<Record<string, unknown>>;
      const orphanedRow = data.find((tx) => String(tx["utr"]) === orphanedUtr);
      assert.ok(
        orphanedRow,
        `expected orphaned transaction (utr=${orphanedUtr}) to appear in the list`,
      );

      const label = orphanedRow["payinGatewayLabel"];
      assert.ok(
        label != null && label !== "",
        `orphaned deposit with provider fallback must have a non-null, non-empty payinGatewayLabel; got: ${JSON.stringify(label)}`,
      );
    });

    it("CONTRACT 2 — GET /api/transactions/:id: orphaned row (connection deleted, provider fallback present) has a non-null payinGatewayLabel", async () => {
      const res = await get(server, `/api/transactions/${orphanedTxId}`, token);
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const label = res.body["payinGatewayLabel"];
      assert.ok(
        label != null && label !== "",
        `detail endpoint for orphaned deposit must return a non-null, non-empty payinGatewayLabel; got: ${JSON.stringify(label)}`,
      );
    });

    it("CONTRACT 3 — orphaned row and live-connection row for the same provider string map to the same label letter", async () => {
      const res = await get(server, "/api/transactions?limit=50", token);
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const data = res.body["data"] as Array<Record<string, unknown>>;
      const orphanedRow = data.find((tx) => String(tx["utr"]) === orphanedUtr);
      const liveRow = data.find((tx) => String(tx["utr"]) === liveUtr);

      assert.ok(orphanedRow, `expected orphaned transaction (utr=${orphanedUtr}) in the list`);
      assert.ok(liveRow, `expected live-connection transaction (utr=${liveUtr}) in the list`);

      const orphanedLabel = orphanedRow["payinGatewayLabel"];
      const liveLabel = liveRow["payinGatewayLabel"];

      // Both resolve to 'cashfree' via their respective paths (fallback vs live join)
      // so getStableProviderToLabel must assign them the same letter.
      assert.equal(
        orphanedLabel,
        liveLabel,
        `orphaned row label (${JSON.stringify(orphanedLabel)}) must match live-connection row label (${JSON.stringify(liveLabel)}) — both represent cashfree`,
      );

      assert.ok(
        orphanedLabel != null && orphanedLabel !== "",
        `shared label must be non-null and non-empty; got: ${JSON.stringify(orphanedLabel)}`,
      );

      // Detail endpoints must agree with the list labels.
      const orphanedDetail = await get(server, `/api/transactions/${orphanedTxId}`, token);
      const liveDetail = await get(server, `/api/transactions/${liveTxId}`, token);
      assert.equal(orphanedDetail.status, 200, JSON.stringify(orphanedDetail.body));
      assert.equal(liveDetail.status, 200, JSON.stringify(liveDetail.body));

      assert.equal(
        orphanedDetail.body["payinGatewayLabel"],
        orphanedLabel,
        "detail endpoint must agree with list endpoint for the orphaned row",
      );
      assert.equal(
        liveDetail.body["payinGatewayLabel"],
        liveLabel,
        "detail endpoint must agree with list endpoint for the live-connection row",
      );
    });

    it("CONTRACT 4 — orphaned row with no provider fallback (provider=NULL) returns payinGatewayLabel=null gracefully, not an error", async () => {
      // List endpoint — row must appear (status 200) and label must be null.
      const listRes = await get(server, "/api/transactions?limit=50", token);
      assert.equal(listRes.status, 200, JSON.stringify(listRes.body));

      const data = listRes.body["data"] as Array<Record<string, unknown>>;
      const noProvRow = data.find((tx) => String(tx["utr"]) === noProviderUtr);
      assert.ok(
        noProvRow,
        `expected no-provider-fallback transaction (utr=${noProviderUtr}) to appear in the list`,
      );
      assert.equal(
        noProvRow["payinGatewayLabel"],
        null,
        `a deleted-connection + null-provider row must degrade to payinGatewayLabel=null (not an error); got: ${JSON.stringify(noProvRow["payinGatewayLabel"])}`,
      );

      // Detail endpoint — must return 200, not 500, and label must be null.
      const detailRes = await get(server, `/api/transactions/${noProviderTxId}`, token);
      assert.equal(detailRes.status, 200, JSON.stringify(detailRes.body));
      assert.equal(
        detailRes.body["payinGatewayLabel"],
        null,
        `detail endpoint must return null payinGatewayLabel for no-fallback orphan; got: ${JSON.stringify(detailRes.body["payinGatewayLabel"])}`,
      );
    });
  },
);
