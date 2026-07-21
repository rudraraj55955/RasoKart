/**
 * Integration test: no-op audit suppression for gateway settings PUT endpoints.
 *
 * Verifies the server-side guard: when an admin saves gateway config with
 * the same values that are already stored, NO new `audit_logs` row is
 * written. A genuine change (even a single field) MUST produce exactly
 * one new row. Covers:
 *
 *   PUT /api/system-config/cashfree
 *   PUT /api/system-config/cashfree-payout
 *   PUT /api/admin/upigateway/settings
 *   PUT /api/provider-integrations/integrations/:key
 *
 * Uses the real database — no mocks. Credential fields (clientId,
 * clientSecret, webhookSecret, apiKey, etc.) are intentionally omitted
 * from the no-op payloads because the current suppression logic always
 * records an audit entry when a credential field is submitted, even if the
 * value is identical to what is stored. Only non-credential metadata
 * fields participate in the no-op comparison.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, count } from "drizzle-orm";
import {
  db,
  usersTable,
  auditLogsTable,
  providerIntegrationsTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

// ── HTTP helpers ────────────────────────────────────────────────────────────

type HttpResult = { status: number; body: Record<string, unknown> };

function httpRequest(
  server: http.Server,
  method: string,
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
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
    if (payload) req.end(payload);
    else req.end();
  });
}

/** Count all rows in audit_logs at this instant. */
async function currentAuditCount(): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(auditLogsTable);
  return total;
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe(
  "Gateway settings PUT — no-op audit suppression (real DB)",
  () => {
    let server: http.Server;
    let token: string;

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );

      const [admin] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, "admin@rasokart.com"))
        .limit(1);
      assert.ok(
        admin,
        "admin@rasokart.com must exist in the seeded DB for this test",
      );
      token = generateToken({ userId: admin!.id, role: "admin" });
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    // ── PUT /api/system-config/cashfree ────────────────────────────────────

    describe("PUT /api/system-config/cashfree", () => {
      it("does not insert an audit row when non-credential fields are unchanged", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/cashfree",
          token,
        );
        assert.equal(
          getRes.status,
          200,
          `GET cashfree failed: ${JSON.stringify(getRes.body)}`,
        );
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        // PUT identical non-credential values — no audit row expected
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree",
          token,
          {
            enabled: cfg["enabled"],
            env: cfg["env"],
            upiEnabled: cfg["upiEnabled"],
            qrEnabled: cfg["qrEnabled"],
            paymentLinksEnabled: cfg["paymentLinksEnabled"],
            merchantPayinEnabled: cfg["merchantPayinEnabled"],
            minAmount: cfg["minAmount"],
            maxAmount: cfg["maxAmount"],
            dailyLimit: cfg["dailyLimit"],
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT cashfree (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "cashfree no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when a non-credential field changes", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/cashfree",
          token,
        );
        assert.equal(getRes.status, 200);
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        // Flip `enabled` to trigger a genuine change
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree",
          token,
          { enabled: !cfg["enabled"] },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT cashfree (change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "cashfree enabled-flag change must produce exactly one audit_logs row",
        );

        // Restore to avoid polluting subsequent tests
        await httpRequest(server, "PUT", "/api/system-config/cashfree", token, {
          enabled: cfg["enabled"],
        });
      });
    });

    // ── PUT /api/system-config/cashfree-payout ─────────────────────────────

    describe("PUT /api/system-config/cashfree-payout", () => {
      it("does not insert an audit row when non-credential fields are unchanged", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/cashfree-payout",
          token,
        );
        assert.equal(
          getRes.status,
          200,
          `GET cashfree-payout failed: ${JSON.stringify(getRes.body)}`,
        );
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-payout",
          token,
          {
            enabled: cfg["enabled"],
            env: cfg["env"],
            merchantEnabled: cfg["merchantEnabled"],
            bulkEnabled: cfg["bulkEnabled"],
            adminApprovalRequired: cfg["adminApprovalRequired"],
            minLimit: cfg["minLimit"],
            maxLimit: cfg["maxLimit"],
            dailyLimit: cfg["dailyLimit"],
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT cashfree-payout (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "cashfree-payout no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when a non-credential field changes", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/cashfree-payout",
          token,
        );
        assert.equal(getRes.status, 200);
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        // Flip `merchantEnabled`
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-payout",
          token,
          { merchantEnabled: !cfg["merchantEnabled"] },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT cashfree-payout (change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "cashfree-payout merchantEnabled change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          "/api/system-config/cashfree-payout",
          token,
          { merchantEnabled: cfg["merchantEnabled"] },
        );
      });
    });

    // ── PUT /api/admin/upigateway/settings ─────────────────────────────────

    describe("PUT /api/admin/upigateway/settings", () => {
      it("does not insert an audit row when non-credential fields are unchanged", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/admin/upigateway/settings",
          token,
        );
        assert.equal(
          getRes.status,
          200,
          `GET upigateway/settings failed: ${JSON.stringify(getRes.body)}`,
        );
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        // Send only non-credential fields — apiKey and webhookSecret are
        // intentionally omitted because they always trigger an audit entry
        // even when the value is unchanged.
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/admin/upigateway/settings",
          token,
          {
            enabled: cfg["enabled"],
            env: cfg["env"],
            minAmount: cfg["minAmount"],
            maxAmount: cfg["maxAmount"],
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT upigateway/settings (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "upigateway no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when a non-credential field changes", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/admin/upigateway/settings",
          token,
        );
        assert.equal(getRes.status, 200);
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        // Flip `enabled`
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/admin/upigateway/settings",
          token,
          { enabled: !cfg["enabled"] },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT upigateway/settings (change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "upigateway enabled-flag change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          "/api/admin/upigateway/settings",
          token,
          { enabled: cfg["enabled"] },
        );
      });
    });

    // ── PUT /api/provider-integrations/integrations/:key ───────────────────

    describe("PUT /api/provider-integrations/integrations/:key", () => {
      const testKey = `audit-noop-test-${Date.now()}`;

      before(async () => {
        // Insert a dedicated custom integration so the test has full control
        // over the starting state without touching any built-in integration.
        await db.insert(providerIntegrationsTable).values({
          providerKey: testKey,
          providerNameInternal: "Audit No-op Test Gateway",
          displayNamePublic: "Test Gateway",
          environment: "test",
          isEnabled: false,
          isCustom: true,
          webhookUrl: "https://example.com/webhook",
          notes: "created by no-op audit integration test",
        });
      });

      after(async () => {
        await db
          .delete(providerIntegrationsTable)
          .where(eq(providerIntegrationsTable.providerKey, testKey));
      });

      it("does not insert an audit row when metadata fields are unchanged", async () => {
        const countBefore = await currentAuditCount();

        // PUT with values identical to what was inserted above — no changes
        const putRes = await httpRequest(
          server,
          "PUT",
          `/api/provider-integrations/integrations/${testKey}`,
          token,
          {
            isEnabled: false,
            environment: "test",
            webhookUrl: "https://example.com/webhook",
            notes: "created by no-op audit integration test",
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT provider-integrations (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "provider-integrations no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when isEnabled changes", async () => {
        const countBefore = await currentAuditCount();

        // Flip isEnabled from false → true
        const putRes = await httpRequest(
          server,
          "PUT",
          `/api/provider-integrations/integrations/${testKey}`,
          token,
          { isEnabled: true },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT provider-integrations (isEnabled change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "provider-integrations isEnabled change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          `/api/provider-integrations/integrations/${testKey}`,
          token,
          { isEnabled: false },
        );
      });

      it("inserts exactly one audit row when notes change", async () => {
        const countBefore = await currentAuditCount();

        const putRes = await httpRequest(
          server,
          "PUT",
          `/api/provider-integrations/integrations/${testKey}`,
          token,
          { notes: "updated note — genuine change" },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT provider-integrations (notes change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "provider-integrations notes change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          `/api/provider-integrations/integrations/${testKey}`,
          token,
          { notes: "created by no-op audit integration test" },
        );
      });
    });
  },
);
