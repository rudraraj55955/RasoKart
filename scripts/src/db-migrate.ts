/**
 * db-migrate.ts
 *
 * Idempotent schema migration using CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 * Safe to run multiple times. No TTY required — replaces `drizzle-kit push` in post-merge.
 *
 * Add new tables/columns here whenever a task agent ships new schema.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Running DB migrations…");

  await db.execute(sql`
    -- ── users ──────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'merchant',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── merchants ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS merchants (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT,
      website TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── plans ──────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      features JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── merchant_plans ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS merchant_plans (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES plans(id),
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── merchant_kyc ───────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS merchant_kyc (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      reviewed_by INTEGER,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS merchant_kyc_merchant_id_idx ON merchant_kyc(merchant_id);
    CREATE INDEX IF NOT EXISTS merchant_kyc_status_idx ON merchant_kyc(status);

    -- ── kyc_review_history ─────────────────────────────────────────────────────
    -- Append-only audit trail of every approve/reject decision on a KYC document.
    -- No FK cascade on kyc_id: history rows intentionally survive document deletion
    -- so admins can audit past decisions even after a merchant resubmits.
    CREATE TABLE IF NOT EXISTS kyc_review_history (
      id SERIAL PRIMARY KEY,
      kyc_id INTEGER NOT NULL,
      reviewed_by INTEGER NOT NULL,
      status TEXT NOT NULL,
      admin_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS kyc_review_history_kyc_id_idx ON kyc_review_history(kyc_id);

    -- ── module_controls ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS module_controls (
      id SERIAL PRIMARY KEY,
      module_name TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      label TEXT NOT NULL,
      description TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_admin_id INTEGER,
      updated_by_admin_email TEXT,
      CONSTRAINT module_controls_module_name_unique UNIQUE (module_name)
    );

    -- ── module_visibility ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS module_visibility (
      id SERIAL PRIMARY KEY,
      module_name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_admin_id INTEGER,
      updated_by_admin_email TEXT,
      CONSTRAINT module_visibility_uniq UNIQUE (module_name, entity_type, entity_id)
    );

    -- ── merchant_wallets ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS merchant_wallets (
      id                SERIAL PRIMARY KEY,
      merchant_id       INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      currency          TEXT NOT NULL DEFAULT 'INR',
      available_balance  NUMERIC(18,2) NOT NULL DEFAULT 0,
      pending_balance    NUMERIC(18,2) NOT NULL DEFAULT 0,
      hold_balance       NUMERIC(18,2) NOT NULL DEFAULT 0,
      settlement_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
      payout_balance     NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_collection   NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_payout       NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_charges      NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_refunds      NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_reversals    NUMERIC(18,2) NOT NULL DEFAULT 0,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT merchant_wallets_merchant_id_uniq UNIQUE (merchant_id)
    );

    -- ── wallet_ledger ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id               SERIAL PRIMARY KEY,
      merchant_id      INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      txn_type         TEXT NOT NULL,
      bucket           TEXT NOT NULL,
      amount           NUMERIC(18,2) NOT NULL,
      available_before NUMERIC(18,2) NOT NULL DEFAULT 0,
      available_after  NUMERIC(18,2) NOT NULL DEFAULT 0,
      pending_before   NUMERIC(18,2) NOT NULL DEFAULT 0,
      pending_after    NUMERIC(18,2) NOT NULL DEFAULT 0,
      reference_type   TEXT,
      reference_id     INTEGER,
      description      TEXT NOT NULL,
      created_by       INTEGER,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wallet_ledger_merchant_created_idx ON wallet_ledger(merchant_id, created_at);
    CREATE INDEX IF NOT EXISTS wallet_ledger_txn_type_idx ON wallet_ledger(txn_type);

    -- ── wallet_holds ───────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS wallet_holds (
      id          SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      amount      NUMERIC(18,2) NOT NULL,
      reason      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      created_by  INTEGER NOT NULL,
      released_by INTEGER,
      released_at TIMESTAMPTZ,
      expires_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wallet_holds_merchant_status_idx ON wallet_holds(merchant_id, status);

    -- ── wallet_charges ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS wallet_charges (
      id             SERIAL PRIMARY KEY,
      merchant_id    INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      amount         NUMERIC(18,2) NOT NULL,
      charge_type    TEXT NOT NULL DEFAULT 'fee',
      description    TEXT NOT NULL,
      reference_type TEXT,
      reference_id   INTEGER,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wallet_charges_merchant_idx ON wallet_charges(merchant_id);

    -- ── merchant_verifications ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS merchant_verifications (
      id                       SERIAL PRIMARY KEY,
      merchant_id              INTEGER NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
      status                   TEXT NOT NULL DEFAULT 'pending',
      business_name            TEXT,
      owner_name               TEXT,
      mobile                   TEXT,
      email                    TEXT,
      pan                      TEXT,
      gst                      TEXT,
      business_type            TEXT,
      website_url              TEXT,
      address                  TEXT,
      expected_monthly_volume  TEXT,
      use_case                 TEXT,
      bank_account_name        TEXT,
      bank_account_number      TEXT,
      ifsc_code                TEXT,
      upi_id                   TEXT,
      admin_note               TEXT,
      reviewed_by              INTEGER,
      reviewed_at              TIMESTAMPTZ,
      submitted_at             TIMESTAMPTZ,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS merchant_verifications_merchant_id_idx ON merchant_verifications(merchant_id);
    CREATE INDEX IF NOT EXISTS merchant_verifications_status_idx ON merchant_verifications(status);

    -- ── merchant_documents ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS merchant_documents (
      id               SERIAL PRIMARY KEY,
      verification_id  INTEGER NOT NULL REFERENCES merchant_verifications(id) ON DELETE CASCADE,
      merchant_id      INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      doc_type         TEXT NOT NULL,
      file_url         TEXT NOT NULL,
      file_name        TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS merchant_documents_verification_id_idx ON merchant_documents(verification_id);
    CREATE INDEX IF NOT EXISTS merchant_documents_merchant_id_idx ON merchant_documents(merchant_id);

    -- ── merchants: add verification_status column ───────────────────────────────
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'pending';

    -- ── users: add weekly_delivery_digest_emails column ─────────────────────────
    ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_delivery_digest_emails BOOLEAN NOT NULL DEFAULT TRUE;

    -- ── users: notification preference columns ───────────────────────────────────
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ekqr_sync_alert_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_change_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_prefs_disabled_at TIMESTAMPTZ;

    -- ── users: quiet hours columns ───────────────────────────────────────────────
    ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_end TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_timezone TEXT;

    -- ── users: github sync repeated-failure escalation email preference ─────────
    ALTER TABLE users ADD COLUMN IF NOT EXISTS github_sync_failure_alert_emails BOOLEAN NOT NULL DEFAULT TRUE;

    -- ── users: super admin flag (Company Branding settings gate) ────────────────
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

    -- ── company_settings: dynamic company branding / support contact ────────────
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
    );
    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS support_email TEXT;
    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;
    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS company_address TEXT;
    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS footer_text TEXT;
    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS updated_by INTEGER;
    INSERT INTO company_settings (id, company_name, support_phone)
      SELECT 1, 'Nickey Collection Private Limited', '9358774496'
      WHERE NOT EXISTS (SELECT 1 FROM company_settings);

    -- ── quiet_hours_queue ────────────────────────────────────────────────────────
    -- Real incident: this CREATE TABLE previously only had (id, user_id, subject,
    -- html, queued_at) while the Drizzle schema (lib/db/src/schema/quietHoursQueue.ts)
    -- and the code that reads/writes it (helpers/quietHours.ts, routes/auth.ts)
    -- require "to", deliver_after, flushed, flushed_at, created_at — so the
    -- every-minute quiet-hours flush scheduler failed with
    -- "column quiet_hours_queue.flushed does not exist" on every tick. Adding the
    -- missing columns below (idempotent, all nullable/defaulted) fixes this
    -- permanently without touching existing rows.
    CREATE TABLE IF NOT EXISTS quiet_hours_queue (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      html TEXT NOT NULL,
      queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE quiet_hours_queue ADD COLUMN IF NOT EXISTS "to" TEXT NOT NULL DEFAULT '';
    ALTER TABLE quiet_hours_queue ADD COLUMN IF NOT EXISTS deliver_after TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE quiet_hours_queue ADD COLUMN IF NOT EXISTS flushed BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE quiet_hours_queue ADD COLUMN IF NOT EXISTS flushed_at TIMESTAMPTZ;
    ALTER TABLE quiet_hours_queue ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    CREATE INDEX IF NOT EXISTS quiet_hours_queue_user_id_idx ON quiet_hours_queue(user_id);
    CREATE INDEX IF NOT EXISTS quiet_hours_queue_flushed_deliver_after_idx ON quiet_hours_queue(flushed, deliver_after);

    -- ── cashfree_payment_orders: permanent schema guard ─────────────────────────
    -- Ensures every column the deposit-order insert (payinOrders.ts) needs
    -- actually exists on the live table, and all statuses are canonical
    -- uppercase (CREATED/PENDING/PAID/FAILED/EXPIRED), on every deploy — so
    -- this never again depends on a manual VPS SQL hotfix. This is the fix
    -- for the "provider order created, but DB insert failed" incident: the
    -- live table was missing columns (provider_key, payment_method,
    -- customer_email, raw_provider_status, failure_reason, raw_payload,
    -- public_order_id) that existed in the Drizzle schema but were never
    -- applied to the database. Safe/idempotent to run repeatedly — every
    -- ADD COLUMN is IF NOT EXISTS and nullable/defaulted (never NOT NULL
    -- without a DEFAULT), so it can never fail against a table with rows.
    CREATE TABLE IF NOT EXISTS cashfree_payment_orders (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      cashfree_order_id TEXT NOT NULL UNIQUE,
      amount NUMERIC(18,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'CREATED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS public_order_id TEXT;
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS provider_key TEXT DEFAULT 'cashfree';
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS payment_session_id TEXT;
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS utr TEXT;
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS raw_provider_status TEXT;
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS failure_reason TEXT;
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
    ALTER TABLE cashfree_payment_orders ADD COLUMN IF NOT EXISTS raw_payload TEXT;

    DO $$
    DECLARE col TEXT;
    BEGIN
      FOREACH col IN ARRAY ARRAY[
        'public_order_id', 'provider_key', 'payment_session_id', 'payment_method',
        'utr', 'customer_phone', 'customer_email', 'raw_provider_status',
        'failure_reason', 'raw_payload'
      ]
      LOOP
        BEGIN
          EXECUTE format('ALTER TABLE cashfree_payment_orders ALTER COLUMN %I DROP NOT NULL', col);
        EXCEPTION WHEN undefined_column THEN NULL;
        END;
      END LOOP;
    END $$;

    UPDATE cashfree_payment_orders SET status = UPPER(status) WHERE status IS NOT NULL AND status <> UPPER(status);

    -- ── merchant_auth_otps: merchant OTP login + password reset ────────────────
    -- Mirrors the in-process guard in artifacts/api-server/src/lib/schemaGuard.ts
    -- so this table is guaranteed at deploy time, before the server process
    -- even starts (defense-in-depth: the in-process guard is a second layer).
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
    );
    CREATE INDEX IF NOT EXISTS merchant_auth_otps_identifier_hash_idx ON merchant_auth_otps(identifier_hash);
    CREATE INDEX IF NOT EXISTS merchant_auth_otps_merchant_id_idx ON merchant_auth_otps(merchant_id);
    CREATE INDEX IF NOT EXISTS merchant_auth_otps_purpose_idx ON merchant_auth_otps(purpose);
    CREATE INDEX IF NOT EXISTS merchant_auth_otps_expires_at_idx ON merchant_auth_otps(expires_at);

    -- ── providers / provider_integrations / provider_visibility / routing ──────
    -- Safety net for envs where these were never created by drizzle-kit push.
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
    );

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
    );
    -- UPI Gateways consolidation columns — previously only added via an
    -- ad hoc inline ALTER TABLE block in seed.ts (not deploy-permanent).
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS api_secret_encrypted TEXT;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS webhook_secret_encrypted TEXT;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS api_base_url TEXT;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS client_id_encrypted TEXT;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS client_secret_encrypted TEXT;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS min_amount NUMERIC(18,2);
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS max_amount NUMERIC(18,2);
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS daily_limit NUMERIC(18,2);
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS supports_dynamic_qr BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS supports_static_qr BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS supports_payment_links BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS supports_webhooks BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE provider_integrations ADD COLUMN IF NOT EXISTS updated_by_email VARCHAR(255);

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
    );
    CREATE INDEX IF NOT EXISTS pv_provider_merchant_idx ON provider_visibility(provider_id, merchant_id);

    CREATE TABLE IF NOT EXISTS routing_configs (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
    );
    ALTER TABLE routing_rules ADD COLUMN IF NOT EXISTS is_fallback_only BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE routing_rules ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 1;
    -- Resolve pre-existing enabled priority collisions before creating the unique
    -- index. For each (config_id, priority) group that has multiple enabled rows,
    -- keep the oldest (lowest id) and disable the rest. No-op when there are none.
    UPDATE routing_rules SET is_enabled = false
    WHERE is_enabled = true
      AND id NOT IN (
        SELECT MIN(id) FROM routing_rules
        WHERE is_enabled = true
        GROUP BY config_id, priority
      );
    -- Partial unique index: only one enabled rule per (config, priority).
    -- Disabled rules are excluded so they can freely share a priority number.
    CREATE UNIQUE INDEX IF NOT EXISTS routing_rules_enabled_priority_uniq
      ON routing_rules(config_id, priority)
      WHERE is_enabled = true;

    -- ── demo_account_removals ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS demo_account_removals (
      email TEXT PRIMARY KEY,
      removed_by_admin_id INTEGER,
      removed_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("DB migrations complete.");
  process.exit(0);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
