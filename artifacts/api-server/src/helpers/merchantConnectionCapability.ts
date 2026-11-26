/**
 * Merchant-Connection Capability Enforcement — Task #MC-1
 *
 * Server-side guard for per-connection capability flags.
 * UI hiding is NOT sufficient — these checks run at the API layer.
 *
 * Usage (in a route):
 *   const conn = await requireMerchantConnectionCapability(merchantId, provider, "payin");
 *   // throws with 403 JSON if blocked; returns the connection row if allowed
 *
 * Capabilities:
 *   payin          merchant can initiate payin through this connection
 *   payout         payout is allowed
 *   upi            UPI-specific flows allowed
 *   qr             QR code actions allowed
 *   paymentLinks   payment link creation/payment allowed
 *   refunds        refund issuance allowed
 *   settlement     settlement data access allowed
 */

import { db, merchantConnectionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export type CapabilityKey =
  | "payin"
  | "payout"
  | "upi"
  | "qr"
  | "paymentLinks"
  | "refunds"
  | "settlement";

const CAPABILITY_COLUMN_MAP: Record<CapabilityKey, keyof typeof merchantConnectionsTable.$inferSelect> = {
  payin: "capabilityPayin",
  payout: "capabilityPayout",
  upi: "capabilityUpi",
  qr: "capabilityQr",
  paymentLinks: "capabilityPaymentLinks",
  refunds: "capabilityRefunds",
  settlement: "capabilitySettlement",
};

export interface CapabilityCheckResult {
  allowed: boolean;
  reason?: string;
  connection?: typeof merchantConnectionsTable.$inferSelect;
}

/**
 * Check whether a specific capability is enabled for a merchant's provider connection.
 * Returns { allowed: true, connection } or { allowed: false, reason }.
 * Does NOT throw — callers decide what to do with the result.
 */
export async function checkMerchantConnectionCapability(
  merchantId: number,
  provider: string,
  capability: CapabilityKey
): Promise<CapabilityCheckResult> {
  try {
    const [conn] = await db
      .select()
      .from(merchantConnectionsTable)
      .where(
        and(
          eq(merchantConnectionsTable.merchantId, merchantId),
          eq(merchantConnectionsTable.provider, provider),
          eq(merchantConnectionsTable.isActive, true),
        )
      )
      .limit(1);

    if (!conn) {
      return { allowed: false, reason: `No active ${provider} connection for this merchant` };
    }

    if (conn.connectionStatus === "suspended") {
      return { allowed: false, reason: `${provider} connection is suspended` };
    }

    if (conn.connectionStatus === "failed") {
      return { allowed: false, reason: `${provider} connection failed its last test — retesting required before use` };
    }

    if (!conn.visibilityEnabled) {
      return { allowed: false, reason: `${provider} connection is not visible` };
    }

    const col = CAPABILITY_COLUMN_MAP[capability];
    const capabilityEnabled = conn[col] as boolean;

    if (!capabilityEnabled) {
      return {
        allowed: false,
        reason: `${capability} is not enabled for this merchant's ${provider} connection`,
      };
    }

    return { allowed: true, connection: conn };
  } catch (err) {
    logger.error({ err, merchantId, provider, capability }, "Capability check error");
    return { allowed: false, reason: "Capability check failed due to an internal error" };
  }
}

/**
 * Assert that a capability is enabled; throws a structured error object
 * (to be caught by the route and returned as 403) if not.
 *
 * Example:
 *   try {
 *     const conn = await assertMerchantConnectionCapability(merchantId, "payu", "payin");
 *   } catch (e: any) {
 *     res.status(403).json({ error: e.message, code: e.code });
 *     return;
 *   }
 */
export async function assertMerchantConnectionCapability(
  merchantId: number,
  provider: string,
  capability: CapabilityKey
): Promise<typeof merchantConnectionsTable.$inferSelect> {
  const result = await checkMerchantConnectionCapability(merchantId, provider, capability);
  if (!result.allowed || !result.connection) {
    const err = new Error(result.reason ?? "Capability not allowed") as any;
    err.code = "CAPABILITY_DENIED";
    err.status = 403;
    throw err;
  }
  return result.connection;
}
