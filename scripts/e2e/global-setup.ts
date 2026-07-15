/**
 * Playwright globalSetup — runs exactly once per `playwright test` invocation,
 * regardless of how many workers are used.
 *
 * With `fullyParallel: true`, Playwright can shard the tests of a single spec
 * file across multiple worker processes. Each worker runs its own copy of
 * `test.beforeAll`, so if every worker independently called the login
 * endpoint we'd burn through the DB-backed login rate limiter (10 attempts /
 * 15 min per IP) after only 2-3 workers. Logging in once here and caching the
 * token to disk lets every worker (and every spec file) share a single login.
 */
import { writeFileSync } from "node:fs";
import {
  ADMIN_TOKEN_CACHE_PATH,
  MERCHANT_TOKEN_CACHE_PATH,
  MERCHANT_SETTINGS_SNAPSHOT_CACHE_PATH,
  SETTINGS_SNAPSHOT_CACHE_PATH,
  type MerchantSettingsSnapshot,
  type SettingsSnapshot,
} from "./token-cache";

const BASE = "http://localhost:80";
const API = `${BASE}/api`;

/**
 * Wait for the API server to be ready before attempting any requests.
 * The validation workflow starts in parallel with the API server; without this
 * the first login attempt races with server startup and gets a 502.
 */
async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API}/healthz`);
      if (res.ok) return;
    } catch {
      // server not yet listening
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("API server did not become ready within 30 seconds");
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

async function apiGet(token: string, path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

/**
 * Snapshot the admin settings that settings-persistence.spec.ts mutates.
 * Done exactly once here (globalSetup runs once per `playwright test`
 * invocation regardless of worker count) so global-teardown.ts can restore
 * them exactly once too — see the comment on SETTINGS_SNAPSHOT_CACHE_PATH in
 * token-cache.ts for why this must not happen per-worker.
 */
async function snapshotSettings(adminToken: string): Promise<void> {
  const [smtp, qrCleanup, vaCleanup, webhookRetry, reportRetry, quietHoursFlush, auditLogRetention, settings] =
    await Promise.all([
      apiGet(adminToken, "/settings/smtp"),
      apiGet(adminToken, "/system-config/qr-cleanup"),
      apiGet(adminToken, "/system-config/va-cleanup"),
      apiGet(adminToken, "/system-config/webhook-retries"),
      apiGet(adminToken, "/settings/report-delivery-retries"),
      apiGet(adminToken, "/system-config/quiet-hours-flush"),
      apiGet(adminToken, "/system-config/audit-report-retention"),
      apiGet(adminToken, "/settings"),
    ]);

  const snapshot: SettingsSnapshot = {
    smtp: {
      host: smtp.host ?? null,
      port: smtp.port ?? null,
      user: smtp.user ?? null,
      from: smtp.from ?? null,
    },
    qrRetention: qrCleanup.retentionDays ?? 30,
    vaRetention: vaCleanup.retentionDays ?? 30,
    webhookRetry: {
      maxAttempts: webhookRetry.maxAttempts ?? 4,
      delay1: webhookRetry.delay1 ?? 300,
      delay2: webhookRetry.delay2 ?? 900,
      delay3: webhookRetry.delay3 ?? 3600,
    },
    reportRetry: {
      maxAttempts: reportRetry.maxAttempts ?? 3,
      backoffBaseMs: reportRetry.backoffBaseMs ?? 1000,
    },
    quietHoursFlush: quietHoursFlush.intervalSeconds ?? 60,
    auditLogRetention: auditLogRetention.retentionDays ?? 90,
    financeEmail: settings.finance_report_email ?? null,
  };
  writeFileSync(SETTINGS_SNAPSHOT_CACHE_PATH, JSON.stringify(snapshot));
}

/**
 * Snapshot the merchant-portal settings that
 * merchant-settings-persistence.spec.ts mutates. Same "once here, once in
 * global-teardown.ts" reasoning as snapshotSettings() above.
 */
async function snapshotMerchantSettings(merchantToken: string): Promise<void> {
  const [webhookConfig, me] = await Promise.all([
    apiGet(merchantToken, "/webhooks"),
    apiGet(merchantToken, "/auth/me"),
  ]);

  const snapshot: MerchantSettingsSnapshot = {
    webhookUrl: webhookConfig.url ?? "",
    webhookIsActive: webhookConfig.isActive ?? true,
    webhookEvents: webhookConfig.events ?? [],
    apiKeyGeneratedEmails: me.apiKeyGeneratedEmails ?? true,
    quietHoursStart: me.quietHoursStart ?? null,
    quietHoursEnd: me.quietHoursEnd ?? null,
    quietHoursTimezone: me.quietHoursTimezone ?? null,
    businessName: me.businessName ?? "",
  };
  writeFileSync(MERCHANT_SETTINGS_SNAPSHOT_CACHE_PATH, JSON.stringify(snapshot));
}

/**
 * When the validation runner executes both playwright invocations simultaneously
 * (settings-persistence.spec.ts AND merchant-settings-persistence.spec.ts), the
 * merchant run finishes faster and its globalTeardown fires while the settings
 * run is still mid-test. If both teardowns call restoreAdminSettings(), the
 * merchant teardown races to reset qr-cleanup / SMTP / etc. back to snapshot
 * values while the settings tests have just set them to known baselines.
 *
 * Guard: only the settings spec invocation snapshots (and later restores) admin
 * settings. The merchant spec invocation is identified by its process.argv.
 */
const isMerchantRun = process.argv.some((arg) => arg.includes("merchant-settings-persistence"));

export default async function globalSetup(): Promise<void> {
  await waitForServer();
  const adminToken = await login("admin@rasokart.com", "Admin@123456");
  writeFileSync(ADMIN_TOKEN_CACHE_PATH, JSON.stringify({ token: adminToken }));

  const merchantToken = await login("merchant2@demo.com", "Merchant@123456");
  writeFileSync(MERCHANT_TOKEN_CACHE_PATH, JSON.stringify({ token: merchantToken }));

  const tasks: Promise<void>[] = [snapshotMerchantSettings(merchantToken)];
  if (!isMerchantRun) {
    tasks.push(snapshotSettings(adminToken));
  }
  await Promise.all(tasks);
}
