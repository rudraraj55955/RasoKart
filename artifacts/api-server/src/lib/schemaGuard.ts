import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Permanent, in-process schema guard for the tables/columns most likely to
 * drift between the Drizzle schema files and a live (dev or VPS/prod) DB
 * when a `db push` / `db-migrate` step is skipped or fails silently after a
 * deploy. This is defense-in-depth: `scripts/src/db-migrate.ts` (run via
 * `scripts/post-merge.sh` on every deploy) applies the same statements at
 * deploy time — this in-process guard is a second layer that runs before
 * `seed()` inside the server process itself, so a fresh/drifted DB can never
 * again 502 on login/seed because of a missing column.
 *
 * Real incident this guards against: `users.is_super_admin`,
 * `company_settings`, `merchant_auth_otps`, and several `provider_integrations`
 * UPI columns existed in the Drizzle schema files but were never applied to
 * the live VPS DB, so login/seed threw "column does not exist" and the
 * server returned raw HTML 502s. Also guards `quiet_hours_queue`, whose
 * CREATE TABLE was itself out of sync with the Drizzle schema (missing
 * `to`, `deliver_after`, `flushed`, `flushed_at`, `created_at`), causing the
 * every-minute quiet-hours flush scheduler to fail continuously.
 *
 * Every statement is idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF
 * NOT EXISTS) and every ADD COLUMN is nullable or has a DEFAULT — never
 * NOT NULL without a DEFAULT — so this can never fail against a table that
 * already has rows, and is safe to run any number of times.
 */
let guardPromise: Promise<void> | null = null;

async function runGuard(): Promise<void> {
  logger.info("schema_guard_started");

  // ── users: super admin flag + auth/audit columns ────────────────────────
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS merchant_id INTEGER`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_ip TEXT`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  logger.info({ table: "users" }, "schema_guard_column_added");

  // ── company_settings ────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS company_settings (
      id SERIAL PRIMARY KEY,
      company_name TEXT NOT NULL DEFAULT 'Nickey Collection Private Limited',
      support_phone TEXT NOT NULL DEFAULT '9358774496',
      support_email TEXT,
      whatsapp_phone TEXT,
      company_address TEXT,
      footer_text TEXT,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  logger.info({ table: "company_settings" }, "schema_guard_table_created");
  await db.execute(sql`
    INSERT INTO company_settings (id, company_name, support_phone)
    SELECT 1, 'Nickey Collection Private Limited', '9358774496'
    WHERE NOT EXISTS (SELECT 1 FROM company_settings)
  `);

  // ── demo_account_removals (admin-portal permanent demo account removal) ─
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS demo_account_removals (
      email TEXT PRIMARY KEY,
      removed_by_admin_id INTEGER,
      removed_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  logger.info({ table: "demo_account_removals" }, "schema_guard_table_created");

  // ── merchant_auth_otps (OTP login + password reset) ────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS merchant_auth_otps (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER,
      identifier_hash TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      attempts INTEGER NOT NULL DEFAULT 0,
      resend_count INTEGER NOT NULL DEFAULT 0,
      ip_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS merchant_auth_otps_identifier_hash_idx ON merchant_auth_otps(identifier_hash)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS merchant_auth_otps_merchant_id_idx ON merchant_auth_otps(merchant_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS merchant_auth_otps_purpose_idx ON merchant_auth_otps(purpose)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS merchant_auth_otps_expires_at_idx ON merchant_auth_otps(expires_at)`);
  logger.info({ table: "merchant_auth_otps" }, "schema_guard_table_created");

  // ── providers / provider_integrations / provider_visibility / routing ──
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS providers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo_url TEXT,
      category TEXT NOT NULL DEFAULT 'upi',
      status TEXT NOT NULL DEFAULT 'live',
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS provider_integrations (
      id SERIAL PRIMARY KEY,
      provider_key VARCHAR(64) NOT NULL UNIQUE,
      provider_name_internal VARCHAR(255) NOT NULL,
      display_name_public VARCHAR(255) NOT NULL,
      environment TEXT NOT NULL DEFAULT 'test',
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      product_type VARCHAR(100),
      webhook_url TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS api_secret_encrypted TEXT`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS webhook_secret_encrypted TEXT`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS api_base_url TEXT`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS client_id_encrypted TEXT`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS client_secret_encrypted TEXT`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS min_amount NUMERIC(18,2)`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS max_amount NUMERIC(18,2)`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS daily_limit NUMERIC(18,2)`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS supports_dynamic_qr BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS supports_static_qr BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS supports_payment_links BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS supports_webhooks BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS updated_by_email VARCHAR(255)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS provider_visibility (
      id SERIAL PRIMARY KEY,
      provider_id INTEGER NOT NULL,
      merchant_id INTEGER,
      visible BOOLEAN NOT NULL DEFAULT TRUE,
      min_amount NUMERIC(18,2),
      max_amount NUMERIC(18,2),
      daily_limit NUMERIC(18,2),
      priority_override INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pv_provider_merchant_idx ON provider_visibility(provider_id, merchant_id)`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS routing_configs (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS routing_rules (
      id SERIAL PRIMARY KEY,
      config_id INTEGER NOT NULL REFERENCES routing_configs(id) ON DELETE CASCADE,
      provider_key VARCHAR(64) NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      weight_percent INTEGER NOT NULL DEFAULT 100,
      min_amount NUMERIC(18,2),
      max_amount NUMERIC(18,2),
      allowed_payment_modes TEXT,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  logger.info({ tables: ["providers", "provider_integrations", "provider_visibility", "routing_configs", "routing_rules"] }, "schema_guard_column_added");

  // ── quiet_hours_queue: columns required by helpers/quietHours.ts ───────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS quiet_hours_queue (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      html TEXT NOT NULL,
      queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`ALTER TABLE quiet_hours_queue ADD COLUMN IF NOT EXISTS "to" TEXT NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE quiet_hours_queue ADD COLUMN IF NOT EXISTS deliver_after TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await db.execute(sql`ALTER TABLE quiet_hours_queue ADD COLUMN IF NOT EXISTS flushed BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE quiet_hours_queue ADD COLUMN IF NOT EXISTS flushed_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE quiet_hours_queue ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS quiet_hours_queue_user_id_idx ON quiet_hours_queue(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS quiet_hours_queue_flushed_deliver_after_idx ON quiet_hours_queue(flushed, deliver_after)`);
  logger.info({ table: "quiet_hours_queue" }, "schema_guard_column_added");

  logger.info("schema_guard_completed");
}

/**
 * Ensures the schema guard has run (once per process). Never throws in a way
 * that should crash the server — callers should log and continue on failure,
 * since every statement here is additive/idempotent and a failure most
 * likely means a transient DB connectivity blip (which the DB connection
 * health check in index.ts already guards against separately).
 */
export async function ensureSchemaGuard(): Promise<void> {
  if (!guardPromise) {
    guardPromise = runGuard().catch((err) => {
      guardPromise = null;
      throw err;
    });
  }
  return guardPromise;
}

/** Test-only: clears the cached guard promise so each test starts fresh. */
export function resetSchemaGuardCacheForTests(): void {
  guardPromise = null;
}
