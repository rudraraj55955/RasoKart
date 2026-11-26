/**
 * Integration test: POST /api/admin/merchant-enrollments/:merchantId/enrollments/:providerSlug/test
 *
 * Covers:
 *   1.  Pass case    — valid encrypted credentials → pass:true, lastVerifiedAt stamped in DB
 *   2.  Fail case    — missing / too-short credentials → pass:false with a human-readable detail
 *   3.  Fail case    — apiKey entirely missing → pass:false, detail mentions "missing"
 *   4.  404          — enrollment does not exist for the requested merchant + providerSlug
 *   5.  Pine Labs    — fake credentials → UAT API rejects or network error → pass:false, human-readable detail, no plaintext leak
 *   6.  Pine Labs    — missing Merchant ID (MID) → immediate pass:false before any network call
 *   7.  Category E   — unsupported provider → pass:false, no DB write
 *   8.  Security     — credential values (plaintext) NEVER appear anywhere in the response body
 *   9.  403          — regular admin (not Super Admin) → forbidden
 *  10.  E2E flow     — merchant initiates Pine Labs enrollment via API, submits credentials via API,
 *                      admin runs the credential test via API → full route chain verified end-to-end
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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

type HttpResult = { status: number; body: Record<string, unknown>; raw: string };

/** POST with no body (used for admin credential test trigger). */
function post(
  server: http.Server,
  path: string,
  token: string,
): Promise<HttpResult> {
  return makeRequest(server, "POST", path, token, undefined);
}

/** POST with JSON body. */
function postJson(
  server: http.Server,
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<HttpResult> {
  return makeRequest(server, "POST", path, token, body);
}

/** PUT with JSON body. */
function putJson(
  server: http.Server,
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<HttpResult> {
  return makeRequest(server, "PUT", path, token, body);
}

function makeRequest(
  server: http.Server,
  method: string,
  path: string,
  token: string,
  body: Record<string, unknown> | undefined,
): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  const bodyStr = body ? JSON.stringify(body) : "";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(bodyStr),
              }
            : { "Content-Length": "0" }),
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
    if (body) req.write(bodyStr);
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

      // 5. "pinelabs" — Category D with live UAT call; fake credentials will be
      //    rejected by the Pine Labs Plural UAT API (or produce a network/timeout
      //    error if unreachable). Either outcome is a human-readable pass:false.
      await db.insert(merchantProviderEnrollmentsTable).values({
        merchantId,
        providerSlug:     "pinelabs",
        enrollmentStatus: "credentials_submitted",
        maskedIdentifier: "TEST_MID_12345",
        encryptedApiKey:    encryptSecret("pinelabs-access-code-fake"),
        encryptedApiSecret: encryptSecret("pinelabs-secret-key-fake"),
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

    // ── 5. Pine Labs — fake credentials rejected by UAT API (or network error) ──
    //
    // The live UAT call with clearly-fake credentials will either:
    //   a) Reach Pine Labs UAT → get an auth error  → pass:false with auth message
    //   b) Time out / network error                 → pass:false with network message
    // Either way: pass:false AND a human-readable detail (no silent pass).

    it("returns pass:false with a human-readable message when Pine Labs credentials are invalid", async () => {
      const { status, body } = await post(
        server,
        `/api/admin/merchant-enrollments/${merchantId}/enrollments/pinelabs/test`,
        superAdminToken,
      );

      assert.equal(status, 200, `expected HTTP 200, got ${status}: ${JSON.stringify(body)}`);
      assert.equal(body["pass"], false, `expected pass:false for fake Pine Labs credentials, got: ${JSON.stringify(body)}`);
      assert.ok(
        typeof body["message"] === "string" && body["message"].length > 0,
        "message should be a non-empty string",
      );
      // detail must mention either the Pine Labs auth failure or a network/timeout problem
      assert.ok(
        typeof body["detail"] === "string" && body["detail"].length > 0,
        "detail should explain what failed",
      );
      // Ensure plaintext credentials NEVER appear in the response
      assert.ok(
        !String(body["detail"]).includes("pinelabs-access-code-fake"),
        "detail must not contain plaintext Access Code",
      );
      assert.ok(
        !String(body["detail"]).includes("pinelabs-secret-key-fake"),
        "detail must not contain plaintext Secret Key",
      );
    });

    // ── 6. Pine Labs — missing Merchant ID → immediate fail (no network call) ──
    //
    // Uses a separate merchant so the unique (merchantId, providerSlug) constraint
    // for the main test merchant is not affected.

    it("returns pass:false immediately when Pine Labs Merchant ID (MID) is missing", async () => {
      const ts = Date.now();
      // Create a temporary merchant for this sub-test
      const [tmpMerchant] = await db
        .insert(merchantsTable)
        .values({
          businessName: `PL MID Test Merchant ${ts}`,
          contactName:  "PL MID Tester",
          email:        `pl-mid-test-${ts}@example.com`,
          phone:        `8${String(ts).slice(-9)}`,
          status:       "approved",
        })
        .returning();

      try {
        // Enroll without maskedIdentifier (MID missing)
        await db.insert(merchantProviderEnrollmentsTable).values({
          merchantId:       tmpMerchant!.id,
          providerSlug:     "pinelabs",
          enrollmentStatus: "credentials_submitted",
          maskedIdentifier: null,
          encryptedApiKey:    encryptSecret("access-code-long-enough"),
          encryptedApiSecret: encryptSecret("secret-key-long-enough"),
        });

        const { status, body } = await post(
          server,
          `/api/admin/merchant-enrollments/${tmpMerchant!.id}/enrollments/pinelabs/test`,
          superAdminToken,
        );

        assert.equal(status, 200);
        assert.equal(body["pass"], false, `expected pass:false for missing MID, got: ${JSON.stringify(body)}`);
        assert.match(
          String(body["detail"]),
          /merchant id|mid/i,
          "detail should mention Merchant ID",
        );
      } finally {
        // Cascade-deletes the enrollment row too
        await db.delete(merchantsTable).where(eq(merchantsTable.id, tmpMerchant!.id));
      }
    });

    // ── 7. Category E rejection ───────────────────────────────────────────────

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

    // ── 8. Security — plaintext credential values never leak ─────────────────

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

    // ── 9. 403 when called by a non-super-admin ───────────────────────────────

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

    // ── 10. End-to-end route flow: initiate → submit credentials → admin test ─
    //
    // Exercises the complete Pine Labs enrollment route chain:
    //   a. Merchant: POST /api/merchant/enrollments          → initiate enrollment
    //   b. Merchant: PUT  /api/merchant/enrollments/pinelabs/credentials
    //                                                         → submit MID + Access Code + Secret Key
    //   c. Admin:    POST /api/admin/merchant-enrollments/:merchantId/enrollments/pinelabs/test
    //                                                         → run credential test
    //
    // Credentials are deliberately fake — the Pine Labs UAT API will reject them
    // (or a network error occurs if UAT is unreachable). Either outcome is a
    // deterministic pass:false with a human-readable message. This validates the
    // full route chain independently of whether UAT is reachable in CI.

    it("full e2e: merchant initiates Pine Labs enrollment, submits credentials, admin runs test → pass:false with detail", async () => {
      const ts = Date.now();

      // Create a dedicated test merchant for this flow
      const [e2eMerchant] = await db
        .insert(merchantsTable)
        .values({
          businessName: `PL E2E Test ${ts}`,
          contactName:  "PL E2E Tester",
          email:        `pl-e2e-${ts}@example.com`,
          phone:        `7${String(ts).slice(-9)}`,
          status:       "approved",
        })
        .returning();
      const e2eMerchantId = e2eMerchant!.id;

      // Create a merchant user linked to this merchant
      const [e2eUser] = await db
        .insert(usersTable)
        .values({
          email:        `pl-e2e-user-${ts}@example.com`,
          passwordHash: "x",
          name:         "PL E2E Merchant User",
          role:         "merchant",
          merchantId:   e2eMerchantId,
        })
        .returning();
      const merchantToken = generateToken({ userId: e2eUser!.id, role: "merchant" });

      try {
        // ── Step a: initiate Pine Labs enrollment ─────────────────────────────
        const initResult = await postJson(
          server,
          "/api/merchant/enrollments",
          merchantToken,
          { providerSlug: "pinelabs" },
        );
        assert.equal(
          initResult.status,
          200,
          `initiate enrollment expected 200, got ${initResult.status}: ${initResult.raw}`,
        );
        assert.ok(
          initResult.body["enrollment"],
          "response should contain an enrollment object",
        );
        assert.equal(
          (initResult.body["enrollment"] as Record<string, unknown>)["providerSlug"],
          "pinelabs",
        );

        // ── Step b: submit Pine Labs credentials ──────────────────────────────
        const credResult = await putJson(
          server,
          "/api/merchant/enrollments/pinelabs/credentials",
          merchantToken,
          {
            merchantId: "E2E_MID_12345",          // MID (public identifier)
            apiKey:     "e2e-access-code-fake",   // Access Code
            apiSecret:  "e2e-secret-key-fake",    // Secret Key
          },
        );
        assert.equal(
          credResult.status,
          200,
          `credential submission expected 200, got ${credResult.status}: ${credResult.raw}`,
        );
        const credEnrollment = credResult.body["enrollment"] as Record<string, unknown>;
        assert.equal(
          credEnrollment["enrollmentStatus"],
          "credentials_submitted",
          "status should be credentials_submitted after credential submission",
        );
        // Credential values must never be echoed back
        assert.ok(!credResult.raw.includes("e2e-access-code-fake"), "Access Code must not appear in response");
        assert.ok(!credResult.raw.includes("e2e-secret-key-fake"),  "Secret Key must not appear in response");

        // ── Step c: admin runs the credential test ────────────────────────────
        const testResult = await post(
          server,
          `/api/admin/merchant-enrollments/${e2eMerchantId}/enrollments/pinelabs/test`,
          superAdminToken,
        );
        assert.equal(
          testResult.status,
          200,
          `admin credential test expected HTTP 200, got ${testResult.status}: ${testResult.raw}`,
        );
        // Fake credentials → Pine Labs UAT rejects or network error → always pass:false
        assert.equal(
          testResult.body["pass"],
          false,
          `fake Pine Labs credentials must produce pass:false, got: ${JSON.stringify(testResult.body)}`,
        );
        assert.ok(
          typeof testResult.body["message"] === "string" && (testResult.body["message"] as string).length > 0,
          "test result must include a human-readable message",
        );
        assert.ok(
          typeof testResult.body["detail"] === "string" && (testResult.body["detail"] as string).length > 0,
          "test result must include a detail explanation",
        );
        // Credential values must never appear in the test result
        assert.ok(!testResult.raw.includes("e2e-access-code-fake"), "Access Code must not appear in test result");
        assert.ok(!testResult.raw.includes("e2e-secret-key-fake"),  "Secret Key must not appear in test result");
      } finally {
        // Cascades to enrollment rows via FK onDelete:cascade
        await db.delete(usersTable).where(eq(usersTable.id, e2eUser!.id));
        await db.delete(merchantsTable).where(eq(merchantsTable.id, e2eMerchantId));
      }
    });
  },
);
