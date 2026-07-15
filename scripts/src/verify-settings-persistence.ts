/**
 * verify-settings-persistence.ts
 *
 * Integration smoke-test for every admin settings config endpoint that was
 * previously broken by the React Query v5 `query: { onSuccess }` pattern.
 *
 * For each affected endpoint it:
 *   1. GETs the current persisted value
 *   2. PUTs a canary value
 *   3. GETs again and asserts the canary value is returned
 *   4. PUTs the original value back (cleanup)
 *
 * This verifies that the backend correctly persists and returns each value —
 * the data the frontend `useEffect` hydration reads on page reload.
 *
 * Requires:
 *   - API server running and accessible at localhost:80 (via shared proxy)
 *   - DATABASE_URL and SESSION_SECRET env vars available (same as the server)
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify-settings-persistence
 *
 * Exit code 0 = all checks passed, 1 = one or more checks failed.
 */

const BASE_URL = "http://localhost:80/api";

// Admin credentials — env overrides are respected, but the defaults are the
// documented public demo credentials already committed to replit.md. These are
// not production secrets; avoid storing real credentials here.
const ADMIN_EMAIL = process.env["VERIFY_ADMIN_EMAIL"] ?? "admin@rasokart.com";
const ADMIN_PASSWORD = process.env["VERIFY_ADMIN_PASSWORD"] ?? "Admin@123456";

/**
 * Wait for the API server to be ready before attempting any requests.
 * The validation workflow starts in parallel with the API server; without this
 * the first login attempt races with server startup and gets a 502.
 */
async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/healthz`);
      if (res.ok) return;
    } catch {
      // server not yet listening
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("API server did not become ready within 30 seconds");
}

async function getAdminToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Admin login failed (${res.status}): ${text}`);
  }
  const data = await res.json() as { token: string };
  return data.token;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

type CheckResult = { name: string; passed: boolean; detail: string };

async function checkRoundTrip(
  token: string,
  name: string,
  getUrl: string,
  putUrl: string,
  getOriginal: (data: any) => any,
  buildCanary: (original: any) => any,
  buildPutBody: (canary: any) => object,
  assertCanary: (data: any, canary: any) => boolean,
  buildRestoreBody: (original: any) => object,
): Promise<CheckResult> {
  try {
    const r1 = await fetch(`${BASE_URL}${getUrl}`, { headers: authHeaders(token) });
    if (!r1.ok) throw new Error(`GET failed with ${r1.status}`);
    const original = await r1.json();
    const originalVal = getOriginal(original);
    const canary = buildCanary(originalVal);

    const r2 = await fetch(`${BASE_URL}${putUrl}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(buildPutBody(canary)),
    });
    if (!r2.ok) {
      const txt = await r2.text();
      throw new Error(`PUT failed with ${r2.status}: ${txt}`);
    }

    const r3 = await fetch(`${BASE_URL}${getUrl}`, { headers: authHeaders(token) });
    if (!r3.ok) throw new Error(`GET after PUT failed with ${r3.status}`);
    const afterPut = await r3.json();
    if (!assertCanary(afterPut, canary)) {
      throw new Error(`Canary value not persisted. Got: ${JSON.stringify(afterPut)}, expected canary: ${JSON.stringify(canary)}`);
    }

    const r4 = await fetch(`${BASE_URL}${putUrl}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify(buildRestoreBody(originalVal)),
    });
    if (!r4.ok) {
      const txt = await r4.text();
      throw new Error(`Restore PUT failed with ${r4.status}: ${txt}`);
    }

    return { name, passed: true, detail: `canary=${JSON.stringify(canary)} persisted and restored` };
  } catch (err: any) {
    return { name, passed: false, detail: err?.message ?? String(err) };
  }
}

async function run() {
  console.log("=== RasoKart Settings Persistence Verification ===\n");

  await waitForServer();

  let token: string;
  try {
    token = await getAdminToken();
    console.log("✓ Admin login OK\n");
  } catch (err: any) {
    console.error("✗ Admin login FAILED:", err.message);
    process.exit(1);
  }

  const results: CheckResult[] = [];

  // 1. Finance report email (GET /api/settings, PUT /api/settings/finance_report_email)
  results.push(await checkRoundTrip(
    token,
    "finance_report_email",
    "/settings",
    "/settings/finance_report_email",
    (d) => d.finance_report_email ?? "",
    (orig) => orig === "canary-settings-test@example.com" ? "canary2-settings-test@example.com" : "canary-settings-test@example.com",
    (canary) => ({ value: canary }),
    (d, canary) => d.finance_report_email === canary,
    (orig) => ({ value: orig || null }),
  ));

  // 2. Reconciliation schedule (GET /api/settings, PUT /api/settings/reconciliation_schedule)
  results.push(await checkRoundTrip(
    token,
    "reconciliation_schedule",
    "/settings",
    "/settings/reconciliation_schedule",
    (d) => d.reconciliation_schedule ?? "daily",
    (orig) => orig === "weekly" ? "off" : "weekly",
    (canary) => ({ value: canary }),
    (d, canary) => d.reconciliation_schedule === canary,
    (orig) => ({ value: orig }),
  ));

  // 3. SMTP host (GET /api/settings/smtp, PUT /api/settings/smtp)
  // getOriginal returns the full SMTP config so the restore body can include
  // all original fields (host, port, user, from) — not just host.
  results.push(await checkRoundTrip(
    token,
    "smtp_host",
    "/settings/smtp",
    "/settings/smtp",
    (d) => ({ host: d.host ?? null, port: d.port ?? null, user: d.user ?? null, from: d.from ?? null }),
    (orig) => ({
      ...orig,
      host: orig.host === "smtp.canary-test.example.com" ? "smtp.canary2-test.example.com" : "smtp.canary-test.example.com",
    }),
    (canary) => ({ host: canary.host, port: canary.port, smtpUser: canary.user, from: canary.from }),
    (d, canary) => d.host === canary.host,
    (orig) => ({ host: orig.host, port: orig.port, smtpUser: orig.user, from: orig.from }),
  ));

  // 4. QR cleanup retention days (GET /api/system-config/qr-cleanup, PUT same)
  results.push(await checkRoundTrip(
    token,
    "qr_cleanup_retention_days",
    "/system-config/qr-cleanup",
    "/system-config/qr-cleanup",
    (d) => d.retentionDays ?? 30,
    (orig) => orig === 47 ? 48 : 47,
    (canary) => ({ retentionDays: canary }),
    (d, canary) => d.retentionDays === canary,
    (orig) => ({ retentionDays: orig }),
  ));

  // 5. VA cleanup retention days
  results.push(await checkRoundTrip(
    token,
    "va_cleanup_retention_days",
    "/system-config/va-cleanup",
    "/system-config/va-cleanup",
    (d) => d.retentionDays ?? 30,
    (orig) => orig === 52 ? 53 : 52,
    (canary) => ({ retentionDays: canary }),
    (d, canary) => d.retentionDays === canary,
    (orig) => ({ retentionDays: orig }),
  ));

  // 6. Test email history retention days
  results.push(await checkRoundTrip(
    token,
    "test_email_retention_days",
    "/system-config/test-email-retention",
    "/system-config/test-email-retention",
    (d) => d.retentionDays ?? 30,
    (orig) => orig === 14 ? 15 : 14,
    (canary) => ({ retentionDays: canary }),
    (d, canary) => d.retentionDays === canary,
    (orig) => ({ retentionDays: orig }),
  ));

  // 7. Audit log retention days
  results.push(await checkRoundTrip(
    token,
    "audit_log_retention_days",
    "/system-config/audit-report-retention",
    "/system-config/audit-report-retention",
    (d) => d.retentionDays ?? 90,
    (orig) => orig === 45 ? 46 : 45,
    (canary) => ({ retentionDays: canary }),
    (d, canary) => d.retentionDays === canary,
    (orig) => ({ retentionDays: orig }),
  ));

  // NOTE: storage cleanup schedule (/system-config/storage-cleanup GET/PUT) does not
  // have a standalone config endpoint in the current backend — only run/runs endpoints
  // exist. That card's values are stored via system config keys but lack a dedicated
  // REST pair, so it is excluded from this round-trip check.

  // 9. Webhook retry config (maxAttempts + delays)
  results.push(await checkRoundTrip(
    token,
    "webhook_retry_config",
    "/system-config/webhook-retries",
    "/system-config/webhook-retries",
    (d) => ({ maxAttempts: d.maxAttempts ?? 4, delay1: d.delay1 ?? 300, delay2: d.delay2 ?? 900, delay3: d.delay3 ?? 3600 }),
    (orig) => ({ ...orig, maxAttempts: orig.maxAttempts === 3 ? 4 : 3 }),
    (canary) => canary,
    (d, canary) => d.maxAttempts === canary.maxAttempts && d.delay1 === canary.delay1,
    (orig) => orig,
  ));

  // 10. Report delivery retry config (maxAttempts + backoffBaseMs)
  results.push(await checkRoundTrip(
    token,
    "report_delivery_retry_config",
    "/settings/report-delivery-retries",
    "/settings/report-delivery-retries",
    (d) => ({ maxAttempts: d.maxAttempts ?? 3, backoffBaseMs: d.backoffBaseMs ?? 1000 }),
    (orig) => ({ ...orig, maxAttempts: orig.maxAttempts === 2 ? 3 : 2 }),
    (canary) => canary,
    (d, canary) => d.maxAttempts === canary.maxAttempts && d.backoffBaseMs === canary.backoffBaseMs,
    (orig) => orig,
  ));

  // 11. Quiet hours flush interval
  results.push(await checkRoundTrip(
    token,
    "quiet_hours_flush_interval",
    "/system-config/quiet-hours-flush",
    "/system-config/quiet-hours-flush",
    (d) => d.intervalSeconds ?? 60,
    (orig) => orig === 90 ? 120 : 90,
    (canary) => ({ intervalSeconds: canary }),
    (d, canary) => d.intervalSeconds === canary,
    (orig) => ({ intervalSeconds: orig }),
  ));

  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  for (const r of results) {
    console.log(`${r.passed ? "✓ PASS" : "✗ FAIL"} | ${r.name} | ${r.detail}`);
  }

  console.log(
    `\n${failed.length === 0
      ? `✅ All ${results.length} settings persistence checks passed.`
      : `❌ ${failed.length} of ${results.length} checks FAILED — see output above.`
    }`,
  );

  process.exit(failed.length === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
