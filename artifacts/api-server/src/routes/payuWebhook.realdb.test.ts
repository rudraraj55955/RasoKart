/**
 * PostgreSQL integration tests for PayU callback processing.
 *
 * These tests intentionally use the real db.transaction() implementation.
 * The success test sends S2S and browser-return callbacks at the same time so
 * a broken INITIATED/PENDING -> SUCCESS predicate would create duplicate
 * wallet credits instead of being hidden by a mock.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import {
  db,
  merchantWalletsTable,
  merchantsTable,
  payuPaymentOrdersTable,
  payuWebhookLogsTable,
  transactionsTable,
  walletLedgerTable,
  PAYU_ORDER_STATUS,
} from "@workspace/db";
import app from "../app";

const TEST_KEY = "testkey_rasokart_realdb_12345";
const TEST_SALT = "testsalt_rasokart_realdb_abcdef";

type HttpResult = {
  status: number;
  location: string | undefined;
  body: string;
};

function computePayuResponseHash(fields: {
  status: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
}): string {
  const payload = [
    TEST_SALT,
    fields.status,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    fields.email,
    fields.firstname,
    fields.productinfo,
    fields.amount,
    fields.txnid,
    TEST_KEY,
  ].join("|");
  return crypto.createHash("sha512").update(payload).digest("hex");
}

function postUrlEncoded(
  server: http.Server,
  path: string,
  fields: Record<string, string>,
): Promise<HttpResult> {
  const address = server.address() as { port: number };
  const body = new URLSearchParams(fields).toString();

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        response.on("end", () => resolve({
          status: response.statusCode ?? 0,
          location: response.headers.location as string | undefined,
          body: raw,
        }));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function waitFor<T>(
  load: () => Promise<T | undefined>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await load();
    if (lastValue !== undefined && predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
}

describe("PayU callback processing (real PostgreSQL)", () => {
  let server: http.Server;
  let merchantId: number;
  let merchantEmail: string;
  let savedUatKey: string | undefined;
  let savedUatSalt: string | undefined;

  before(async () => {
    savedUatKey = process.env["PAYU_UAT_KEY"];
    savedUatSalt = process.env["PAYU_UAT_SALT"];
    process.env["PAYU_UAT_KEY"] = TEST_KEY;
    process.env["PAYU_UAT_SALT"] = TEST_SALT;

    merchantEmail = `payu-callback-realdb-${Date.now()}@rasokart.test`;
    const [merchant] = await db.insert(merchantsTable).values({
      businessName: "PayU Callback Real DB Test Merchant",
      contactName: "PayU Callback Tester",
      email: merchantEmail,
      phone: `9${String(Date.now()).slice(-9)}`,
      status: "approved",
      verificationStatus: "approved",
      environment: "test",
    }).returning({ id: merchantsTable.id });
    merchantId = merchant!.id;

    await db.insert(merchantWalletsTable).values({
      merchantId,
      availableBalance: "7.00",
      pendingBalance: "10.00",
      totalCollection: "100.00",
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  beforeEach(async () => {
    // Keep each test isolated while preserving the same real merchant wallet.
    await db.delete(payuWebhookLogsTable).where(eq(payuWebhookLogsTable.merchantId, merchantId));
    await db.delete(transactionsTable).where(eq(transactionsTable.merchantId, merchantId));
    await db.delete(walletLedgerTable).where(eq(walletLedgerTable.merchantId, merchantId));
    await db.delete(payuPaymentOrdersTable).where(eq(payuPaymentOrdersTable.merchantId, merchantId));
    await db.update(merchantWalletsTable)
      .set({
        availableBalance: "7.00",
        pendingBalance: "10.00",
        totalCollection: "100.00",
      })
      .where(eq(merchantWalletsTable.merchantId, merchantId));
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(payuWebhookLogsTable).where(eq(payuWebhookLogsTable.merchantId, merchantId));
    await db.delete(transactionsTable).where(eq(transactionsTable.merchantId, merchantId));
    await db.delete(walletLedgerTable).where(eq(walletLedgerTable.merchantId, merchantId));
    await db.delete(payuPaymentOrdersTable).where(eq(payuPaymentOrdersTable.merchantId, merchantId));
    await db.delete(merchantWalletsTable).where(eq(merchantWalletsTable.merchantId, merchantId));
    await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
    process.env["PAYU_UAT_KEY"] = savedUatKey;
    process.env["PAYU_UAT_SALT"] = savedUatSalt;
  });

  it("credits once when concurrent S2S and browser SUCCESS callbacks race", async () => {
    const txnid = `RK_REALDB_CONCURRENT_${Date.now()}`;
    const amount = "125.00";
    const productinfo = "Real DB callback load";
    const firstname = "Real DB Tester";
    const email = merchantEmail;
    const [order] = await db.insert(payuPaymentOrdersTable).values({
      merchantId,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      environment: "uat",
      status: PAYU_ORDER_STATUS.INITIATED,
    }).returning({ id: payuPaymentOrdersTable.id });
    assert.ok(order, "the initiated PayU order should be created");

    const callback = {
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      status: "success",
      hash: computePayuResponseHash({
        status: "success",
        txnid,
        amount,
        productinfo,
        firstname,
        email,
      }),
      mihpayid: "REALDB_MIHPAYID_CONCURRENT",
      bank_ref_no: "REALDB_BANK_REF_CONCURRENT",
      mode: "UPI",
    };

    const [s2s, browserReturn] = await Promise.all([
      postUrlEncoded(server, "/api/payment/payu-s2s", callback),
      postUrlEncoded(server, "/api/payment/payu-return", callback),
    ]);

    assert.equal(s2s.status, 200);
    assert.deepEqual(JSON.parse(s2s.body), { success: true });
    assert.ok([301, 302, 303, 307].includes(browserReturn.status));
    assert.match(browserReturn.location ?? "", /payu_status=success/);

    await waitFor(
      async () => {
        const [row] = await db.select({
          status: payuPaymentOrdersTable.status,
          hashVerified: payuPaymentOrdersTable.hashVerified,
        }).from(payuPaymentOrdersTable).where(eq(payuPaymentOrdersTable.txnid, txnid));
        return row;
      },
      (row) => row.status === PAYU_ORDER_STATUS.SUCCESS && row.hashVerified === true,
      "the concurrent PayU order to reach SUCCESS",
    );

    const walletRows = await db.select().from(merchantWalletsTable)
      .where(eq(merchantWalletsTable.merchantId, merchantId));
    const ledgerRows = await db.select().from(walletLedgerTable).where(and(
      eq(walletLedgerTable.merchantId, merchantId),
      like(walletLedgerTable.description, `%${txnid}%`),
    ));
    const transactionRows = await db.select().from(transactionsTable).where(and(
      eq(transactionsTable.merchantId, merchantId),
      eq(transactionsTable.referenceId, txnid),
    ));
    const webhookLogs = await waitFor(
      () => db.select().from(payuWebhookLogsTable).where(eq(payuWebhookLogsTable.txnid, txnid)),
      (rows) => rows.length === 2,
      "both callback audit logs",
    );

    assert.equal(walletRows.length, 1);
    assert.equal(walletRows[0]!.availableBalance, "7.00");
    assert.equal(walletRows[0]!.pendingBalance, "135.00");
    assert.equal(walletRows[0]!.totalCollection, "225.00");
    assert.equal(ledgerRows.length, 1, "the atomic order claim must permit one ledger credit");
    assert.equal(transactionRows.length, 1, "the duplicate callback must not create a second transaction");
    assert.equal(webhookLogs.filter((row) => row.processingResult === "credited").length, 1);
    assert.equal(webhookLogs.filter((row) => row.processingResult === "duplicate").length, 1);
  });

  it("marks a verified FAILURE callback failed without changing the wallet", async () => {
    const txnid = `RK_REALDB_FAILURE_${Date.now()}`;
    const amount = "45.00";
    const productinfo = "Real DB failed load";
    const firstname = "Real DB Failure";
    const email = merchantEmail;
    await db.insert(payuPaymentOrdersTable).values({
      merchantId,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      environment: "uat",
      status: PAYU_ORDER_STATUS.INITIATED,
    });

    const response = await postUrlEncoded(server, "/api/payment/payu-return", {
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      status: "failure",
      hash: computePayuResponseHash({
        status: "failure",
        txnid,
        amount,
        productinfo,
        firstname,
        email,
      }),
      error_Message: "Payment declined by bank",
    });

    assert.ok([301, 302, 303, 307].includes(response.status));
    assert.match(response.location ?? "", /payu_status=failed/);

    const [order] = await db.select().from(payuPaymentOrdersTable)
      .where(eq(payuPaymentOrdersTable.txnid, txnid));
    const [wallet] = await db.select().from(merchantWalletsTable)
      .where(eq(merchantWalletsTable.merchantId, merchantId));
    const ledgerRows = await db.select().from(walletLedgerTable)
      .where(eq(walletLedgerTable.merchantId, merchantId));
    const transactionRows = await db.select().from(transactionsTable)
      .where(eq(transactionsTable.merchantId, merchantId));

    assert.equal(order?.status, PAYU_ORDER_STATUS.FAILED);
    assert.equal(order?.failureReason, "Payment declined by bank");
    assert.equal(wallet?.availableBalance, "7.00");
    assert.equal(wallet?.pendingBalance, "10.00");
    assert.equal(wallet?.totalCollection, "100.00");
    assert.equal(ledgerRows.length, 0);
    assert.equal(transactionRows.length, 0);
  });
});