/**
 * Admin Payout Settings — /api/admin/payout-settings/*
 *
 * Global auto-payout approval configuration stored in system_config.
 */
import { Router } from "express";
import { db, systemConfigTable, auditLogsTable, SYSTEM_CONFIG_KEYS, SYSTEM_CONFIG_DEFAULTS } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router = Router();
router.use(requireAuth, requireAdmin);

const AUTO_PAYOUT_KEYS = [
  SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_ENABLED,
  SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_PAUSED,
  SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MAX_SINGLE_AMOUNT,
  SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_DAILY_LIMIT,
  SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MONTHLY_LIMIT,
  SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_ALLOWED_MODES,
  SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MIN_WALLET_BALANCE,
] as const;

function readCfg(cfg: Map<string, string>) {
  const raw = {
    globalEnabled: cfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_ENABLED) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_ENABLED],
    globalPaused: cfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_PAUSED) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_PAUSED],
    defaultMaxSingleAmount: cfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MAX_SINGLE_AMOUNT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MAX_SINGLE_AMOUNT],
    defaultDailyLimit: cfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_DAILY_LIMIT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_DAILY_LIMIT],
    defaultMonthlyLimit: cfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MONTHLY_LIMIT) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MONTHLY_LIMIT],
    defaultAllowedModes: cfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_ALLOWED_MODES) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_ALLOWED_MODES],
    defaultMinWalletBalance: cfg.get(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MIN_WALLET_BALANCE) ?? SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MIN_WALLET_BALANCE],
  };
  let allowedModes: string[] = ["IMPS", "NEFT", "RTGS", "UPI"];
  try { allowedModes = JSON.parse(raw.defaultAllowedModes); } catch { /* keep default */ }
  return {
    globalEnabled: raw.globalEnabled === "true",
    globalPaused: raw.globalPaused === "true",
    defaultMaxSingleAmount: Number(raw.defaultMaxSingleAmount),
    defaultDailyLimit: Number(raw.defaultDailyLimit),
    defaultMonthlyLimit: Number(raw.defaultMonthlyLimit),
    defaultAllowedModes: allowedModes,
    defaultMinWalletBalance: Number(raw.defaultMinWalletBalance),
  };
}

// GET /api/admin/payout-settings/auto-payout
router.get("/auto-payout", async (req, res, next) => {
  try {
    const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, AUTO_PAYOUT_KEYS as unknown as string[]));
    const cfg = new Map(rows.map(r => [r.key, r.value]));
    res.json(readCfg(cfg));
  } catch (err) { next(err); }
});

// PATCH /api/admin/payout-settings/auto-payout
router.patch("/auto-payout", async (req, res, next) => {
  try {
    const admin = (req as any).user;
    const {
      globalEnabled,
      globalPaused,
      defaultMaxSingleAmount,
      defaultDailyLimit,
      defaultMonthlyLimit,
      defaultAllowedModes,
      defaultMinWalletBalance,
    } = req.body as Record<string, unknown>;

    const updates: Array<{ key: string; value: string }> = [];

    if (globalEnabled !== undefined) updates.push({ key: SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_ENABLED, value: globalEnabled ? "true" : "false" });
    if (globalPaused !== undefined) updates.push({ key: SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_PAUSED, value: globalPaused ? "true" : "false" });
    if (defaultMaxSingleAmount !== undefined) updates.push({ key: SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MAX_SINGLE_AMOUNT, value: String(Number(defaultMaxSingleAmount)) });
    if (defaultDailyLimit !== undefined) updates.push({ key: SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_DAILY_LIMIT, value: String(Number(defaultDailyLimit)) });
    if (defaultMonthlyLimit !== undefined) updates.push({ key: SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MONTHLY_LIMIT, value: String(Number(defaultMonthlyLimit)) });
    if (defaultMinWalletBalance !== undefined) updates.push({ key: SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_MIN_WALLET_BALANCE, value: String(Number(defaultMinWalletBalance)) });
    if (defaultAllowedModes !== undefined && Array.isArray(defaultAllowedModes)) {
      const valid = (defaultAllowedModes as string[]).filter(m => ["IMPS", "NEFT", "RTGS", "UPI"].includes(m));
      updates.push({ key: SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_DEFAULT_ALLOWED_MODES, value: JSON.stringify(valid) });
    }

    if (updates.length === 0) { res.status(400).json({ error: "No valid fields provided" }); return; }

    for (const u of updates) {
      await db
        .insert(systemConfigTable)
        .values({ key: u.key, value: u.value, updatedByEmail: admin.email })
        .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: u.value, updatedByEmail: admin.email } });
    }

    const changedKeys = updates.map(u => u.key);
    const isToggle = changedKeys.includes(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_ENABLED) || changedKeys.includes(SYSTEM_CONFIG_KEYS.AUTO_PAYOUT_GLOBAL_PAUSED);
    const action = isToggle
      ? (globalEnabled ? "GLOBAL_AUTO_PAYOUT_ENABLED" : globalPaused ? "GLOBAL_AUTO_PAYOUT_PAUSED" : "GLOBAL_AUTO_PAYOUT_DISABLED")
      : "GLOBAL_AUTO_PAYOUT_LIMIT_UPDATED";

    await db.insert(auditLogsTable).values({
      adminId: admin.id,
      adminEmail: admin.email,
      action,
      targetType: "system_config",
      targetId: 0,
      details: JSON.stringify({ changes: updates }),
      ipAddress: (req as any).ip ?? null,
    } as any).catch(() => {});

    req.log.info({ adminId: admin.id, changes: changedKeys }, "global_auto_payout_settings_updated");

    const rows = await db.select().from(systemConfigTable).where(inArray(systemConfigTable.key, AUTO_PAYOUT_KEYS as unknown as string[]));
    const cfg = new Map(rows.map(r => [r.key, r.value]));
    res.json(readCfg(cfg));
  } catch (err) { next(err); }
});

// ── Self-registration toggle ──────────────────────────────────────────────
const SELF_REG_KEY = "payout_merchant_self_registration_enabled";

// GET /api/admin/payout-settings/self-registration
router.get("/self-registration", async (req, res, next) => {
  try {
    const [row] = await db.select({ value: systemConfigTable.value }).from(systemConfigTable)
      .where(eq(systemConfigTable.key, SELF_REG_KEY)).limit(1);
    const enabled = row ? row.value !== "false" : true;
    res.json({ enabled });
  } catch (err) { next(err); }
});

// PUT /api/admin/payout-settings/self-registration
router.put("/self-registration", async (req, res, next) => {
  try {
    const admin = (req as any).user;
    const { enabled } = req.body as { enabled: unknown };
    if (typeof enabled !== "boolean") { res.status(422).json({ error: "enabled must be boolean" }); return; }
    await db.insert(systemConfigTable)
      .values({ key: SELF_REG_KEY, value: enabled ? "true" : "false", updatedByEmail: admin.email })
      .onConflictDoUpdate({ target: systemConfigTable.key, set: { value: enabled ? "true" : "false", updatedByEmail: admin.email } });
    await db.insert(auditLogsTable).values({
      adminId: admin.id,
      adminEmail: admin.email,
      action: enabled ? "payout_self_registration_enabled" : "payout_self_registration_disabled",
      targetType: "system_config",
      targetId: 0,
      details: JSON.stringify({ enabled }),
    } as any).catch(() => {});
    req.log.info({ adminId: admin.id, enabled }, "payout_self_registration_toggle_updated");
    res.json({ ok: true, enabled });
  } catch (err) { next(err); }
});

export default router;
