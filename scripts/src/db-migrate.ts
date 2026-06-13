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

  console.log("DB migrations complete.");
  process.exit(0);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
