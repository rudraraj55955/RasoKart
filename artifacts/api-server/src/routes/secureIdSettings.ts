import { Router } from "express";
import { db, secureIdSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, requireSuperAdmin } from "../middlewares/auth";
import { encryptValue, safeDecrypt } from "../helpers/encryptionHelper";

const router = Router();
router.use(requireAuth, requireAdmin);

const MASKED = "••••••••••••••••";

function safeRow(row: any) {
  return {
    id: row.id,
    mode: row.mode,
    clientIdSet: !!row.clientIdEncrypted,
    clientSecretSet: !!row.clientSecretEncrypted,
    apiVersion: row.apiVersion,
    onboardingEnabled: row.onboardingEnabled,
    panEnabled: row.panEnabled,
    gstEnabled: row.gstEnabled,
    cinEnabled: row.cinEnabled,
    bankEnabled: row.bankEnabled,
    ocrEnabled: row.ocrEnabled,
    updatedByEmail: row.updatedByEmail,
    updatedAt: row.updatedAt,
  };
}

const DEFAULT_ROW = {
  id: 1, mode: "test", clientIdEncrypted: null, clientSecretEncrypted: null,
  apiVersion: "2023-08-01", onboardingEnabled: false, panEnabled: true,
  gstEnabled: true, cinEnabled: false, bankEnabled: true, ocrEnabled: false,
  updatedByEmail: null, updatedAt: null,
};

// GET /api/admin/secure-id-settings
router.get("/", async (req, res, next) => {
  try {
    const [row] = await db.select().from(secureIdSettingsTable).where(eq(secureIdSettingsTable.id, 1)).limit(1);
    res.json(safeRow(row ?? DEFAULT_ROW));
  } catch (err) { next(err); }
});

// PUT /api/admin/secure-id-settings (super admin only)
router.put("/", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const { mode, clientId, clientSecret, apiVersion, onboardingEnabled, panEnabled, gstEnabled, cinEnabled, bankEnabled, ocrEnabled } = req.body as Record<string, unknown>;
    const [existing] = await db.select().from(secureIdSettingsTable).where(eq(secureIdSettingsTable.id, 1)).limit(1);

    const update: Record<string, unknown> = { updatedByEmail: user.email };
    if (mode !== undefined) update["mode"] = String(mode);
    if (apiVersion !== undefined) update["apiVersion"] = String(apiVersion);
    if (onboardingEnabled !== undefined) update["onboardingEnabled"] = Boolean(onboardingEnabled);
    if (panEnabled !== undefined) update["panEnabled"] = Boolean(panEnabled);
    if (gstEnabled !== undefined) update["gstEnabled"] = Boolean(gstEnabled);
    if (cinEnabled !== undefined) update["cinEnabled"] = Boolean(cinEnabled);
    if (bankEnabled !== undefined) update["bankEnabled"] = Boolean(bankEnabled);
    if (ocrEnabled !== undefined) update["ocrEnabled"] = Boolean(ocrEnabled);

    if (clientId && typeof clientId === "string" && clientId !== MASKED) {
      const enc = encryptValue(clientId.trim());
      update["clientIdEncrypted"] = enc.encrypted;
      update["clientIdIv"] = enc.iv;
      update["clientIdTag"] = enc.tag;
    }
    if (clientSecret && typeof clientSecret === "string" && clientSecret !== MASKED) {
      const enc = encryptValue(clientSecret.trim());
      update["clientSecretEncrypted"] = enc.encrypted;
      update["clientSecretIv"] = enc.iv;
      update["clientSecretTag"] = enc.tag;
    }

    let row: any;
    if (existing) {
      [row] = await db.update(secureIdSettingsTable).set(update as any).where(eq(secureIdSettingsTable.id, 1)).returning();
    } else {
      [row] = await db.insert(secureIdSettingsTable).values({ id: 1, ...update } as any).returning();
    }
    req.log.info({ mode: row.mode, updatedBy: user.email }, "secure_id_settings_updated");
    res.json(safeRow(row));
  } catch (err) { next(err); }
});

// POST /api/admin/secure-id-settings/test — verify credentials work
router.post("/test", requireSuperAdmin, async (req, res, next) => {
  try {
    const [row] = await db.select().from(secureIdSettingsTable).where(eq(secureIdSettingsTable.id, 1)).limit(1);
    if (!row) { res.status(400).json({ error: "No settings configured" }); return; }
    const clientId = safeDecrypt(row.clientIdEncrypted, row.clientIdIv, row.clientIdTag);
    const clientSecret = safeDecrypt(row.clientSecretEncrypted, row.clientSecretIv, row.clientSecretTag);
    if (!clientId || !clientSecret) { res.status(400).json({ error: "Credentials not configured" }); return; }

    const base = row.mode === "live" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";
    const resp = await fetch(`${base}/verification/v1/secure-id/data-availability`, {
      method: "POST",
      headers: { "x-client-id": clientId, "x-client-secret": clientSecret, "x-api-version": row.apiVersion, "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: "9999999999" }),
      signal: AbortSignal.timeout(8000),
    });
    const ok = resp.status !== 401 && resp.status !== 403;
    req.log.info({ status: resp.status, mode: row.mode }, "secure_id_credential_test");
    res.json({ ok, httpStatus: resp.status, message: ok ? "Credentials accepted by provider" : "Provider rejected credentials — check Client ID and Client Secret" });
  } catch (err: any) {
    res.json({ ok: false, message: "Connection failed — check network or provider URL", detail: err?.message });
  }
});

export default router;
