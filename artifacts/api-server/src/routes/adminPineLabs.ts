/**
 * Pine Labs Admin Routes
 *
 * Routes:
 *   POST /api/admin/pinelabs/test-credentials — Probe UAT API with saved credentials
 *
 * Credentials are read from provider_integrations (providerKey = "pinelabs").
 * Decrypted in-process only; never returned or logged.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, providerIntegrationsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { decryptSecret } from "../helpers/cryptoUtils";
import { verifyPineLabsUatCredentials } from "../helpers/pineLabsVerify";

const router = Router();
router.use(requireAuth, requireAdmin);

/**
 * POST /api/admin/pinelabs/test-credentials
 *
 * Reads the saved Pine Labs credentials from the DB, decrypts them, and
 * runs a lightweight inquiry probe against the Pine Labs Plural UAT API.
 *
 * Response shape:
 *   { pass: boolean; message: string; detail: string }
 *
 * Never returns 4xx/5xx for expected probe outcomes — all cases return HTTP
 * 200 with a pass/fail payload so the frontend can render inline feedback.
 */
router.post("/test-credentials", async (req, res, next) => {
  try {
    const [row] = await db
      .select()
      .from(providerIntegrationsTable)
      .where(eq(providerIntegrationsTable.providerKey, "pinelabs"))
      .limit(1);

    if (!row) {
      res.json({
        pass: false,
        message: "Pine Labs integration not found",
        detail: "No Pine Labs integration record exists. Restart the server to seed provider integrations.",
      });
      return;
    }

    const midResult        = row.clientIdEncrypted  ? decryptSecret(row.clientIdEncrypted)  : null;
    const accessCodeResult = row.apiKeyEncrypted     ? decryptSecret(row.apiKeyEncrypted)     : null;
    const secretKeyResult  = row.apiSecretEncrypted  ? decryptSecret(row.apiSecretEncrypted)  : null;

    const mid        = midResult?.ok        ? midResult.value        : "";
    const accessCode = accessCodeResult?.ok ? accessCodeResult.value : "";
    const secretKey  = secretKeyResult?.ok  ? secretKeyResult.value  : "";

    if (!mid || !accessCode || !secretKey) {
      const missing: string[] = [];
      if (!mid)        missing.push("Merchant ID");
      if (!accessCode) missing.push("Access Code");
      if (!secretKey)  missing.push("Secret Key");
      res.json({
        pass: false,
        message: `Missing credentials: ${missing.join(", ")}`,
        detail: `Save all three credentials before running the credential test (missing: ${missing.join(", ")}).`,
      });
      return;
    }

    const result = await verifyPineLabsUatCredentials(mid, accessCode, secretKey);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
