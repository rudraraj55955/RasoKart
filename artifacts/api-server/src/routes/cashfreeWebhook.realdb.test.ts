import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import app from "../app";
import {
  setCashfreeWebhookTestBeforeCreditHook,
} from "./cashfreeWebhook";

process.env.NODE_ENV = "test";

const TEST_RUN = `${process.pid}-${Date.now()}`;
const MERCHANT_EMAIL = `cashfree-webhook-realdb-${TEST_RUN}@rasokart.test`;
const WEBHOOK_SECRET = `cashfree-webhook-secret-${TEST_RUN}`;
const CLIENT_SECRET = `cashfree-client-secret-${TEST_RUN}`;
const CONFIG_KEYS = ["cashfree_enabled", "cashfree_webhook_secret", "cashfree_client_secret"] as const;

type HttpResult = { status: number; body: Record<string, unknown> };

function signedBody(body: unknown, secret: string): { raw: string; headers: Record<string, string> } {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(timestamp + raw).digest("base64");
  return {
    raw,
    headers: {
      "content-type": "application/json",
      "x-webhook-timestamp": timestamp,
      "x-webhook-signature": signature,
    },
  };
}

function post(server: http.Server, payload: unknown, secret: string): Promise<HttpResult> {
  const { raw, headers } = signedBody(payload, secret);
  const address = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/api/payment/cashfree-webhook",
      method: "POST",
      headers: { ...headers, "content-length": Buffer.byteLength(raw) },
    }, (response) => {
      let text = "";
      response.on("data", (chunk: Buffer) => { text += chunk.toString(); });
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        body: JSON.parse(text) as Record<string, unknown>,
      }));
    });
    request.on("error", reject);
    request.end(raw);
  });
}

function payload(orderId: string, amount = "500.00", currency = "INR", paymentId = orderId): unknown {
  return {
    type: "PAYMENT_SUCCESS_WEBHOOK",
    data: {
      order: { order_id: orderId, order_currency: currency },
      payment: {
        payment_status: "SUCCESS",
        payment_amount: amount,
        payment_currency: currency,
        cf_payment_id: paymentId,
      },
    },
  };
}

async function queryOne<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute(query);
  return result.rows[0] as T;
}

async function insertOrder(orderId: string, amount = "500.00", currency = "INR"): Promise<void> {
  await db.execute(sql`
    INSERT INTO cashfree_payment_orders
      (merchant_id, cashfree_order_id, amount, currency, status)
    VALUES
      (${merchantId}, ${orderId}, ${amount}, ${currency}, 'CREATED')
  `);
}

let merchantId: number;
let configSnapshot: Array<{ key: string; value: string }> = [];
let configSnapshotCaptured = false;

async function counts(orderId: string): Promise<{ status: string; pending: string; ledger: string; transactions: string }> {
  const row = await queryOne<{
    status: string;
    pending: string;
    ledger: string;
    transactions: string;
  }>(sql`
    SELECT
      (SELECT status FROM cashfree_payment_orders WHERE cashfree_order_id = ${orderId}) AS status,
      (SELECT pending_balance FROM merchant_wallets WHERE merchant_id = ${merchantId}) AS pending,
      (SELECT count(*)::text FROM wallet_ledger WHERE merchant_id = ${merchantId}
        AND description LIKE ${`%order ${orderId},%`}) AS ledger,
      (SELECT count(*)::text FROM transactions WHERE reference_id = ${orderId}) AS transactions
  `);
  return row;
}

async function cleanupOrder(orderId: string): Promise<void> {
  await db.execute(sql`DELETE FROM cashfree_payment_logs WHERE cashfree_order_id = ${orderId}`);
  await db.execute(sql`DELETE FROM wallet_ledger WHERE merchant_id = ${merchantId} AND description LIKE ${`%order ${orderId},%`}`);
  await db.execute(sql`DELETE FROM transactions WHERE reference_id = ${orderId}`);
  await db.execute(sql`DELETE FROM cashfree_payment_orders WHERE cashfree_order_id = ${orderId}`);
}

describe("Cashfree webhook (HTTP + real PostgreSQL)", { concurrency: false }, () => {
  let server: http.Server;

  before(async () => {
    const merchant = await db.execute(sql`
      INSERT INTO merchants (business_name, contact_name, email, phone, status, verification_status)
      VALUES ('Cashfree webhook test', 'Test', ${MERCHANT_EMAIL}, '9000009971', 'approved', 'approved')
      RETURNING id
    `);
    merchantId = Number((merchant.rows[0] as { id: number }).id);
    await db.execute(sql`
      INSERT INTO merchant_wallets (merchant_id, available_balance, pending_balance, total_collection)
      VALUES (${merchantId}, '0', '0', '0')
      ON CONFLICT (merchant_id) DO UPDATE SET pending_balance = '0', total_collection = '0'
    `);
    configSnapshot = (await db.execute(sql`
      SELECT key, value FROM system_config
      WHERE key IN (${sql.join(CONFIG_KEYS.map((key) => sql`${key}`), sql`, `)})
    `)).rows as Array<{ key: string; value: string }>;
    configSnapshotCaptured = true;
    for (const [key, value] of [
      [CONFIG_KEYS[0], "true"],
      [CONFIG_KEYS[1], WEBHOOK_SECRET],
      [CONFIG_KEYS[2], CLIENT_SECRET],
    ]) {
      await db.execute(sql`
        INSERT INTO system_config (key, value)
        VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `);
    }
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  after(async () => {
    setCashfreeWebhookTestBeforeCreditHook(null);
    await db.execute(sql`DELETE FROM cashfree_payment_logs WHERE merchant_id = ${merchantId}`);
    await db.execute(sql`DELETE FROM wallet_ledger WHERE merchant_id = ${merchantId}`);
    await db.execute(sql`DELETE FROM transactions WHERE merchant_id = ${merchantId}`);
    await db.execute(sql`DELETE FROM cashfree_payment_orders WHERE merchant_id = ${merchantId}`);
    await db.execute(sql`DELETE FROM payout_wallet_load_orders WHERE merchant_id = ${merchantId}`);
    await db.execute(sql`DELETE FROM merchant_wallets WHERE merchant_id = ${merchantId}`);
    await db.execute(sql`DELETE FROM merchants WHERE id = ${merchantId}`);
    if (configSnapshotCaptured) {
      await db.execute(sql`DELETE FROM system_config WHERE key IN (${sql.join(CONFIG_KEYS.map((key) => sql`${key}`), sql`, `)})`);
      for (const row of configSnapshot) {
        await db.execute(sql`
          INSERT INTO system_config (key, value) VALUES (${row.key}, ${row.value})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `);
      }
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("accepts webhook and client secrets when both are configured", async () => {
    for (const [suffix, secret] of [["webhook", WEBHOOK_SECRET], ["client", CLIENT_SECRET]] as const) {
      const orderId = `CF_REAL_SECRET_${suffix}`;
      await insertOrder(orderId);
      const response = await post(server, payload(orderId), secret);
      assert.equal(response.status, 200);
      assert.equal((await counts(orderId)).status, "PAID");
      await cleanupOrder(orderId);
    }
  });

  it("rejects invalid signatures without mutation", async () => {
    const orderId = "CF_REAL_INVALID";
    await insertOrder(orderId);
    const { raw, headers } = signedBody(payload(orderId), "wrong-secret");
    const response = await new Promise<HttpResult>((resolve, reject) => {
      const address = server.address() as { port: number };
      const request = http.request({ hostname: "127.0.0.1", port: address.port, path: "/api/payment/cashfree-webhook", method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(raw) } }, (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => { text += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }));
      });
      request.on("error", reject);
      request.end(raw);
    });
    assert.equal(response.status, 401);
    assert.equal((await counts(orderId)).status, "CREATED");
    await cleanupOrder(orderId);
  });

  it("rejects amount and currency mismatches without mutation", async () => {
    for (const [suffix, amount, currency] of [["AMOUNT", "499.00", "INR"], ["CURRENCY", "500.00", "USD"]] as const) {
      const orderId = `CF_REAL_MISMATCH_${suffix}`;
      await insertOrder(orderId);
      const response = await post(server, payload(orderId, amount, currency), WEBHOOK_SECRET);
      assert.equal(response.status, 400);
      assert.equal((await counts(orderId)).status, "CREATED");
      await cleanupOrder(orderId);
    }
  });

  it("rejects wallet-load amount and currency mismatches before credit", async () => {
    const loadId = "CF_REAL_LOAD_9971";
    const orderId = `WLOAD_${loadId}`;
    await db.execute(sql`
      INSERT INTO payout_wallet_load_orders
        (load_id, merchant_id, amount, fee_amount, gst_amount, net_credit_amount, method, status, internal_order_id)
      VALUES
        (${loadId}, ${merchantId}, '500.00', '0', '0', '500.00', 'ONLINE', 'CREATED', ${orderId})
    `);
    const pendingBefore = Number((await queryOne<{ pending_balance: string }>(
      sql`SELECT pending_balance FROM merchant_wallets WHERE merchant_id = ${merchantId}`,
    )).pending_balance);
    for (const [amount, currency] of [["499.00", "INR"], ["500.00", "USD"]] as const) {
      const response = await post(server, payload(orderId, amount, currency), WEBHOOK_SECRET);
      assert.equal(response.status, 400);
    }
    const result = await queryOne<{ status: string; pending_balance: string }>(sql`
      SELECT p.status, w.pending_balance
      FROM payout_wallet_load_orders p
      JOIN merchant_wallets w ON w.merchant_id = p.merchant_id
      WHERE p.internal_order_id = ${orderId}
    `);
    assert.equal(result.status, "CREATED");
    assert.equal(Number(result.pending_balance), pendingBefore);
    await db.execute(sql`DELETE FROM payout_wallet_load_orders WHERE internal_order_id = ${orderId}`);
  });

  it("credits duplicate and concurrent deliveries exactly once", async () => {
    const orderId = "CF_REAL_DUPLICATE";
    const pendingBefore = Number((await queryOne<{ pending_balance: string }>(
      sql`SELECT pending_balance FROM merchant_wallets WHERE merchant_id = ${merchantId}`,
    )).pending_balance);
    await insertOrder(orderId);
    const body = payload(orderId);
    const responses = await Promise.all([post(server, body, WEBHOOK_SECRET), post(server, body, WEBHOOK_SECRET)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);
    const result = await counts(orderId);
    assert.equal(result.status, "PAID");
    assert.equal(result.ledger, "1");
    assert.equal(result.transactions, "1");
    assert.equal(Number(result.pending) - pendingBefore, 500);
    await cleanupOrder(orderId);
  });

  it("returns retryable failure and credits after a provider retry", async () => {
    const orderId = "CF_REAL_RETRY";
    await insertOrder(orderId);
    setCashfreeWebhookTestBeforeCreditHook(() => {
      setCashfreeWebhookTestBeforeCreditHook(null);
      throw new Error("injected Cashfree transaction failure");
    });
    assert.equal((await post(server, payload(orderId), WEBHOOK_SECRET)).status, 503);
    assert.equal((await counts(orderId)).status, "CREATED");
    assert.equal((await post(server, payload(orderId), WEBHOOK_SECRET)).status, 200);
    assert.equal((await counts(orderId)).status, "PAID");
    await cleanupOrder(orderId);
  });

  it("rolls back the order and wallet when the transaction UTR conflicts", async () => {
    const orderId = "CF_REAL_UTR_CONFLICT";
    const paymentId = "CF_REAL_EXISTING_UTR";
    await insertOrder(orderId);
    await db.execute(sql`
      INSERT INTO transactions
        (merchant_id, provider, type, status, amount, currency, utr, reference_id)
      VALUES
        (${merchantId}, 'cashfree', 'deposit', 'success', '500.00', 'INR', ${`CF-${paymentId}`}, 'existing-conflict')
    `);
    const pendingBefore = Number((await queryOne<{ pending_balance: string }>(
      sql`SELECT pending_balance FROM merchant_wallets WHERE merchant_id = ${merchantId}`,
    )).pending_balance);
    assert.equal((await post(server, payload(orderId, "500.00", "INR", paymentId), WEBHOOK_SECRET)).status, 503);
    const result = await counts(orderId);
    assert.equal(result.status, "CREATED");
    assert.equal(Number(result.pending), pendingBefore);
    assert.equal(result.ledger, "0");
    await db.execute(sql`DELETE FROM transactions WHERE utr = ${`CF-${paymentId}`}`);
    await cleanupOrder(orderId);
  });
});