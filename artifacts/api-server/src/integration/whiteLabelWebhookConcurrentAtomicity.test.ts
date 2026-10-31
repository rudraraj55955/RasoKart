import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { getIsolatedWhiteLabelTestDatabaseUrl } from "../lib/whiteLabelPgTestSafety";

/** Simulates the conditional withdrawal update and ledger mutation together.
 * Test-only PostgreSQL tables: no payment provider, live ledger or wallet access.
 */
test("concurrent duplicate payout success mutates test ledger once; failed ledger rolls back status", async () => {
  const pool = new pg.Pool({ connectionString: getIsolatedWhiteLabelTestDatabaseUrl(process.env), max: 12 });
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS wl_test_webhook_withdrawals (id int PRIMARY KEY, merchant_id int NOT NULL, transfer_status text NOT NULL)");
    await pool.query("CREATE TABLE IF NOT EXISTS wl_test_webhook_ledger (id bigserial PRIMARY KEY, withdrawal_id int NOT NULL, amount int NOT NULL CHECK (amount > 0))");
    await pool.query("TRUNCATE wl_test_webhook_ledger, wl_test_webhook_withdrawals RESTART IDENTITY");
    await pool.query("INSERT INTO wl_test_webhook_withdrawals VALUES (10, 20, 'PENDING'), (11, 20, 'PENDING')");
    const processWebhook = async (id: number, failLedger = false): Promise<boolean> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const changed = await client.query("UPDATE wl_test_webhook_withdrawals SET transfer_status='SUCCESS' WHERE id=$1 AND transfer_status='PENDING' RETURNING id", [id]);
        if (!changed.rowCount) { await client.query("COMMIT"); return false; }
        await client.query("INSERT INTO wl_test_webhook_ledger(withdrawal_id,amount) VALUES ($1,$2)", [id, failLedger ? 0 : 100]);
        await client.query("COMMIT");
        return true;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => processWebhook(10)));
    assert.equal(results.filter(Boolean).length, 1, "only one concurrent transition wins");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM wl_test_webhook_ledger WHERE withdrawal_id=10")).rows[0].n, 1);
    await assert.rejects(processWebhook(11, true), "invalid ledger entry must fail");
    assert.equal((await pool.query("SELECT transfer_status FROM wl_test_webhook_withdrawals WHERE id=11")).rows[0].transfer_status, "PENDING");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM wl_test_webhook_ledger WHERE withdrawal_id=11")).rows[0].n, 0);
    assert.equal(await processWebhook(11), true, "replay can recover after rollback");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM wl_test_webhook_ledger WHERE withdrawal_id=11")).rows[0].n, 1);
  } finally { await pool.end(); }
});
