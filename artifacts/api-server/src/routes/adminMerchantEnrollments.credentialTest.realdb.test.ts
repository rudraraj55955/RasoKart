/**
 * Integration test: POST /api/admin/merchant-enrollments/:merchantId/enrollments/:providerSlug/test
 *
 * Covers:
 *   1. Pass case  — valid encrypted credentials → pass:true, lastVerifiedAt stamped in DB
 *   2. Fail case  — missing / too-short credentials → pass:false with a human-readable detail
 *   3. 404        — enrollment does not exist for the requested merchant + providerSlug
 *   4. Category E — unsupported provider → pass:false, no DB write
 *   5. Security   — credential values (plaintext) NEVER appear anywhere in the response body
 *
 * Uses a real Postgres DB (no mocks of db or cryptoUtils), follows the
 * *.realdb.test.ts pattern established in this directory.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and } from "drizzle-orm";
import {
  db,
  usersTable,
  merchantsTable,
  merchantProviderEnrollmentsTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import { encryptSecret } from "../helpers/cryptoUtils";
import app from "../app";

// ── HTTP helper ───────────────────────────────────────────────────────────────

function post(
  server: http.Server,
  path: string,
  token: string,
): Promise<{ status: number; body: Record<string, unknown>; raw: string }> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Length": "0",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw), raw });
          } catch {
            resolve({ status: res.statusCode!, body: { _raw: raw }, raw });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe(
  "POST /api/admin/merchant-enrollments/:merchantId/enrollments/:providerSlug/test — credential test (real DB)",
  () => {
    let server: http.Server;
    let superAdminToken: string;
    let merchantId: number;

    // Plaintext values used in the "pass" enrollment — must never appear in responses
    const PLAIN_API_KEY    = "phonepe-api-key-test-12345";
    const PLAIN_API_SECRET = "phonepe-api-secret-test-67890";

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      // Use the seeded Super Admin — requireSuperAdmin checks isSuperAdmin on the DB row
      const [admin] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, "admin@rasokart.com"))
        .limit(1);
      assert.ok(admin, "seeded admin@rasokart.com must exist");
      assert.ok(admin!.isSuperAdmin, "admin@rasokart.com must have isSuperAdmin=true");
      superAdminToken = generateToken({ userId: admin!.id, role: "admin" });

      // Create a dedicated test merchant
      const ts = Date.now();
      const [merchant] = await db
        .insert(merchantsTable)
        .values({
          businessName: `Enrollment Test Merchant ${ts}`,
          contactName: "Enrollment Tester",
          email: `enrollment-test-${ts}@example.com`,
          phone: `9${String(ts).slice(-9)}`,
          status: "approved",
        })
        .returning();
      merchantId = merchant!.id;

      // 1. "phonepe" enrollment with valid encrypted credentials (pass case)
      await db.insert(merchantProviderEnrollmentsTable).values({
        merchantId,
        providerSlug: "phonepe",
        enrollmentStatus: "credentials_submitted",
        encryptedApiKey:    encryptSecret(PLAIN_API_KEY),
        encryptedApiSecret: encryptSecret(PLAIN_API_SECRET),
      });

      // 2. "paytm" enrollment — apiSecret is too short (fail case)
      await db.insert(merchantProviderEnrollmentsTable).values({
        merchantId,
        providerSlug: "paytm",
        enrollmentStatus: "credentials_submitted",
        encryptedApiKey:    encryptSecret("paytm-key-long-enough"),
        encryptedApiSecret: encryptSecret("short"),   // < 8 chars → format fail
      });

      // 3. "bharatpe" enrollment — apiKey entirely missing (fail case)
      await db.insert(merchantProviderEnrollmentsTable).values({
        merchantId,
        providerSlug: "bharatpe",
        enrollmentStatus: "credentials_submitted",
        encryptedApiKey:    null,
        encryptedApiSecret: encryptSecret("bharatpe-secret-long-enough"),
      });

      // 4. "freecharge" — Category E unsupported provider (no enrollment row needed;
      //    the route rejects it before the DB lookup in runEnrollmentCredentialTest,
      //    but the route *does* query the DB first — so we need a row to avoid 404)
      await db.insert(merchantProviderEnrollmentsTable).values({
        merchantId,
        providerSlug: "freecharge",
        enrollmentStatus: "credentials_submitted",
        encryptedApiKey:    encryptSecret("freecharge-key-long"),
        encryptedApiSecret: encryptSecret("freecharge-secret-long"),
      });
    });

    after(async () => {
      if (merchantId) {
        // Cascade deletes enrollment rows too (FK onDelete: cascade)
        await db.delete(merchantsTable).where(eq(merchantsTable.id, merchantId));
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    // ── 1. Pass case ─────────────────────────────────────────────────────────

    it("returns pass:true and stamps lastVerifiedAt when credentials are valid", async () => {
      const before = new Date();
      const { status, body } = await post(
        server,
        `/api/admin/merchant-enrollments/${merchantId}/enrollments/phonepe/test`,
        superAdminToken,
      );

      assert.equal(status, 200);
      assert.equal(body["pass"], true, `expected pass:true, got: ${JSON.stringify(body)}`);
      assert.ok(typeof body["message"] === "string" && body["message"].length > 0, "message should be non-empty");
      assert.ok(typeof body["testedAt"] === "string", "testedAt should be an ISO string");

      // Verify DB was updated
      const [row] = await db
        .select({ lastVerifiedAt: merchantProviderEnrollmentsTable.lastVerifiedAt })
        .from(merchantProviderEnrollmentsTable)
        .where(
          and(
            eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
            eq(merchantProviderEnrollmentsTable.providerSlug, "phonepe"),
          )
        )
        .limit(1);

      assert.ok(row!.lastVerifiedAt, "lastVerifiedAt should be set in the DB after a pass");
      assert.ok(
        row!.lastVerifiedAt!.getTime() >= before.getTime(),
        "lastVerifiedAt should be at or after the test started",
      );
    });

    // ── 2. Fail case — secret too short ──────────────────────────────────────

    it("returns pass:false with detail when apiSecret is too short", async () => {
      const before = new Date();
      const { status, body } = await post(
        server,
        `/api/admin/merchant-enrollments/${merchantId}/enrollments/paytm/test`,
        superAdminToken,
      );

      assert.equal(status, 200);
      assert.equal(body["pass"], false, `expected pass:false, got: ${JSON.stringify(body)}`);
      assert.ok(typeof body["detail"] === "string" && body["detail"].length > 0, "detail should explain the failure");
      assert.match(String(body["detail"]), /too short/i);

      // lastVerifiedAt must NOT be updated on a failure
      const [row] = await db
        .select({ lastVerifiedAt: merchantProviderEnrollmentsTable.lastVerifiedAt })
        .from(merchantProviderEnrollmentsTable)
        .where(
          and(
            eq(merchantProviderEnrollmentsTable.merchantId, merchantId),
            eq(merchantProviderEnrollmentsTable.providerSlug, "paytm"),
          )
        )
        .limit(1);

      assert.ok(
        !row!.lastVerifiedAt || row!.lastVerifiedAt.getTime() < before.getTime(),
        "lastVerifiedAt should NOT be updated after a fail",
      );
    });

    // ── 3. Fail case — apiKey missing ─────────────────────────────────────────

    it("returns pass:false with detail when apiKey is missing", async () => {
      const { status, body } = await post(
        server,
        `/api/admin/merchant-enrollments/${merchantId}/enrollments/bharatpe/test`,
        superAdminToken,
      );

      assert.equal(status, 200);
      assert.equal(body["pass"], false);
      assert.ok(typeof body["detail"] === "string");
      assert.match(String(body["detail"]), /missing/i);
    });

    // ── 4. 404 — enrollment not found ────────────────────────────────────────

    it("returns 404 when no enrollment row exists for the requested merchant + providerSlug", async () => {
      const { status, body } = await post(
        server,
        `/api/admin/merchant-enrollments/${merchantId}/enrollments/amazon_pay/test`,
        superAdminToken,
      );

      assert.equal(status, 404);
      assert.ok(typeof body["error"] === "string", "404 body should have an error message");
    });

    // ── 5. Category E rejection ───────────────────────────────────────────────

    it("returns pass:false for a Category E (unsupported) provider", async () => {
      const { status, body } = await post(
        server,
        `/api/admin/merchant-enrollments/${merchantId}/enrollments/freecharge/test`,
        superAdminToken,
      );

      assert.equal(status, 200);
      assert.equal(body["pass"], false);
      assert.match(String(body["message"]), /unsupported/i);
    });

    // ── 6. Security — plaintext credential values never leak ─────────────────

    it("never includes plaintext credential values in any response field", async () => {
      const { raw } = await post(
        server,
        `/api/admin/merchant-enrollments/${merchantId}/enrollments/phonepe/test`,
        superAdminToken,
      );

      assert.ok(
        !raw.includes(PLAIN_API_KEY),
        `response body must not contain the plaintext API key; got: ${raw}`,
      );
      assert.ok(
        !raw.includes(PLAIN_API_SECRET),
        `response body must not contain the plaintext API secret; got: ${raw}`,
      );
    });

    // ── 7. 403 when called by a non-super-admin ───────────────────────────────

    it("returns 403 when the caller is a regular admin (not Super Admin)", async () => {
      // Create a temporary non-SA admin user
      const ts = Date.now();
      const [nonSaAdmin] = await db
        .insert(usersTable)
        .values({
          email: `non-sa-admin-${ts}@example.com`,
          passwordHash: "x",
          name: "Non SA Admin",
          role: "admin",
          isSuperAdmin: false,
        })
        .returning();
      const nonSaToken = generateToken({ userId: nonSaAdmin!.id, role: "admin" });

      try {
        const { status } = await post(
          server,
          `/api/admin/merchant-enrollments/${merchantId}/enrollments/phonepe/test`,
          nonSaToken,
        );
        assert.equal(status, 403);
      } finally {
        await db.delete(usersTable).where(eq(usersTable.id, nonSaAdmin!.id));
      }
    });
  },
);
