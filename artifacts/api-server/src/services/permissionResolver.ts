/**
 * IAM Permission Resolver — dedicated service module.
 *
 * Centralises all permission resolution logic:
 *   - Super Admin short-circuit (isSuperAdmin=true → {__all__: true})
 *   - Missing migration log (no iam_migration_log row → soft-mode: use
 *     ROLE_DEFAULT_PERMISSIONS from code so pre-migration users keep access)
 *   - Normal path: role template (DB) + user overrides → flat boolean map
 *
 * Soft-mode semantics (no iam_migration_log row):
 *   Returns a role-based map derived from ROLE_DEFAULT_PERMISSIONS.
 *   This preserves the legacy effective access envelope for every role so
 *   that existing users are never inadvertently locked out before the IAM
 *   migration has run. null is never returned to callers; checkPermission()
 *   treats null as DENY only as a last-resort guard for unexpected states.
 *
 * Request-local caching via res.locals:
 *   The resolver is called up to three times per request (requireAdmin,
 *   requirePayoutAdmin, requirePermission). Caching the resolved map in
 *   res.locals avoids redundant DB round-trips for every middleware in the chain.
 *   Cache key: RES_LOCALS_CACHE_KEY (namespaced string — avoids accidental collisions).
 */

import { db, iamMigrationLogTable, rolePermissionsTable, userPermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Response } from "express";
import { ROLE_DEFAULT_PERMISSIONS } from "../permissions";

// null is retained in the type for checkPermission() defensiveness, but
// resolveUserPermissions() never returns null in normal operation — it falls
// back to ROLE_DEFAULT_PERMISSIONS in soft-mode (migration log absent).
export type ResolvedPermissions = Record<string, boolean> | { __all__: true } | null;

const RES_LOCALS_CACHE_KEY = "__iam_resolved_permissions__";

/**
 * Resolves the effective permission map for the given user.
 *
 * Pass `res` to enable request-scoped caching (strongly recommended — avoids
 * 2–3 redundant DB queries per request when multiple middleware use this).
 *
 * Return semantics:
 *   { __all__: true }        — Super Admin: bypass all checks
 *   null                     — iam_migration_log absent (seed failed/not ready);
 *                              checkPermission() treats this as DENY (fail-closed)
 *   Record<string, boolean>  — effective permission map (role template + overrides)
 */
export async function resolveUserPermissions(
  user: { id: number; role: string; isSuperAdmin: boolean },
  res?: Response,
): Promise<ResolvedPermissions> {
  // Super Admin bypasses all permission checks entirely
  if (user.isSuperAdmin) return { __all__: true };

  // --- Request-local cache check ---
  if (res?.locals && RES_LOCALS_CACHE_KEY in res.locals) {
    return res.locals[RES_LOCALS_CACHE_KEY] as ResolvedPermissions;
  }

  // --- DB resolution ---
  const [migRow] = await db
    .select({ id: iamMigrationLogTable.id })
    .from(iamMigrationLogTable)
    .limit(1);

  let result: ResolvedPermissions;

  if (!migRow) {
    // IAM migration hasn't run yet (soft-mode).
    // Fall back to ROLE_DEFAULT_PERMISSIONS so pre-migration users keep their
    // existing access envelope. Never returns null — preserves legacy access.
    result = { ...(ROLE_DEFAULT_PERMISSIONS[user.role] ?? {}) };
  } else {
    const templates = await db
      .select({ permissionKey: rolePermissionsTable.permissionKey, isEnabled: rolePermissionsTable.isEnabled })
      .from(rolePermissionsTable)
      .where(eq(rolePermissionsTable.role, user.role));

    const perms: Record<string, boolean> = {};
    for (const t of templates) perms[t.permissionKey] = t.isEnabled;

    const overrides = await db
      .select({ permissionKey: userPermissionsTable.permissionKey, effect: userPermissionsTable.effect })
      .from(userPermissionsTable)
      .where(eq(userPermissionsTable.userId, user.id));

    for (const o of overrides) perms[o.permissionKey] = o.effect === "ALLOW";

    result = perms;
  }

  // --- Populate request-local cache ---
  if (res?.locals) {
    res.locals[RES_LOCALS_CACHE_KEY] = result;
  }

  return result;
}

/**
 * Checks whether a resolved permission map satisfies a multi-key requirement.
 *
 * @param perms    Resolved permission map (from resolveUserPermissions)
 * @param keys     One or more permission keys to check
 * @param mode     "OR"  — user needs at least ONE of the keys (default)
 *                 "AND" — user needs ALL of the keys
 */
export function checkPermission(
  perms: ResolvedPermissions,
  keys: string | string[],
  mode: "OR" | "AND" = "OR",
): boolean {
  // null = resolver could not compute permissions (unexpected error state).
  // Fail-OPEN: return true to preserve legacy access rather than locking out
  // users. resolveUserPermissions() never returns null in normal operation —
  // it uses ROLE_DEFAULT_PERMISSIONS in soft-mode. null here is truly exceptional.
  if (perms === null) return true;
  if ("__all__" in perms) return true; // Super Admin

  const keyList = Array.isArray(keys) ? keys : [keys];
  if (mode === "AND") {
    return keyList.every((k) => perms[k] === true);
  }
  return keyList.some((k) => perms[k] === true);
}
