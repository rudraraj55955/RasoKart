import { pgTable, text, serial, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * IAM Permission Catalog — single source of truth for all permission keys.
 *
 * ── Canonical role model ──────────────────────────────────────────────────────
 * 7 string role values (users.role) + isSuperAdmin boolean flag:
 *   isSuperAdmin=true         → SUPER_ADMIN semantics (bypasses all IAM checks)
 *   role="admin"              → platform admin
 *   role="merchant"           → standard payment merchant
 *   role="payout_merchant"    → merchant with payout access
 *   role="payout_admin"       → payout operations admin
 *   role="payout_super_admin" → elevated payout admin
 *   role="agent"              → support/ops agent (read-heavy)
 *   role="customer"           → end-customer (lowest privilege)
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * DB-backed permissions catalog — one row per permission key.
 * Seeded/synced from the code catalog in permissions.ts.
 * Canonical name: `permissions`
 */
export const permissionsTable = pgTable("permissions", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  category: text("category").notNull(),
  isSuperAdminOnly: boolean("is_super_admin_only").notNull().default(false),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-role default permission states.
 * Seeded at IAM migration time from the ROLE_DEFAULT_PERMISSIONS catalog.
 * Canonical name: `role_permissions`
 *
 * Foreign keys:
 *   permission_key → permissions.key  (ON DELETE CASCADE — key deleted = row gone)
 *   updated_by_user_id → users.id     (ON DELETE SET NULL — actor deleted = null)
 */
export const rolePermissionsTable = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  permissionKey: text("permission_key").notNull().references(() => permissionsTable.key, { onDelete: "cascade" }),
  isEnabled: boolean("is_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
});

/**
 * Per-user explicit overrides on top of the role template.
 * effect = 'ALLOW' → force-grant; 'DENY' → force-revoke.
 * Canonical name: `user_permissions`
 *
 * Foreign keys:
 *   user_id          → users.id        (ON DELETE CASCADE — user deleted = overrides gone)
 *   permission_key   → permissions.key (ON DELETE CASCADE — key deleted = override gone)
 *   updated_by_user_id → users.id      (ON DELETE SET NULL — actor deleted = null)
 */
export const userPermissionsTable = pgTable("user_permissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  permissionKey: text("permission_key").notNull().references(() => permissionsTable.key, { onDelete: "cascade" }),
  effect: text("effect").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
});

/**
 * Singleton-ish record written once when the IAM migration is first executed.
 * cutoffAt is the UTC timestamp marking when the migration ran.
 * Its presence is the signal that IAM enforcement is active.
 *
 * Foreign key:
 *   executed_by_user_id → users.id (ON DELETE SET NULL — actor deleted = null)
 */
export const iamMigrationLogTable = pgTable("iam_migration_log", {
  id: serial("id").primaryKey(),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
  executedByUserId: integer("executed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  totalUsers: integer("total_users").notNull().default(0),
  snapshotJson: jsonb("snapshot_json"),
});

export type Permission = typeof permissionsTable.$inferSelect;
export type RolePermission = typeof rolePermissionsTable.$inferSelect;
export type UserPermission = typeof userPermissionsTable.$inferSelect;
export type IamMigrationLog = typeof iamMigrationLogTable.$inferSelect;

// Backward-compat aliases for any code that still references old names
export const rolePermissionTemplatesTable = rolePermissionsTable;
export const userPermissionOverridesTable = userPermissionsTable;
export type RolePermissionTemplate = RolePermission;
export type UserPermissionOverride = UserPermission;
