import { createHmac, timingSafeEqual } from "crypto";

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

function basicAuth(keyId: string, keySecret: string): string {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

export interface RazorpayCreateOrderRequest {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResponse {
  id?: string;
  entity?: string;
  amount?: number;
  currency?: string;
  receipt?: string;
  status?: string;
  error?: { code?: string; description?: string; field?: string; source?: string; step?: string; reason?: string; metadata?: Record<string, unknown> };
  [key: string]: unknown;
}

export interface RazorpayPaymentResponse {
  id?: string;
  entity?: string;
  amount?: number;
  currency?: string;
  status?: string;
  order_id?: string;
  method?: string;
  description?: string;
  captured?: boolean;
  error_code?: string;
  error_description?: string;
  [key: string]: unknown;
}

export async function razorpayCreateOrder(
  keyId: string,
  keySecret: string,
  payload: RazorpayCreateOrderRequest,
): Promise<{ raw: string; parsed: RazorpayOrderResponse; status: number }> {
  const body = JSON.stringify(payload);
  const resp = await fetch(`${RAZORPAY_API_BASE}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuth(keyId, keySecret),
    },
    body,
  });
  const raw = await resp.text();
  let parsed: RazorpayOrderResponse = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  return { raw, parsed, status: resp.status };
}

export async function razorpayFetchPayment(
  keyId: string,
  keySecret: string,
  paymentId: string,
): Promise<{ raw: string; parsed: RazorpayPaymentResponse; status: number }> {
  const resp = await fetch(`${RAZORPAY_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: basicAuth(keyId, keySecret) },
  });
  const raw = await resp.text();
  let parsed: RazorpayPaymentResponse = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  return { raw, parsed, status: resp.status };
}

export async function razorpayFetchOrder(
  keyId: string,
  keySecret: string,
  orderId: string,
): Promise<{ raw: string; parsed: RazorpayOrderResponse; status: number }> {
  const resp = await fetch(`${RAZORPAY_API_BASE}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: basicAuth(keyId, keySecret) },
  });
  const raw = await resp.text();
  let parsed: RazorpayOrderResponse = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  return { raw, parsed, status: resp.status };
}

/**
 * Verify Razorpay payment signature.
 * Formula: HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret) → hex
 */
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): boolean {
  try {
    const message = `${orderId}|${paymentId}`;
    const expected = createHmac("sha256", keySecret).update(message).digest("hex");
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verify Razorpay webhook signature.
 * Formula: HMAC-SHA256(rawBody, webhookSecret) → hex
 * Header: x-razorpay-signature
 */
export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
): boolean {
  try {
    const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export interface RazorpayRefundRequest {
  amount?: number;
  speed?: "normal" | "optimum";
  notes?: Record<string, string>;
}

export interface RazorpayRefundResponse {
  id?: string;
  entity?: string;
  amount?: number;
  currency?: string;
  payment_id?: string;
  status?: string;
  speed_requested?: string;
  speed_processed?: string;
  created_at?: number;
  error?: { code?: string; description?: string };
  [key: string]: unknown;
}

/**
 * Initiate a refund for a Razorpay payment.
 * POST /v1/payments/{paymentId}/refund
 * amount is in paise (integer). Omit for full refund.
 */
export async function razorpayCreateRefund(
  keyId: string,
  keySecret: string,
  paymentId: string,
  payload: RazorpayRefundRequest,
): Promise<{ raw: string; parsed: RazorpayRefundResponse; status: number }> {
  const body = JSON.stringify(payload);
  const resp = await fetch(`${RAZORPAY_API_BASE}/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuth(keyId, keySecret),
    },
    body,
  });
  const raw = await resp.text();
  let parsed: RazorpayRefundResponse = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  return { raw, parsed, status: resp.status };
}

/**
 * Fetch refund details by refund ID.
 * GET /v1/refunds/{refundId}
 */
export async function razorpayFetchRefund(
  keyId: string,
  keySecret: string,
  refundId: string,
): Promise<{ raw: string; parsed: RazorpayRefundResponse; status: number }> {
  const resp = await fetch(`${RAZORPAY_API_BASE}/refunds/${encodeURIComponent(refundId)}`, {
    headers: { Authorization: basicAuth(keyId, keySecret) },
  });
  const raw = await resp.text();
  let parsed: RazorpayRefundResponse = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  return { raw, parsed, status: resp.status };
}

export interface RazorpayXVerifyResult {
  activated: boolean;
  keyConfigured: boolean;
  message: string;
  contactsEndpointReachable?: boolean;
  rawStatus?: number;
}

/**
 * Probe RazorpayX to verify if the account's Payout API is activated.
 * Uses a READ-ONLY contacts list call — no financial side effects.
 * Credentials expected in RAZORPAY_X_KEY_ID / RAZORPAY_X_SECRET env vars.
 *
 * Returns a structured result; never throws — all errors are caught and
 * returned as { activated: false, message: "..." }.
 */
export async function verifyRazorpayXActivation(): Promise<RazorpayXVerifyResult> {
  const keyId     = process.env["RAZORPAY_X_KEY_ID"] ?? "";
  const keySecret = process.env["RAZORPAY_X_SECRET"]  ?? "";

  if (!keyId || !keySecret) {
    return {
      activated: false,
      keyConfigured: false,
      message: "RAZORPAY_X_KEY_ID or RAZORPAY_X_SECRET environment variable not set. Configure them to enable RazorpayX Payouts.",
    };
  }

  try {
    const resp = await fetch("https://api.razorpay.com/v1/contacts?count=1", {
      headers: { Authorization: basicAuth(keyId, keySecret) },
      signal: AbortSignal.timeout(10_000),
    });

    if (resp.status === 200) {
      return {
        activated: true,
        keyConfigured: true,
        contactsEndpointReachable: true,
        rawStatus: resp.status,
        message: "RazorpayX Payouts API is activated and reachable.",
      };
    }

    if (resp.status === 401 || resp.status === 403) {
      return {
        activated: false,
        keyConfigured: true,
        contactsEndpointReachable: false,
        rawStatus: resp.status,
        message: "RazorpayX credentials are set but the Payouts API is not yet activated on this account. Contact Razorpay support to enable RazorpayX.",
      };
    }

    return {
      activated: false,
      keyConfigured: true,
      contactsEndpointReachable: false,
      rawStatus: resp.status,
      message: `RazorpayX API returned HTTP ${resp.status}. Payouts may not be activated — verify with Razorpay support.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      activated: false,
      keyConfigured: true,
      contactsEndpointReachable: false,
      message: `Network error contacting RazorpayX API: ${msg}`,
    };
  }
}
