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
    // Signed financial events with no matching payout/withdrawal must be
    // recorded as unmatched. No money-moving updates should be attempted.
    // These are synthetic messages, not Cashfree sandbox requests.
    await pool.query(`CREATE TABLE IF NOT EXISTS cashfree_payouts (
      id serial PRIMARY KEY, transfer_id varchar(255) NOT NULL UNIQUE,
      cashfree_transfer_id varchar(255)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS withdrawals (
      id serial PRIMARY KEY, provider_reference_id text
    )`);
    await pool.query(`ALTER TABLE cashfree_payouts
      ADD COLUMN IF NOT EXISTS public_transfer_id varchar(64),
      ADD COLUMN IF NOT EXISTS provider_key varchar(64),
      ADD COLUMN IF NOT EXISTS beneficiary_name varchar(255),
      ADD COLUMN IF NOT EXISTS account_number varchar(100),
      ADD COLUMN IF NOT EXISTS ifsc varchar(20),
      ADD COLUMN IF NOT EXISTS upi_id varchar(255),
      ADD COLUMN IF NOT EXISTS amount numeric(18,2),
      ADD COLUMN IF NOT EXISTS remark varchar(255),
      ADD COLUMN IF NOT EXISTS status text,
      ADD COLUMN IF NOT EXISTS error_message text,
      ADD COLUMN IF NOT EXISTS merchant_id integer,
      ADD COLUMN IF NOT EXISTS initiated_by_email varchar(255),
      ADD COLUMN IF NOT EXISTS utr text,
      ADD COLUMN IF NOT EXISTS raw_response text,
      ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()`);
    await pool.query(`ALTER TABLE withdrawals
      ADD COLUMN IF NOT EXISTS merchant_id integer,
      ADD COLUMN IF NOT EXISTS amount numeric(18,2),
      ADD COLUMN IF NOT EXISTS currency text,
      ADD COLUMN IF NOT EXISTS status text,
      ADD COLUMN IF NOT EXISTS transfer_status text,
      ADD COLUMN IF NOT EXISTS utr text,
      ADD COLUMN IF NOT EXISTS failure_reason text,
      ADD COLUMN IF NOT EXISTS approved_by_admin_id integer,
      ADD COLUMN IF NOT EXISTS approved_at timestamptz,
      ADD COLUMN IF NOT EXISTS completed_at timestamptz,
      ADD COLUMN IF NOT EXISTS payout_mode text,
      ADD COLUMN IF NOT EXISTS upi_id text,
      ADD COLUMN IF NOT EXISTS remarks text,
      ADD COLUMN IF NOT EXISTS bank_account text,
      ADD COLUMN IF NOT EXISTS bank_name text,
      ADD COLUMN IF NOT EXISTS ifsc_code text,
      ADD COLUMN IF NOT EXISTS account_holder text,
      ADD COLUMN IF NOT EXISTS beneficiary_id integer,
      ADD COLUMN IF NOT EXISTS rejection_reason text,
      ADD COLUMN IF NOT EXISTS rejected_by_admin_id integer,
      ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
      ADD COLUMN IF NOT EXISTS approval_type text,
      ADD COLUMN IF NOT EXISTS approved_by_system boolean,
      ADD COLUMN IF NOT EXISTS auto_approval_rule_snapshot jsonb,
      ADD COLUMN IF NOT EXISTS approved_by text,
      ADD COLUMN IF NOT EXISTS idempotency_key text,
      ADD COLUMN IF NOT EXISTS slip_verification_token text,
      ADD COLUMN IF NOT EXISTS payout_fee numeric(10,2),
      ADD COLUMN IF NOT EXISTS gst_amount numeric(10,2),
      ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()`);
    await pool.query("DELETE FROM cashfree_payout_webhook_logs WHERE transfer_id LIKE 'synthetic_unmatched_%'");
    for (const outcome of ["SUCCESS", "FAILED"]) {
      const payload = JSON.stringify({
        type: `TRANSFER_${outcome}`,
        data: { transfer: {
          transfer_id: `synthetic_unmatched_${outcome}`,
          transfer_status: outcome,
        } },
      });
      const stamp = String(Math.floor(Date.now() / 1000));
      const sig = createHmac("sha256", "synthetic_local_test_secret_123")
        .update(stamp + payload).digest("base64");
      const reply = await fetch(`http://127.0.0.1:${address.port}/api/cashfree-payout/webhook`, {
        method: "POST", headers: {
          "Content-Type": "application/json",
          "x-webhook-timestamp": stamp, "x-webhook-signature": sig,
        },
        body: payload,
      });
      assert.equal(reply.status, 200);
    }
    // Handler ACKs before processing: poll for the database log without
    // assuming an immediate async mutation.
    let unmatched = await pool.query(
      "SELECT transfer_id, processing_result FROM cashfree_payout_webhook_logs WHERE transfer_id LIKE 'synthetic_unmatched_%' ORDER BY id",
    );
    for (let attempt = 0; attempt < 30 && unmatched.rows.length !== 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      unmatched = await pool.query(
        "SELECT transfer_id, processing_result FROM cashfree_payout_webhook_logs WHERE transfer_id LIKE 'synthetic_unmatched_%' ORDER BY id",
      );
    }
    assert.equal(unmatched.rows.length, 2);
    assert.ok(unmatched.rows.every(r => r.processing_result === "unmatched"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await pool.end();
  }
});
