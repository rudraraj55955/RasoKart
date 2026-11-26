/**
 * Pine Labs Admin Routes
 *
 * Routes:
 *   POST /api/admin/pinelabs/test-credentials — Probe UAT or live API with saved credentials
 *
 * Credentials are read from provider_integrations (providerKey = "pinelabs").
 * The environment field on the row determines which endpoint is probed:
 *   - "live" → api.pinepg.in (Pine Labs production)
 *   - anything else → uat.pinepg.in (Pine Labs UAT / sandbox)
 *
 * Decrypted in-process only; never returned or logged.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, providerIntegrationsTable } from "@workspace/db";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";
import { decryptSecret } from "../helpers/cryptoUtils";
import { verifyPineLabsUatCredentials } from "../helpers/pineLabsVerify";

const router = Router();
// Pine Labs credential test is strictly Super Admin-only.  requireSuperAdmin uses
// a direct isSuperAdmin flag check that cannot be bypassed via per-user IAM
// ALLOW overrides — unlike requirePermission, which evaluates the IAM resolver
// and can be escalated by a SA granting the key to a regular admin.
router.use(requireAuth, requireSuperAdmin);

/**
 * Translate the raw `environment` string stored in provider_integrations into
 * the strict "uat" | "live" discriminant that verifyPineLabsUatCredentials
 * expects.
 *
 * Exported so that unit tests can confirm the mapping without going through the
 * full HTTP/DB layer.
 *
 * Contract:
 *   - "live"             → "live"   (Pine Labs production endpoint)
 *   - anything else      → "uat"    (Pine Labs UAT endpoint, safe default)
 */
export function selectPineLabsEnv(
  rowEnvironment: string | null | undefined,
): "uat" | "live" {
  return rowEnvironment === "live" ? "live" : "uat";
}

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

    const env = selectPineLabsEnv(row.environment);
    const result = await verifyPineLabsUatCredentials(mid, accessCode, secretKey, env);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
