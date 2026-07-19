import { Router } from "express";
import { db, usersTable, iamMigrationLogTable, rolePermissionsTable, userPermissionsTable, permissionsTable, auditLogsTable } from "@workspace/db";
import { eq, and, count, desc, like } from "drizzle-orm";
import { requireAuth, requireAdmin, requirePermission } from "../middlewares/auth";
import { ALL_PERMISSION_KEYS, PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, SUPER_ADMIN_ONLY_PERMISSIONS } from "../permissions";

const router = Router();

const KNOWN_ROLES = ["admin", "merchant", "payout_merchant", "payout_admin", "payout_super_admin", "agent", "customer"];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function writeAuditLog(req: any, action: string, targetType: string, targetId: number | null, details: object) {
  const user = (req as any).user;
  try {
    await db.insert(auditLogsTable).values({
      adminId: user.id,
      adminEmail: user.email,
      action,
      targetType,
      targetId,
      details: JSON.stringify(details),
      ipAddress: (req as any).ip ?? null,
    });
  } catch {
    req.log.warn({ action, targetType, targetId }, "iam_audit_log_write_failed");
  }
}

// ── GET /api/iam/permissions ────────────────────────────────────────────────
// List all permission keys from DB catalog (falls back to code catalog if empty).
router.get(
  "/permissions",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_READ),
  async (_req, res, next) => {
    try {
      const dbRows = await db.select().from(permissionsTable).orderBy(permissionsTable.category, permissionsTable.key);
      if (dbRows.length > 0) {
        res.json({
          permissions: dbRows.map((r) => ({
            key: r.key,
            isSuperAdminOnly: r.isSuperAdminOnly,
            category: r.category,
            description: r.description ?? null,
          })),
          total: dbRows.length,
          source: "db",
        });
        return;
      }
      // Fallback to code catalog when DB catalog not yet seeded
      const keys = ALL_PERMISSION_KEYS.map((k) => ({
        key: k,
        isSuperAdminOnly: SUPER_ADMIN_ONLY_PERMISSIONS.has(k),
        category: k.split("_")[0],
        description: null,
      }));
      res.json({ permissions: keys, total: keys.length, source: "code" });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/iam/permissions/sync ──────────────────────────────────────────
// Upsert all permission keys from the code catalog into the DB permissions table.
router.post(
  "/permissions/sync",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_MANAGE),
  async (req, res, next) => {
    const user = (req as any).user;
    if (!user.isSuperAdmin) {
      res.status(403).json({ error: "Only Super Admin can sync the permissions catalog" });
      return;
    }
    try {
      let upserted = 0;
      for (const key of ALL_PERMISSION_KEYS) {
        const category = key.split("_")[0] ?? "unknown";
        const isSuperAdminOnly = SUPER_ADMIN_ONLY_PERMISSIONS.has(key);
        await db
          .insert(permissionsTable)
          .values({ key, category, isSuperAdminOnly, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: permissionsTable.key,
            set: { category, isSuperAdminOnly, updatedAt: new Date() },
          });
        upserted++;
      }
      await writeAuditLog(req, "iam_permissions_synced", "iam", null, {
        count: upserted,
        executedBy: user.email,
      });
      req.log.info({ count: upserted, executedBy: user.email }, "iam_permissions_catalog_synced");
      res.json({ ok: true, upserted });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/iam/migration/status ───────────────────────────────────────────
router.get(
  "/migration/status",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_READ),
  async (req, res, next) => {
    try {
      const [migRow] = await db
        .select()
        .from(iamMigrationLogTable)
        .orderBy(iamMigrationLogTable.executedAt)
        .limit(1);

      const [templateCount] = await db.select({ c: count() }).from(rolePermissionsTable);
      const [overrideCount] = await db.select({ c: count() }).from(userPermissionsTable);
      const [catalogCount] = await db.select({ c: count() }).from(permissionsTable);

      res.json({
        migrated: !!migRow,
        migratedAt: migRow?.executedAt ?? null,
        cutoffAt: migRow?.cutoffAt ?? null,
        totalUsers: migRow?.totalUsers ?? 0,
        templateRows: Number(templateCount.c),
        overrideRows: Number(overrideCount.c),
        catalogRows: Number(catalogCount.c),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/iam/migration/run ─────────────────────────────────────────────
router.post(
  "/migration/run",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_MANAGE),
  async (req, res, next) => {
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

      // 1. Sync permissions catalog into DB
      for (const key of ALL_PERMISSION_KEYS) {
        const category = key.split("_")[0] ?? "unknown";
        const isSuperAdminOnly = SUPER_ADMIN_ONLY_PERMISSIONS.has(key);
        await db
          .insert(permissionsTable)
          .values({ key, category, isSuperAdminOnly, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: permissionsTable.key,
            set: { category, isSuperAdminOnly, updatedAt: new Date() },
          });
      }

      // 2. Seed role_permissions from ROLE_DEFAULT_PERMISSIONS
      const [userCountRow] = await db.select({ c: count() }).from(usersTable);
      const totalUsers = Number(userCountRow.c);

      for (const role of KNOWN_ROLES) {
        const defaults = ROLE_DEFAULT_PERMISSIONS[role] ?? {};
        for (const key of ALL_PERMISSION_KEYS) {
          const isEnabled = defaults[key] ?? false;
          await db
            .insert(rolePermissionsTable)
            .values({ role, permissionKey: key, isEnabled, updatedByUserId: user.id })
            .onConflictDoUpdate({
              target: [rolePermissionsTable.role, rolePermissionsTable.permissionKey],
              set: { isEnabled, updatedByUserId: user.id, updatedAt: new Date() },
            });
        }
      }

      // 3. Backfill legacy permissionsJson overrides → user_permissions
      // Pre-cutoff users may have explicit per-key overrides stored in the legacy
      // users.permissions_json column. We diff each user's stored map against
      // their role default and create ALLOW/DENY overrides for any deviation,
      // preserving their exact effective access across the migration boundary.
      const allUsers = await db
        .select({
          id: usersTable.id,
          role: usersTable.role,
          isSuperAdmin: usersTable.isSuperAdmin,
          permissionsJson: usersTable.permissionsJson,
        })
        .from(usersTable);

      let backfilledUsers = 0;
      let backfilledOverrides = 0;
      for (const u of allUsers) {
        if (u.isSuperAdmin) continue; // SA bypasses permission checks entirely
        const legacyMap = u.permissionsJson as Record<string, boolean> | null;
        if (!legacyMap || typeof legacyMap !== "object") continue;
        const roleDefaults = ROLE_DEFAULT_PERMISSIONS[u.role] ?? {};
        let userHadOverride = false;
        for (const [key, legacyValue] of Object.entries(legacyMap)) {
          if (!ALL_PERMISSION_KEYS.includes(key as any)) continue;
          const roleDefault = roleDefaults[key] ?? false;
          if (legacyValue === roleDefault) continue; // no deviation — skip
          const effect = legacyValue ? "ALLOW" : "DENY";
          // Block backfilling SA-only permissions as ALLOW for non-SA users
          if (effect === "ALLOW" && SUPER_ADMIN_ONLY_PERMISSIONS.has(key)) continue;
          await db
            .insert(userPermissionsTable)
            .values({ userId: u.id, permissionKey: key, effect, updatedByUserId: user.id })
            .onConflictDoUpdate({
              target: [userPermissionsTable.userId, userPermissionsTable.permissionKey],
              set: { effect, updatedByUserId: user.id, updatedAt: new Date() },
            });
          backfilledOverrides++;
          userHadOverride = true;
        }
        if (userHadOverride) backfilledUsers++;
      }

      req.log.info({ backfilledUsers, backfilledOverrides }, "iam_migration_legacy_backfill_done");

      // 4. Write migration log (cutoffAt = now, so all users existing before this point are covered)
      const now = new Date();
      await db.insert(iamMigrationLogTable).values({
        cutoffAt: now,
        executedByUserId: user.id,
        totalUsers,
        snapshotJson: {
          roles: KNOWN_ROLES,
          permissionCount: ALL_PERMISSION_KEYS.length,
          catalogSynced: true,
          backfilledUsers,
          backfilledOverrides,
        },
      });

      await writeAuditLog(req, "iam_migration_run", "iam", null, {
        totalUsers,
        templateRows: KNOWN_ROLES.length * ALL_PERMISSION_KEYS.length,
        catalogRows: ALL_PERMISSION_KEYS.length,
        backfilledUsers,
        backfilledOverrides,
        executedBy: user.email,
        cutoffAt: now.toISOString(),
      });

      req.log.info({ executedBy: user.email, totalUsers, cutoffAt: now }, "iam_migration_run");
      res.json({
        ok: true,
        message: "IAM migration complete — catalog synced, role templates seeded, legacy overrides backfilled",
        totalUsers,
        templateRows: KNOWN_ROLES.length * ALL_PERMISSION_KEYS.length,
        catalogRows: ALL_PERMISSION_KEYS.length,
        backfilledUsers,
        backfilledOverrides,
        cutoffAt: now.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /api/iam/migration/rollback ────────────────────────────────────────
router.post(
  "/migration/rollback",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_MANAGE),
  async (req, res, next) => {
    const user = (req as any).user;
    if (!user.isSuperAdmin) {
      res.status(403).json({ error: "Only Super Admin can roll back IAM migration" });
      return;
    }
    try {
      const [existingMig] = await db.select({ id: iamMigrationLogTable.id }).from(iamMigrationLogTable).limit(1);
      if (!existingMig) {
        res.status(409).json({ error: "No IAM migration to roll back." });
        return;
      }

      // Capture snapshot before deletion for audit
      const [templateCount] = await db.select({ c: count() }).from(rolePermissionsTable);
      const [overrideCount] = await db.select({ c: count() }).from(userPermissionsTable);

      await db.delete(userPermissionsTable);
      await db.delete(rolePermissionsTable);
      await db.delete(iamMigrationLogTable);

      await writeAuditLog(req, "iam_migration_rollback", "iam", null, {
        executedBy: user.email,
        deletedTemplates: Number(templateCount.c),
        deletedOverrides: Number(overrideCount.c),
      });

      req.log.info({ executedBy: user.email }, "iam_migration_rollback");
      res.json({ ok: true, message: "IAM migration rolled back. System is in legacy role-based mode." });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/iam/roles ──────────────────────────────────────────────────────
router.get(
  "/roles",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_READ),
  async (_req, res, next) => {
    try {
      const templates = await db
        .select()
        .from(rolePermissionsTable)
        .orderBy(rolePermissionsTable.role, rolePermissionsTable.permissionKey);

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
  },
);

// ── PUT /api/iam/roles/:role/:permissionKey ─────────────────────────────────
router.put(
  "/roles/:role/:permissionKey",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_MANAGE),
  async (req, res, next) => {
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
        .insert(rolePermissionsTable)
        .values({ role, permissionKey, isEnabled, updatedByUserId: user.id })
        .onConflictDoUpdate({
          target: [rolePermissionsTable.role, rolePermissionsTable.permissionKey],
          set: { isEnabled, updatedByUserId: user.id, updatedAt: new Date() },
        });

      await writeAuditLog(req, "iam_role_template_updated", "iam_role_template", null, {
        role,
        permissionKey,
        isEnabled,
        updatedBy: user.email,
      });

      req.log.info({ role, permissionKey, isEnabled, updatedBy: user.email }, "iam_role_template_updated");
      res.json({ ok: true, role, permissionKey, isEnabled });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/iam/users ──────────────────────────────────────────────────────
router.get(
  "/users",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_READ),
  async (req, res, next) => {
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
        .select({ userId: userPermissionsTable.userId, c: count() })
        .from(userPermissionsTable)
        .groupBy(userPermissionsTable.userId);

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
  },
);

// ── GET /api/iam/users/:userId/permissions ──────────────────────────────────
router.get(
  "/users/:userId/permissions",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_READ),
  async (req, res, next) => {
    const userId = parseInt(req.params["userId"] as string, 10);
    if (!userId) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }
    try {
      const [userRow] = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          name: usersTable.name,
          role: usersTable.role,
          isSuperAdmin: usersTable.isSuperAdmin,
          isActive: usersTable.isActive,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!userRow) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (userRow.isSuperAdmin) {
        res.json({ user: userRow, effectivePermissions: { __all__: true }, overrides: [], roleTemplate: {} });
        return;
      }

      const [migRow] = await db.select({ id: iamMigrationLogTable.id }).from(iamMigrationLogTable).limit(1);
      const migrated = !!migRow;

      const roleDefaults = migrated
        ? await db
            .select({
              permissionKey: rolePermissionsTable.permissionKey,
              isEnabled: rolePermissionsTable.isEnabled,
            })
            .from(rolePermissionsTable)
            .where(eq(rolePermissionsTable.role, userRow.role))
        : ALL_PERMISSION_KEYS.map((k) => ({
            permissionKey: k,
            isEnabled: (ROLE_DEFAULT_PERMISSIONS[userRow.role] ?? {})[k] ?? false,
          }));

      const overrides = await db
        .select()
        .from(userPermissionsTable)
        .where(eq(userPermissionsTable.userId, userId));

      const effective: Record<string, boolean> = {};
      for (const t of roleDefaults) effective[t.permissionKey] = t.isEnabled;
      for (const o of overrides) effective[o.permissionKey] = o.effect === "ALLOW";

      res.json({
        user: userRow,
        migrated,
        effectivePermissions: effective,
        overrides: overrides.map((o) => ({
          permissionKey: o.permissionKey,
          effect: o.effect,
          updatedAt: o.updatedAt,
        })),
        roleTemplate: Object.fromEntries(roleDefaults.map((r) => [r.permissionKey, r.isEnabled])),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── PUT /api/iam/users/:userId/permissions/:permissionKey ───────────────────
router.put(
  "/users/:userId/permissions/:permissionKey",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_MANAGE),
  async (req, res, next) => {
    const callerUser = (req as any).user;
    if (!callerUser.isSuperAdmin) {
      res.status(403).json({ error: "Only Super Admin can set user permission overrides" });
      return;
    }

    const userId = parseInt(req.params["userId"] as string, 10);
    const { permissionKey } = req.params as { permissionKey: string };
    const { effect } = req.body as { effect: string };

    if (!userId) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }
    if (!ALL_PERMISSION_KEYS.includes(permissionKey as any)) {
      res.status(400).json({ error: "Unknown permission key" });
      return;
    }
    if (effect !== "ALLOW" && effect !== "DENY") {
      res.status(400).json({ error: "effect must be ALLOW or DENY" });
      return;
    }

    try {
      const [targetUser] = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          role: usersTable.role,
          isSuperAdmin: usersTable.isSuperAdmin,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!targetUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // ── Role max-scope guard ──────────────────────────────────────────────
      // Block ALLOW grants that escalate beyond the target user's role boundary.
      // Rule 1: SA-only permissions can never be ALLOWed for non-SA users.
      // Rule 2: Permissions outside the role's default-true set (i.e., the
      //         permission key maps to `false` in ROLE_DEFAULT_PERMISSIONS for
      //         that role) cannot be ALLOWed — that would be cross-role escalation.
      //         DENY overrides are always permitted (they can only reduce access).
      if (effect === "ALLOW" && !targetUser.isSuperAdmin) {
        if (SUPER_ADMIN_ONLY_PERMISSIONS.has(permissionKey)) {
          res.status(403).json({
            error: "Cannot grant a Super Admin-only permission to a non-Super-Admin user",
            permissionKey,
            hint: "Super Admin-only permissions are enforced at the system level and cannot be overridden per-user.",
          });
          return;
        }
        // Use === true (not just `in`) because every role's map has every key,
        // most set to false — a false entry means the role has no access to it.
        const targetRoleDefault = (ROLE_DEFAULT_PERMISSIONS[targetUser.role] ?? {})[permissionKey];
        if (targetRoleDefault !== true) {
          res.status(403).json({
            error: `Cannot ALLOW '${permissionKey}' for role '${targetUser.role}': it is outside that role's default access envelope. Escalating requires a role change, not a per-user override.`,
            permissionKey,
            targetRole: targetUser.role,
            hint: "Only permissions that are true by default for a role may be re-granted via override. Use DENY overrides to reduce access below role default.",
          });
          return;
        }
      }

      await db
        .insert(userPermissionsTable)
        .values({ userId, permissionKey, effect, updatedByUserId: callerUser.id })
        .onConflictDoUpdate({
          target: [userPermissionsTable.userId, userPermissionsTable.permissionKey],
          set: { effect, updatedByUserId: callerUser.id, updatedAt: new Date() },
        });

      await writeAuditLog(req, "iam_user_override_set", "user", userId, {
        targetEmail: targetUser.email,
        permissionKey,
        effect,
        callerEmail: callerUser.email,
      });

      req.log.info(
        { targetUserId: userId, targetEmail: targetUser.email, permissionKey, effect, callerEmail: callerUser.email },
        "iam_user_override_set",
      );
      res.json({ ok: true, userId, permissionKey, effect });
    } catch (err) {
      next(err);
    }
  },
);

// ── DELETE /api/iam/users/:userId/permissions/:permissionKey ────────────────
router.delete(
  "/users/:userId/permissions/:permissionKey",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_MANAGE),
  async (req, res, next) => {
    const callerUser = (req as any).user;
    if (!callerUser.isSuperAdmin) {
      res.status(403).json({ error: "Only Super Admin can remove user permission overrides" });
      return;
    }

    const userId = parseInt(req.params["userId"] as string, 10);
    const { permissionKey } = req.params as { permissionKey: string };

    if (!userId) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    try {
      await db
        .delete(userPermissionsTable)
        .where(
          and(
            eq(userPermissionsTable.userId, userId),
            eq(userPermissionsTable.permissionKey, permissionKey),
          ),
        );

      await writeAuditLog(req, "iam_user_override_removed", "user", userId, {
        permissionKey,
        callerEmail: callerUser.email,
      });

      req.log.info({ targetUserId: userId, permissionKey, callerEmail: callerUser.email }, "iam_user_override_removed");
      res.json({ ok: true, userId, permissionKey, removed: true });
    } catch (err) {
      next(err);
    }
  },
);

// ── PUT /api/iam/users/:userId/permissions ─────────────────────────────────
// Bulk override: apply multiple permission overrides in one request.
// Body: { overrides: Record<permissionKey, "ALLOW" | "DENY" | null> }
// null removes the override for that key. Super Admin only.
router.put(
  "/users/:userId/permissions/bulk",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_MANAGE),
  async (req, res, next) => {
    const callerUser = (req as any).user;
    if (!callerUser.isSuperAdmin) {
      res.status(403).json({ error: "Only Super Admin can bulk-set user permission overrides" });
      return;
    }

    const userId = parseInt(req.params["userId"] as string, 10);
    if (!userId) {
      res.status(400).json({ error: "Invalid userId" });
      return;
    }

    const { overrides } = req.body as { overrides?: Record<string, string | null> };
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      res.status(400).json({ error: "overrides must be an object mapping permissionKey → ALLOW | DENY | null" });
      return;
    }

    const entries = Object.entries(overrides);
    if (entries.length === 0) {
      res.status(400).json({ error: "overrides must contain at least one entry" });
      return;
    }

    // Validate all keys and effects up-front
    for (const [key, effect] of entries) {
      if (!ALL_PERMISSION_KEYS.includes(key as any)) {
        res.status(400).json({ error: `Unknown permission key: ${key}` });
        return;
      }
      if (effect !== "ALLOW" && effect !== "DENY" && effect !== null) {
        res.status(400).json({ error: `Invalid effect for '${key}': must be ALLOW, DENY, or null` });
        return;
      }
    }

    try {
      const [targetUser] = await db
        .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role, isSuperAdmin: usersTable.isSuperAdmin })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!targetUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Guard: SA-only and cross-role escalation checks (same rules as per-key endpoint)
      for (const [key, effect] of entries) {
        if (effect === "ALLOW" && !targetUser.isSuperAdmin) {
          if (SUPER_ADMIN_ONLY_PERMISSIONS.has(key)) {
            res.status(403).json({
              error: `Cannot grant SA-only permission '${key}' to a non-SA user`,
              permissionKey: key,
            });
            return;
          }
          const roleDefault = (ROLE_DEFAULT_PERMISSIONS[targetUser.role] ?? {})[key];
          if (roleDefault !== true) {
            res.status(403).json({
              error: `Cannot ALLOW '${key}' for role '${targetUser.role}': outside role's default access envelope`,
              permissionKey: key,
              targetRole: targetUser.role,
            });
            return;
          }
        }
      }

      // Apply overrides: upsert ALLOW/DENY, delete null
      const toUpsert = entries.filter(([, e]) => e !== null) as [string, string][];
      const toDelete = entries.filter(([, e]) => e === null).map(([k]) => k);

      for (const [key, effect] of toUpsert) {
        await db
          .insert(userPermissionsTable)
          .values({ userId, permissionKey: key, effect, updatedByUserId: callerUser.id })
          .onConflictDoUpdate({
            target: [userPermissionsTable.userId, userPermissionsTable.permissionKey],
            set: { effect, updatedByUserId: callerUser.id, updatedAt: new Date() },
          });
      }

      for (const key of toDelete) {
        await db
          .delete(userPermissionsTable)
          .where(and(eq(userPermissionsTable.userId, userId), eq(userPermissionsTable.permissionKey, key)));
      }

      await writeAuditLog(req, "iam_user_bulk_override", "user", userId, {
        targetEmail: targetUser.email,
        upserted: toUpsert.length,
        removed: toDelete.length,
        callerEmail: callerUser.email,
      });

      req.log.info(
        { targetUserId: userId, targetEmail: targetUser.email, upserted: toUpsert.length, removed: toDelete.length },
        "iam_user_bulk_override",
      );
      res.json({
        ok: true,
        userId,
        applied: toUpsert.length,
        removed: toDelete.length,
        upserted: Object.fromEntries(toUpsert),
        deletedKeys: toDelete,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /api/iam/audit ──────────────────────────────────────────────────────
router.get(
  "/audit",
  requireAuth,
  requireAdmin,
  requirePermission(PERMISSIONS.IAM_READ),
  async (req, res, next) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt((req.query["limit"] as string) || "50", 10)));
      const page = Math.max(1, parseInt((req.query["page"] as string) || "1", 10));
      const offset = (page - 1) * limit;

      const rows = await db
        .select()
        .from(auditLogsTable)
        .where(like(auditLogsTable.action, "iam_%"))
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit)
        .offset(offset);

      const [totalRow] = await db
        .select({ c: count() })
        .from(auditLogsTable)
        .where(like(auditLogsTable.action, "iam_%"));

      res.json({
        entries: rows.map((r) => ({
          id: r.id,
          adminEmail: r.adminEmail,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          details: r.details ? JSON.parse(r.details) : null,
          createdAt: r.createdAt,
        })),
        page,
        limit,
        total: Number(totalRow.c),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
