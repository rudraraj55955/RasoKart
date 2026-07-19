import { Router } from "express";
import { db, usersTable, iamMigrationLogTable, rolePermissionTemplatesTable, userPermissionOverridesTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { ALL_PERMISSION_KEYS, ROLE_DEFAULT_PERMISSIONS, SUPER_ADMIN_ONLY_PERMISSIONS } from "../permissions";
import { logger } from "../lib/logger";

const router = Router();

const KNOWN_ROLES = ["admin", "merchant", "payout_merchant", "payout_admin", "payout_super_admin", "agent"];

// ── GET /api/iam/permissions ────────────────────────────────────────────────
// List all permission keys in the catalog.
router.get("/permissions", requireAuth, requireAdmin, (_req, res) => {
  const keys = ALL_PERMISSION_KEYS.map((k) => ({
    key: k,
    isSuperAdminOnly: SUPER_ADMIN_ONLY_PERMISSIONS.has(k),
    category: k.split("_")[0],
  }));
  res.json({ permissions: keys, total: keys.length });
});

// ── GET /api/iam/migration/status ───────────────────────────────────────────
router.get("/migration/status", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [migRow] = await db
      .select()
      .from(iamMigrationLogTable)
      .orderBy(iamMigrationLogTable.executedAt)
      .limit(1);

    const [templateCount] = await db.select({ c: count() }).from(rolePermissionTemplatesTable);
    const [overrideCount] = await db.select({ c: count() }).from(userPermissionOverridesTable);

    res.json({
      migrated: !!migRow,
      migratedAt: migRow?.executedAt ?? null,
      cutoffAt: migRow?.cutoffAt ?? null,
      totalUsers: migRow?.totalUsers ?? 0,
      templateRows: Number(templateCount.c),
      overrideRows: Number(overrideCount.c),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/iam/migration/run ─────────────────────────────────────────────
// Seeds role_permission_templates from ROLE_DEFAULT_PERMISSIONS catalog.
// Idempotent — safe to run again if templates already exist.
router.post("/migration/run", requireAuth, requireAdmin, async (req, res, next) => {
  const user = (req as any).user;
  if (!user.isSuperAdmin) {
    res.status(403).json({ error: "Only Super Admin can run IAM migration" });
    return;
  }
  try {
    const [existingMig] = await db.select({ id: iamMigrationLogTable.id }).from(iamMigrationLogTable).limit(1);
    if (existingMig) {
      res.status(409).json({ error: "IAM migration already run. Use rollback first to re-run." });
      return;
    }

    const [userCountRow] = await db.select({ c: count() }).from(usersTable);
    const totalUsers = Number(userCountRow.c);

    for (const role of KNOWN_ROLES) {
      const defaults = ROLE_DEFAULT_PERMISSIONS[role] ?? {};
      for (const key of ALL_PERMISSION_KEYS) {
        const isEnabled = defaults[key] ?? false;
        await db
          .insert(rolePermissionTemplatesTable)
          .values({ role, permissionKey: key, isEnabled, updatedByUserId: user.id })
          .onConflictDoUpdate({
            target: [rolePermissionTemplatesTable.role, rolePermissionTemplatesTable.permissionKey],
            set: { isEnabled, updatedByUserId: user.id, updatedAt: new Date() },
          });
      }
    }

    const now = new Date();
    await db.insert(iamMigrationLogTable).values({
      cutoffAt: now,
      executedByUserId: user.id,
      totalUsers,
      snapshotJson: { roles: KNOWN_ROLES, permissionCount: ALL_PERMISSION_KEYS.length },
    });

    req.log.info({ executedBy: user.email, totalUsers }, "iam_migration_run");
    res.json({ ok: true, message: "IAM migration complete", totalUsers, templateRows: KNOWN_ROLES.length * ALL_PERMISSION_KEYS.length });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/iam/migration/rollback ────────────────────────────────────────
// Drops all role templates and per-user overrides, and removes the migration log.
router.post("/migration/rollback", requireAuth, requireAdmin, async (req, res, next) => {
  const user = (req as any).user;
  if (!user.isSuperAdmin) {
    res.status(403).json({ error: "Only Super Admin can roll back IAM migration" });
    return;
  }
  try {
    await db.delete(userPermissionOverridesTable);
    await db.delete(rolePermissionTemplatesTable);
    await db.delete(iamMigrationLogTable);
    req.log.info({ executedBy: user.email }, "iam_migration_rollback");
    res.json({ ok: true, message: "IAM migration rolled back. System is in legacy role-based mode." });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/iam/roles ──────────────────────────────────────────────────────
// Returns each role with its template permission map.
router.get("/roles", requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const templates = await db
      .select()
      .from(rolePermissionTemplatesTable)
      .orderBy(rolePermissionTemplatesTable.role, rolePermissionTemplatesTable.permissionKey);

    const byRole: Record<string, Record<string, boolean>> = {};
    for (const t of templates) {
      if (!byRole[t.role]) byRole[t.role] = {};
      byRole[t.role][t.permissionKey] = t.isEnabled;
    }

    res.json({
      roles: KNOWN_ROLES.map((r) => ({
        role: r,
        permissions: byRole[r] ?? ROLE_DEFAULT_PERMISSIONS[r] ?? {},
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/iam/roles/:role/:permissionKey ─────────────────────────────────
// Update a role template entry.
router.put("/roles/:role/:permissionKey", requireAuth, requireAdmin, async (req, res, next) => {
  const user = (req as any).user;
  if (!user.isSuperAdmin) {
    res.status(403).json({ error: "Only Super Admin can edit role templates" });
    return;
  }
  const { role, permissionKey } = req.params as { role: string; permissionKey: string };
  if (!KNOWN_ROLES.includes(role)) {
    res.status(400).json({ error: "Unknown role" });
    return;
  }
  if (!ALL_PERMISSION_KEYS.includes(permissionKey as any)) {
    res.status(400).json({ error: "Unknown permission key" });
    return;
  }
  const { isEnabled } = req.body as { isEnabled: boolean };
  if (typeof isEnabled !== "boolean") {
    res.status(400).json({ error: "isEnabled must be a boolean" });
    return;
  }
  try {
    await db
      .insert(rolePermissionTemplatesTable)
      .values({ role, permissionKey, isEnabled, updatedByUserId: user.id })
      .onConflictDoUpdate({
        target: [rolePermissionTemplatesTable.role, rolePermissionTemplatesTable.permissionKey],
        set: { isEnabled, updatedByUserId: user.id, updatedAt: new Date() },
      });
    req.log.info({ role, permissionKey, isEnabled, updatedBy: user.email }, "iam_role_template_updated");
    res.json({ ok: true, role, permissionKey, isEnabled });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/iam/users ──────────────────────────────────────────────────────
// List users with their role and override counts.
router.get("/users", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt((req.query["page"] as string) || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query["limit"] as string) || "50", 10)));
    const offset = (page - 1) * limit;

    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        role: usersTable.role,
        isSuperAdmin: usersTable.isSuperAdmin,
        isActive: usersTable.isActive,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .limit(limit)
      .offset(offset)
      .orderBy(usersTable.createdAt);

    const overrideCounts = await db
      .select({ userId: userPermissionOverridesTable.userId, c: count() })
      .from(userPermissionOverridesTable)
      .groupBy(userPermissionOverridesTable.userId);

    const overrideMap: Record<number, number> = {};
    for (const row of overrideCounts) overrideMap[row.userId] = Number(row.c);

    const [totalRow] = await db.select({ c: count() }).from(usersTable);

    res.json({
      users: users.map((u) => ({
        ...u,
        overrideCount: overrideMap[u.id] ?? 0,
        effectivePerm: u.isSuperAdmin ? "__all__" : u.role,
      })),
      total: Number(totalRow.c),
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/iam/users/:userId/permissions ──────────────────────────────────
// Get effective permissions for a specific user.
router.get("/users/:userId/permissions", requireAuth, requireAdmin, async (req, res, next) => {
  const userId = parseInt(req.params["userId"] as string, 10);
  if (!userId) { res.status(400).json({ error: "Invalid userId" }); return; }
  try {
    const [userRow] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role, isSuperAdmin: usersTable.isSuperAdmin, isActive: usersTable.isActive })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!userRow) { res.status(404).json({ error: "User not found" }); return; }

    if (userRow.isSuperAdmin) {
      res.json({ user: userRow, effectivePermissions: { __all__: true }, overrides: [], roleTemplate: {} });
      return;
    }

    const [migRow] = await db.select({ id: iamMigrationLogTable.id }).from(iamMigrationLogTable).limit(1);
    const migrated = !!migRow;

    const roleDefaults = migrated
      ? await db.select({ permissionKey: rolePermissionTemplatesTable.permissionKey, isEnabled: rolePermissionTemplatesTable.isEnabled })
          .from(rolePermissionTemplatesTable)
          .where(eq(rolePermissionTemplatesTable.role, userRow.role))
      : ALL_PERMISSION_KEYS.map((k) => ({ permissionKey: k, isEnabled: (ROLE_DEFAULT_PERMISSIONS[userRow.role] ?? {})[k] ?? false }));

    const overrides = await db
      .select()
      .from(userPermissionOverridesTable)
      .where(eq(userPermissionOverridesTable.userId, userId));

    const effective: Record<string, boolean> = {};
    for (const t of roleDefaults) effective[t.permissionKey] = t.isEnabled;
    for (const o of overrides) effective[o.permissionKey] = o.effect === "ALLOW";

    res.json({
      user: userRow,
      migrated,
      effectivePermissions: effective,
      overrides: overrides.map((o) => ({ permissionKey: o.permissionKey, effect: o.effect, updatedAt: o.updatedAt })),
      roleTemplate: Object.fromEntries(roleDefaults.map((r) => [r.permissionKey, r.isEnabled])),
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/iam/users/:userId/permissions/:permissionKey ───────────────────
// Set a per-user permission override.
router.put("/users/:userId/permissions/:permissionKey", requireAuth, requireAdmin, async (req, res, next) => {
  const callerUser = (req as any).user;
  if (!callerUser.isSuperAdmin) {
    res.status(403).json({ error: "Only Super Admin can set user permission overrides" });
    return;
  }

  const userId = parseInt(req.params["userId"] as string, 10);
  const { permissionKey } = req.params as { permissionKey: string };
  const { effect } = req.body as { effect: string };

  if (!userId) { res.status(400).json({ error: "Invalid userId" }); return; }
  if (!ALL_PERMISSION_KEYS.includes(permissionKey as any)) { res.status(400).json({ error: "Unknown permission key" }); return; }
  if (effect !== "ALLOW" && effect !== "DENY") { res.status(400).json({ error: "effect must be ALLOW or DENY" }); return; }

  try {
    const [targetUser] = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!targetUser) { res.status(404).json({ error: "User not found" }); return; }

    await db
      .insert(userPermissionOverridesTable)
      .values({ userId, permissionKey, effect, updatedByUserId: callerUser.id })
      .onConflictDoUpdate({
        target: [userPermissionOverridesTable.userId, userPermissionOverridesTable.permissionKey],
        set: { effect, updatedByUserId: callerUser.id, updatedAt: new Date() },
      });

    req.log.info({ targetUserId: userId, targetEmail: targetUser.email, permissionKey, effect, callerEmail: callerUser.email }, "iam_user_override_set");
    res.json({ ok: true, userId, permissionKey, effect });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/iam/users/:userId/permissions/:permissionKey ────────────────
// Remove a per-user permission override (reverts to role default).
router.delete("/users/:userId/permissions/:permissionKey", requireAuth, requireAdmin, async (req, res, next) => {
  const callerUser = (req as any).user;
  if (!callerUser.isSuperAdmin) {
    res.status(403).json({ error: "Only Super Admin can remove user permission overrides" });
    return;
  }

  const userId = parseInt(req.params["userId"] as string, 10);
  const { permissionKey } = req.params as { permissionKey: string };

  if (!userId) { res.status(400).json({ error: "Invalid userId" }); return; }

  try {
    await db
      .delete(userPermissionOverridesTable)
      .where(and(eq(userPermissionOverridesTable.userId, userId), eq(userPermissionOverridesTable.permissionKey, permissionKey)));

    req.log.info({ targetUserId: userId, permissionKey, callerEmail: callerUser.email }, "iam_user_override_removed");
    res.json({ ok: true, userId, permissionKey, removed: true });
  } catch (err) {
    next(err);
  }
});

export default router;
