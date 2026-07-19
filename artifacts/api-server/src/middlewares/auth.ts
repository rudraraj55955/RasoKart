import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db, usersTable, iamMigrationLogTable, rolePermissionsTable, userPermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.SESSION_SECRET || "rasokart-secret-key-change-in-production";

export interface AuthPayload {
  userId: number;
  role: string;
  iat?: number;
  exp?: number;
}

export function generateToken(payload: { userId: number; role: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
    if (!user || !user.isActive) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.passwordUpdatedAt && payload.iat != null && payload.iat * 1000 < user.passwordUpdatedAt.getTime()) {
      res.status(401).json({ error: "Session expired. Please log in again." });
      return;
    }
    (req as any).user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/**
 * Role gate + IAM RBAC wrapper.
 *
 * Pre-migration (IAM not yet run): role check only — same as before.
 * Post-migration: also verifies at minimum `admin_dashboard` permission so that
 * per-user IAM overrides actually govern portal access.  Super Admin (isSuperAdmin)
 * always bypasses both checks.  This makes requireAdmin a true RBAC wrapper —
 * every route using it gets permission enforcement without per-route changes.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || (user.role !== "admin" && !user.isSuperAdmin)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (user.isSuperAdmin) { next(); return; }
  try {
    const perms = await resolveUserPermissions(user);
    if (perms === null) { next(); return; } // pre-migration: soft-pass
    if ("__all__" in perms) { next(); return; } // SA marker
    if (perms["admin_dashboard"] === true) { next(); return; }
    res.status(403).json({ error: "Forbidden", permissionRequired: "admin_dashboard" });
  } catch (err) {
    // Fail-CLOSED: a resolver failure must never silently grant access.
    // Return 503 so the caller knows this is a transient infrastructure
    // error rather than a permanent denial.
    const reqWithLog = req as any;
    (reqWithLog.log ?? console).error({ err }, "requireAdmin_resolver_error");
    res.status(503).json({ error: "Permission resolver unavailable — try again shortly" });
  }
}

/** Super Admin is an admin with the isSuperAdmin flag set — a strict superset of requireAdmin. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== "admin" || !user.isSuperAdmin) {
    res.status(403).json({ error: "Only Super Admin can update company settings" });
    return;
  }
  next();
}

/**
 * Payout Admin or Payout Super Admin — can manage payout operations.
 * Post-migration: also verifies `payout_admin_dashboard` permission.
 */
export async function requirePayoutAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || (user.role !== "payout_admin" && user.role !== "payout_super_admin" && user.role !== "admin")) {
    res.status(403).json({ error: "Payout Admin access required" });
    return;
  }
  if (user.isSuperAdmin) { next(); return; }
  try {
    const perms = await resolveUserPermissions(user);
    if (perms === null) { next(); return; }
    if ("__all__" in perms) { next(); return; }
    if (perms["payout_admin_dashboard"] === true) { next(); return; }
    res.status(403).json({ error: "Payout Admin access required", permissionRequired: "payout_admin_dashboard" });
  } catch (err) {
    const reqWithLog = req as any;
    (reqWithLog.log ?? console).error({ err }, "requirePayoutAdmin_resolver_error");
    res.status(503).json({ error: "Permission resolver unavailable — try again shortly" });
  }
}

/** Payout Super Admin only — has broader payout admin powers (e.g. provider config if granted). */
export function requirePayoutSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || (user.role !== "payout_super_admin" && user.role !== "admin")) {
    res.status(403).json({ error: "Payout Super Admin access required" });
    return;
  }
  next();
}

/** Agent — can only see their own merchants and commission data. */
export function requireAgent(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== "agent") {
    res.status(403).json({ error: "Agent access required" });
    return;
  }
  next();
}

/** Payout Merchant — a merchant that uses payout-only services. */
export function requirePayoutMerchant(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user || user.role !== "payout_merchant") {
    res.status(403).json({ error: "Payout Merchant access required" });
    return;
  }
  next();
}

/**
 * Admin OR Payout Admin — for routes accessible to both main admins and payout admins.
 * Payout admins should only see payout-related data (enforced by route logic, not this middleware).
 */
export function requireAnyAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  const adminRoles = ["admin", "payout_admin", "payout_super_admin"];
  if (!user || !adminRoles.includes(user.role)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// ── IAM permission resolver ─────────────────────────────────────────────────

/**
 * Resolves the effective permission map for a user.
 * - Super Admin (isSuperAdmin=true): returns { __all__: true }
 * - Before migration runs: returns null (soft/pass-through enforcement)
 * - After migration: role template + user overrides → flat boolean map
 */
export async function resolveUserPermissions(
  user: { id: number; role: string; isSuperAdmin: boolean },
): Promise<Record<string, boolean> | { __all__: true } | null> {
  if (user.isSuperAdmin) return { __all__: true };

  const [migRow] = await db.select({ id: iamMigrationLogTable.id }).from(iamMigrationLogTable).limit(1);
  if (!migRow) return null;

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

  return perms;
}

/**
 * Combined middleware factory: role-gate (requireAdmin) + IAM permission check
 * in one call.  Preferred pattern for new routes — replaces the old two-step
 * `router.use(requireAdmin); router.use(requirePermission(key))` pattern.
 *
 * Usage:
 *   router.use(requireAuth, ...requireAdminPermission(PERMISSIONS.ADMIN_MERCHANTS));
 */
export function requireAdminPermission(permissionKey: string): Array<(req: Request, res: Response, next: NextFunction) => void | Promise<void>> {
  return [requireAdmin, requirePermission(permissionKey)];
}

/**
 * Middleware factory: check that the authenticated user has a specific
 * permission key. Super Admin always passes. Before IAM migration, always
 * passes (soft/backward-compat). After migration, enforces the permission.
 */
export function requirePermission(permissionKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (user.isSuperAdmin) { next(); return; }

    try {
      const perms = await resolveUserPermissions(user);
      if (perms === null) { next(); return; }
      if ("__all__" in perms) { next(); return; }
      if (perms[permissionKey] === true) { next(); return; }
      res.status(403).json({ error: "Permission denied", permissionRequired: permissionKey });
    } catch {
      res.status(403).json({ error: "Permission check failed" });
    }
  };
}
