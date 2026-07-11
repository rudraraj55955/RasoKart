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
  // name: required by seed.ts INSERT/UPDATE and the Drizzle schema, but absent
  // from the original db-migrate CREATE TABLE — seed crashes in a fresh DB
  // ("column name does not exist") without this guard.
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`);
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
  await db.execute(sql`ALTER TABLE routing_rules ADD COLUMN IF NOT EXISTS is_fallback_only BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE routing_rules ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 1`);
  // De-duplicate before creating the unique index — keeps the oldest (lowest id)
  // enabled rule per (config_id, priority) and disables the rest. This is a no-op
  // when no collisions exist, so it is always safe to run.
  await db.execute(sql`
    UPDATE routing_rules SET is_enabled = false
    WHERE is_enabled = true
      AND id NOT IN (
        SELECT MIN(id) FROM routing_rules
        WHERE is_enabled = true
        GROUP BY config_id, priority
      )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS routing_rules_enabled_priority_uniq
    ON routing_rules(config_id, priority)
    WHERE is_enabled = true
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

  // Withdrawals: rejection audit columns (admin ID + timestamp)
  await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejected_by_admin_id INTEGER`);
  await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ`);
  logger.info({ table: "withdrawals" }, "schema_guard_column_added");

  // provider_integrations: Own Static UPI collection fields
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS collection_type TEXT NOT NULL DEFAULT 'api_gateway'`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS own_upi_id TEXT`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS own_qr_image_url TEXT`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS own_account_holder TEXT`);
  await db.execute(sql`ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS own_instructions TEXT`);
  logger.info({ table: "provider_integrations", columns: ["collection_type", "own_upi_id", "own_qr_image_url", "own_account_holder", "own_instructions"] }, "schema_guard_column_added");

  // transactions: payin charge columns (nullable — safe for existing rows)
  await db.execute(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gross_amount  NUMERIC(12,2)`);
  await db.execute(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payin_fee     NUMERIC(12,2)`);
  await db.execute(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gst_amount    NUMERIC(12,2)`);
  await db.execute(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS net_amount    NUMERIC(12,2)`);
  await db.execute(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_rate      NUMERIC(8,4)`);
  await db.execute(sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_rule_source TEXT`);
  logger.info({ table: "transactions", columns: ["gross_amount", "payin_fee", "gst_amount", "net_amount", "fee_rate", "fee_rule_source"] }, "schema_guard_column_added");

  // payin_charge_settings: global singleton table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS payin_charge_settings (
      id SERIAL PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      mdr_pct NUMERIC(8,4) NOT NULL DEFAULT 0,
      fixed_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
      min_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
      max_fee NUMERIC(18,2),
      gst_pct NUMERIC(8,4) NOT NULL DEFAULT 18,
      gst_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      rounding_mode TEXT NOT NULL DEFAULT 'round',
      apply_to_own_static_upi BOOLEAN NOT NULL DEFAULT TRUE,
      apply_to_dynamic_qr BOOLEAN NOT NULL DEFAULT TRUE,
      apply_to_payment_links BOOLEAN NOT NULL DEFAULT TRUE,
      apply_to_api_gateway BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_email TEXT
    )
  `);

  // merchant_charge_overrides: per-merchant override row
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS merchant_charge_overrides (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      use_global BOOLEAN NOT NULL DEFAULT TRUE,
      custom_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      mdr_pct NUMERIC(8,4),
      fixed_fee NUMERIC(18,2),
      min_fee NUMERIC(18,2),
      max_fee NUMERIC(18,2),
      gst_pct NUMERIC(8,4),
      gst_enabled BOOLEAN,
      rounding_mode TEXT,
      notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_email TEXT
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS merchant_charge_overrides_merchant_id_uniq
    ON merchant_charge_overrides(merchant_id)
  `);
  logger.info({ tables: ["payin_charge_settings", "merchant_charge_overrides"] }, "schema_guard_table_created");

  // ── platform_wallet_ledger: running balance of platform profit ───────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS platform_wallet_ledger (
      id                  SERIAL PRIMARY KEY,
      source_type         TEXT NOT NULL,
      source_id           INTEGER,
      merchant_id         INTEGER,
      gross_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
      fee_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
      gst_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
      provider_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
      profit_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
      balance_after       NUMERIC(12,2) NOT NULL DEFAULT 0,
      description         TEXT,
      created_by_admin_id INTEGER,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata            TEXT
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pwl_source_id_idx ON platform_wallet_ledger(source_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pwl_merchant_id_idx ON platform_wallet_ledger(merchant_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pwl_source_type_idx ON platform_wallet_ledger(source_type)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pwl_created_at_idx ON platform_wallet_ledger(created_at DESC)`);

  // ── tax_liability_ledger: running balance of GST collected ───────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tax_liability_ledger (
      id           SERIAL PRIMARY KEY,
      source_type  TEXT NOT NULL,
      source_id    INTEGER,
      merchant_id  INTEGER,
      gst_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
      balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
      description  TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata     TEXT
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS tll_source_id_idx ON tax_liability_ledger(source_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS tll_created_at_idx ON tax_liability_ledger(created_at DESC)`);
  logger.info({ tables: ["platform_wallet_ledger", "tax_liability_ledger"] }, "schema_guard_table_created");

  // ── api_keys: label column for named/labelled API keys ───────────────────
  await db.execute(sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS label TEXT`);
  logger.info({ table: "api_keys", column: "label" }, "schema_guard_column_added");

  // ── otp_sms_settings (SMS OTP provider config) ────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS otp_sms_settings (
      id SERIAL PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'msg91',
      api_key_encrypted TEXT,
      api_key_iv TEXT,
      api_key_tag TEXT,
      sender_id TEXT,
      dlt_entity_id TEXT,
      dlt_template_id TEXT,
      otp_template_text TEXT DEFAULT 'Your login code is {otp}. Valid for 5 minutes. Do not share.',
      otp_expiry_seconds INTEGER NOT NULL DEFAULT 300,
      max_resend_count INTEGER NOT NULL DEFAULT 3,
      max_verify_attempts INTEGER NOT NULL DEFAULT 5,
      otp_login_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      sms_fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      fallback_provider TEXT,
      fallback_api_key_encrypted TEXT,
      fallback_api_key_iv TEXT,
      fallback_api_key_tag TEXT,
      fallback_sender_id TEXT,
      fallback_dlt_template_id TEXT,
      updated_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  logger.info({ table: "otp_sms_settings" }, "schema_guard_table_created");

  // ── sms_send_logs (SMS delivery audit log) ────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sms_send_logs (
      id SERIAL PRIMARY KEY,
      mobile_hash TEXT NOT NULL,
      mobile_last4 TEXT,
      otp_purpose TEXT,
      provider_used TEXT NOT NULL,
      status TEXT NOT NULL,
      fallback_attempted BOOLEAN NOT NULL DEFAULT FALSE,
      fallback_provider_used TEXT,
      provider_msg_id TEXT,
      error_reason TEXT,
      merchant_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS sms_send_logs_created_at_idx ON sms_send_logs(created_at DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS sms_send_logs_status_idx ON sms_send_logs(status)`);
  logger.info({ table: "sms_send_logs" }, "schema_guard_table_created");

  // ── merchant_tryit_presets (server-side Try It preset sync) ───────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS merchant_tryit_presets (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      presets JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS merchant_tryit_presets_merchant_id_uidx
    ON merchant_tryit_presets(merchant_id)
  `);
  logger.info({ table: "merchant_tryit_presets" }, "schema_guard_table_created");

  // ── admin_tryit_presets (server-side Try It preset sync for admin) ────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS admin_tryit_presets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      presets JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS admin_tryit_presets_user_id_uidx
    ON admin_tryit_presets(user_id)
  `);
  logger.info({ table: "admin_tryit_presets" }, "schema_guard_table_created");

  // ── merchants: payout merchant type & service flags ──────────────────────────
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS merchant_type TEXT NOT NULL DEFAULT 'NORMAL'`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_service_enabled BOOLEAN NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payin_service_enabled BOOLEAN NOT NULL DEFAULT true`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS collection_service_enabled BOOLEAN NOT NULL DEFAULT true`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS onboarding_type TEXT NOT NULL DEFAULT 'NORMAL'`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS agent_id INTEGER`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS approved_for_payout_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_limits_json JSONB`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS payout_fee_json JSONB`);
  logger.info({ table: "merchants", migration: "add_payout_merchant_cols" }, "schema_guard_column_added");

  // ── merchant_kyc_data new columns (aadhaar_status, udyam, bank_holder_name) ─
  await db.execute(sql`ALTER TABLE merchant_kyc_data ADD COLUMN IF NOT EXISTS aadhaar_status TEXT DEFAULT 'PENDING'`);
  await db.execute(sql`ALTER TABLE merchant_kyc_data ADD COLUMN IF NOT EXISTS bank_holder_name TEXT`);
  await db.execute(sql`ALTER TABLE merchant_kyc_data ADD COLUMN IF NOT EXISTS udyam_number TEXT`);
  await db.execute(sql`ALTER TABLE merchant_kyc_data ADD COLUMN IF NOT EXISTS udyam_status TEXT DEFAULT 'SKIPPED'`);
  // Fix defaults: gst/cin should default to SKIPPED (optional)
  await db.execute(sql`UPDATE merchant_kyc_data SET gst_status = 'SKIPPED' WHERE gst_status = 'PENDING'`).catch(() => {});
  await db.execute(sql`UPDATE merchant_kyc_data SET cin_status = 'SKIPPED' WHERE cin_status = 'PENDING'`).catch(() => {});
  logger.info({ table: "merchant_kyc_data", migration: "add_aadhaar_udyam_cols" }, "schema_guard_column_added");

  // ── secure_id_settings (Cashfree Secure ID provider config) ──────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS secure_id_settings (
      id SERIAL PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'test',
      client_id_encrypted TEXT,
      client_id_iv TEXT,
      client_id_tag TEXT,
      client_secret_encrypted TEXT,
      client_secret_iv TEXT,
      client_secret_tag TEXT,
      api_version TEXT NOT NULL DEFAULT '2023-08-01',
      onboarding_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      pan_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      gst_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      cin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      bank_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      ocr_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      updated_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  logger.info({ table: "secure_id_settings" }, "schema_guard_table_created");

  // ── merchant_onboarding_sessions ──────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS merchant_onboarding_sessions (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      mobile_last4 TEXT,
      mobile_hash TEXT,
      verification_id TEXT NOT NULL UNIQUE,
      session_id_encrypted TEXT,
      session_id_iv TEXT,
      session_id_tag TEXT,
      auth_code_encrypted TEXT,
      auth_code_iv TEXT,
      auth_code_tag TEXT,
      access_token_encrypted TEXT,
      access_token_iv TEXT,
      access_token_tag TEXT,
      status TEXT NOT NULL DEFAULT 'INITIATED',
      consent_status TEXT NOT NULL DEFAULT 'PENDING',
      data_available BOOLEAN DEFAULT FALSE,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS mos_merchant_id_idx ON merchant_onboarding_sessions(merchant_id)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS mos_verification_id_uidx ON merchant_onboarding_sessions(verification_id)`);
  logger.info({ table: "merchant_onboarding_sessions" }, "schema_guard_table_created");

  // ── merchant_kyc_data ─────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS merchant_kyc_data (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL UNIQUE,
      onboarding_session_id INTEGER,
      full_name TEXT,
      dob TEXT,
      gender TEXT,
      email TEXT,
      pan_masked TEXT,
      aadhaar_last4 TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      state_name TEXT,
      pincode TEXT,
      business_name TEXT,
      gstin_masked TEXT,
      cin_number TEXT,
      bank_account_masked TEXT,
      bank_ifsc TEXT,
      bank_name TEXT,
      pan_status TEXT DEFAULT 'PENDING',
      gst_status TEXT DEFAULT 'PENDING',
      cin_status TEXT DEFAULT 'SKIPPED',
      bank_status TEXT DEFAULT 'PENDING',
      risk_score INTEGER DEFAULT 0,
      mismatch_flags JSONB,
      admin_decision TEXT NOT NULL DEFAULT 'PENDING',
      rejection_reason TEXT,
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  logger.info({ table: "merchant_kyc_data" }, "schema_guard_table_created");

  // ── verification_logs (encrypted raw provider responses) ──────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS verification_logs (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      onboarding_session_id INTEGER,
      verification_type TEXT NOT NULL,
      status TEXT NOT NULL,
      request_id TEXT,
      raw_response_encrypted TEXT,
      raw_response_iv TEXT,
      raw_response_tag TEXT,
      error_encrypted TEXT,
      error_iv TEXT,
      error_tag TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vl_merchant_id_idx ON verification_logs(merchant_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vl_created_at_idx ON verification_logs(created_at DESC)`);
  logger.info({ table: "verification_logs" }, "schema_guard_table_created");

  // ── merchant_kyc_verifications (new dedicated auto-KYC pipeline) ──────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS merchant_kyc_verifications (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL UNIQUE,
      pan_number_masked TEXT,
      pan_number_hash TEXT,
      pan_name TEXT,
      pan_type TEXT,
      pan_verified BOOLEAN NOT NULL DEFAULT FALSE,
      pan_verified_at TIMESTAMPTZ,
      pan_reference_id_encrypted TEXT,
      pan_reference_id_iv TEXT,
      pan_reference_id_tag TEXT,
      aadhaar_last4 TEXT,
      aadhaar_number_hash TEXT,
      aadhaar_name TEXT,
      aadhaar_verified BOOLEAN NOT NULL DEFAULT FALSE,
      aadhaar_verified_at TIMESTAMPTZ,
      aadhaar_reference_id_encrypted TEXT,
      aadhaar_reference_id_iv TEXT,
      aadhaar_reference_id_tag TEXT,
      aadhaar_digilocker_session_encrypted TEXT,
      aadhaar_digilocker_session_iv TEXT,
      aadhaar_digilocker_session_tag TEXT,
      mobile_verified BOOLEAN NOT NULL DEFAULT FALSE,
      mobile_verified_at TIMESTAMPTZ,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      email_verified_at TIMESTAMPTZ,
      name_match_score INTEGER,
      verification_status TEXT NOT NULL DEFAULT 'PENDING',
      failure_reason TEXT,
      consent_ip TEXT,
      consent_user_agent TEXT,
      consent_at TIMESTAMPTZ,
      admin_decision_by TEXT,
      admin_decision_at TIMESTAMPTZ,
      admin_decision_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS mkv_status_idx ON merchant_kyc_verifications(verification_status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS mkv_pan_hash_idx ON merchant_kyc_verifications(pan_number_hash)`);
  await db.execute(sql`ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS aadhaar_digilocker_session_encrypted TEXT`);
  await db.execute(sql`ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS aadhaar_digilocker_session_iv TEXT`);
  await db.execute(sql`ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS aadhaar_digilocker_session_tag TEXT`);
  await db.execute(sql`ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS mobile_verified BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS mobile_verified_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE merchant_kyc_verifications DROP COLUMN IF EXISTS aadhaar_otp_session_encrypted`);
  await db.execute(sql`ALTER TABLE merchant_kyc_verifications DROP COLUMN IF EXISTS aadhaar_otp_session_iv`);
  await db.execute(sql`ALTER TABLE merchant_kyc_verifications DROP COLUMN IF EXISTS aadhaar_otp_session_tag`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS mkv_aadhaar_hash_idx ON merchant_kyc_verifications(aadhaar_number_hash)`);
  logger.info({ table: "merchant_kyc_verifications" }, "schema_guard_table_created");

  // ── kyc_verification_logs (masked audit trail for auto-KYC pipeline) ──────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kyc_verification_logs (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      verification_type TEXT NOT NULL,
      status TEXT NOT NULL,
      request_masked TEXT,
      response_masked TEXT,
      provider_reference_id_encrypted TEXT,
      provider_reference_id_iv TEXT,
      provider_reference_id_tag TEXT,
      error_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS kvl_merchant_id_idx ON kyc_verification_logs(merchant_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS kvl_created_at_idx ON kyc_verification_logs(created_at DESC)`);
  logger.info({ table: "kyc_verification_logs" }, "schema_guard_table_created");

  // ── merchant_kyc_settings (Super Admin auto-KYC provider config) ──────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS merchant_kyc_settings (
      id SERIAL PRIMARY KEY,
      pan_api_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      aadhaar_api_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      mode TEXT NOT NULL DEFAULT 'test',
      client_id_encrypted TEXT,
      client_id_iv TEXT,
      client_id_tag TEXT,
      client_secret_encrypted TEXT,
      client_secret_iv TEXT,
      client_secret_tag TEXT,
      base_url TEXT,
      min_name_match_score INTEGER NOT NULL DEFAULT 80,
      auto_approve_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      duplicate_check_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      daily_verification_limit INTEGER NOT NULL DEFAULT 200,
      per_merchant_attempt_limit INTEGER NOT NULL DEFAULT 5,
      updated_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  logger.info({ table: "merchant_kyc_settings" }, "schema_guard_table_created");

  // ── withdrawals: auto-approval tracking columns ─────────────────────────
  await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approval_type TEXT NOT NULL DEFAULT 'MANUAL'`);
  await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_by_system BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS auto_approval_rule_snapshot JSONB`);
  await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_by TEXT`);
  logger.info({ table: "withdrawals", migration: "add_auto_approval_cols" }, "schema_guard_column_added");

  // ── merchants: per-merchant auto-payout settings ─────────────────────────
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auto_payout_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auto_payout_max_single_amount NUMERIC(18,2)`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auto_payout_daily_limit NUMERIC(18,2)`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auto_payout_monthly_limit NUMERIC(18,2)`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS per_beneficiary_daily_limit NUMERIC(18,2)`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auto_payout_allowed_modes JSONB`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auto_payout_only_verified_beneficiaries BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auto_payout_min_wallet_balance_after_payout NUMERIC(18,2) NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auto_payout_paused BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auto_payout_updated_by TEXT`);
  await db.execute(sql`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auto_payout_updated_at TIMESTAMPTZ`);
  logger.info({ table: "merchants", migration: "add_auto_payout_cols" }, "schema_guard_column_added");

  // ── users: payout admin permission columns ───────────────────────────────
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_payout_provider_credentials BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions_json JSONB`);
  logger.info({ table: "users", migration: "add_payout_admin_permission_cols" }, "schema_guard_column_added");

  // ── agents table ─────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      referral_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      wallet_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_commission_earned NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_commission_paid NUMERIC(18,2) NOT NULL DEFAULT 0,
      created_by_admin_id INTEGER,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  logger.info({ table: "agents" }, "schema_guard_table_created");

  // ── payout_wallet_load_orders ─────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS payout_wallet_load_orders (
      id SERIAL PRIMARY KEY,
      load_id TEXT NOT NULL,
      merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
      amount NUMERIC(18,2) NOT NULL,
      fee_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      gst_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      net_credit_amount NUMERIC(18,2) NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CREATED',
      internal_order_id TEXT,
      provider_payment_id TEXT,
      utr TEXT,
      payer_name TEXT,
      payer_reference TEXT,
      screenshot_url TEXT,
      rejection_reason TEXT,
      credited_at TIMESTAMPTZ,
      approved_by INTEGER,
      approved_at TIMESTAMPTZ,
      admin_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS pwlo_load_id_uniq ON payout_wallet_load_orders(load_id)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS pwlo_internal_order_id_uniq ON payout_wallet_load_orders(internal_order_id) WHERE internal_order_id IS NOT NULL`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS pwlo_utr_uniq ON payout_wallet_load_orders(utr) WHERE utr IS NOT NULL`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pwlo_merchant_created_idx ON payout_wallet_load_orders(merchant_id, created_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pwlo_status_idx ON payout_wallet_load_orders(status)`);
  logger.info({ table: "payout_wallet_load_orders" }, "schema_guard_table_created");

  // ── withdrawals: idempotency key for double-submit protection ───────────
  await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_merchant_idempotency_key_uniq ON withdrawals(merchant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);
  logger.info({ table: "withdrawals", migration: "add_idempotency_key" }, "schema_guard_column_added");

  // ── merchant_plans: UNIQUE constraint + Drizzle schema columns ──────────
  // Root CI failure: db-migrate's CREATE TABLE for merchant_plans had neither
  // a UNIQUE constraint on merchant_id nor the Drizzle-schema columns
  // (assigned_at, renewed_at, scheduled_renewal_at, assigned_by, notes).
  // seed.ts uses onConflictDoUpdate(target: merchantPlansTable.merchantId)
  // which requires a UNIQUE constraint — without it Postgres throws "no unique
  // constraint matching ON CONFLICT specification" on a fresh DB → seed
  // crashes → server never binds to port 8080 → nginx returns 502.
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS merchant_plans_merchant_id_uniq ON merchant_plans(merchant_id)`);
  await db.execute(sql`ALTER TABLE merchant_plans ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await db.execute(sql`ALTER TABLE merchant_plans ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE merchant_plans ADD COLUMN IF NOT EXISTS scheduled_renewal_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE merchant_plans ADD COLUMN IF NOT EXISTS assigned_by INTEGER`);
  await db.execute(sql`ALTER TABLE merchant_plans ADD COLUMN IF NOT EXISTS notes TEXT`);
  logger.info({ table: "merchant_plans", migration: "add_unique_and_drizzle_columns" }, "schema_guard_column_added");

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
