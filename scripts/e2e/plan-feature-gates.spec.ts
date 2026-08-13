/**
 * plan-feature-gates.spec.ts
 *
 * Verifies that the backend plan-feature gates on POST /api/api-keys and
 * PUT /api/webhooks actually work end-to-end:
 *
 *   • A Starter-plan merchant is refused (HTTP 403) with a meaningful error
 *     message on both endpoints.
 *   • A non-Starter merchant (Gold plan) is NOT blocked by the plan gate —
 *     the request proceeds past the 403 check and reaches normal validation
 *     (e.g. 400 for missing fields, 201 for a successful key creation).
 *
 * These are API-level tests (no browser); they execute as fast as a curl call
 * and don't touch the rate-limiter login path because each portal session is
 * established with a single login call in beforeAll.
 *
 * Demo accounts used:
 *   merchant@demo.com  — Starter plan (apiAccess=false, webhookAccess=false)
 *   merchant2@demo.com — Gold plan    (apiAccess=true,  webhookAccess=true)
 */

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:80";
const API = `${BASE}/api`;

/** Starter demo merchant credentials (no API/webhook access). */
const STARTER = { email: "merchant@demo.com", password: "Merchant@123456" };

/** Gold demo merchant credentials (full API/webhook access). */
const GOLD = { email: "merchant2@demo.com", password: "Merchant@123456" };

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${email}: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function postApiKey(token: string, label?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}/api-keys`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ label: label ?? "test-key" }),
  });
  return { status: res.status, body: await res.json() };
}

async function deleteApiKey(token: string, id: number): Promise<void> {
  await fetch(`${API}/api-keys/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

async function putWebhook(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}/webhooks`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ─── Shared state ─────────────────────────────────────────────────────────────

let starterToken = "";
let goldToken = "";

test.beforeAll(async () => {
  // Login both merchants once; reuse tokens for all tests in this file.
  [starterToken, goldToken] = await Promise.all([
    login(STARTER.email, STARTER.password),
    login(GOLD.email, GOLD.password),
  ]);
});

// ─── Starter merchant — API key gate ─────────────────────────────────────────

test("Starter merchant: POST /api/api-keys returns 403 with a plan-upgrade message", async () => {
  const { status, body } = await postApiKey(starterToken, "starter-gate-test");

  expect(status).toBe(403);
  // The error must be informative — not a silent failure or a generic message.
  expect(typeof body.error).toBe("string");
  expect(body.error.toLowerCase()).toMatch(/plan|upgrade|api access/);
});

// ─── Starter merchant — webhook gate ─────────────────────────────────────────

test("Starter merchant: PUT /api/webhooks returns 403 with a plan-upgrade message", async () => {
  const { status, body } = await putWebhook(starterToken, {
    url: "https://example.com/hook",
    events: ["payment.success"],
  });

  expect(status).toBe(403);
  expect(typeof body.error).toBe("string");
  expect(body.error.toLowerCase()).toMatch(/plan|upgrade|webhook access/);
});

// ─── Gold merchant — API key gate is open ────────────────────────────────────

test("Gold merchant: POST /api/api-keys succeeds (plan gate is open)", async () => {
  const { status, body } = await postApiKey(goldToken, "gold-gate-verification-key");

  // The plan gate passes; the server creates the key and returns 201.
  expect(status).toBe(201);
  expect(typeof body.id).toBe("number");

  // Clean up: revoke the key so it doesn't accumulate across test runs.
  if (typeof body.id === "number") {
    await deleteApiKey(goldToken, body.id);
  }
});

// ─── Gold merchant — webhook gate is open ────────────────────────────────────

test("Gold merchant: PUT /api/webhooks is not blocked by the plan gate", async () => {
  // Omit the url/events fields intentionally — we just need to confirm the
  // plan gate (403) does NOT fire. A 400 ("url and events required") means the
  // request got past the plan check and into normal validation.
  const { status, body } = await putWebhook(goldToken, {});

  // Must NOT be 403 from the plan gate.
  expect(status).not.toBe(403);

  // The expected outcome for a missing url/events is a 400 validation error.
  // We assert that to avoid accidentally treating a different 4xx as "passing".
  expect(status).toBe(400);
  expect(typeof body.error).toBe("string");
  expect(body.error.toLowerCase()).toContain("url");
});

// ─── Retry gate helpers ───────────────────────────────────────────────────────

async function retryWebhookLog(
  token: string,
  logId: number,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}/webhooks/logs/${logId}/retry`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return { status: res.status, body: await res.json() };
}

// ─── Starter merchant — retry gate ───────────────────────────────────────────

test("Starter merchant: POST /api/webhooks/logs/:id/retry returns 403 with a plan-upgrade message", async () => {
  // Use a non-existent log id (999999999). For a Starter merchant the plan
  // gate must fire BEFORE the 404 log-not-found check, so we still get 403.
  const { status, body } = await retryWebhookLog(starterToken, 999999999);

  expect(status).toBe(403);
  expect(typeof body.error).toBe("string");
  expect(body.error.toLowerCase()).toMatch(/plan|upgrade|webhook access/);
});

// ─── Gold merchant — retry gate is open ──────────────────────────────────────

test("Gold merchant: POST /api/webhooks/logs/:id/retry is not blocked by the plan gate", async () => {
  // Use a non-existent log id (999999999). A Gold merchant passes the plan
  // gate; the server then returns 404 (log not found) — proof the gate is open.
  const { status, body } = await retryWebhookLog(goldToken, 999999999);

  // Must NOT be 403 from the plan gate.
  expect(status).not.toBe(403);

  // The expected outcome for a missing log is 404.
  expect(status).toBe(404);
  expect(typeof body.error).toBe("string");
});
