/**
 * Integration tests: PATCH /api/merchants/me — phone & website validation
 *
 * Regression guard for the validation block added to the PATCH /me handler
 * (artifacts/api-server/src/routes/merchants.ts ~lines 446-465).
 *
 * Covered cases:
 *   Invalid inputs (→ 400):
 *     1. Phone string with no digits
 *     2. Website with ftp:// protocol
 *     3. Website that is not a URL at all
 *
 *   Valid inputs (→ 200):
 *     4. Valid +91 phone number
 *     5. Valid https:// website
 *     6. Empty string website (clears the field — sets website to null)
 *
 * Uses the real database (seeded merchant@demo.com) so the full
 * Express middleware chain (requireAuth → DB user lookup → handler) runs
 * exactly as it does in production. Original field values are restored after
 * the 200 tests so the demo account is not permanently mutated.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db, usersTable, merchantsTable } from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

// ── HTTP helper ──────────────────────────────────────────────────────────────

type HttpResult = { status: number; body: Record<string, unknown> };

function patch(
  server: http.Server,
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
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
    req.end(payload);
  });
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("PATCH /api/merchants/me — phone & website validation (real DB)", () => {
  let server: http.Server;
  let token: string;
  let originalPhone: string;
  let originalWebsite: string | null;
  let merchantId: number;

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    // Use the seeded demo merchant user
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, "merchant@demo.com"))
      .limit(1);
    assert.ok(user, "merchant@demo.com must exist in the seeded DB for this test");
    assert.equal(user.role, "merchant", "merchant@demo.com must have role=merchant");
    assert.ok(user.merchantId, "merchant@demo.com must have a merchantId");

    token = generateToken({ userId: user.id, role: "merchant" });
    merchantId = user.merchantId!;

    // Snapshot original values so we can restore after 200-path tests
    const [merchant] = await db
      .select({ phone: merchantsTable.phone, website: merchantsTable.website })
      .from(merchantsTable)
      .where(eq(merchantsTable.id, merchantId))
      .limit(1);
    assert.ok(merchant, "merchant row must exist for merchant@demo.com");
    originalPhone = merchant.phone ?? null;
    originalWebsite = merchant.website ?? null;
  });

  after(async () => {
    // Restore original values so demo data is not permanently mutated
    await db
      .update(merchantsTable)
      .set({ phone: originalPhone, website: originalWebsite })
      .where(eq(merchantsTable.id, merchantId));

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── Invalid inputs → 400 ─────────────────────────────────────────────────

  it("returns 400 when phone contains no digits", async () => {
    const { status, body } = await patch(
      server,
      "/api/merchants/me",
      token,
      { phone: "no-digits-here" },
    );

    assert.equal(
      status,
      400,
      `Expected 400 for phone with no digits but got ${status}: ${JSON.stringify(body)}`,
    );
    assert.ok(
      typeof body["error"] === "string" && (body["error"] as string).length > 0,
      "Response must include an error message",
    );
  });

  it("returns 400 when website uses ftp:// protocol", async () => {
    const { status, body } = await patch(
      server,
      "/api/merchants/me",
      token,
      { website: "ftp://files.example.com" },
    );

    assert.equal(
      status,
      400,
      `Expected 400 for ftp:// website but got ${status}: ${JSON.stringify(body)}`,
    );
    assert.ok(
      typeof body["error"] === "string" && (body["error"] as string).length > 0,
      "Response must include an error message",
    );
  });

  it("returns 400 when website is not a valid URL", async () => {
    const { status, body } = await patch(
      server,
      "/api/merchants/me",
      token,
      { website: "not-a-url" },
    );

    assert.equal(
      status,
      400,
      `Expected 400 for non-URL website but got ${status}: ${JSON.stringify(body)}`,
    );
    assert.ok(
      typeof body["error"] === "string" && (body["error"] as string).length > 0,
      "Response must include an error message",
    );
  });

  // ── Valid inputs → 200 ───────────────────────────────────────────────────

  it("returns 200 and saves a valid +91 phone number", async () => {
    const { status, body } = await patch(
      server,
      "/api/merchants/me",
      token,
      { phone: "+91 98765 43210" },
    );

    assert.equal(
      status,
      200,
      `Expected 200 for valid phone but got ${status}: ${JSON.stringify(body)}`,
    );
    assert.equal(
      body["phone"],
      "+91 98765 43210",
      "Response must echo back the saved phone number",
    );
  });

  it("returns 200 and saves a valid https:// website", async () => {
    const { status, body } = await patch(
      server,
      "/api/merchants/me",
      token,
      { website: "https://validbusiness.example.com" },
    );

    assert.equal(
      status,
      200,
      `Expected 200 for valid https:// website but got ${status}: ${JSON.stringify(body)}`,
    );
    assert.equal(
      body["website"],
      "https://validbusiness.example.com",
      "Response must echo back the saved website URL",
    );
  });

  it("returns 200 and clears the website when an empty string is sent", async () => {
    // First set a website so there is something to clear
    await patch(server, "/api/merchants/me", token, {
      website: "https://to-be-cleared.example.com",
    });

    const { status, body } = await patch(
      server,
      "/api/merchants/me",
      token,
      { website: "" },
    );

    assert.equal(
      status,
      200,
      `Expected 200 when clearing website but got ${status}: ${JSON.stringify(body)}`,
    );
    assert.equal(
      body["website"],
      null,
      "Response must show website as null after clearing with empty string",
    );
  });
});
