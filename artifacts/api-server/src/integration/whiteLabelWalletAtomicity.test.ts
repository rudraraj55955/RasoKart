import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { getIsolatedWhiteLabelTestDatabaseUrl } from "../lib/whiteLabelPgTestSafety";

/** Regression proof for the transaction boundary needed by the existing webhook.
 * Uses isolated test tables only; never calls a real wallet, provider or webhook.
 */
test("wallet status update and ledger insertion roll back together on failure", async () => {
  const url = getIsolatedWhiteLabelTestDatabaseUrl(process.env);
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS wl_test_withdrawal_atomic (id integer PRIMARY KEY, status text NOT NULL)");
    await pool.query("CREATE TABLE IF NOT EXISTS wl_test_wallet_ledger_atomic (id serial PRIMARY KEY, withdrawal_id integer NOT NULL, amount numeric NOT NULL CHECK (amount <> 0))");
    await pool.query("DELETE FROM wl_test_wallet_ledger_atomic");
    await pool.query("DELETE FROM wl_test_withdrawal_atomic");
    await pool.query("INSERT INTO wl_test_withdrawal_atomic(id,status) VALUES(1,'PENDING')");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const update = await client.query("UPDATE wl_test_withdrawal_atomic SET status='SUCCESS' WHERE id=1 AND status='PENDING' RETURNING id");
      assert.equal(update.rowCount, 1);
      await assert.rejects(client.query("INSERT INTO wl_test_wallet_ledger_atomic(withdrawal_id,amount) VALUES(1,0)"));
      await client.query("ROLLBACK");
    } finally { client.release(); }
    const state = await pool.query("SELECT status FROM wl_test_withdrawal_atomic WHERE id=1");
    assert.equal(state.rows[0].status, "PENDING");
    const ledger = await pool.query("SELECT count(*)::int AS n FROM wl_test_wallet_ledger_atomic");
    assert.equal(ledger.rows[0].n, 0);
  } finally { await pool.end(); }
});
