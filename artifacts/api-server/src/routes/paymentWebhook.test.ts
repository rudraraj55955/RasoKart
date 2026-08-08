/**
 * Integration test: POST /api/payment/webhook — EKQR webhook reachability
 *
 * Regression guard: the EKQR webhook handler was once mounted at the wrong
 * sub-path, causing every call to return 404 even though the code compiled
 * and typechecked cleanly.  This test catches that class of regression by
 * firing real HTTP requests at the in-process server and asserting:
 *
 *   1. SUCCESS status   → HTTP 200 { success: true }
 *   2. PENDING status   → HTTP 200 { success: true }  (always ack)
 *   3. Missing client_txn_id → HTTP 200 { success: true }  (always ack)
 *
 * The webhook handler sends its 200 response immediately and then does all
 * processing asynchronously, so we only need to reach the route — no
 * live DB or EKQR credentials are required.  We stub `db.select` and
 * `db.insert` to isolate from the real database.
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { db, systemConfigTable, ekqrWebhookLogsTable } from "@workspace/db";
import app from "../app";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * POST `path` with an application/x-www-form-urlencoded body (mirroring
 * what EKQR delivers) and return the status code + parsed JSON body.
 */
function postForm(
  server: http.Server,
  path: string,
  fields: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const data = new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, body: { _raw: raw } as Record<string, unknown> });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

/**
 * Returns a minimal db.select stub that tells the webhook handler EKQR is
 * disabled so it acks and exits without touching QR codes or transactions.
 * The only table the early-exit path reads is systemConfigTable.
 */
function makeSelectStub(originalSelect: unknown) {
  return (_fields?: unknown) => ({
    from: (table: unknown) => ({
      where: (_cond: unknown) => ({
        // systemConfigTable rows — return EKQR_ENABLED=false so we exit early
        // after the immediate 200 response.  No other DB calls are made.
        limit: async () => {
          if (table === systemConfigTable) {
            return [
              { key: "EKQR_ENABLED", value: "false" },
              { key: "EKQR_API_KEY",  value: "" },
            ];
          }
          return [];
        },
      }),
      limit: async () => [],
      orderBy: async () => [],
    }),
  });
}

/**
 * Minimal db.insert stub — silently swallows ekqrWebhookLogs inserts so the
 * async logging path after the 200 response doesn't throw.
 */
function makeInsertStub() {
  return (_table: unknown) => ({
    values: (_vals: unknown) => ({
      returning: async () => [{}],
    }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/payment/webhook — EKQR webhook reachability", () => {
  let server: http.Server;
  const originalSelect = (db as any).select.bind(db);
  const originalInsert = (db as any).insert.bind(db);

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  after(async () => {
    // Restore originals before closing.
    (db as any).select = originalSelect;
    (db as any).insert = originalInsert;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    // Restore stubs after each test.
    (db as any).select = originalSelect;
    (db as any).insert = originalInsert;
  });

  it("SUCCESS status — route is reachable and returns 200 { success: true }", async () => {
    (db as any).select = makeSelectStub(originalSelect);
    (db as any).insert = makeInsertStub();

    const { status, body } = await postForm(server, "/api/payment/webhook", {
      id:            "EKQR-ORDER-001",
      amount:        "100.00",
      client_txn_id: "qr-ref-abc123",
      status:        "SUCCESS",
      upi_txn_id:    "UPI123456",
    });

    assert.equal(status, 200, `Expected 200 but got ${status} — route may be mounted at the wrong path`);
    assert.equal((body as any).success, true, "Response body must be { success: true }");
  });

  it("PENDING status — always acks with 200 { success: true }", async () => {
    (db as any).select = makeSelectStub(originalSelect);
    (db as any).insert = makeInsertStub();

    const { status, body } = await postForm(server, "/api/payment/webhook", {
      id:            "EKQR-ORDER-002",
      amount:        "250.00",
      client_txn_id: "qr-ref-def456",
      status:        "PENDING",
    });

    assert.equal(status, 200, `Expected 200 for PENDING but got ${status}`);
    assert.equal((body as any).success, true, "Response body must be { success: true }");
  });

  it("missing client_txn_id — always acks with 200 { success: true }", async () => {
    (db as any).select = makeSelectStub(originalSelect);
    (db as any).insert = makeInsertStub();

    const { status, body } = await postForm(server, "/api/payment/webhook", {
      id:     "EKQR-ORDER-003",
      amount: "50.00",
      status: "SUCCESS",
      // client_txn_id deliberately omitted
    });

    assert.equal(status, 200, `Expected 200 for missing client_txn_id but got ${status}`);
    assert.equal((body as any).success, true, "Response body must be { success: true }");
  });
});
