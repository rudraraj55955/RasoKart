/**
 * PayU Hosted Checkout helpers.
 *
 * Security model:
 *  - Credentials (key + salt) are NEVER passed through any public endpoint.
 *  - Hash generation and verification happen server-side only.
 *  - No credential value is logged — only masked prefixes for debugging.
 *  - Timing-safe comparison is used for all hash equality checks.
 */

import { createHash, timingSafeEqual } from "crypto";
import { request as httpsRequest } from "https";
import querystring from "querystring";

export type PayuEnv = "uat" | "live";

export const PAYU_PAYMENT_URL: Record<PayuEnv, string> = {
  uat:  "https://test.payu.in/_payment",
  live: "https://secure.payu.in/_payment",
};

const PAYU_STATUS_HOST: Record<PayuEnv, string> = {
  uat:  "test.payu.in",
  live: "info.payu.in",
};

// ── Hash generation ────────────────────────────────────────────────────────────

export interface PayuHashParams {
  key:         string;
  txnid:       string;
  amount:      string;   // e.g. "100.00" — no rounding, pass exact
  productinfo: string;
  firstname:   string;
  email:       string;
  udf1?:       string;
  udf2?:       string;
  udf3?:       string;
  udf4?:       string;
  udf5?:       string;
  salt:        string;
}

/**
 * Generate the SHA-512 payment hash sent in the PayU checkout form.
 * Formula (PayU docs): sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
 */
export function generatePayuHash(p: PayuHashParams): string {
  const { key, txnid, amount, productinfo, firstname, email, salt } = p;
  const udf1 = p.udf1 ?? "";
  const udf2 = p.udf2 ?? "";
  const udf3 = p.udf3 ?? "";
  const udf4 = p.udf4 ?? "";
  const udf5 = p.udf5 ?? "";
  const s = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`;
  return createHash("sha512").update(s).digest("hex");
}

// ── Response verification ──────────────────────────────────────────────────────

export interface PayuVerifyParams {
  key:         string;
  txnid:       string;
  amount:      string;
  productinfo: string;
  firstname:   string;
  email:       string;
  udf1?:       string;
  udf2?:       string;
  udf3?:       string;
  udf4?:       string;
  udf5?:       string;
  status:      string;
  salt:        string;
  hash:        string;   // hash returned by PayU in the response
}

/**
 * Verify the response hash PayU sends to surl / furl / s2s webhook.
 * Formula (reverse): sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
 * Returns true only if hash is present, well-formed, and matches.
 */
export function verifyPayuResponseHash(p: PayuVerifyParams): boolean {
  const { key, txnid, amount, productinfo, firstname, email, status, salt, hash } = p;
  if (!hash || hash.length !== 128) return false;   // SHA-512 hex = 128 chars
  const udf1 = p.udf1 ?? "";
  const udf2 = p.udf2 ?? "";
  const udf3 = p.udf3 ?? "";
  const udf4 = p.udf4 ?? "";
  const udf5 = p.udf5 ?? "";
  const s = `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  const expected = createHash("sha512").update(s).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

// ── Status enquiry ─────────────────────────────────────────────────────────────

export interface PayuStatusQueryParams {
  key:   string;
  salt:  string;
  txnid: string;
  env:   PayuEnv;
}

export interface PayuStatusResult {
  ok:       boolean;
  status?:  string;   // "success" | "failure" | "pending" | "not found"
  mihpayid?: string;
  bankRefNo?: string;
  paymentMode?: string;
  errorMessage?: string;
  raw?: string;
}

/**
 * Query PayU Verify Payment API to get the canonical status of a txnid.
 * Formula: sha512(key|command|var1|salt) where command="verify_payment", var1=txnid
 */
export async function queryPayuTransactionStatus(p: PayuStatusQueryParams): Promise<PayuStatusResult> {
  const { key, salt, txnid, env } = p;
  const command = "verify_payment";
  const hashString = `${key}|${command}|${txnid}|${salt}`;
  const hash = createHash("sha512").update(hashString).digest("hex");

  const body = querystring.stringify({ key, command, var1: txnid, hash });
  const host = PAYU_STATUS_HOST[env];

  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        hostname: host,
        path:     "/merchant/postservice.php?form=2",
        method:   "POST",
        headers:  {
          "Content-Type":   "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "Accept":         "application/json",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const txnArr = (parsed["transaction_details"] as Record<string, unknown> | undefined)?.[txnid] as Record<string, unknown> | undefined;
            if (!txnArr) {
              resolve({ ok: false, status: "not found", raw });
              return;
            }
            const txnStatus = (txnArr["status"] as string) ?? "";
            resolve({
              ok:          true,
              status:      txnStatus.toLowerCase(),
              mihpayid:    txnArr["mihpayid"] as string | undefined,
              bankRefNo:   txnArr["bank_ref_num"] as string | undefined,
              paymentMode: txnArr["mode"] as string | undefined,
              raw,
            });
          } catch {
            resolve({ ok: false, errorMessage: "Failed to parse PayU status response", raw });
          }
        });
      },
    );
    req.on("error", (err: Error) => resolve({ ok: false, errorMessage: err.message }));
    req.setTimeout(15_000, () => {
      req.destroy();
      resolve({ ok: false, errorMessage: "PayU status query timed out" });
    });
    req.write(body);
    req.end();
  });
}

// ── Unique transaction ID ──────────────────────────────────────────────────────

/**
 * Generate a unique PayU txnid.
 * Format: RK-PAY-{merchantId}-{timestamp}-{random6}
 * Max 25 chars (PayU limit). merchantId ≤ 6 digits, timestamp = epoch-ms-mod = 8 digits
 */
export function generatePayuTxnId(merchantId: number): string {
  const ts   = Date.now().toString(36).toUpperCase();   // base-36 timestamp
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RK${merchantId}T${ts}${rand}`.slice(0, 25);
}
