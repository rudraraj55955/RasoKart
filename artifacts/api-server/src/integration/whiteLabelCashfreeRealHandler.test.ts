import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHmac } from "node:crypto";
import pg from "pg";
import { getIsolatedWhiteLabelTestDatabaseUrl } from "../lib/whiteLabelPgTestSafety";

test("actual Cashfree webhook HTTP handler rejects unauthenticated payout on isolated DB", async () => {
  const url = getIsolatedWhiteLabelTestDatabaseUrl(process.env);
  process.env.DATABASE_URL = url;
  const pool = new pg.Pool({ connectionString: url });
  await pool.query(`CREATE TABLE IF NOT EXISTS system_config (
    key varchar(100) PRIMARY KEY, value text NOT NULL,
    updated_at timestamp NOT NULL DEFAULT now(), updated_by_email varchar(255)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS cashfree_payout_webhook_logs (
    id serial PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now(),
    endpoint text, event_type text, status text, signature_verified boolean,
    payout_id integer, transfer_id text, cf_transfer_id text, utr text,
    safe_error text, processing_result text NOT NULL DEFAULT 'received', raw_payload text
  )`);
  // Local synthetic credential only; no provider requests or production secrets.
  await pool.query("INSERT INTO system_config(key,value) VALUES ('cashfree_payout_env','test'),('cashfree_payout_webhook_secret','synthetic_local_test_secret_123') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const { default: router } = await import("../routes/cashfreePayoutWebhook");
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = Buffer.from(buf); } }));
  app.use("/api/cashfree-payout/webhook", router);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Listener unavailable");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/cashfree-payout/webhook`, {
      method: "POST", headers: {
        "Content-Type": "application/json",
        "x-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-webhook-signature": "invalid_signature",
      },
      body: JSON.stringify({ type: "TRANSFER_SUCCESS", data: { transfer: { transfer_id: "fake_test_transfer", transfer_status: "SUCCESS" } } }),
    });
    assert.equal(response.status, 401);
    const rows = await pool.query("SELECT signature_verified, processing_result FROM cashfree_payout_webhook_logs ORDER BY id DESC LIMIT 1");
    assert.equal(rows.rows[0]?.signature_verified, false);
    assert.equal(rows.rows[0]?.processing_result, "rejected");
    // Authenticated TEST events must be acknowledged without touching payout tables.
    const body = JSON.stringify({ type: "WEBHOOK_TEST", data: {} });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "synthetic_local_test_secret_123")
      .update(timestamp + body).digest("base64");
    for (let n = 0; n < 2; n++) {
      const ok = await fetch(`http://127.0.0.1:${address.port}/api/cashfree-payout/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json",
          "x-webhook-timestamp": timestamp, "x-webhook-signature": signature },
        body,
      });
      assert.equal(ok.status, 200);
    }
    const verified = await pool.query(
      "SELECT signature_verified, processing_result FROM cashfree_payout_webhook_logs ORDER BY id DESC LIMIT 2",
    );
    assert.equal(verified.rows.length, 2);
    for (const event of verified.rows) {
      assert.equal(event.signature_verified, true);
      assert.equal(event.processing_result, "ignored");
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end();
  }
});
