/**
 * Integration test: GET /api/transactions — admin gateway label behaviour
 * (real DB, no mocks).
 *
 * This test guards two deliberate design contracts for the admin view:
 *
 *  CONTRACT 1 — raw `connectionProvider` is ALWAYS present in admin responses.
 *    Merchant responses strip the raw key (white-label privacy); admin responses
 *    must always expose it so the ops team can identify the real provider.
 *    A refactor that accidentally removes `connectionProvider` from admin items
 *    (or sets it to `undefined` like the merchant path) will be caught here.
 *
 *  CONTRACT 2 — admin `payinGatewayLabel` uses a per-filter, alphabetically-
 *    sorted shortcut (NOT the stable first-use ordering that merchant views rely
 *    on). This is intentional: admins see the raw key already, so label
 *    stability across pagination/filters is irrelevant and the cheaper
 *    computation is acceptable. The test proves this by showing that the label
 *    assigned to a provider changes when the active filter changes — behaviour
 *    that would be WRONG for merchants but is expected and acceptable for admins.
 *
 * WARNING: If you ever need to surface `payinGatewayLabel` to admins in a
 * context where stability matters (e.g. a paginated export or a comparison
 * view), switch that code path to use `getStableProviderToLabel()` instead.
 * Do NOT just reuse the merchant code path without understanding that the
 * label letter will silently shift depending on the active filter.
 *
 * Scenario:
 *  - "cashfree" is added first (Jan 2024).
 *  - "airpay" is added later (Jun 2024), but sorts before "cashfree" alphabetically.
 *  - Merchant view: cashfree → "A", airpay → "B" (stable first-use order).
 *  - Admin view, all transactions: airpay → "A", cashfree → "B" (alphabetical).
 *  - Admin view, cashfree-only filter: cashfree → "A" (only provider in set).
 *  - Admin view, airpay-only filter:   airpay  → "A" (only provider in set).
 *
 * The label-shift between filter windows (cashfree is "B" unfiltered but "A"
 * when filtered to cashfree-only) is exactly what proves the per-filter path
 * is in use instead of the stable first-use path.
 *
 * A companion describe block at the bottom of this file tests the DETAIL route
 * (GET /api/transactions/:id) covering the same connectionProvider contract for
 * both connection-backed rows and legacy rows (connectionId=NULL, provider set
 * directly on the transaction).
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
  return `TESTUTR_ADMINGW_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

describe(
  "GET /api/transactions — admin gateway label contracts: raw connectionProvider exposed + per-filter label ordering (real DB)",
  () => {
    let server: http.Server;
    let adminToken: string;
    let merchantId: number;
    let merchantUserId: number;
    let adminUserId: number;
    let cashfreeConnId: number;
    let airpayConnId: number;

    const cashfreeUtr = generateUtr("CF");
    const airpayUtr = generateUtr("AP");

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      // Merchant & merchant user (we need a real merchant for the transactions)
      const email = `admingwlabel-test-${Date.now()}@example.com`;
      const [merchant] = await db.insert(merchantsTable).values({
        businessName: "Admin Gateway Label Test Merchant",
        contactName: "Test Contact",
        email,
        phone: "9999999997",
        status: "approved",
        verificationStatus: "approved",
      }).returning();
      merchantId = merchant!.id;

      const [merchantUser] = await db.insert(usersTable).values({
        email,
        passwordHash: "not-a-real-hash",
        name: "Admin GW Test Merchant User",
        role: "merchant",
        merchantId,
      }).returning();
      merchantUserId = merchantUser!.id;

      // Admin user — no merchantId
      const adminEmail = `admingwlabel-admin-${Date.now()}@example.com`;
      const [adminUser] = await db.insert(usersTable).values({
        email: adminEmail,
        passwordHash: "not-a-real-hash",
        name: "Admin GW Test Admin User",
        role: "admin",
      }).returning();
      adminUserId = adminUser!.id;
      adminToken = generateToken({ userId: adminUserId, role: "admin" });

      // "cashfree" connection & transaction — used first (Jan 2024)
      const [cashfreeConn] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "cashfree",
        isActive: true,
      }).returning();
      cashfreeConnId = cashfreeConn!.id;

      await db.insert(transactionsTable).values({
        merchantId,
        connectionId: cashfreeConnId,
        type: "deposit",
        status: "success",
        amount: "100.00",
        utr: cashfreeUtr,
        createdAt: new Date("2024-01-01T00:00:00Z"),
      });

      // "airpay" connection & transaction — used later (Jun 2024), but sorts
      // before "cashfree" alphabetically ("a" < "c").
      const [airpayConn] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "airpay",
        isActive: true,
      }).returning();
      airpayConnId = airpayConn!.id;

      await db.insert(transactionsTable).values({
        merchantId,
        connectionId: airpayConnId,
        type: "deposit",
        status: "success",
        amount: "200.00",
        utr: airpayUtr,
        createdAt: new Date("2024-06-01T00:00:00Z"),
      });
    });

    after(async () => {
      await db.delete(transactionsTable).where(eq(transactionsTable.merchantId, merchantId));
      await db.delete(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, merchantId));
      await db.delete(usersTable).where(eq(usersTable.id, merchantUserId));
      await db.delete(usersTable).where(eq(usersTable.id, adminUserId));
      await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    /**
     * CONTRACT 1: raw `connectionProvider` is always present in admin responses.
     *
     * This assertion will break if the admin branch is accidentally changed to
     * omit `connectionProvider` the way the merchant branch does
     * (`isMerchantUser ? undefined : r.connectionProvider`).
     */
    it("CONTRACT 1 — every admin transaction item exposes a non-null connectionProvider (raw provider key)", async () => {
      const res = await get(
        server,
        `/api/transactions?merchantId=${merchantId}&limit=20`,
        adminToken,
      );
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const data = res.body["data"] as Array<Record<string, unknown>>;

      const cfTx = data.find((tx) => String(tx["utr"]).includes("_CF_"));
      const apTx = data.find((tx) => String(tx["utr"]).includes("_AP_"));
      assert.ok(cfTx, "expected cashfree transaction in admin response");
      assert.ok(apTx, "expected airpay transaction in admin response");

      // Both items must include a non-null, non-undefined connectionProvider.
      assert.ok(
        cfTx["connectionProvider"] != null && cfTx["connectionProvider"] !== "",
        `cashfree transaction must expose connectionProvider; got: ${JSON.stringify(cfTx["connectionProvider"])}`,
      );
      assert.ok(
        apTx["connectionProvider"] != null && apTx["connectionProvider"] !== "",
        `airpay transaction must expose connectionProvider; got: ${JSON.stringify(apTx["connectionProvider"])}`,
      );

      assert.equal(cfTx["connectionProvider"], "cashfree", "raw connectionProvider for cashfree transaction must be 'cashfree'");
      assert.equal(apTx["connectionProvider"], "airpay",   "raw connectionProvider for airpay transaction must be 'airpay'");
    });

    /**
     * CONTRACT 2a: admin labels are alphabetically sorted across the full
     * unfiltered result set.
     *
     * "airpay" sorts before "cashfree" alphabetically, so it receives label "A"
     * even though cashfree was used first. This is the OPPOSITE of what the
     * stable merchant computation would produce, which is deliberate.
     *
     * If a refactor accidentally switches admin to use getStableProviderToLabel(),
     * cashfree would become "A" (first-used) and airpay "B", and this test
     * would fail — alerting the developer to the behaviour change.
     */
    it("CONTRACT 2a — admin labels are alphabetically ordered (NOT first-use stable): airpay → 'A', cashfree → 'B' when both are present", async () => {
      const res = await get(
        server,
        `/api/transactions?merchantId=${merchantId}&limit=20`,
        adminToken,
      );
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const data = res.body["data"] as Array<Record<string, unknown>>;

      const cfTx = data.find((tx) => String(tx["utr"]).includes("_CF_"));
      const apTx = data.find((tx) => String(tx["utr"]).includes("_AP_"));
      assert.ok(cfTx, "expected cashfree transaction in admin response");
      assert.ok(apTx, "expected airpay transaction in admin response");

      // Alphabetical ordering: "airpay" < "cashfree" → airpay is "A", cashfree is "B".
      assert.equal(
        apTx["payinGatewayLabel"],
        "Payment Gateway A",
        "admin: airpay (alphabetically first) must be labeled 'Payment Gateway A' in the unfiltered set",
      );
      assert.equal(
        cfTx["payinGatewayLabel"],
        "Payment Gateway B",
        "admin: cashfree (alphabetically second) must be labeled 'Payment Gateway B' in the unfiltered set",
      );
    });

    /**
     * CONTRACT 2b: admin label shifts when the filter changes — proving the
     * per-filter shortcut is in use, NOT the stable first-use computation.
     *
     * When filtering to cashfree-only transactions, cashfree is the only provider
     * in the filtered set, so it becomes "Payment Gateway A". When filtering to
     * airpay-only, airpay similarly becomes "Payment Gateway A". This label shift
     * between filter windows is the hallmark of the per-filter computation and
     * confirms that a stable pre-computed map is NOT being used for admins.
     *
     * Contrast with the merchant view where cashfree would ALWAYS be "A"
     * regardless of which provider-filter is active.
     */
    it("CONTRACT 2b — admin label shifts across filter windows (per-filter computation confirmed)", async () => {
      // Cashfree-only filter: cashfree is the sole provider → must be "A".
      const cfOnly = await get(
        server,
        `/api/transactions?merchantId=${merchantId}&connectionProvider=cashfree&limit=20`,
        adminToken,
      );
      assert.equal(cfOnly.status, 200, JSON.stringify(cfOnly.body));
      const cfOnlyData = cfOnly.body["data"] as Array<Record<string, unknown>>;
      const cfOnlyTx = cfOnlyData.find((tx) => String(tx["utr"]).includes("_CF_"));
      assert.ok(cfOnlyTx, "expected cashfree transaction when filtering by connectionProvider=cashfree");
      assert.equal(
        cfOnlyTx["payinGatewayLabel"],
        "Payment Gateway A",
        "admin: cashfree is the only provider in the cashfree-filtered set, so it must be 'Payment Gateway A'",
      );

      // Airpay-only filter: airpay is the sole provider → must be "A".
      const apOnly = await get(
        server,
        `/api/transactions?merchantId=${merchantId}&connectionProvider=airpay&limit=20`,
        adminToken,
      );
      assert.equal(apOnly.status, 200, JSON.stringify(apOnly.body));
      const apOnlyData = apOnly.body["data"] as Array<Record<string, unknown>>;
      const apOnlyTx = apOnlyData.find((tx) => String(tx["utr"]).includes("_AP_"));
      assert.ok(apOnlyTx, "expected airpay transaction when filtering by connectionProvider=airpay");
      assert.equal(
        apOnlyTx["payinGatewayLabel"],
        "Payment Gateway A",
        "admin: airpay is the only provider in the airpay-filtered set, so it must be 'Payment Gateway A'",
      );

      // The shift is the key signal: cashfree was "B" in the unfiltered view
      // (CONTRACT 2a above) but is "A" here. This proves the label is derived
      // from the current filtered set, NOT from a pre-computed stable map.
    });
  },
);

/**
 * Detail route contract: GET /api/transactions/:id
 *
 *  CONTRACT D1 — admin detail response always exposes a non-null
 *    `connectionProvider` equal to the real provider key for a
 *    connection-backed row (connectionId set, LEFT JOIN resolves the provider).
 *
 *  CONTRACT D2 — admin detail response exposes a non-null `connectionProvider`
 *    even for legacy rows where connectionId=NULL but the `provider` column on
 *    the transaction row itself is set. The detail route must fall back to
 *    `transactions.provider` so that ops never sees a blank raw provider key.
 *
 *  CONTRACT D3 — merchant detail response never exposes `connectionProvider`
 *    (white-label privacy). The field must be absent (undefined) for merchant
 *    users even when the provider is known.
 */
describe(
  "GET /api/transactions/:id — admin detail always exposes raw connectionProvider (real DB)",
  () => {
    let server: http.Server;
    let adminToken: string;
    let merchantToken: string;
    let merchantId: number;
    let merchantUserId: number;
    let adminUserId: number;
    let connBackedTxId: number;   // transaction with connectionId set
    let legacyTxId: number;       // transaction with connectionId=NULL, provider set directly

    const connBackedUtr = generateUtr("DETAIL_CONN");
    const legacyUtr     = generateUtr("DETAIL_LEGACY");

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      // Create a dedicated merchant for this suite
      const email = `admingw-detail-${Date.now()}@example.com`;
      const [merchant] = await db.insert(merchantsTable).values({
        businessName: "Admin GW Detail Test Merchant",
        contactName: "Detail Contact",
        email,
        phone: "9999999996",
        status: "approved",
        verificationStatus: "approved",
      }).returning();
      merchantId = merchant!.id;

      const [merchantUser] = await db.insert(usersTable).values({
        email,
        passwordHash: "not-a-real-hash",
        name: "Admin GW Detail Merchant User",
        role: "merchant",
        merchantId,
      }).returning();
      merchantUserId = merchantUser!.id;
      merchantToken = generateToken({ userId: merchantUserId, role: "merchant" });

      const adminEmail = `admingw-detail-admin-${Date.now()}@example.com`;
      const [adminUser] = await db.insert(usersTable).values({
        email: adminEmail,
        passwordHash: "not-a-real-hash",
        name: "Admin GW Detail Admin User",
        role: "admin",
      }).returning();
      adminUserId = adminUser!.id;
      adminToken = generateToken({ userId: adminUserId, role: "admin" });

      // CONNECTION-BACKED transaction: has a real merchant_connection row
      const [conn] = await db.insert(merchantConnectionsTable).values({
        merchantId,
        provider: "razorpay",
        isActive: true,
      }).returning();

      const [connBacked] = await db.insert(transactionsTable).values({
        merchantId,
        connectionId: conn!.id,
        type: "deposit",
        status: "success",
        amount: "500.00",
        utr: connBackedUtr,
        createdAt: new Date("2024-03-01T00:00:00Z"),
      }).returning();
      connBackedTxId = connBacked!.id;

      // LEGACY transaction: connectionId=NULL, provider set directly on the row
      const [legacy] = await db.insert(transactionsTable).values({
        merchantId,
        connectionId: null,
        provider: "ekqr",
        type: "deposit",
        status: "success",
        amount: "250.00",
        utr: legacyUtr,
        createdAt: new Date("2023-11-01T00:00:00Z"),
      }).returning();
      legacyTxId = legacy!.id;
    });

    after(async () => {
      await db.delete(transactionsTable).where(eq(transactionsTable.merchantId, merchantId));
      await db.delete(merchantConnectionsTable).where(eq(merchantConnectionsTable.merchantId, merchantId));
      await db.delete(usersTable).where(eq(usersTable.id, merchantUserId));
      await db.delete(usersTable).where(eq(usersTable.id, adminUserId));
      await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    /**
     * CONTRACT D1: connection-backed row.
     * The LEFT JOIN resolves merchantConnectionsTable.provider; the admin
     * detail response must expose that value as `connectionProvider`.
     */
    it("CONTRACT D1 — admin detail for connection-backed row exposes non-null connectionProvider equal to the connection provider", async () => {
      const res = await get(server, `/api/transactions/${connBackedTxId}`, adminToken);
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const body = res.body as Record<string, unknown>;
      assert.ok(
        body["connectionProvider"] != null && body["connectionProvider"] !== "",
        `connectionProvider must be non-null for a connection-backed row; got: ${JSON.stringify(body["connectionProvider"])}`,
      );
      assert.equal(
        body["connectionProvider"],
        "razorpay",
        "connectionProvider must equal the provider on the merchant_connection row",
      );
    });

    /**
     * CONTRACT D2: legacy row (connectionId=NULL, provider set directly).
     * The LEFT JOIN yields NULL for merchantConnectionsTable.provider, so the
     * detail route must fall back to transactions.provider to populate the
     * `connectionProvider` field. Without this fallback, admins would see a
     * blank raw key for every pre-connection transaction.
     */
    it("CONTRACT D2 — admin detail for legacy row (connectionId=NULL) falls back to transactions.provider, never blank", async () => {
      const res = await get(server, `/api/transactions/${legacyTxId}`, adminToken);
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const body = res.body as Record<string, unknown>;
      assert.ok(
        body["connectionProvider"] != null && body["connectionProvider"] !== "",
        `connectionProvider must be non-null even when connectionId is NULL; got: ${JSON.stringify(body["connectionProvider"])}`,
      );
      assert.equal(
        body["connectionProvider"],
        "ekqr",
        "connectionProvider must fall back to transactions.provider for legacy rows",
      );
    });

    /**
     * CONTRACT D3: merchant detail response must never expose connectionProvider.
     * White-label privacy: merchants see a gateway label, not the raw provider key.
     */
    it("CONTRACT D3 — merchant detail response never exposes connectionProvider (white-label privacy)", async () => {
      const res = await get(server, `/api/transactions/${connBackedTxId}`, merchantToken);
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const body = res.body as Record<string, unknown>;
      assert.ok(
        !("connectionProvider" in body) || body["connectionProvider"] === undefined,
        `connectionProvider must be absent from merchant detail response; got: ${JSON.stringify(body["connectionProvider"])}`,
      );
    });
  },
);
