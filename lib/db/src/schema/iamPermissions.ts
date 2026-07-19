import { pgTable, text, serial, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";

/**
 * Per-role default permission states.
 * Seeded at IAM migration time from the ROLE_DEFAULT_PERMISSIONS catalog.
 */
export const rolePermissionTemplatesTable = pgTable("role_permission_templates", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  permissionKey: text("permission_key").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id"),
});

/**
 * Per-user explicit overrides on top of the role template.
 * effect = 'ALLOW' → force-grant; 'DENY' → force-revoke.
 */
export const userPermissionOverridesTable = pgTable("user_permission_overrides", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  permissionKey: text("permission_key").notNull(),
  effect: text("effect").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: integer("updated_by_user_id"),
});

/**
 * Singleton-ish record written once when the IAM migration is first executed.
 * cutoffAt is the UTC timestamp marking when the migration ran.
 * If this table has no rows, IAM migration has not been run and permission
 * enforcement is in soft/pass-through mode (backward compat).
 */
export const iamMigrationLogTable = pgTable("iam_migration_log", {
  id: serial("id").primaryKey(),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
  executedByUserId: integer("executed_by_user_id"),
  totalUsers: integer("total_users").notNull().default(0),
  snapshotJson: jsonb("snapshot_json"),
});

export type RolePermissionTemplate = typeof rolePermissionTemplatesTable.$inferSelect;
export type UserPermissionOverride = typeof userPermissionOverridesTable.$inferSelect;
export type IamMigrationLog = typeof iamMigrationLogTable.$inferSelect;
