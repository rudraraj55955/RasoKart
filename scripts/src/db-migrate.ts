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
