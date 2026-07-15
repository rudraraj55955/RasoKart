/**
 * Integration test: GET /api/healthz/deep — demo-credential deploy gate
 * against the REAL database.
 *
 * This proves the actual contract described in replit.md: if a documented
 * demo account's password hash is broken (e.g. a seed regression), the deep
 * health check must fail closed with HTTP 503 and `checks.demo_credentials: false`,
 * so Replit's autoscale startup health check refuses to route traffic to the
 * new instance. We tamper merchant3@demo.com's password hash, hit the route,
 * assert the failure, then restore the original hash so the DB is left clean
 * (including re-verifying the account authenticates again afterward).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { DEMO_CREDENTIALS } from "@workspace/demo-credentials";
import app from "../app";

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

describe("GET /api/healthz/deep — demo credential deploy gate (real DB)", () => {
  let server: http.Server;
  const merchant3 = DEMO_CREDENTIALS.find((c) => c.email === "merchant3@demo.com");
  let originalPasswordHash: string | null;

  before(async () => {
    assert.ok(merchant3, "merchant3@demo.com must be present in DEMO_CREDENTIALS for this test");

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const [row] = await db
      .select({ passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.email, "merchant3@demo.com"))
      .limit(1);
    assert.ok(row, "merchant3@demo.com must exist in the seeded DB for this test");
    originalPasswordHash = row!.passwordHash;
  });

  after(async () => {
    if (originalPasswordHash) {
      await db
        .update(usersTable)
        .set({ passwordHash: originalPasswordHash })
        .where(eq(usersTable.email, "merchant3@demo.com"));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns 200 with demo_credentials: true before tampering", async () => {
    const res = await get(server, "/api/healthz/deep");
    assert.equal(res.status, 200);
    assert.equal(res.body["checks"] && (res.body["checks"] as Record<string, boolean>)["demo_credentials"], true);
  });

  it("returns 503 with demo_credentials: false when merchant3's hash is tampered", async () => {
    await db
      .update(usersTable)
      .set({ passwordHash: "$2b$10$tamperedhashtamperedhashtamperedhashtamperedhashtampe" })
      .where(eq(usersTable.email, "merchant3@demo.com"));

    const res = await get(server, "/api/healthz/deep");
    assert.equal(res.status, 503);
    assert.equal(res.body["status"], "degraded");
    assert.equal((res.body["checks"] as Record<string, boolean>)["demo_credentials"], false);
  });

  it("returns 200 with demo_credentials: true again after restoring the hash", async () => {
    await db
      .update(usersTable)
      .set({ passwordHash: originalPasswordHash })
      .where(eq(usersTable.email, "merchant3@demo.com"));

    const res = await get(server, "/api/healthz/deep");
    assert.equal(res.status, 200);
    assert.equal((res.body["checks"] as Record<string, boolean>)["demo_credentials"], true);
  });
});
