import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { backfillOrder } from "./adminCashfreePayinRecon.js";

const TEST_RUN = `${process.pid}-${Date.now()}`;
const MERCHANT_EMAIL = `cashfree-recon-realdb-${TEST_RUN}@rasokart.test`;
const ORDER_ID = `CF_RECON_CONFLICT_${TEST_RUN}`;
const CONFLICTING_UTR = `CF_RECON_UTR_${TEST_RUN}`;
const EXISTING_REFERENCE_ID = `CF_RECON_EXISTING_${TEST_RUN}`;

let merchantId: number;

async function queryOne<T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> {
  const result = await db.execute(query);
  return result.rows[0] as T;
}

describe("Cashfree payin reconciliation accounting (real PostgreSQL)", { concurrency: false }, () => {
  before(async () => {
    const merchant = await db.execute(sql`
      INSERT INTO merchants (business_name, contact_name, email, phone, status, verification_status)
      VALUES ('Cashfree reconciliation test', 'Test', ${MERCHANT_EMAIL}, '9000009969', 'approved', 'approved')
      RETURNING id
    `);
    merchantId = Number((merchant.rows[0] as { id: number }).id);

    await db.execute(sql`
      INSERT INTO merchant_wallets (merchant_id, available_balance, pending_balance, total_collection)
      VALUES (${merchantId}, '100', '200', '300')
    `);
    await db.execute(sql`
      INSERT INTO transactions
        (merchant_id, provider, type, status, amount, currency, utr, reference_id)
      VALUES
        (${merchantId}, 'cashfree', 'deposit', 'success', '1', 'INR', ${CONFLICTING_UTR}, ${EXISTING_REFERENCE_ID})
    `);
    await db.execute(sql`
      INSERT INTO cashfree_payment_orders
        (merchant_id, cashfree_order_id, amount, currency, status, utr)
      VALUES
        (${merchantId}, ${ORDER_ID}, '500', 'INR', 'CREATED', ${CONFLICTING_UTR})
    `);
  });

  after(async () => {
    await db.execute(sql`DELETE FROM wallet_ledger WHERE merchant_id = ${merchantId}`);
    await db.execute(sql`DELETE FROM transactions WHERE merchant_id = ${merchantId}`);
    await db.execute(sql`DELETE FROM cashfree_payment_orders WHERE merchant_id = ${merchantId}`);
    await db.execute(sql`DELETE FROM merchant_wallets WHERE merchant_id = ${merchantId}`);
    await db.execute(sql`DELETE FROM merchants WHERE id = ${merchantId}`);
  });

  it("rolls back the order, wallet, and ledger when the UTR already exists", async () => {
    const outcome = await backfillOrder(ORDER_ID);
    assert.equal(outcome.outcome, "error");

    const state = await queryOne<{
      status: string;
      pending_balance: string;
      total_collection: string;
      ledger_count: string;
      transaction_count: string;
    }>(sql`
      SELECT
        (SELECT status FROM cashfree_payment_orders WHERE cashfree_order_id = ${ORDER_ID}) AS status,
        (SELECT pending_balance FROM merchant_wallets WHERE merchant_id = ${merchantId}) AS pending_balance,
        (SELECT total_collection FROM merchant_wallets WHERE merchant_id = ${merchantId}) AS total_collection,
        (SELECT count(*)::text FROM wallet_ledger
          WHERE merchant_id = ${merchantId} AND description LIKE ${`%order ${ORDER_ID},%`}) AS ledger_count,
        (SELECT count(*)::text FROM transactions
          WHERE merchant_id = ${merchantId} AND utr = ${CONFLICTING_UTR}) AS transaction_count
    `);

    assert.equal(state.status, "CREATED");
    assert.equal(Number(state.pending_balance), 200);
    assert.equal(Number(state.total_collection), 300);
    assert.equal(state.ledger_count, "0");
    assert.equal(state.transaction_count, "1");
  });
});