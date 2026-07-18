/**
 * Integration test: GET /api/healthz/deep — excluded demo account exclusion
 * against the REAL database.
 *
 * Verifies that when a documented demo account is intentionally excluded (via
 * the SEED_EXCLUDE_DEMO_EMAILS env var OR via a row in the demo_account_removals
 * table), a broken/missing password hash for that account does NOT cause
 * /api/healthz/deep to return HTTP 503. This guards against regressions where
 * the exclusion logic in routes/health.ts is accidentally removed or bypassed.
 *
 * Test sequence (merchant3@demo.com is used as the target throughout):
 *   1. Baseline: tamper the hash → must get 503 (proves the break is real).
 *   2. Env-var exclusion: set SEED_EXCLUDE_DEMO_EMAILS → must get 200.
 *   3. DB-table exclusion: insert into demo_account_removals → must get 200.
 *   4. After removing the DB exclusion row (hash still broken): must get 503
 *      again, confirming the exclusion—not luck—was responsible for the 200.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db, usersTable, demoAccountRemovalsTable } from "@workspace/db";
import { DEMO_CREDENTIALS } from "@workspace/demo-credentials";
import app from "../app";

const TARGET_EMAIL = "merchant3@demo.com";
const BROKEN_HASH = "$2b$10$tamperedhashtamperedhashtamperedhashtamperedhashtampe";

function get(server: http.Server, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "GET",
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
    req.end();
  });
}

describe("GET /api/healthz/deep — excluded demo account does not trip deploy gate (real DB)", () => {
  let server: http.Server;
  let originalPasswordHash: string | null = null;

  before(async () => {
    assert.ok(
      DEMO_CREDENTIALS.some((c) => c.email === TARGET_EMAIL),
      `${TARGET_EMAIL} must be present in DEMO_CREDENTIALS for this test to be meaningful`,
    );

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const [row] = await db
      .select({ passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.email, TARGET_EMAIL))
      .limit(1);
    assert.ok(row, `${TARGET_EMAIL} must exist in the seeded DB for this test`);
    originalPasswordHash = row!.passwordHash;

    await db
      .update(usersTable)
      .set({ passwordHash: BROKEN_HASH })
      .where(eq(usersTable.email, TARGET_EMAIL));
  });

  after(async () => {
    delete process.env["SEED_EXCLUDE_DEMO_EMAILS"];

    await db.delete(demoAccountRemovalsTable).where(eq(demoAccountRemovalsTable.email, TARGET_EMAIL));

    if (originalPasswordHash) {
      await db
        .update(usersTable)
        .set({ passwordHash: originalPasswordHash })
        .where(eq(usersTable.email, TARGET_EMAIL));
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns 503 with demo_credentials: false when account is broken and NOT excluded (baseline)", async () => {
    delete process.env["SEED_EXCLUDE_DEMO_EMAILS"];
    await db.delete(demoAccountRemovalsTable).where(eq(demoAccountRemovalsTable.email, TARGET_EMAIL));

    const res = await get(server, "/api/healthz/deep");
    assert.equal(res.status, 503, "expected HTTP 503 when demo account is broken and not excluded");
    assert.equal(
      (res.body["checks"] as Record<string, boolean>)["demo_credentials"],
      false,
      "expected demo_credentials check to be false",
    );
  });

  it("returns 200 with demo_credentials: true when account is excluded via SEED_EXCLUDE_DEMO_EMAILS env var", async () => {
    process.env["SEED_EXCLUDE_DEMO_EMAILS"] = TARGET_EMAIL;
    try {
      const res = await get(server, "/api/healthz/deep");
      assert.equal(res.status, 200, "expected HTTP 200 when broken account is excluded via env var");
      assert.equal(
        (res.body["checks"] as Record<string, boolean>)["demo_credentials"],
        true,
        "expected demo_credentials check to pass when account is env-var-excluded",
      );
    } finally {
      delete process.env["SEED_EXCLUDE_DEMO_EMAILS"];
    }
  });

  it("returns 200 with demo_credentials: true when account is excluded via demo_account_removals DB table", async () => {
    await db
      .insert(demoAccountRemovalsTable)
      .values({ email: TARGET_EMAIL })
      .onConflictDoNothing();
    try {
      const res = await get(server, "/api/healthz/deep");
      assert.equal(res.status, 200, "expected HTTP 200 when broken account is excluded via DB table");
      assert.equal(
        (res.body["checks"] as Record<string, boolean>)["demo_credentials"],
        true,
        "expected demo_credentials check to pass when account is DB-table-excluded",
      );
    } finally {
      await db.delete(demoAccountRemovalsTable).where(eq(demoAccountRemovalsTable.email, TARGET_EMAIL));
    }
  });

  it("returns 503 again after DB exclusion row is removed (confirms cleanup)", async () => {
    const res = await get(server, "/api/healthz/deep");
    assert.equal(res.status, 503, "expected HTTP 503 after exclusion row removed (account still broken)");
    assert.equal(
      (res.body["checks"] as Record<string, boolean>)["demo_credentials"],
      false,
      "expected demo_credentials check to be false after exclusion row removed",
    );
  });
});
