/**
 * backfill-cashfree-payin-credits.test.ts
 *
 * Unit/integration tests for the Cashfree payin credit recovery backfill
 * script.  Runs against the real DATABASE_URL (same DB used by the dev
 * server) so that the atomic UPDATE-WHERE-status-!=-PAID gate, the wallet
 * ledger writes, and the idempotency contract are verified end-to-end.
 *
 * Scenarios covered
 * -----------------
 * 1. Already-PAID order is skipped — outcome is "duplicate", wallet unchanged.
 * 2. Wallet pending balance and total_collection are credited correctly.
 * 3. The wallet_ledger row has the right before/after snapshots and the
 *    [RECONCILIATION] description prefix.
 * 4. Running the backfill twice for the same order is a true no-op — balance
 *    and ledger row count are identical after the second call.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts run test:backfill-cashfree-payin-credits
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  pool,
  cashfreePaymentOrdersTable,
  merchantWalletsTable,
  walletLedgerTable,
  transactionsTable,
  merchantsTable,
  PAYIN_ORDER_STATUS,
} from "@workspace/db";
import { backfillOrder } from "./backfill-cashfree-payin-credits.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a short random suffix so test data never collides across runs. */
function rand(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Insert a minimal test merchant and return its id.
 * Uses a unique email so the unique constraint is never violated.
 */
async function insertTestMerchant(): Promise<number> {
  const suffix = rand();
  const [row] = await db
    .insert(merchantsTable)
    .values({
      businessName: `Test Merchant ${suffix}`,
      contactName:  `Test Contact ${suffix}`,
      email:        `test-backfill-${suffix}@example.invalid`,
      phone:        `999${suffix}`,
      status:       "approved",
    })
    .returning({ id: merchantsTable.id });
  return row.id;
}

/**
 * Insert a cashfree_payment_orders row and return its cashfreeOrderId.
 * @param merchantId  FK to merchants.id
 * @param status      Initial payin order status (default: CREATED)
 * @param amount      Amount string (default: "500.00")
 */
async function insertTestOrder(
  merchantId: number,
  status: string  = PAYIN_ORDER_STATUS.CREATED,
  amount: string  = "500.00",
): Promise<string> {
  const cfOrderId = `CF-TEST-${rand()}`;
  await db.insert(cashfreePaymentOrdersTable).values({
    merchantId,
    cashfreeOrderId: cfOrderId,
    amount,
    currency: "INR",
    status,
  });
  return cfOrderId;
}

/** Delete all test rows created for a given merchant (cascade handles wallet + ledger). */
async function cleanup(merchantId: number, cfOrderIds: string[]): Promise<void> {
  // Transactions have their own FK-independent cleanup (no cascade from merchant).
  if (cfOrderIds.length) {
    for (const cfOrderId of cfOrderIds) {
      await db
        .delete(transactionsTable)
        .where(eq(transactionsTable.referenceId, cfOrderId));
    }
  }
  // cashfree_payment_orders — no cascade from merchant, delete explicitly.
  if (cfOrderIds.length) {
    for (const cfOrderId of cfOrderIds) {
      await db
        .delete(cashfreePaymentOrdersTable)
        .where(eq(cashfreePaymentOrdersTable.cashfreeOrderId, cfOrderId));
    }
  }
  // wallet_ledger and merchant_wallets cascade on merchant delete.
  await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
}

// ── Tests ────────────────────────────────────────────────────────────────────

after(async () => {
  await pool.end();
});

describe("backfillOrder — scenario 1: already-PAID order is skipped", () => {
  let merchantId: number;
  let cfOrderId:  string;

  it("sets up: insert merchant + PAID order", async () => {
    merchantId = await insertTestMerchant();
    cfOrderId  = await insertTestOrder(merchantId, PAYIN_ORDER_STATUS.PAID, "200.00");
  });

  it("returns outcome='duplicate' without touching the wallet", async () => {
    // No wallet row inserted — the function must not create one either.
    const { outcome } = await backfillOrder(cfOrderId);
    assert.equal(outcome, "duplicate", "PAID order must return 'duplicate'");

    // Wallet must still not exist (was never created for a pre-PAID order).
    const wallets = await db
      .select()
      .from(merchantWalletsTable)
      .where(eq(merchantWalletsTable.merchantId, merchantId));
    assert.equal(wallets.length, 0, "No wallet row should be created for a skipped order");
  });

  after(async () => {
    await cleanup(merchantId, [cfOrderId]);
  });
});

describe("backfillOrder — scenario 2: correct wallet amounts after credit", () => {
  let merchantId:  number;
  let cfOrderId:   string;
  const AMOUNT = 750.00;

  it("sets up: insert merchant + CREATED order + pre-existing wallet", async () => {
    merchantId = await insertTestMerchant();
    cfOrderId  = await insertTestOrder(merchantId, PAYIN_ORDER_STATUS.CREATED, String(AMOUNT));

    // Pre-seed wallet with known balances so we can verify the delta.
    await db.insert(merchantWalletsTable).values({
      merchantId,
      pendingBalance:  "100.00",
      availableBalance: "50.00",
      totalCollection: "1000.00",
    }).onConflictDoNothing();
  });

  it("credits pending balance and total_collection by the order amount", async () => {
    const { outcome } = await backfillOrder(cfOrderId);
    assert.equal(outcome, "credited", "First call must return 'credited'");

    const [wallet] = await db
      .select()
      .from(merchantWalletsTable)
      .where(eq(merchantWalletsTable.merchantId, merchantId));

    assert.ok(wallet, "Wallet row must exist after backfill");

    const pendingAfter    = parseFloat(wallet.pendingBalance   ?? "0");
    const totalCollection = parseFloat(wallet.totalCollection  ?? "0");
    const available       = parseFloat(wallet.availableBalance ?? "0");

    assert.equal(
      pendingAfter,
      100.00 + AMOUNT,
      `pendingBalance must increase by ${AMOUNT}`,
    );
    assert.equal(
      totalCollection,
      1000.00 + AMOUNT,
      `totalCollection must increase by ${AMOUNT}`,
    );
    assert.equal(
      available,
      50.00,
      "availableBalance must be unchanged by a pending_credit",
    );
  });

  after(async () => {
    await cleanup(merchantId, [cfOrderId]);
  });
});

describe("backfillOrder — scenario 3: ledger row has correct before/after snapshots", () => {
  let merchantId: number;
  let cfOrderId:  string;
  const AMOUNT          = 300.00;
  const PENDING_BEFORE  = 200.00;
  const AVAILABLE_BEFORE = 80.00;

  it("sets up: insert merchant + CREATED order + wallet with known balances", async () => {
    merchantId = await insertTestMerchant();
    cfOrderId  = await insertTestOrder(merchantId, PAYIN_ORDER_STATUS.CREATED, String(AMOUNT));

    await db.insert(merchantWalletsTable).values({
      merchantId,
      pendingBalance:   String(PENDING_BEFORE),
      availableBalance: String(AVAILABLE_BEFORE),
      totalCollection:  "0.00",
    }).onConflictDoNothing();
  });

  it("writes a wallet_ledger row with [RECONCILIATION] prefix and correct snapshots", async () => {
    const { outcome } = await backfillOrder(cfOrderId);
    assert.equal(outcome, "credited");

    const ledgerRows = await db
      .select()
      .from(walletLedgerTable)
      .where(eq(walletLedgerTable.merchantId, merchantId))
      .orderBy(desc(walletLedgerTable.id));

    assert.ok(ledgerRows.length >= 1, "At least one ledger row must be written");

    const row = ledgerRows[0];

    assert.equal(row.txnType, "pending_credit",      "txnType must be 'pending_credit'");
    assert.equal(row.bucket,  "pending",              "bucket must be 'pending'");
    assert.equal(parseFloat(row.amount), AMOUNT,      "ledger amount must match order amount");

    assert.ok(
      row.description.startsWith("[RECONCILIATION]"),
      `description must start with [RECONCILIATION], got: "${row.description}"`,
    );
    assert.ok(
      row.description.includes(cfOrderId),
      "description must include the cashfree order ID",
    );

    // Before snapshot
    assert.equal(
      parseFloat(row.pendingBefore   ?? "0"),
      PENDING_BEFORE,
      "pendingBefore must equal pre-credit wallet pendingBalance",
    );
    assert.equal(
      parseFloat(row.availableBefore ?? "0"),
      AVAILABLE_BEFORE,
      "availableBefore must equal pre-credit wallet availableBalance",
    );

    // After snapshot
    assert.equal(
      parseFloat(row.pendingAfter   ?? "0"),
      PENDING_BEFORE + AMOUNT,
      "pendingAfter must equal pendingBefore + creditAmount",
    );
    assert.equal(
      parseFloat(row.availableAfter ?? "0"),
      AVAILABLE_BEFORE,
      "availableAfter must be unchanged (credit goes to pending, not available)",
    );
  });

  after(async () => {
    await cleanup(merchantId, [cfOrderId]);
  });
});

describe("backfillOrder — scenario 4: running twice is a true no-op", () => {
  let merchantId: number;
  let cfOrderId:  string;
  const AMOUNT = 450.00;

  it("sets up: insert merchant + CREATED order + wallet", async () => {
    merchantId = await insertTestMerchant();
    cfOrderId  = await insertTestOrder(merchantId, PAYIN_ORDER_STATUS.CREATED, String(AMOUNT));

    await db.insert(merchantWalletsTable).values({
      merchantId,
      pendingBalance:  "0.00",
      availableBalance: "0.00",
      totalCollection: "0.00",
    }).onConflictDoNothing();
  });

  it("first call returns 'credited'", async () => {
    const { outcome } = await backfillOrder(cfOrderId);
    assert.equal(outcome, "credited");
  });

  it("second call returns 'duplicate' — wallet and ledger are unchanged", async () => {
    // Snapshot wallet after first credit.
    const [walletAfterFirst] = await db
      .select()
      .from(merchantWalletsTable)
      .where(eq(merchantWalletsTable.merchantId, merchantId));

    const ledgerCountAfterFirst = (
      await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.merchantId, merchantId))
    ).length;

    // Run the backfill a second time.
    const { outcome } = await backfillOrder(cfOrderId);
    assert.equal(outcome, "duplicate", "Second call must return 'duplicate'");

    // Wallet balances must be exactly unchanged.
    const [walletAfterSecond] = await db
      .select()
      .from(merchantWalletsTable)
      .where(eq(merchantWalletsTable.merchantId, merchantId));

    assert.equal(
      walletAfterSecond.pendingBalance,
      walletAfterFirst.pendingBalance,
      "pendingBalance must not change on the second call",
    );
    assert.equal(
      walletAfterSecond.totalCollection,
      walletAfterFirst.totalCollection,
      "totalCollection must not change on the second call",
    );

    // Ledger row count must be exactly the same.
    const ledgerCountAfterSecond = (
      await db
        .select()
        .from(walletLedgerTable)
        .where(eq(walletLedgerTable.merchantId, merchantId))
    ).length;

    assert.equal(
      ledgerCountAfterSecond,
      ledgerCountAfterFirst,
      "No additional ledger rows must be written on the second call",
    );
  });

  after(async () => {
    await cleanup(merchantId, [cfOrderId]);
  });
});
