/**
 * Shared file paths for tokens cached once by global-setup.ts and read by
 * each spec file's `test.beforeAll`. Using a file (rather than an in-memory
 * module variable) is required because `fullyParallel: true` can run
 * different tests — and different copies of the same spec's beforeAll — in
 * separate worker processes that don't share memory.
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ADMIN_TOKEN_CACHE_PATH = join(tmpdir(), "rasokart-e2e-admin-token.json");
export const MERCHANT_TOKEN_CACHE_PATH = join(tmpdir(), "rasokart-e2e-merchant-token.json");

/**
 * Snapshot of the admin settings that settings-persistence.spec.ts mutates,
 * captured exactly once in global-setup.ts (before any test runs) and
 * restored exactly once in global-teardown.ts (after every worker has
 * finished). This must NOT be captured/restored per-worker: with
 * `fullyParallel: true`, a spec file's `beforeAll`/`afterAll` run once per
 * worker process, not once for the whole file. A worker that finishes its
 * share of tests early would otherwise fire `afterAll` and overwrite a
 * setting that a *different* worker is still mid-test on, corrupting that
 * still-running test's expected value.
 */
export const SETTINGS_SNAPSHOT_CACHE_PATH = join(tmpdir(), "rasokart-e2e-settings-snapshot.json");

export type SettingsSnapshot = {
  smtp: { host: string | null; port: string | null; user: string | null; from: string | null };
  qrRetention: number;
  vaRetention: number;
  webhookRetry: { maxAttempts: number; delay1: number; delay2: number; delay3: number };
  reportRetry: { maxAttempts: number; backoffBaseMs: number };
  quietHoursFlush: number;
  auditLogRetention: number;
  financeEmail: string | null;
};

/**
 * Same "capture once in globalSetup, restore once in globalTeardown" pattern
 * as SETTINGS_SNAPSHOT_CACHE_PATH, but for the merchant-portal settings that
 * merchant-settings-persistence.spec.ts mutates. See that file's header
 * comment for why this must not be a per-file beforeAll/afterAll under
 * `fullyParallel: true`.
 */
export const MERCHANT_SETTINGS_SNAPSHOT_CACHE_PATH = join(
  tmpdir(),
  "rasokart-e2e-merchant-settings-snapshot.json",
);

export type MerchantSettingsSnapshot = {
  webhookUrl: string;
  webhookIsActive: boolean;
  webhookEvents: string[];
  apiKeyGeneratedEmails: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quietHoursTimezone: string | null;
  businessName: string;
};

function readCachedToken(path: string): string {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as { token: string };
  return parsed.token;
}

export function readCachedAdminToken(): string {
  return readCachedToken(ADMIN_TOKEN_CACHE_PATH);
}

export function readCachedMerchantToken(): string {
  return readCachedToken(MERCHANT_TOKEN_CACHE_PATH);
}

export function readSettingsSnapshot(): SettingsSnapshot {
  const raw = readFileSync(SETTINGS_SNAPSHOT_CACHE_PATH, "utf-8");
  return JSON.parse(raw) as SettingsSnapshot;
}

export function readMerchantSettingsSnapshot(): MerchantSettingsSnapshot {
  const raw = readFileSync(MERCHANT_SETTINGS_SNAPSHOT_CACHE_PATH, "utf-8");
  return JSON.parse(raw) as MerchantSettingsSnapshot;
}
