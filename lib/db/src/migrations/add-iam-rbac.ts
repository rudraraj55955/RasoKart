/**
 * IAM RBAC schema migration — add-iam-rbac.ts
 *
 * Provides deterministic `up()` and `rollback()` functions for the IAM/RBAC
 * schema additions.  Both are idempotent (CREATE/DROP IF EXISTS) so they can
 * be run safely on any environment state.
 *
 * Deployment flow:
 *   1. `up()` is called by schemaGuard on every server start (additive/safe).
 *   2. `rollback()` is available for emergency rollback via admin tooling.
 *
 * Tables introduced by this migration:
 *   permissions          — DB-backed catalog mirroring ALL_PERMISSION_KEYS
 *   role_permissions     — per-role default permission states (admin-editable)
 *   user_permissions     — per-user ALLOW/DENY overrides (Super Admin only)
 *   iam_migration_log    — records when the runtime IAM migration was executed
 *
 * Legacy renames handled by up():
 *   role_permission_templates  → role_permissions
 *   user_permission_overrides  → user_permissions
 *
 * Ordering note: the permissions catalog INSERT must come BEFORE the FK
 * constraints on role_permissions/user_permissions so that:
 *   (a) fresh DBs have no orphan rows when the FK is added, and
 *   (b) an orphan-cleanup step can safely purge any stale rows before the FK.
 */

import { sql, type SQL } from "drizzle-orm";

/** Minimal structural interface — compatible with any Drizzle `db` instance (NodePg, PlanetScale, etc.) */
interface DrizzleExecutor {
  execute(query: SQL<unknown>): Promise<unknown>;
}

export async function up(db: DrizzleExecutor): Promise<void> {
  // ── Rename legacy tables to canonical names ───────────────────────────────
  // Fully idempotent: only renames if source exists AND target does not,
  // avoiding "relation already exists" errors on any environment state.
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'role_permission_templates')
         AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'role_permissions')
      THEN ALTER TABLE role_permission_templates RENAME TO role_permissions; END IF;
    END $$
  `);
  await db.execute(sql`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_permission_overrides')
         AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_permissions')
      THEN ALTER TABLE user_permission_overrides RENAME TO user_permissions; END IF;
    END $$
  `);

  // ── permissions — DB-backed catalog of all permission keys ───────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS permissions (
      id                  SERIAL PRIMARY KEY,
      key                 TEXT NOT NULL UNIQUE,
      category            TEXT NOT NULL,
      is_super_admin_only BOOLEAN NOT NULL DEFAULT FALSE,
      description         TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── role_permissions — per-role default permission states ─────────────────
  // Admin-editable via PUT /iam/roles/:role/:key.
  // Seed uses onConflictDoNothing() so admin edits survive restarts.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS role_permissions (
      id                  SERIAL PRIMARY KEY,
      role                TEXT NOT NULL,
      permission_key      TEXT NOT NULL,
      is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_user_id  INTEGER,
      UNIQUE (role, permission_key)
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS rp_role_idx ON role_permissions(role)`,
  );

  // ── user_permissions — per-user ALLOW/DENY overrides ────────────────────
  // Super Admin only — SET via PUT /iam/users/:userId/permissions/:key.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_permissions (
      id                  SERIAL PRIMARY KEY,
      user_id             INTEGER NOT NULL,
      permission_key      TEXT NOT NULL,
      effect              TEXT NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_user_id  INTEGER,
      UNIQUE (user_id, permission_key)
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS up_user_id_idx ON user_permissions(user_id)`,
  );

  // ── iam_migration_log — runtime migration audit record ───────────────────
  // One row is inserted when POST /iam/migration/run completes.
  // Its presence is the signal that IAM enforcement is active.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS iam_migration_log (
      id                  SERIAL PRIMARY KEY,
      cutoff_at           TIMESTAMPTZ NOT NULL,
      executed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      executed_by_user_id INTEGER,
      total_users         INTEGER NOT NULL DEFAULT 0,
      snapshot_json       JSONB
    )
  `);
  // FK: executed_by_user_id → users.id (set null — actor deleted = null)
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'iml_executed_by_fk' AND table_name = 'iam_migration_log'
      ) THEN
        ALTER TABLE iam_migration_log
          ADD CONSTRAINT iml_executed_by_fk
          FOREIGN KEY (executed_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$
  `);

  // ── Seed the permissions catalog BEFORE adding FKs ───────────────────────
  // Must come before rp_permission_key_fk / up_permission_key_fk so that:
  //   - fresh DBs: no orphan rows exist when FK is added
  //   - existing DBs: orphan cleanup below only removes truly unknown keys
  // ON CONFLICT DO NOTHING preserves any admin-customised descriptions.
  await db.execute(sql`
    INSERT INTO permissions (key, category, is_super_admin_only) VALUES
      -- Admin portal
      ('admin_dashboard',         'admin', FALSE),
      ('admin_merchants',         'admin', FALSE),
      ('admin_transactions',      'admin', FALSE),
      ('admin_settlements',       'admin', FALSE),
      ('admin_payouts',           'admin', FALSE),
      ('admin_users',             'admin', FALSE),
      ('admin_plans',             'admin', FALSE),
      ('admin_webhooks',          'admin', FALSE),
      ('admin_audit_logs',        'admin', FALSE),
      ('admin_feature_control',   'admin', FALSE),
      ('admin_settings',          'admin', FALSE),
      ('admin_company_branding',  'admin', TRUE),
      ('admin_data_hygiene',      'admin', TRUE),
      ('admin_smart_routing',     'admin', FALSE),
      ('admin_kyc',               'admin', FALSE),
      ('admin_providers',         'admin', FALSE),
      ('admin_reports',           'admin', FALSE),
      ('admin_support',           'admin', FALSE),
      ('admin_payout_admins',     'admin', FALSE),
      ('admin_payout_merchants',  'admin', FALSE),
      ('admin_payout_settings',   'admin', FALSE),
      ('admin_razorpay',          'admin', TRUE),
      ('admin_social_providers',  'admin', TRUE),
      ('admin_secure_id',         'admin', TRUE),
      ('admin_otp_settings',      'admin', TRUE),
      ('admin_reconciliation',    'admin', FALSE),
      ('admin_module_control',    'admin', FALSE),
      ('admin_platform_profit',   'admin', TRUE),
      ('admin_utr_verifications', 'admin', FALSE),
      ('admin_payin_charges',     'admin', FALSE),
      ('admin_connections',       'admin', FALSE),
      ('admin_api_monitoring',    'admin', FALSE),
      -- IAM (super admin only)
      ('iam_read',   'iam', TRUE),
      ('iam_manage', 'iam', TRUE),
      -- Merchant portal
      ('merchant_dashboard',        'merchant', FALSE),
      ('merchant_transactions',     'merchant', FALSE),
      ('merchant_payouts',          'merchant', FALSE),
      ('merchant_api_keys',         'merchant', FALSE),
      ('merchant_webhook',          'merchant', FALSE),
      ('merchant_virtual_accounts', 'merchant', FALSE),
      ('merchant_qr_codes',         'merchant', FALSE),
      ('merchant_ledger',           'merchant', FALSE),
      ('merchant_reports',          'merchant', FALSE),
      ('merchant_kyc',              'merchant', FALSE),
      ('merchant_onboarding',       'merchant', FALSE),
      ('merchant_support',          'merchant', FALSE),
      ('merchant_payment_links',    'merchant', FALSE),
      -- Payout merchant portal
      ('payout_merchant_dashboard',    'payout_merchant', FALSE),
      ('payout_merchant_payouts',      'payout_merchant', FALSE),
      ('payout_merchant_kyc',          'payout_merchant', FALSE),
      ('payout_merchant_wallet_loads', 'payout_merchant', FALSE),
      -- Payout admin portal (canonical + extended role access)
      ('payout_admin_dashboard',  'payout_admin', FALSE),
      ('payout_admin_merchants',  'payout_admin', FALSE),
      ('payout_admin_audit_logs', 'payout_admin', FALSE),
      ('payout_admin_settings',   'payout_admin', FALSE),
      -- Agent portal
      ('agent_dashboard',  'agent', FALSE),
      ('agent_merchants',  'agent', FALSE),
      ('agent_commission', 'agent', FALSE),
      ('agent_profile',    'agent', FALSE),
      -- Customer (checkout consumer — no portal access by default)
      ('customer_checkout', 'customer', FALSE)
    ON CONFLICT (key) DO NOTHING
  `);

  // ── Orphan cleanup: remove role_permissions / user_permissions rows ───────
  // whose permission_key no longer exists in the permissions catalog.
  // This is safe and idempotent — the INSERT INTO role_permissions below will
  // re-populate any legitimately missing rows.  Prevents FK violations when
  // the constraint is added on an existing DB with stale rows.
  await db.execute(sql`
    DELETE FROM role_permissions
    WHERE permission_key NOT IN (SELECT key FROM permissions)
  `);
  await db.execute(sql`
    DELETE FROM user_permissions
    WHERE permission_key NOT IN (SELECT key FROM permissions)
  `);

  // ── FK constraints (added AFTER permissions catalog is populated) ─────────

  // role_permissions: permission_key → permissions.key
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'rp_permission_key_fk' AND table_name = 'role_permissions'
      ) THEN
        ALTER TABLE role_permissions
          ADD CONSTRAINT rp_permission_key_fk
          FOREIGN KEY (permission_key) REFERENCES permissions(key) ON DELETE CASCADE;
      END IF;
    END $$
  `);
  // role_permissions: updated_by_user_id → users.id
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'rp_updated_by_fk' AND table_name = 'role_permissions'
      ) THEN
        ALTER TABLE role_permissions
          ADD CONSTRAINT rp_updated_by_fk
          FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$
  `);

  // user_permissions: user_id → users.id
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'up_user_id_fk' AND table_name = 'user_permissions'
      ) THEN
        ALTER TABLE user_permissions
          ADD CONSTRAINT up_user_id_fk
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END $$
  `);
  // user_permissions: permission_key → permissions.key
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'up_permission_key_fk' AND table_name = 'user_permissions'
      ) THEN
        ALTER TABLE user_permissions
          ADD CONSTRAINT up_permission_key_fk
          FOREIGN KEY (permission_key) REFERENCES permissions(key) ON DELETE CASCADE;
      END IF;
    END $$
  `);
  // user_permissions: updated_by_user_id → users.id
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'up_updated_by_fk' AND table_name = 'user_permissions'
      ) THEN
        ALTER TABLE user_permissions
          ADD CONSTRAINT up_updated_by_fk
          FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$
  `);

  // ── Seed role_permissions defaults ────────────────────────────────────────
  // Covers all 7 roles (5 canonical + 2 extended payout roles) × all keys.
  // Uses a CROSS JOIN + CASE so the logic mirrors ROLE_DEFAULT_PERMISSIONS in
  // permissions.ts and remains a single idempotent statement.
  // ON CONFLICT DO NOTHING preserves any admin-customised role templates.
  await db.execute(sql`
    INSERT INTO role_permissions (role, permission_key, is_enabled)
    SELECT
      r.role,
      p.key,
      CASE
        WHEN r.role = 'admin' THEN (
          p.key LIKE 'admin_%'
          AND p.key NOT IN (
            'admin_company_branding', 'admin_data_hygiene', 'admin_razorpay',
            'admin_social_providers', 'admin_secure_id', 'admin_otp_settings',
            'admin_platform_profit'
          )
          AND p.key NOT IN ('iam_read', 'iam_manage')
        )
        WHEN r.role = 'merchant'         THEN p.key LIKE 'merchant_%'
        WHEN r.role = 'payout_merchant'  THEN p.key LIKE 'payout_merchant_%'
        WHEN r.role = 'payout_admin'     THEN p.key LIKE 'payout_admin_%'
        WHEN r.role = 'payout_super_admin' THEN p.key LIKE 'payout_admin_%'
        WHEN r.role = 'agent'            THEN p.key LIKE 'agent_%'
        WHEN r.role = 'customer'         THEN FALSE
        ELSE FALSE
      END AS is_enabled
    FROM (VALUES
      ('admin'), ('merchant'), ('payout_merchant'),
      ('payout_admin'), ('payout_super_admin'), ('agent'), ('customer')
    ) AS r(role)
    CROSS JOIN permissions p
    ON CONFLICT (role, permission_key) DO NOTHING
  `);
}

/**
 * Rollback: drops all IAM tables in dependency order (overrides before templates,
 * log before both).  Destructive — call only in emergency or dev environments.
 */
export async function rollback(db: DrizzleExecutor): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS iam_migration_log`);
  await db.execute(sql`DROP TABLE IF EXISTS user_permissions`);
  await db.execute(sql`DROP TABLE IF EXISTS role_permissions`);
  await db.execute(sql`DROP TABLE IF EXISTS permissions`);
}
