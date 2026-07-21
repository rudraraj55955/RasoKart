import { createHmac, timingSafeEqual } from "crypto";
import { db, systemConfigTable, SYSTEM_CONFIG_KEYS } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { decryptSecret } from "./cryptoUtils";
import { logger } from "../lib/logger";

export interface UpigatewayConfig {
  enabled: boolean;
  env: "test" | "live";
  baseUrl: string;
  apiKey: string;
  merchantId: string;
  createOrderEndpoint: string;
  checkStatusEndpoint: string;
  webhookSecret: string;
  minAmount: number;
  maxAmount: number;
  dailyLimit: number;
  merchantAccess: boolean;
  apiKeySet: boolean;
  apiKeyMasked: string;
  webhookSecretSet: boolean;
  lastUpdatedByEmail: string | null;
  lastUpdatedAt: string | null;
}

const CONFIG_KEYS = [
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_PAYIN_ENABLED,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_ENV,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_BASE_URL,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_API_KEY,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_WEBHOOK_SECRET,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_MERCHANT_ID,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_CREATE_ORDER_ENDPOINT,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_CHECK_STATUS_ENDPOINT,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_MIN_AMOUNT,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_MAX_AMOUNT,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_DAILY_LIMIT,
  SYSTEM_CONFIG_KEYS.UPIGATEWAY_MERCHANT_ACCESS,
] as const;

function maskSecret(s: string): string {
  if (!s) return "";
  if (s.length <= 8) return "*".repeat(s.length);
  return `${s.slice(0, 4)}${"*".repeat(Math.max(0, s.length - 8))}${s.slice(-4)}`;
}

function decryptConfigValue(raw: string | undefined): string {
  if (!raw) return "";
  if (!raw.startsWith("enc:v1:")) return "";
  const r = decryptSecret(raw);
  return r.ok ? r.value : "";
}

export async function loadUpigatewayConfig(): Promise<UpigatewayConfig> {
  const rows = await db.select().from(systemConfigTable)
    .where(inArray(systemConfigTable.key, CONFIG_KEYS as unknown as string[]));
  const map = new Map(rows.map(r => [r.key, r.value]));

  const rawApiKey = decryptConfigValue(map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_API_KEY));
  const rawSecret = decryptConfigValue(map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_WEBHOOK_SECRET));

  const latestRow = rows
    .filter(r => r.updatedAt)
    .sort((a, b) => new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime())[0];

  return {
    enabled: (map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_PAYIN_ENABLED) ?? "false") === "true",
    env: (map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_ENV) ?? "test") as "test" | "live",
    baseUrl: map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_BASE_URL) ?? "https://api.ekqr.in",
    apiKey: rawApiKey,
    merchantId: map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_MERCHANT_ID) ?? "",
    createOrderEndpoint: map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_CREATE_ORDER_ENDPOINT) ?? "/api/create_order",
    checkStatusEndpoint: map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_CHECK_STATUS_ENDPOINT) ?? "/api/check_order_status",
    webhookSecret: rawSecret,
    minAmount: parseInt(map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_MIN_AMOUNT) ?? "1") || 1,
    maxAmount: parseInt(map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_MAX_AMOUNT) ?? "200000") || 200000,
    dailyLimit: parseInt(map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_DAILY_LIMIT) ?? "1000000") || 1000000,
    merchantAccess: (map.get(SYSTEM_CONFIG_KEYS.UPIGATEWAY_MERCHANT_ACCESS) ?? "false") === "true",
    apiKeySet: rawApiKey.length > 0,
    apiKeyMasked: maskSecret(rawApiKey),
    webhookSecretSet: rawSecret.length > 0,
    lastUpdatedByEmail: latestRow?.updatedByEmail ?? null,
    lastUpdatedAt: latestRow?.updatedAt ? (latestRow.updatedAt as Date).toISOString() : null,
  };
}

export interface UpigatewayCreateOrderPayload {
  key: string;
  client_txn_id: string;
  amount: string;
  p_info: string;
  customer_name: string;
  customer_email: string;
  customer_mobile: string;
  redirect_url: string;
  udf1?: string;
  udf2?: string;
}

export interface UpigatewayCreateOrderResponse {
  status: boolean;
  msg: string;
  payment_url?: string;
  [key: string]: unknown;
}

export async function upigatewayCreateOrder(
  config: Pick<UpigatewayConfig, "baseUrl" | "createOrderEndpoint">,
  payload: UpigatewayCreateOrderPayload,
): Promise<{ raw: string; parsed: UpigatewayCreateOrderResponse }> {
  const url = `${config.baseUrl.replace(/\/$/, "")}${config.createOrderEndpoint}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await res.text();
    let parsed: UpigatewayCreateOrderResponse;
    try {
      parsed = JSON.parse(raw) as UpigatewayCreateOrderResponse;
    } catch {
      logger.warn({ raw }, "upigateway create_order returned non-JSON");
      parsed = { status: false, msg: raw };
    }
    return { raw, parsed };
  } finally {
    clearTimeout(timeout);
  }
}

export interface UpigatewayCheckStatusResponse {
  status: boolean;
  msg: string;
  data?: {
    client_txn_id: string;
    amount: string;
    status: string;
    upi_txn_id?: string;
    remark?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function upigatewayCheckStatus(
  config: Pick<UpigatewayConfig, "baseUrl" | "checkStatusEndpoint" | "apiKey">,
  clientTxnId: string,
  txnDate: string,
): Promise<{ raw: string; parsed: UpigatewayCheckStatusResponse }> {
  const url = `${config.baseUrl.replace(/\/$/, "")}${config.checkStatusEndpoint}`;
  const body = { key: config.apiKey, client_txn_id: clientTxnId, txn_date: txnDate };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    let parsed: UpigatewayCheckStatusResponse;
    try {
      parsed = JSON.parse(raw) as UpigatewayCheckStatusResponse;
    } catch {
      logger.warn({ raw }, "upigateway check_order_status returned non-JSON");
      parsed = { status: false, msg: raw };
    }
    return { raw, parsed };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Verify a UPIGateway / EKQR webhook signature.
 * HMAC-SHA256( client_txn_id|txn_id|amount|status , webhookSecret )
 */
export function verifyUpigatewayWebhookSignature(
  body: Record<string, string>,
  webhookSecret: string,
): boolean {
  const incomingHash = body["hash"];
  if (!incomingHash) return false;
  const canonical = [
    body["client_txn_id"] ?? "",
    body["txn_id"] ?? "",
    body["amount"] ?? "",
    body["status"] ?? "",
  ].join("|");
  const expected = createHmac("sha256", webhookSecret).update(canonical).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(incomingHash, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

/** Format a Date as DD-MM-YYYY for UPIGateway/EKQR check_order_status */
export function upigatewayFormatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}
