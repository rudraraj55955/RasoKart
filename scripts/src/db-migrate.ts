/**
 * db-migrate.ts
 *
 * Idempotent schema migration using CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
 * Safe to run multiple times. No TTY required — replaces `drizzle-kit push` in post-merge.
 *
 * Each section is a separate db.execute() call so failures are isolated:
 * - The failing section name is printed clearly.
 * - The actual PostgreSQL error (cause.message / cause.code) is printed, NOT the full SQL.
 * - This prevents the 1500-line SQL dump from hiding the real error in CI/deploy logs.
 *
 * Add new tables/columns here whenever a task agent ships new schema.
 */

import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";

async function runSection(name: string, query: SQL<unknown>): Promise<void> {
  process.stdout.write(`  [migrate] ${name}... `);
  try {
    await db.execute(query);
    process.stdout.write("ok\n");
  } catch (err: unknown) {
    process.stdout.write("FAILED\n");
    const e = err as Record<string, unknown>;
    const cause = e["cause"] as Record<string, unknown> | undefined;
    if (cause) {
      console.error(`  PG error  : ${String(cause["message"] ?? "unknown")}`);
      if (cause["code"])   console.error(`  PG code   : ${String(cause["code"])}`);
      if (cause["detail"]) console.error(`  PG detail : ${String(cause["detail"])}`);
      if (cause["hint"])   console.error(`  PG hint   : ${String(cause["hint"])}`);
    } else {
      console.error(`  Error: ${String(e["message"] ?? err)}`);
    }
    throw new Error(`Migration section "${name}" failed — see PG error above`);
  }
}

async function migrate() {
  console.log("Running DB migrations…");

  // ── Section 1: Core tables ───────────────────────────────────────────────
  await runSection("core-tables (users, merchants, plans, merchant_plans)", sql`
    -- ── users ──────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'merchant',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- name column: required by seed.ts and the Drizzle schema but was absent
    -- from the original CREATE TABLE definition in db-migrate, causing seed to
    -- crash in a fresh CI database ("column name does not exist").
    ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';

    -- ── merchants ──────────────────────────────────────────────────────────────
    -- Full column set matching lib/db/src/schema/merchants.ts (Drizzle source of truth).
    -- The original stub was missing email (onConflict target in seed.ts), balance,
    -- total_deposits, total_withdrawals, and most other fields. The seed crashed on
    -- the first merchant INSERT, leaving all user.merchant_id values as null, which
    -- caused GET /webhooks to return 403 ("Merchants only") in e2e global-setup.
    CREATE TABLE IF NOT EXISTS merchants (
      id SERIAL PRIMARY KEY,
      business_name TEXT NOT NULL,
      contact_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      website TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      verification_status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      merchant_type TEXT NOT NULL DEFAULT 'NORMAL',
      payout_service_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      payin_service_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      collection_service_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      onboarding_type TEXT NOT NULL DEFAULT 'NORMAL',
      agent_id INTEGER,
      approved_for_payout_at TIMESTAMPTZ,
      payout_limits_json JSONB,
      payout_fee_json JSONB,
      total_deposits NUMERIC(18,2) NOT NULL DEFAULT 0,
      total_withdrawals NUMERIC(18,2) NOT NULL DEFAULT 0,
      balance NUMERIC(18,2) NOT NULL DEFAULT 0,
      logo_url TEXT,
      brand_color TEXT,
      callback_secret TEXT,
      callback_secret_updated_at TIMESTAMPTZ,
      callback_timestamp_window_seconds INTEGER,
      auto_payout_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      auto_payout_max_single_amount NUMERIC(18,2),
      auto_payout_daily_limit NUMERIC(18,2),
      auto_payout_monthly_limit NUMERIC(18,2),
      per_beneficiary_daily_limit NUMERIC(18,2),
      auto_payout_allowed_modes JSONB,
      auto_payout_only_verified_beneficiaries BOOLEAN NOT NULL DEFAULT TRUE,
      auto_payout_min_wallet_balance_after_payout NUMERIC(18,2) NOT NULL DEFAULT 0,
      auto_payout_paused BOOLEAN NOT NULL DEFAULT FALSE,
      auto_payout_updated_by TEXT,
      auto_payout_updated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── plans ──────────────────────────────────────────────────────────────────
    -- Full column set matching lib/db/src/schema/plans.ts (Drizzle source of truth).
    -- The original stub only had 6 columns; seed.ts inserts all 22, so on a fresh
    -- CI database the first INSERT crashed with "column does not exist".
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      price TEXT NOT NULL DEFAULT '0',
      monthly_fee TEXT NOT NULL DEFAULT '0',
      yearly_fee TEXT NOT NULL DEFAULT '0',
      setup_fee TEXT NOT NULL DEFAULT '0',
      pricing TEXT NOT NULL DEFAULT '{}',
      features TEXT NOT NULL DEFAULT '[]',
      custom_features TEXT NOT NULL DEFAULT '[]',
      dynamic_qr_limit INTEGER NOT NULL DEFAULT 10,
      static_qr_limit INTEGER NOT NULL DEFAULT 10,
      virtual_account_limit INTEGER NOT NULL DEFAULT 5,
      payment_link_limit INTEGER NOT NULL DEFAULT 10,
      payout_limit INTEGER NOT NULL DEFAULT 20,
      daily_transaction_limit INTEGER NOT NULL DEFAULT 999,
      monthly_transaction_limit INTEGER NOT NULL DEFAULT 9999,
      settlement_fee TEXT NOT NULL DEFAULT '2.0',
      deposit_fee TEXT NOT NULL DEFAULT '0.0',
      api_access BOOLEAN NOT NULL DEFAULT TRUE,
      webhook_access BOOLEAN NOT NULL DEFAULT TRUE,
      provider_access BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
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
    -- UNIQUE index on merchant_id: required for seed.ts onConflictDoUpdate and
    -- matches the Drizzle schema (.unique() on merchantId). Missing in the
    -- original CREATE TABLE, so seed crashed with "no unique constraint
    -- matching ON CONFLICT specification" in a fresh CI database.
    CREATE UNIQUE INDEX IF NOT EXISTS merchant_plans_merchant_id_uniq ON merchant_plans(merchant_id);
    -- Drizzle schema columns not present in the original CREATE TABLE above:
    ALTER TABLE merchant_plans ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE merchant_plans ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ;
    ALTER TABLE merchant_plans ADD COLUMN IF NOT EXISTS scheduled_renewal_at TIMESTAMPTZ;
    ALTER TABLE merchant_plans ADD COLUMN IF NOT EXISTS assigned_by INTEGER;
    ALTER TABLE merchant_plans ADD COLUMN IF NOT EXISTS notes TEXT;
  `);

  // ── Section 2: KYC base tables ───────────────────────────────────────────
  await runSection("kyc-base (merchant_kyc, kyc_review_history, kyc_data, kyc_verifications, verification_logs)", sql`
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

    -- ── merchant_kyc_data (secure onboarding, structured extracted KYC fields) ──
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
      bank_holder_name TEXT,
      pan_status TEXT DEFAULT 'PENDING',
      gst_status TEXT DEFAULT 'SKIPPED',
      cin_status TEXT DEFAULT 'SKIPPED',
      bank_status TEXT DEFAULT 'PENDING',
      aadhaar_status TEXT DEFAULT 'PENDING',
      udyam_number TEXT,
      udyam_status TEXT DEFAULT 'SKIPPED',
      risk_score INTEGER DEFAULT 0,
      mismatch_flags JSONB,
      admin_decision TEXT NOT NULL DEFAULT 'PENDING',
      rejection_reason TEXT,
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Columns added after initial release (self-heals older DBs):
    ALTER TABLE merchant_kyc_data ADD COLUMN IF NOT EXISTS aadhaar_status TEXT DEFAULT 'PENDING';
    ALTER TABLE merchant_kyc_data ADD COLUMN IF NOT EXISTS bank_holder_name TEXT;
    ALTER TABLE merchant_kyc_data ADD COLUMN IF NOT EXISTS udyam_number TEXT;
    ALTER TABLE merchant_kyc_data ADD COLUMN IF NOT EXISTS udyam_status TEXT DEFAULT 'SKIPPED';

    -- ── merchant_kyc_verifications (auto-KYC PAN/Aadhaar pipeline) ─────────────
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
    );
    CREATE INDEX IF NOT EXISTS mkv_status_idx ON merchant_kyc_verifications(verification_status);
    CREATE INDEX IF NOT EXISTS mkv_pan_hash_idx ON merchant_kyc_verifications(pan_number_hash);
    CREATE INDEX IF NOT EXISTS mkv_aadhaar_hash_idx ON merchant_kyc_verifications(aadhaar_number_hash);
    -- DigiLocker Aadhaar + mobile/email contact verification (self-heals older DBs):
    ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS aadhaar_digilocker_session_encrypted TEXT;
    ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS aadhaar_digilocker_session_iv TEXT;
    ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS aadhaar_digilocker_session_tag TEXT;
    ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS mobile_verified BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS mobile_verified_at TIMESTAMPTZ;
    ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE merchant_kyc_verifications ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
    ALTER TABLE merchant_kyc_verifications DROP COLUMN IF EXISTS aadhaar_otp_session_encrypted;
    ALTER TABLE merchant_kyc_verifications DROP COLUMN IF EXISTS aadhaar_otp_session_iv;
    ALTER TABLE merchant_kyc_verifications DROP COLUMN IF EXISTS aadhaar_otp_session_tag;

    -- ── kyc_verification_logs (masked audit trail for auto-KYC pipeline) ──────
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
    );
    CREATE INDEX IF NOT EXISTS kvl_merchant_id_idx ON kyc_verification_logs(merchant_id);
    CREATE INDEX IF NOT EXISTS kvl_created_at_idx ON kyc_verification_logs(created_at DESC);

    -- ── verification_logs (encrypted raw provider responses, secure onboarding) ─
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
    );
    CREATE INDEX IF NOT EXISTS vl_merchant_id_idx ON verification_logs(merchant_id);
    CREATE INDEX IF NOT EXISTS vl_created_at_idx ON verification_logs(created_at DESC);
  `);

  // ── Section 3: KYC settings, module controls ─────────────────────────────
  await runSection("kyc-settings + module-controls", sql`
    -- ── merchant_kyc_settings (Super Admin auto-KYC provider config) ───────────
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
    );

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
  `);

  // ── Section 4: Wallet tables ──────────────────────────────────────────────
  await runSection("wallets (merchant_wallets, wallet_ledger, wallet_holds, wallet_charges)", sql`
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
  `);

  // ── Section 5: Merchant onboarding + user columns + company settings ──────
  await runSection("merchant-onboarding + user-columns + company-settings", sql`
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

    -- ── users: notification preference columns ───────────────────────────────────
    ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_delivery_digest_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ekqr_sync_alert_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_change_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_prefs_disabled_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_start TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_end TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS quiet_hours_timezone TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS github_sync_failure_alert_emails BOOLEAN NOT NULL DEFAULT TRUE;
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
  `);

  // ── Section 6: Quiet hours queue + cashfree orders + auth OTPs ───────────
  await runSection("quiet-hours-queue + cashfree-payment-orders + merchant-auth-otps", sql`
    -- ── quiet_hours_queue ────────────────────────────────────────────────────────
    -- Real incident: this CREATE TABLE previously only had (id, user_id, subject,
    -- html, queued_at) while the Drizzle schema (lib/db/src/schema/quietHoursQueue.ts)
    -- and the code that reads/writes it (helpers/quietHours.ts, routes/auth.ts)
    -- require "to", deliver_after, flushed, flushed_at, created_at — so the
    -- every-minute quiet-hours flush scheduler failed with
    -- "column quiet_hours_queue.flushed does not exist" on every tick.
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
    -- this never again depends on a manual VPS SQL hotfix. Safe/idempotent:
    -- every ADD COLUMN is IF NOT EXISTS and nullable/defaulted.
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
  `);

  // ── Section 7: DROP NOT NULL on cashfree_payment_orders optional columns ──
  // Separate section because it uses PL/pgSQL DO block — isolated so any
  // failure here is immediately visible without polluting other sections.
  await runSection("cashfree-drop-not-null (PL/pgSQL DO block)", sql`
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
  `);

  // ── Section 8: Providers, routing, trusted IPs ───────────────────────────
  await runSection("providers + routing + trusted-ips", sql`
    -- ── merchant_trusted_ips: per-merchant trusted IP allowlist ─────────────
    CREATE TABLE IF NOT EXISTS merchant_trusted_ips (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      ip_address TEXT NOT NULL,
      label TEXT NOT NULL,
      labeled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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
      config_name VARCHAR(64) NOT NULL UNIQUE,
      description TEXT,
      strategy VARCHAR(32) NOT NULL DEFAULT 'priority',
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      fallback_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      timeout_ms INTEGER NOT NULL DEFAULT 30000,
      min_success_rate_threshold NUMERIC(5,2) DEFAULT 80.00,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_email VARCHAR(255)
    );
    -- Columns added after initial production deploy — self-heal existing DBs
    -- that only have the original minimal (name, is_active) schema:
    -- Make the legacy name/is_active columns optional so Drizzle INSERTs that
    -- omit them (using the new config_name/is_enabled schema) never violate NOT NULL.
    -- Wrapped in DO block so fresh DBs (which never had a "name" column) skip safely.
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'routing_configs' AND column_name = 'name'
      ) THEN
        ALTER TABLE routing_configs ALTER COLUMN name DROP NOT NULL;
        ALTER TABLE routing_configs ALTER COLUMN name SET DEFAULT '';
      END IF;
    END $$;
    ALTER TABLE routing_configs ADD COLUMN IF NOT EXISTS config_name VARCHAR(64);
    ALTER TABLE routing_configs ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE routing_configs ADD COLUMN IF NOT EXISTS strategy VARCHAR(32) NOT NULL DEFAULT 'priority';
    ALTER TABLE routing_configs ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE routing_configs ADD COLUMN IF NOT EXISTS fallback_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE routing_configs ADD COLUMN IF NOT EXISTS timeout_ms INTEGER NOT NULL DEFAULT 30000;
    ALTER TABLE routing_configs ADD COLUMN IF NOT EXISTS min_success_rate_threshold NUMERIC(5,2) DEFAULT 80.00;
    ALTER TABLE routing_configs ADD COLUMN IF NOT EXISTS updated_by_email VARCHAR(255);
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
  `);

  // ── Section 9: Misc tables (demo removals, system config, rate limits) ────
  await runSection("demo-account-removals + system-config + rate-limit-hits", sql`
    -- ── demo_account_removals ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS demo_account_removals (
      email TEXT PRIMARY KEY,
      removed_by_admin_id INTEGER,
      removed_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── system_config ───────────────────────────────────────────────────────
    -- Key-value store for reconciliation schedule, gateway config, EkQR,
    -- UPI Gateway, Cashfree payin/payout settings, wallet-load config, etc.
    -- initReconciliationScheduler() SELECTs from this table at startup; if it
    -- doesn't exist on a fresh CI database the API crashes before binding to
    -- port 8080 → nginx returns HTTP 502 on every health-check retry.
    CREATE TABLE IF NOT EXISTS system_config (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_email VARCHAR(255)
    );

    -- ── rate_limit_hits ─────────────────────────────────────────────────────
    -- Persistent rate-limit counter store used by express-rate-limit on every
    -- login request. Missing from the original db-migrate caused POST
    -- /api/auth/login to return HTTP 500 on a fresh CI database (unhandled
    -- "relation rate_limit_hits does not exist" error from the middleware).
    CREATE TABLE IF NOT EXISTS rate_limit_hits (
      key TEXT PRIMARY KEY,
      hits INTEGER NOT NULL DEFAULT 1,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rate_limit_hits_expires_at_idx ON rate_limit_hits(expires_at);
  `);

  // ── Section 10: Transactions, withdrawals, API keys, webhooks ─────────────
  await runSection("merchant-connections + withdrawals + transactions + api-keys + webhooks", sql`
    -- ── merchant_connections ─────────────────────────────────────────────────
    -- Must be created before transactions (which has an FK to this table).
    -- Also accessed by the providerLimitScheduler at startup.
    CREATE TABLE IF NOT EXISTS merchant_connections (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      credentials TEXT,
      monthly_limit NUMERIC(18,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      deactivated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS merchant_connections_merchant_id_idx ON merchant_connections(merchant_id);
    -- Columns added after initial production deploy — self-heal existing DB:
    ALTER TABLE merchant_connections ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

    -- ── withdrawals ─────────────────────────────────────────────────────────
    -- schemaGuard.ts has ALTER TABLE withdrawals ADD COLUMN lines but no
    -- CREATE TABLE, so on a fresh CI database schemaGuard crashes at the very
    -- first ALTER TABLE (relation does not exist) → the entire schemaGuard
    -- run is aborted → payin_charge_settings, platform_wallet_ledger, agents,
    -- payout_wallet_load_orders, and every table after line 232 are never
    -- created. Creating the table here (before schemaGuard runs) fixes the
    -- cascade. The ALTER TABLE lines in schemaGuard remain as safe no-ops.
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      amount NUMERIC(18,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'pending',
      transfer_status TEXT NOT NULL DEFAULT 'NOT_STARTED',
      provider_reference_id TEXT,
      utr TEXT,
      failure_reason TEXT,
      approved_by_admin_id INTEGER,
      approved_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      payout_mode TEXT NOT NULL DEFAULT 'IMPS',
      upi_id TEXT,
      remarks TEXT,
      bank_account TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '',
      ifsc_code TEXT NOT NULL DEFAULT '',
      account_holder TEXT NOT NULL DEFAULT '',
      beneficiary_id INTEGER,
      rejection_reason TEXT,
      rejected_by_admin_id INTEGER,
      rejected_at TIMESTAMPTZ,
      approval_type TEXT NOT NULL DEFAULT 'MANUAL',
      approved_by_system BOOLEAN NOT NULL DEFAULT FALSE,
      auto_approval_rule_snapshot JSONB,
      approved_by TEXT,
      idempotency_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Columns added after initial production deploy — self-heal existing DB.
    -- idempotency_key is required by the unique index below; without this guard
    -- the index CREATE fails with "column does not exist" on older production DBs.
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejected_by_admin_id INTEGER;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approval_type TEXT NOT NULL DEFAULT 'MANUAL';
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_by_system BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS auto_approval_rule_snapshot JSONB;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS approved_by TEXT;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
    CREATE INDEX IF NOT EXISTS withdrawals_merchant_id_idx ON withdrawals(merchant_id);
    CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawals(status);
    CREATE INDEX IF NOT EXISTS withdrawals_transfer_status_idx ON withdrawals(transfer_status);
    CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_merchant_idempotency_key_uniq
      ON withdrawals(merchant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    -- ── transactions ─────────────────────────────────────────────────────────
    -- schemaGuard.ts has ALTER TABLE transactions ADD COLUMN lines (payin fee
    -- columns) but no CREATE TABLE. On a fresh CI DB, after the withdrawals
    -- cascade is fixed, schemaGuard reaches line 246 and would again crash on
    -- "relation transactions does not exist". Creating here prevents that.
    -- Also: seed.ts inserts demo transactions at startup.
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      virtual_account_id INTEGER,
      qr_code_id INTEGER,
      connection_id INTEGER REFERENCES merchant_connections(id) ON DELETE SET NULL,
      provider TEXT,
      payment_link_id INTEGER,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      amount NUMERIC(18,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      utr TEXT NOT NULL UNIQUE,
      reference_id TEXT,
      description TEXT,
      metadata TEXT,
      gross_amount NUMERIC(12,2),
      payin_fee NUMERIC(12,2),
      gst_amount NUMERIC(12,2),
      net_amount NUMERIC(12,2),
      fee_rate NUMERIC(8,4),
      fee_rule_source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Columns added after initial production deploy — self-heal existing DB:
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gross_amount NUMERIC(12,2);
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payin_fee NUMERIC(12,2);
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12,2);
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12,2);
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_rate NUMERIC(8,4);
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_rule_source TEXT;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS provider TEXT;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_link_id INTEGER;
    CREATE INDEX IF NOT EXISTS transactions_merchant_id_idx ON transactions(merchant_id);
    CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions(status);
    CREATE INDEX IF NOT EXISTS transactions_created_at_idx ON transactions(created_at DESC);

    -- ── api_keys ─────────────────────────────────────────────────────────────
    -- schemaGuard.ts has ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS label
    -- but no CREATE TABLE. Also: seed.ts inserts demo API keys at startup.
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      secret_key TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      label TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Columns added after initial production deploy — self-heal existing DB:
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS label TEXT;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS api_keys_merchant_id_idx ON api_keys(merchant_id);

    -- ── webhooks ─────────────────────────────────────────────────────────────
    -- Required by PUT /api/webhooks (merchant settings test) and by seed.ts.
    -- Missing from both db-migrate and schemaGuard caused the merchant webhook
    -- configuration route to return HTTP 500 on a fresh CI database.
    CREATE TABLE IF NOT EXISTS webhooks (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL UNIQUE,
      url TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      events TEXT[] NOT NULL DEFAULT '{}',
      secret TEXT,
      secret_rotated_at TIMESTAMPTZ,
      max_retries INTEGER NOT NULL DEFAULT 3,
      retry_delay_1 INTEGER,
      retry_delay_2 INTEGER,
      retry_delay_3 INTEGER,
      failure_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      failure_alert_threshold INTEGER NOT NULL DEFAULT 3,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Columns added after initial production deploy — self-heal existing DB:
    ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS secret_rotated_at TIMESTAMPTZ;
    ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS retry_delay_1 INTEGER;
    ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS retry_delay_2 INTEGER;
    ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS retry_delay_3 INTEGER;
    ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS failure_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS failure_alert_threshold INTEGER NOT NULL DEFAULT 3;

    -- ── callback_logs ─────────────────────────────────────────────────────────
    -- Accessed by callbackRetry.ts scheduler at startup.
    CREATE TABLE IF NOT EXISTS callback_logs (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      qr_code_id INTEGER,
      transaction_id INTEGER,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      http_status INTEGER,
      request_body TEXT,
      response_body TEXT,
      attempts INTEGER NOT NULL DEFAULT 1,
      next_retry_at TIMESTAMPTZ,
      last_attempt_at TIMESTAMPTZ,
      event_type TEXT,
      signature_verified BOOLEAN,
      is_test BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── callback_log_attempts ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS callback_log_attempts (
      id SERIAL PRIMARY KEY,
      callback_log_id INTEGER NOT NULL,
      attempt_number INTEGER NOT NULL,
      fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      http_status INTEGER,
      response_body TEXT
    );

    -- ── credential_events ────────────────────────────────────────────────────
    -- Tracks login and API key events for the security audit log.
    CREATE TABLE IF NOT EXISTS credential_events (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_id INTEGER NOT NULL,
      actor_email TEXT NOT NULL,
      key_prefix TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── Section 11: Audit, settings, reports ─────────────────────────────────
  await runSection("scheduled-audit-reports + system-settings + audit-logs", sql`
    -- ── scheduled_audit_reports ──────────────────────────────────────────────
    -- Accessed by overdueReportScheduler at startup. Missing table caused a
    -- level-50 error log on every server start with a fresh CI database.
    CREATE TABLE IF NOT EXISTS scheduled_audit_reports (
      id SERIAL PRIMARY KEY,
      frequency TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_sent_at TIMESTAMPTZ,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      auto_pause_after_failures INTEGER NOT NULL DEFAULT 3,
      failure_acknowledged_at TIMESTAMPTZ,
      failure_acknowledged_by_email TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── system_settings ─────────────────────────────────────────────────────
    -- Key-value store for SMTP config, finance_report_email, reconciliation
    -- schedule, and other admin-configurable settings.
    -- routes/settings.ts reads/writes this table on every PUT /settings/* call.
    -- Missing on a fresh CI database caused all admin settings PUT endpoints to
    -- return HTTP 500 (relation "system_settings" does not exist).
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER
    );

    -- ── audit_logs ───────────────────────────────────────────────────────────
    -- Admin action audit trail. Every PUT handler in routes/systemConfig.ts and
    -- routes/settings.ts inserts a row here after a successful save — so if this
    -- table is absent on a fresh CI database every admin config PUT returns 500.
    -- Schema matches lib/db/src/schema/auditLogs.ts (Drizzle source of truth).
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      admin_email TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS audit_logs_admin_id_idx ON audit_logs(admin_id);
    CREATE INDEX IF NOT EXISTS audit_logs_target_type_idx ON audit_logs(target_type);
    CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at DESC);

    -- ── report_schedules ─────────────────────────────────────────────────────
    -- Per-merchant scheduled report config. Accessed by overdueReportScheduler
    -- and deliverySuccessRateAlertScheduler at startup.
    CREATE TABLE IF NOT EXISTS report_schedules (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      frequency TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'xlsx',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      day_of_week INTEGER,
      day_of_month INTEGER,
      last_sent_at TIMESTAMPTZ,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      auto_pause_after_failures INTEGER NOT NULL DEFAULT 3,
      next_run_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS report_schedules_merchant_unique_idx ON report_schedules(merchant_id);

    -- ── report_delivery_logs ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS report_delivery_logs (
      id SERIAL PRIMARY KEY,
      schedule_id INTEGER NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
      merchant_id INTEGER NOT NULL,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      success BOOLEAN NOT NULL,
      failure_reason TEXT,
      is_auto_pause BOOLEAN NOT NULL DEFAULT FALSE,
      retry_count INTEGER NOT NULL DEFAULT 0,
      frequency TEXT,
      format TEXT,
      outcome TEXT,
      triggered_by TEXT,
      triggered_by_email TEXT,
      performed_by_admin_id INTEGER,
      performed_by_admin_email TEXT,
      max_attempts INTEGER,
      backoff_base_ms INTEGER
    );
  `);

  // ── Section 12: Users columns (large block of notification prefs) ─────────
  await runSection("users-columns (notification prefs + profile fields)", sql`
    -- ── users: missing notification preference + profile columns ─────────────
    -- The original CREATE TABLE users only had id/email/password_hash/role/
    -- timestamps. Subsequent ALTER TABLE blocks in this file added a handful
    -- of columns. The rest of the Drizzle schema (notification email/notif
    -- toggles, badge-snooze fields, is_active, merchant_id, last_seen_ip,
    -- password_updated_at, last_login_at, and the payout-admin permission
    -- columns) were never added here — only in schemaGuard (which crashes on
    -- fresh DBs before reaching its own users ALTER TABLE block at line 689).
    -- Adding all of them here ensures they exist on the first server request.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS merchant_id INTEGER;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reconciliation_alert_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expiry_alert_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS settlement_state_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_failure_alert_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_failure_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS report_failure_alert_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_generated_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_revoked_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS login_alert_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS report_schedule_changed_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS settlement_state_changed_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reconciliation_alert_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expiry_alert_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS settlement_state_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_failure_alert_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS webhook_failure_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ekqr_sync_alert_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS report_failure_alert_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_delivery_digest_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_generated_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_revoked_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS login_alert_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS report_schedule_changed_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS settlement_state_changed_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_change_notifs BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_reminder_emails BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reports_badge_snoozed_until TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_snoozed_until JSONB;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_reminder_sent_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_field_disabled_at JSONB;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_ip TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_payout_provider_credentials BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions_json JSONB;
  `);

  // ── Section 13: Core business tables accessed by seed.ts ─────────────────
  // These tables are created by schemaGuard/seed on a running server but were
  // never in db-migrate.ts. On a fresh CI DB the post-merge seed crashes with
  // "relation X does not exist" before schemaGuard has a chance to create them.
  // Creating them here (all IF NOT EXISTS — safe to re-run on existing DBs).
  await runSection("core-business-tables (settlements, qr_codes, virtual_accounts, account_details, ledger_entries, notifications, reconciliation, scheduled_audit_report_logs)", sql`

    -- ── settlements ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS settlements (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      amount NUMERIC(18,2) NOT NULL,
      requested_amount NUMERIC(18,2),
      requested_note TEXT,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'pending',
      period_from DATE,
      period_to DATE,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      admin_remark TEXT,
      processed_by INTEGER,
      processed_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      reference_number TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS settlements_merchant_id_idx ON settlements(merchant_id);
    CREATE INDEX IF NOT EXISTS settlements_status_idx ON settlements(status);

    -- ── qr_codes ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS qr_codes (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      label TEXT,
      payload TEXT NOT NULL,
      amount TEXT,
      order_id TEXT,
      callback_url TEXT,
      merchant_reference TEXT,
      expires_at TIMESTAMPTZ,
      ekqr_order_id TEXT,
      ekqr_payment_url TEXT,
      provider_key TEXT,
      provider_order_id TEXT,
      provider_payment_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS qr_codes_merchant_id_idx ON qr_codes(merchant_id);

    -- ── virtual_accounts ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS virtual_accounts (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      account_number TEXT NOT NULL UNIQUE,
      ifsc TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      account_holder TEXT NOT NULL,
      label TEXT,
      balance TEXT NOT NULL DEFAULT '0.00',
      total_collection TEXT NOT NULL DEFAULT '0.00',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS virtual_accounts_merchant_id_idx ON virtual_accounts(merchant_id);

    -- ── account_details ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS account_details (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      account_number TEXT,
      ifsc TEXT,
      bank_name TEXT,
      account_holder TEXT,
      upi_id TEXT,
      qr_payload TEXT,
      provider TEXT,
      metadata TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_global BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── ledger_entries ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount NUMERIC(18,2) NOT NULL,
      balance_before NUMERIC(18,2) NOT NULL,
      balance_after NUMERIC(18,2) NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      description TEXT NOT NULL,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ledger_merchant_created_idx ON ledger_entries(merchant_id, created_at);

    -- ── notifications ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata JSONB,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, is_read, created_at);
    -- Dedup partial unique indexes relied on by onConflictDoNothing() callers:
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_provider_limit_dedup_idx
      ON notifications(user_id, type, ((metadata->>'provider')), ((metadata->>'monthKey')))
      WHERE type IN ('provider_limit_warning', 'provider_limit_reached');
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_provider_limit_reset_dedup_idx
      ON notifications(user_id, type, ((metadata->>'provider')), ((metadata->>'currentMonthKey')))
      WHERE type = 'provider_limit_reset';
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_merchant_dormant_dedup_idx
      ON notifications(user_id, type, ((metadata->>'dedupeKey')))
      WHERE type = 'merchant_dormant';
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_report_overdue_dedup_idx
      ON notifications(user_id, type, ((metadata->>'dedupeKey')))
      WHERE type = 'scheduled_report_overdue';
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_report_auto_paused_admin_dedup_idx
      ON notifications(user_id, type, ((metadata->>'scheduleId')))
      WHERE type = 'report_schedule_auto_paused_admin' AND is_read = false;
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_scheduled_report_failure_dedup_idx
      ON notifications(user_id, type, ((metadata->>'scheduleId')), ((metadata->>'consecutiveFailures')))
      WHERE type = 'scheduled_report_failure';
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_scheduled_report_auto_paused_dedup_idx
      ON notifications(user_id, type, ((metadata->>'scheduleId')))
      WHERE type = 'scheduled_report_auto_paused';
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_delivery_rate_alert_dedup_idx
      ON notifications(user_id, type, ((metadata->>'dedupeKey')))
      WHERE type = 'report_delivery_low_success_rate';

    -- ── reconciliation_runs ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS reconciliation_runs (
      id SERIAL PRIMARY KEY,
      merchant_id INTEGER,
      date_from DATE NOT NULL,
      date_to DATE NOT NULL,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_deposits INTEGER NOT NULL DEFAULT 0,
      total_matched INTEGER NOT NULL DEFAULT 0,
      total_unmatched INTEGER NOT NULL DEFAULT 0,
      total_settlements INTEGER NOT NULL DEFAULT 0,
      matched_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      unmatched_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      completed_at TIMESTAMPTZ,
      created_by INTEGER,
      triggered_by TEXT NOT NULL DEFAULT 'manual',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── reconciliation_items ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS reconciliation_items (
      id SERIAL PRIMARY KEY,
      run_id INTEGER NOT NULL,
      transaction_id INTEGER,
      settlement_id INTEGER,
      merchant_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      amount NUMERIC(18,2) NOT NULL,
      matched_at TIMESTAMPTZ,
      notes TEXT,
      resolved_at TIMESTAMPTZ,
      resolved_by INTEGER,
      resolved_by_email TEXT,
      resolution_type TEXT,
      resolution_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── reconciliation_email_logs ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS reconciliation_email_logs (
      id SERIAL PRIMARY KEY,
      run_id INTEGER NOT NULL,
      email_type TEXT NOT NULL,
      recipients TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      error_message TEXT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── scheduled_audit_report_logs ───────────────────────────────────────────
    -- Per-delivery log for scheduled_audit_reports runs.
    -- References scheduled_audit_reports(id) which is created in Section 11.
    CREATE TABLE IF NOT EXISTS scheduled_audit_report_logs (
      id SERIAL PRIMARY KEY,
      schedule_id INTEGER NOT NULL REFERENCES scheduled_audit_reports(id) ON DELETE CASCADE,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      row_count INTEGER NOT NULL DEFAULT 0,
      success BOOLEAN NOT NULL,
      error_message TEXT,
      is_retry BOOLEAN NOT NULL DEFAULT FALSE,
      retry_attempt INTEGER NOT NULL DEFAULT 0,
      is_manual_retry BOOLEAN NOT NULL DEFAULT FALSE,
      delivery_cycle_id TEXT
    );
  `);

  // ── Section 14: Razorpay Payin tables ──────────────────────────────────────
  await runSection("razorpay-payin-tables", sql`
    CREATE TABLE IF NOT EXISTS razorpay_payment_orders (
      id                  SERIAL PRIMARY KEY,
      merchant_id         INTEGER NOT NULL,
      internal_order_id   TEXT    NOT NULL,
      razorpay_order_id   TEXT    NOT NULL,
      razorpay_payment_id TEXT,
      amount              NUMERIC(18,2) NOT NULL,
      currency            TEXT NOT NULL DEFAULT 'INR',
      status              TEXT NOT NULL DEFAULT 'CREATED',
      payment_method      TEXT,
      utr                 TEXT,
      failure_reason      TEXT,
      paid_at             TIMESTAMPTZ,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS razorpay_orders_internal_id_uniq     ON razorpay_payment_orders(internal_order_id);
    CREATE UNIQUE INDEX IF NOT EXISTS razorpay_orders_rzp_order_id_uniq    ON razorpay_payment_orders(razorpay_order_id);
    CREATE UNIQUE INDEX IF NOT EXISTS razorpay_orders_rzp_payment_id_uniq  ON razorpay_payment_orders(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS razorpay_orders_utr_uniq              ON razorpay_payment_orders(utr) WHERE utr IS NOT NULL;
    CREATE INDEX        IF NOT EXISTS razorpay_orders_merchant_created_idx  ON razorpay_payment_orders(merchant_id, created_at);

    CREATE TABLE IF NOT EXISTS razorpay_webhook_logs (
      id                  SERIAL PRIMARY KEY,
      webhook_event_id    TEXT,
      event_type          TEXT,
      razorpay_order_id   TEXT,
      razorpay_payment_id TEXT,
      merchant_id         INTEGER,
      amount              TEXT,
      processing_result   TEXT NOT NULL,
      safe_message        TEXT,
      received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS razorpay_webhook_logs_event_id_uniq ON razorpay_webhook_logs(webhook_event_id) WHERE webhook_event_id IS NOT NULL;
    CREATE INDEX        IF NOT EXISTS razorpay_webhook_logs_created_idx    ON razorpay_webhook_logs(received_at);
  `);

  // ── Section 15: Withdrawals payout slip fields ────────────────────────────
  await runSection("withdrawals-slip-fields", sql`
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS slip_verification_token TEXT;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS payout_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
    ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
    CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_slip_verif_token_uniq
      ON withdrawals(slip_verification_token) WHERE slip_verification_token IS NOT NULL;
  `);

  console.log("DB migrations complete.");
  process.exit(0);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
