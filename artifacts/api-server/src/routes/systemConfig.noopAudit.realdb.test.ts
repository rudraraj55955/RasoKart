/**
 * Integration test: no-op audit suppression for system-config PUT endpoints.
 *
 * Verifies the server-side guard: when an admin saves system config with the
 * same values already stored, NO new `audit_logs` row is written.  A genuine
 * change (even a single field) MUST produce exactly one new row.  Covers:
 *
 *   PUT /api/system-config/reconciliation
 *   PUT /api/system-config/qr-cleanup
 *   PUT /api/system-config/va-cleanup
 *   PUT /api/system-config/webhook-retries
 *   PUT /api/system-config/webhook-failure-alert
 *   PUT /api/system-config/signature-failure-alert
 *   PUT /api/system-config/credential-rotation-alert-recipients
 *
 * Uses the real database — no mocks.  Each test GETs the current config
 * first so the no-op payload is always live data, not a hardcoded assumption.
 * Genuine-change tests restore the original value after asserting so they
 * do not pollute subsequent tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, count } from "drizzle-orm";
import { db, usersTable, auditLogsTable } from "@workspace/db";
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
  "System config PUT — no-op audit suppression (real DB)",
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

    // ── PUT /api/system-config/reconciliation ──────────────────────────────

    describe("PUT /api/system-config/reconciliation", () => {
      it("does not insert an audit row when all fields are unchanged", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/reconciliation",
          token,
        );
        assert.equal(
          getRes.status,
          200,
          `GET reconciliation failed: ${JSON.stringify(getRes.body)}`,
        );
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/reconciliation",
          token,
          {
            hour: cfg["hour"],
            minute: cfg["minute"],
            lookbackDays: cfg["lookbackDays"],
            enabled: cfg["enabled"],
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT reconciliation (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "reconciliation no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when a field changes", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/reconciliation",
          token,
        );
        assert.equal(getRes.status, 200);
        const cfg = getRes.body;
        const originalHour = cfg["hour"] as number;

        const countBefore = await currentAuditCount();

        // Nudge hour by +1, wrapping around 23
        const changedHour = (originalHour + 1) % 24;
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/reconciliation",
          token,
          {
            hour: changedHour,
            minute: cfg["minute"],
            lookbackDays: cfg["lookbackDays"],
            enabled: cfg["enabled"],
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT reconciliation (change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "reconciliation hour change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          "/api/system-config/reconciliation",
          token,
          {
            hour: originalHour,
            minute: cfg["minute"],
            lookbackDays: cfg["lookbackDays"],
            enabled: cfg["enabled"],
          },
        );
      });
    });

    // ── PUT /api/system-config/qr-cleanup ─────────────────────────────────

    describe("PUT /api/system-config/qr-cleanup", () => {
      it("does not insert an audit row when retentionDays is unchanged", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/qr-cleanup",
          token,
        );
        assert.equal(
          getRes.status,
          200,
          `GET qr-cleanup failed: ${JSON.stringify(getRes.body)}`,
        );
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/qr-cleanup",
          token,
          { retentionDays: cfg["retentionDays"] },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT qr-cleanup (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "qr-cleanup no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when retentionDays changes", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/qr-cleanup",
          token,
        );
        assert.equal(getRes.status, 200);
        const original = getRes.body["retentionDays"] as number;

        const countBefore = await currentAuditCount();

        // Use a value that stays within the 0–365 range
        const changed = original === 30 ? 31 : 30;
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/qr-cleanup",
          token,
          { retentionDays: changed },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT qr-cleanup (change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "qr-cleanup retentionDays change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          "/api/system-config/qr-cleanup",
          token,
          { retentionDays: original },
        );
      });
    });

    // ── PUT /api/system-config/va-cleanup ─────────────────────────────────

    describe("PUT /api/system-config/va-cleanup", () => {
      it("does not insert an audit row when retentionDays is unchanged", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/va-cleanup",
          token,
        );
        assert.equal(
          getRes.status,
          200,
          `GET va-cleanup failed: ${JSON.stringify(getRes.body)}`,
        );
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/va-cleanup",
          token,
          { retentionDays: cfg["retentionDays"] },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT va-cleanup (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "va-cleanup no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when retentionDays changes", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/va-cleanup",
          token,
        );
        assert.equal(getRes.status, 200);
        const original = getRes.body["retentionDays"] as number;

        const countBefore = await currentAuditCount();

        const changed = original === 30 ? 31 : 30;
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/va-cleanup",
          token,
          { retentionDays: changed },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT va-cleanup (change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "va-cleanup retentionDays change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          "/api/system-config/va-cleanup",
          token,
          { retentionDays: original },
        );
      });
    });

    // ── PUT /api/system-config/webhook-retries ─────────────────────────────

    describe("PUT /api/system-config/webhook-retries", () => {
      it("does not insert an audit row when all fields are unchanged", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/webhook-retries",
          token,
        );
        assert.equal(
          getRes.status,
          200,
          `GET webhook-retries failed: ${JSON.stringify(getRes.body)}`,
        );
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/webhook-retries",
          token,
          {
            maxAttempts: cfg["maxAttempts"],
            delay1: cfg["delay1"],
            delay2: cfg["delay2"],
            delay3: cfg["delay3"],
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT webhook-retries (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "webhook-retries no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when maxAttempts changes", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/webhook-retries",
          token,
        );
        assert.equal(getRes.status, 200);
        const cfg = getRes.body;
        const originalMax = cfg["maxAttempts"] as number;

        const countBefore = await currentAuditCount();

        // Toggle between 3 and 4, both valid and within 1–10 range
        const changedMax = originalMax === 4 ? 3 : 4;
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/webhook-retries",
          token,
          {
            maxAttempts: changedMax,
            delay1: cfg["delay1"],
            delay2: cfg["delay2"],
            delay3: cfg["delay3"],
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT webhook-retries (change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "webhook-retries maxAttempts change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          "/api/system-config/webhook-retries",
          token,
          {
            maxAttempts: originalMax,
            delay1: cfg["delay1"],
            delay2: cfg["delay2"],
            delay3: cfg["delay3"],
          },
        );
      });
    });

    // ── PUT /api/system-config/webhook-failure-alert ───────────────────────

    describe("PUT /api/system-config/webhook-failure-alert", () => {
      it("does not insert an audit row when cooldownHours is unchanged", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/webhook-failure-alert",
          token,
        );
        assert.equal(
          getRes.status,
          200,
          `GET webhook-failure-alert failed: ${JSON.stringify(getRes.body)}`,
        );
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/webhook-failure-alert",
          token,
          { cooldownHours: cfg["cooldownHours"] },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT webhook-failure-alert (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "webhook-failure-alert no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when cooldownHours changes", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/webhook-failure-alert",
          token,
        );
        assert.equal(getRes.status, 200);
        const original = getRes.body["cooldownHours"] as number;

        const countBefore = await currentAuditCount();

        // Toggle between 1 and 2, both within 1–168 range
        const changed = original === 1 ? 2 : 1;
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/webhook-failure-alert",
          token,
          { cooldownHours: changed },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT webhook-failure-alert (change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "webhook-failure-alert cooldownHours change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          "/api/system-config/webhook-failure-alert",
          token,
          { cooldownHours: original },
        );
      });
    });

    // ── PUT /api/system-config/signature-failure-alert ────────────────────

    describe("PUT /api/system-config/signature-failure-alert", () => {
      it("does not insert an audit row when all fields are unchanged", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/signature-failure-alert",
          token,
        );
        assert.equal(
          getRes.status,
          200,
          `GET signature-failure-alert failed: ${JSON.stringify(getRes.body)}`,
        );
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/signature-failure-alert",
          token,
          {
            threshold: cfg["threshold"],
            cooldownHours: cfg["cooldownHours"],
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT signature-failure-alert (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "signature-failure-alert no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when threshold changes", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/signature-failure-alert",
          token,
        );
        assert.equal(getRes.status, 200);
        const cfg = getRes.body;
        const originalThreshold = cfg["threshold"] as number;

        const countBefore = await currentAuditCount();

        // Toggle between 10 and 11 — both within 1–10000 range
        const changedThreshold = originalThreshold === 10 ? 11 : 10;
        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/signature-failure-alert",
          token,
          {
            threshold: changedThreshold,
            cooldownHours: cfg["cooldownHours"],
          },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT signature-failure-alert (change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "signature-failure-alert threshold change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          "/api/system-config/signature-failure-alert",
          token,
          {
            threshold: originalThreshold,
            cooldownHours: cfg["cooldownHours"],
          },
        );
      });
    });

    // ── PUT /api/system-config/credential-rotation-alert-recipients ────────

    describe("PUT /api/system-config/credential-rotation-alert-recipients", () => {
      it("does not insert an audit row when extraRecipients is unchanged", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/credential-rotation-alert-recipients",
          token,
        );
        assert.equal(
          getRes.status,
          200,
          `GET credential-rotation-alert-recipients failed: ${JSON.stringify(getRes.body)}`,
        );
        const cfg = getRes.body;

        const countBefore = await currentAuditCount();

        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/credential-rotation-alert-recipients",
          token,
          { extraRecipients: cfg["extraRecipients"] },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT credential-rotation-alert-recipients (no-op) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore,
          "credential-rotation-alert-recipients no-op PUT must not insert any audit_logs row",
        );
      });

      it("inserts exactly one audit row when extraRecipients changes", async () => {
        const getRes = await httpRequest(
          server,
          "GET",
          "/api/system-config/credential-rotation-alert-recipients",
          token,
        );
        assert.equal(getRes.status, 200);
        const originalRecipients = getRes.body["extraRecipients"] as string[];

        const countBefore = await currentAuditCount();

        // Add a test address if the list is currently empty, or clear it if not
        const changedRecipients =
          originalRecipients.length === 0
            ? ["noop-audit-test@example.com"]
            : [];

        const putRes = await httpRequest(
          server,
          "PUT",
          "/api/system-config/credential-rotation-alert-recipients",
          token,
          { extraRecipients: changedRecipients },
        );
        assert.equal(
          putRes.status,
          200,
          `PUT credential-rotation-alert-recipients (change) failed: ${JSON.stringify(putRes.body)}`,
        );

        const countAfter = await currentAuditCount();
        assert.equal(
          countAfter,
          countBefore + 1,
          "credential-rotation-alert-recipients change must produce exactly one audit_logs row",
        );

        // Restore
        await httpRequest(
          server,
          "PUT",
          "/api/system-config/credential-rotation-alert-recipients",
          token,
          { extraRecipients: originalRecipients },
        );
      });
    });
  },
);
