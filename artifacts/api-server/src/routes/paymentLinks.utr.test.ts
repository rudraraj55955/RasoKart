/**
 * Integration tests: POST /api/payment-links/public/:slug/utr
 *
 * Covers four requirements:
 * 1. Duplicate UTR returns 409 with code DUPLICATE_UTR (not a generic message)
 * 2. DUPLICATE_UTR response body never contains raw SQL or stack traces
 * 3. DUPLICATE_UTR response always has a specific code (not a generic error)
 * 4. Successful UTR submission creates a pending_verification transaction
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  db,
  usersTable,
  paymentLinksTable,
  providerIntegrationsTable,
  transactionsTable,
} from "@workspace/db";
import app from "../app";

function post(
  server: http.Server,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
            resolve({ status: res.statusCode!, body: { _raw: raw } });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const MOCK_LINK = {
  id: 77,
  merchantId: 1,
  slug: "test-link-abc123",
  title: "Test Payment",
  description: null,
  amount: "500.00",
  status: "active" as const,
  maxPayments: null,
  expiresAt: null,
  callbackUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_GATEWAY = { providerKey: "own_static_upi" };

const MOCK_TXN = {
  id: 999,
  merchantId: 1,
  paymentLinkId: 77,
  type: "deposit",
  status: "pending_verification",
  provider: "own_static_upi",
  amount: "500.00",
  currency: "INR",
  utr: "TEST123456789",
  metadata: "{}",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("POST /api/payment-links/public/:slug/utr", () => {
  let server: http.Server;

  const originalSelect = (db as any).select.bind(db);
  const originalInsert = (db as any).insert.bind(db);

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  after(async () => {
    (db as any).select = originalSelect;
    (db as any).insert = originalInsert;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    (db as any).select = originalSelect;
    (db as any).insert = originalInsert;
  });

  function mockSelectForActiveLink() {
    (db as any).select = (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async () => {
            if (table === paymentLinksTable) return [{ link: MOCK_LINK }];
            if (table === providerIntegrationsTable) return [MOCK_GATEWAY];
            if (table === usersTable) return [];
            return [];
          },
        }),
        limit: async () => {
          if (table === paymentLinksTable) return [{ link: MOCK_LINK }];
          return [];
        },
      }),
    });
  }

  it(
    "returns 409 with code DUPLICATE_UTR when the same UTR has already been submitted",
    async () => {
      mockSelectForActiveLink();

      (db as any).insert = (_table: unknown) => ({
        values: (_vals: unknown) => ({
          returning: async () => {
            const err = new Error("duplicate key value violates unique constraint \"transactions_utr_unique\"");
            (err as any).code = "23505";
            (err as any).constraint = "transactions_utr_unique";
            throw err;
          },
        }),
      });

      const { status, body } = await post(
        server,
        "/api/payment-links/public/test-link-abc123/utr",
        { utr: "TEST123456789", amount: "500.00" },
      );

      assert.equal(status, 409, `Expected 409 but got ${status}: ${JSON.stringify(body)}`);
      assert.equal(body["code"], "DUPLICATE_UTR", "Response must include code DUPLICATE_UTR");
      assert.equal(body["title"], "Duplicate UTR", "Response must include title 'Duplicate UTR'");
      assert.ok(
        typeof body["message"] === "string" && (body["message"] as string).length > 0,
        "Response must include a human-readable message",
      );
      assert.match(
        body["message"] as string,
        /UTR|reference/i,
        "Message must mention UTR or reference",
      );
    },
  );

  it(
    "DUPLICATE_UTR response body never contains raw SQL queries or stack traces",
    async () => {
      mockSelectForActiveLink();

      (db as any).insert = (_table: unknown) => ({
        values: (_vals: unknown) => ({
          returning: async () => {
            const err = new Error("duplicate key value violates unique constraint");
            (err as any).code = "23505";
            throw err;
          },
        }),
      });

      const { status, body } = await post(
        server,
        "/api/payment-links/public/test-link-abc123/utr",
        { utr: "DUPTEST123456", amount: "500.00" },
      );

      assert.equal(status, 409);

      const bodyStr = JSON.stringify(body).toUpperCase();

      // Must not contain raw SQL keywords that would indicate an unhandled error
      const sqlPatterns = ["INSERT INTO", "SELECT FROM", "WHERE ", "RETURNING", "DUPLICATE KEY VALUE"];
      for (const pattern of sqlPatterns) {
        assert.ok(
          !bodyStr.includes(pattern),
          `Response body must not contain raw SQL — found "${pattern}" in: ${JSON.stringify(body)}`,
        );
      }

      // Must not contain stack trace markers
      assert.ok(!bodyStr.includes("AT "), "Response body must not contain stack traces");
      assert.ok(!bodyStr.includes("NODE:"), "Response body must not contain Node.js internals");
    },
  );

  it(
    "DUPLICATE_UTR returns a specific error code — not a generic unexpected-error message",
    async () => {
      mockSelectForActiveLink();

      (db as any).insert = (_table: unknown) => ({
        values: (_vals: unknown) => ({
          returning: async () => {
            const err = new Error("duplicate key value violates unique constraint");
            (err as any).code = "23505";
            throw err;
          },
        }),
      });

      const { status, body } = await post(
        server,
        "/api/payment-links/public/test-link-abc123/utr",
        { utr: "DUPSPECIFIC789", amount: "500.00" },
      );

      assert.equal(status, 409);

      // Must have a specific machine-readable code
      assert.equal(body["code"], "DUPLICATE_UTR");

      // Must NOT be a generic "unexpected error" message
      const message = (body["message"] ?? body["error"] ?? "") as string;
      assert.ok(
        !message.toLowerCase().includes("unexpected error"),
        `Response must not say "unexpected error" for a known condition. Got: "${message}"`,
      );
      assert.ok(
        !message.toLowerCase().includes("try again or contact support") ||
          message.toLowerCase().includes("utr") ||
          message.toLowerCase().includes("reference"),
        "Response message must be specific to the UTR duplicate condition",
      );
    },
  );

  it(
    "successful UTR submission returns 200 and creates a pending_verification transaction",
    async () => {
      mockSelectForActiveLink();

      let insertCalled = false;
      let insertedStatus: string | undefined;

      (db as any).insert = (_table: unknown) => ({
        values: (vals: any) => ({
          returning: async () => {
            insertCalled = true;
            insertedStatus = vals?.status;
            return [MOCK_TXN];
          },
        }),
      });

      const { status, body } = await post(
        server,
        "/api/payment-links/public/test-link-abc123/utr",
        { utr: "SUCCESSUTR123456", amount: "500.00" },
      );

      assert.equal(status, 200, `Expected 200 but got ${status}: ${JSON.stringify(body)}`);
      assert.equal(body["ok"], true, "Response must have ok: true");
      assert.ok(
        typeof body["transactionId"] === "number" || typeof body["transactionId"] === "string",
        "Response must include a transactionId",
      );
      assert.ok(insertCalled, "db.insert must have been called");
      assert.equal(
        insertedStatus,
        "pending_verification",
        "Inserted transaction must have status pending_verification",
      );
    },
  );
});
