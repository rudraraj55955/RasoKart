-- Migration 0002: payout_wallet_load_orders table + wallet load system_config defaults
-- Idempotent — safe to run on any existing DB (dev or VPS).
-- Does NOT delete existing payout data.

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payout_wallet_load_orders (
  id                  SERIAL PRIMARY KEY,
  load_id             TEXT NOT NULL,
  merchant_id         INTEGER NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
  amount              NUMERIC(18,2) NOT NULL,
  fee_amount          NUMERIC(18,2) NOT NULL DEFAULT 0,
  gst_amount          NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_credit_amount   NUMERIC(18,2) NOT NULL,
  method              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'CREATED',
  internal_order_id   TEXT,
  provider_payment_id TEXT,
  utr                 TEXT,
  payer_name          TEXT,
  payer_reference     TEXT,
  screenshot_url      TEXT,
  rejection_reason    TEXT,
  credited_at         TIMESTAMPTZ,
  approved_by         INTEGER,
  approved_at         TIMESTAMPTZ,
  admin_note          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS pwlo_load_id_uniq
  ON payout_wallet_load_orders(load_id);

CREATE UNIQUE INDEX IF NOT EXISTS pwlo_internal_order_id_uniq
  ON payout_wallet_load_orders(internal_order_id)
  WHERE internal_order_id IS NOT NULL;

-- Blocks duplicate UTR submissions across all merchants
CREATE UNIQUE INDEX IF NOT EXISTS pwlo_utr_uniq
  ON payout_wallet_load_orders(utr)
  WHERE utr IS NOT NULL;

CREATE INDEX IF NOT EXISTS pwlo_merchant_created_idx
  ON payout_wallet_load_orders(merchant_id, created_at);

CREATE INDEX IF NOT EXISTS pwlo_status_idx
  ON payout_wallet_load_orders(status);

-- ── system_config defaults (wallet load settings) ────────────────────────────
-- ON CONFLICT DO NOTHING — never overwrites a value an admin already configured.
INSERT INTO system_config (key, value) VALUES
  ('wallet_load_enabled',           'true'),
  ('wallet_load_online_enabled',    'true'),
  ('wallet_load_manual_utr_enabled','true'),
  ('wallet_load_admin_topup_enabled','true'),
  ('wallet_load_min_amount',        '100'),
  ('wallet_load_max_amount',        '500000'),
  ('wallet_load_fee_type',          'NONE'),
  ('wallet_load_fee_value',         '0'),
  ('wallet_load_gst_on_fee',        'false'),
  ('wallet_load_require_screenshot','false'),
  ('wallet_load_bank_name',         ''),
  ('wallet_load_account_number',    ''),
  ('wallet_load_ifsc',              ''),
  ('wallet_load_account_holder',    ''),
  ('wallet_load_upi_id',            '')
ON CONFLICT (key) DO NOTHING;
