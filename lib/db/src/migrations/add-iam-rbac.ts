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
  // FK: permission_key → permissions.key (cascade — key deleted = row gone)
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
  // FK: updated_by_user_id → users.id (set null — actor deleted = null)
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
  // FK: user_id → users.id (cascade — user deleted = overrides gone)
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
  // FK: permission_key → permissions.key (cascade — key deleted = override gone)
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
  // FK: updated_by_user_id → users.id (set null — actor deleted = null)
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
