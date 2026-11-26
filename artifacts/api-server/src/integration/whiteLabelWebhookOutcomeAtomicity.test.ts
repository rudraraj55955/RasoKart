import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { getIsolatedWhiteLabelTestDatabaseUrl } from "../lib/whiteLabelPgTestSafety";

/** PostgreSQL model of the actual withdrawal CAS and wallet ledger transaction.
 * Does NOT exercise the HTTP handler or contact Cashfree. Uses test-only tables.
 */
test("success and failure outcomes each change test wallet only once", async () => {
  const pool = new pg.Pool({ connectionString: getIsolatedWhiteLabelTestDatabaseUrl(process.env), max: 12 });
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS wl_outcome_withdrawals (id int PRIMARY KEY, merchant_id int NOT NULL, transfer_status text NOT NULL)");
    await pool.query("CREATE TABLE IF NOT EXISTS wl_outcome_wallets (merchant_id int PRIMARY KEY, available int NOT NULL, held int NOT NULL, payouts int NOT NULL, reversals int NOT NULL)");
    await pool.query("CREATE TABLE IF NOT EXISTS wl_outcome_ledger (id bigserial PRIMARY KEY, withdrawal_id int NOT NULL, event text NOT NULL, amount int NOT NULL)");
    await pool.query("TRUNCATE wl_outcome_ledger, wl_outcome_withdrawals, wl_outcome_wallets RESTART IDENTITY");
    await pool.query("INSERT INTO wl_outcome_withdrawals VALUES (1, 11, 'PENDING'), (2, 12, 'PENDING')");
    await pool.query("INSERT INTO wl_outcome_wallets VALUES (11, 0, 100, 0, 0), (12, 0, 100, 0, 0)");
    const apply = async (id: number, status: "SUCCESS" | "FAILED"): Promise<boolean> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query("UPDATE wl_outcome_withdrawals SET transfer_status=$1 WHERE id=$2 AND transfer_status='PENDING' RETURNING merchant_id", [status, id]);
        if (!result.rowCount) { await client.query("COMMIT"); return false; }
        const merchantId = result.rows[0].merchant_id as number;
        if (status === "SUCCESS") {
          await client.query("UPDATE wl_outcome_wallets SET held=held-100, payouts=payouts+100 WHERE merchant_id=$1", [merchantId]);
        } else {
          await client.query("UPDATE wl_outcome_wallets SET held=held-100, available=available+100, reversals=reversals+100 WHERE merchant_id=$1", [merchantId]);
        }
        await client.query("INSERT INTO wl_outcome_ledger(withdrawal_id,event,amount) VALUES($1,$2,100)", [id,status]);
        await client.query("COMMIT");
        return true;
      } catch(e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
    };
    const success = await Promise.all(Array.from({length: 10}, () => apply(1, "SUCCESS")));
    const failed = await Promise.all(Array.from({length: 10}, () => apply(2, "FAILED")));
    assert.equal(success.filter(Boolean).length, 1);
    assert.equal(failed.filter(Boolean).length, 1);
    assert.equal(await apply(1, "FAILED"), false);
    assert.equal(await apply(2, "SUCCESS"), false);
    const wallets = await pool.query("SELECT * FROM wl_outcome_wallets ORDER BY merchant_id");
    assert.deepEqual(wallets.rows, [
      { merchant_id:11, available:0, held:0, payouts:100, reversals:0 },
      { merchant_id:12, available:100, held:0, payouts:0, reversals:100 },
    ]);
    const count = await pool.query("SELECT count(*)::int AS count FROM wl_outcome_ledger");
    assert.equal(count.rows[0].count, 2);
  } finally { await pool.end(); }
});
