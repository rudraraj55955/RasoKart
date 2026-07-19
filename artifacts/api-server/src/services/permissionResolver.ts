/**
 * IAM Permission Resolver — dedicated service module.
 *
 * Centralises all permission resolution logic:
 *   - Super Admin short-circuit (isSuperAdmin=true → {__all__: true})
 *   - Missing migration log (no iam_migration_log row → null → fail-CLOSED)
 *   - Normal path: role template + user overrides → flat boolean map
 *
 * The seed auto-activates IAM on every fresh startup, so null is a transient
 * error state only (e.g. seed failed). checkPermission() treats null as DENY.
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
    // IAM migration hasn't run yet — soft-pass so existing routes still work
    result = null;
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
  // null = migration log missing (seed failed or schema not ready).
  // Fail-CLOSED: deny access rather than allow. The seed auto-activates
  // IAM on startup so null is a transient/error state, not a normal mode.
  if (perms === null) return false;
  if ("__all__" in perms) return true; // Super Admin

  const keyList = Array.isArray(keys) ? keys : [keys];
  if (mode === "AND") {
    return keyList.every((k) => perms[k] === true);
  }
  return keyList.some((k) => perms[k] === true);
}
