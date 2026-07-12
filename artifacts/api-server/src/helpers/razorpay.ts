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
