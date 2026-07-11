/**
 * Playwright globalTeardown — runs exactly once per `playwright test`
 * invocation, after every worker has finished. This is the only safe place
 * to restore the admin settings snapshotted by global-setup.ts.
 *
 * It must NOT be done in a spec file's `test.afterAll`: with
 * `fullyParallel: true`, `afterAll` runs once per worker process, and a
 * worker that finishes its share of the file's tests early would fire it
 * while a different worker is still mid-test on the same settings row —
 * silently clobbering that still-running test's expected value.
 */
import {
  readCachedAdminToken,
  readCachedMerchantToken,
  readMerchantSettingsSnapshot,
  readSettingsSnapshot,
} from "./token-cache";

const BASE = "http://localhost:80";
const API = `${BASE}/api`;

async function apiPut(token: string, path: string, body: object): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PUT ${path} → ${res.status}: ${txt}`);
  }
}

async function apiPatch(token: string, path: string, body: object): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`PATCH ${path} → ${res.status}: ${txt}`);
  }
}

async function restoreAdminSettings(): Promise<void> {
  const token = readCachedAdminToken();
  const originals = readSettingsSnapshot();

  await Promise.all([
    apiPut(token, "/settings/smtp", {
      host: originals.smtp.host,
      port: originals.smtp.port,
      smtpUser: originals.smtp.user,
      from: originals.smtp.from,
    }),
    apiPut(token, "/system-config/qr-cleanup", { retentionDays: originals.qrRetention }),
    apiPut(token, "/system-config/va-cleanup", { retentionDays: originals.vaRetention }),
    apiPut(token, "/system-config/webhook-retries", originals.webhookRetry),
    apiPut(token, "/settings/report-delivery-retries", originals.reportRetry),
    apiPut(token, "/system-config/quiet-hours-flush", { intervalSeconds: originals.quietHoursFlush }),
    apiPut(token, "/system-config/audit-report-retention", { retentionDays: originals.auditLogRetention }),
    apiPut(token, "/settings/finance_report_email", { value: originals.financeEmail }),
  ]);
}

async function restoreMerchantSettings(): Promise<void> {
  const token = readCachedMerchantToken();
  const originals = readMerchantSettingsSnapshot();

  // The webhook config PUT requires a non-empty url + events array. If the
  // merchant had no webhook configured before this run (a fresh/never-set-up
  // account), there is nothing valid to restore it to — skip rather than
  // sending an invalid empty payload that would 400 and abort the other
  // restores in the same Promise.all.
  const restoreWebhook = originals.webhookUrl
    ? apiPut(token, "/webhooks", {
        url: originals.webhookUrl,
        isActive: originals.webhookIsActive,
        events: originals.webhookEvents.length ? originals.webhookEvents : ["payment.success"],
        secret: null,
        // Explicitly pass 0 so the server never applies its default (which can
        // exceed the global cap when a concurrent test has temporarily lowered
        // maxAttempts, causing a 422 that aborts the whole teardown and leaves
        // QR / VA / SMTP settings un-restored for the next run).
        maxRetries: 0,
      })
    : Promise.resolve();

  await Promise.all([
    restoreWebhook,
    apiPut(token, "/auth/preferences", {
      apiKeyGeneratedEmails: originals.apiKeyGeneratedEmails,
      quietHoursStart: originals.quietHoursStart,
      quietHoursEnd: originals.quietHoursEnd,
      quietHoursTimezone: originals.quietHoursTimezone,
    }),
    apiPatch(token, "/merchants/me", {
      businessName: originals.businessName,
    }),
  ]);
}

export default async function globalTeardown(): Promise<void> {
  await Promise.all([restoreAdminSettings(), restoreMerchantSettings()]);
}
