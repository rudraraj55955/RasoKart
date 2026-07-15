import { logger } from "../lib/logger";

const MSG91_EMAIL_OTP_ENDPOINT = "https://control.msg91.com/api/v5/email/otp";
const COMPANY_NAME = "Nickey Collection Private Limited";
const FROM_ADDRESS = "RasoKart <no-reply@notify.rasokart.com>";
const DOMAIN = "notify.rasokart.com";
const TEMPLATE_ID = "global_otp";
const OTP_EXPIRY_MINUTES = 5;

export async function sendMsg91EmailOtp(opts: {
  to: string;
  toName: string;
  otp: string;
}): Promise<boolean> {
  const authKey = process.env["MSG91_AUTH_KEY"];
  if (!authKey) {
    logger.warn("MSG91_AUTH_KEY not configured; MSG91 email OTP unavailable");
    return false;
  }

  const body: Record<string, unknown> = {
    template_id: TEMPLATE_ID,
    domain: DOMAIN,
    from: FROM_ADDRESS,
    to: [{ name: opts.toName || opts.to.split("@")[0], email: opts.to }],
    OTP: opts.otp,
    OTP_EXPIRY: OTP_EXPIRY_MINUTES,
    variables: {
      company_name: COMPANY_NAME,
      otp: opts.otp,
    },
  };

  let resp: Response;
  try {
    resp = await fetch(MSG91_EMAIL_OTP_ENDPOINT, {
      method: "POST",
      headers: {
        "authkey": authKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err: unknown) {
    logger.warn({ err }, "MSG91 email OTP network error");
    return false;
  }

  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }

  if (!resp.ok) {
    logger.warn({ status: resp.status }, "MSG91 email OTP non-ok response");
    return false;
  }

  const type = (data as Record<string, unknown> | null)?.["type"];
  if (type === "error") {
    const msg = (data as Record<string, unknown>)?.["message"];
    logger.warn({ msg }, "MSG91 email OTP error response");
    return false;
  }

  logger.info({ to: opts.to }, "MSG91 email OTP sent successfully");
  return true;
}
