import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../lib/logger";

export const EKQR_CREATE_ORDER_URL = "https://api.ekqr.in/api/create_order";
export const EKQR_CHECK_STATUS_URL = "https://api.ekqr.in/api/check_order_status";

export interface EkqrCreateOrderPayload {
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
  udf3?: string;
}

export interface EkqrCreateOrderResponse {
  status: boolean;
  msg: string;
  payment_url?: string;
  // EKQR may return additional fields
  [key: string]: unknown;
}

export interface EkqrCheckStatusResponse {
  status: boolean;
  msg: string;
  data?: {
    client_txn_id: string;
    amount: string;
    p_info: string;
    customer_name: string;
    customer_email: string;
    customer_mobile: string;
    upi_txn_id: string;
    status: string;       // SUCCESS | FAILED | PENDING
    remark: string;
    udf1?: string;
    udf2?: string;
    udf3?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function ekqrCreateOrder(
  payload: EkqrCreateOrderPayload,
): Promise<{ raw: string; parsed: EkqrCreateOrderResponse }> {
  const res = await fetch(EKQR_CREATE_ORDER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  let parsed: EkqrCreateOrderResponse;
  try {
    parsed = JSON.parse(raw) as EkqrCreateOrderResponse;
  } catch {
    logger.warn({ raw }, "EKQR create_order returned non-JSON response");
    parsed = { status: false, msg: raw };
  }
  return { raw, parsed };
}

export async function ekqrCheckOrderStatus(
  apiKey: string,
  clientTxnId: string,
  txnDate: string, // DD-MM-YYYY
): Promise<{ raw: string; parsed: EkqrCheckStatusResponse }> {
  const body = { key: apiKey, client_txn_id: clientTxnId, txn_date: txnDate };
  const res = await fetch(EKQR_CHECK_STATUS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: EkqrCheckStatusResponse;
  try {
    parsed = JSON.parse(raw) as EkqrCheckStatusResponse;
  } catch {
    logger.warn({ raw }, "EKQR check_order_status returned non-JSON response");
    parsed = { status: false, msg: raw };
  }
  return { raw, parsed };
}

/** Format a Date as DD-MM-YYYY for EKQR's check_order_status API */
export function ekqrFormatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** Build the client_txn_id for an EKQR order, given our QR code ID */
export function ekqrClientTxnId(qrCodeId: number): string {
  return `EKQR-${qrCodeId}`;
}

/**
 * Verify an EKQR webhook signature.
 *
 * EKQR includes a `hash` field in the webhook body computed as:
 *   HMAC-SHA256(client_txn_id + "|" + txn_id + "|" + amount + "|" + status, webhookSecret)
 *
 * Returns true if the signature matches, false if missing or invalid.
 * When no webhookSecret is configured this function should not be called.
 */
export function verifyEkqrWebhookSignature(
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
