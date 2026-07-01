-- RasoKart Production Migration Script
-- Safe, idempotent — run on VPS after git pull.
-- Uses IF NOT EXISTS / DO blocks to never fail on a pre-existing column or index.
-- Run as: psql "$DATABASE_URL" -f scripts/migrate-production.sql

BEGIN;

-- ── quiet_hours_queue ────────────────────────────────────────────────────────
ALTER TABLE quiet_hours_queue
  ADD COLUMN IF NOT EXISTS flushed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE quiet_hours_queue
  ADD COLUMN IF NOT EXISTS flushed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quiet_hours_queue_flushed_deliver
  ON quiet_hours_queue (flushed, deliver_after);

-- ── withdrawals ──────────────────────────────────────────────────────────────
-- These columns were added for the payout-system integration.
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS transfer_status TEXT NOT NULL DEFAULT 'NOT_STARTED';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS provider_reference_id TEXT;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS utr TEXT;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS approved_by_admin_id INTEGER;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS payout_mode TEXT NOT NULL DEFAULT 'IMPS';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS upi_id TEXT;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS remarks TEXT;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS bank_account TEXT NOT NULL DEFAULT '';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS bank_name TEXT NOT NULL DEFAULT '';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS ifsc_code TEXT NOT NULL DEFAULT '';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS account_holder TEXT NOT NULL DEFAULT '';

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ── system_config new keys (seed inserts these but migration makes them safe) ─
-- No schema change needed — system_config is a key-value table.
-- New keys (cashfree_payout_bulk_enabled, etc.) are inserted by the API server
-- seed on startup.

-- ── cashfree_payout_webhook_logs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cashfree_payout_webhook_logs (
  id                 SERIAL PRIMARY KEY,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  endpoint           TEXT,
  event_type         TEXT,
  status             TEXT,
  signature_verified BOOLEAN,
  payout_id          INTEGER,
  transfer_id        TEXT,
  cf_transfer_id     TEXT,
  utr                TEXT,
  safe_error         TEXT,
  processing_result  TEXT NOT NULL DEFAULT 'received',
  raw_payload        TEXT
);

CREATE INDEX IF NOT EXISTS idx_cpwl_received_at ON cashfree_payout_webhook_logs (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpwl_transfer_id ON cashfree_payout_webhook_logs (transfer_id);

-- ── cashfree_payout_webhook_logs: add endpoint column if table already exists ──
ALTER TABLE cashfree_payout_webhook_logs ADD COLUMN IF NOT EXISTS endpoint TEXT;

-- ── cashfree_payouts: add utr column ──────────────────────────────────────────
ALTER TABLE cashfree_payouts ADD COLUMN IF NOT EXISTS utr TEXT;

COMMIT;

SELECT 'Migration complete ✓' AS status;
