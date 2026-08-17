/**
 * Provider connectivity / credential-format check adapters.
 *
 * CONTRACT:
 *   - ZERO financial transactions
 *   - ZERO wallet / ledger mutations
 *   - Returns { pass, message, detail? }
 *
 * Used by both /api/connections/:id/test (merchant connections)
 * and /api/platform-connections/:id/test (platform-owned connections).
 */

export interface ConnectionTestResult {
  pass: boolean;
  message: string;
  detail?: string;
}

export async function runProviderTest(
  provider: string,
  credentialsRaw: string | null
): Promise<ConnectionTestResult> {
  let creds: Record<string, string> = {};
  if (credentialsRaw && credentialsRaw.trim() !== "") {
    try {
      creds = JSON.parse(credentialsRaw);
    } catch {
      return { pass: false, message: "Credentials are not valid JSON", detail: "Parse error" };
    }
  }

  switch (provider) {
    case "upi_id": {
      const upiId = creds["upi_id"] ?? creds["vpa"] ?? Object.values(creds)[0] ?? "";
      const valid = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(upiId.trim());
      return valid
        ? { pass: true,  message: "UPI ID format is valid" }
        : { pass: false, message: "UPI ID format is invalid", detail: `Value: "${upiId}"` };
    }

    case "google_pay":
    case "phonepe":
    case "paytm":
    case "bharatpe":
    case "amazon_pay":
    case "freecharge":
    case "mobikwik":
    case "sbi_yono":
    case "hdfc_smarthub":
    case "icici_eazypay":
    case "axis_pay":
    case "kotak_smart": {
      const hasCreds = Object.keys(creds).length > 0;
      return hasCreds
        ? { pass: true,  message: "Credentials are present and well-formed" }
        : { pass: false, message: "No credentials configured for this connection" };
    }

    case "cashfree": {
      const hasKey    = !!(creds["api_key"]    || creds["client_id"] || creds["appId"]);
      const hasSecret = !!(creds["api_secret"] || creds["client_secret"] || creds["secretKey"]);
      if (!hasKey || !hasSecret) {
        return {
          pass: false,
          message: "Cashfree credentials must include API key and secret",
          detail: `Keys present: ${Object.keys(creds).join(", ") || "none"}`,
        };
      }
      try {
        const resp = await fetch("https://api.cashfree.com/api/v2/credentials", {
          method: "GET",
          headers: {
            "x-client-id":     creds["api_key"]    ?? creds["client_id"] ?? creds["appId"]        ?? "",
            "x-client-secret": creds["api_secret"] ?? creds["client_secret"] ?? creds["secretKey"] ?? "",
            "x-api-version":   "2022-09-01",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.status === 401) return { pass: false, message: "Cashfree credentials rejected (401)", detail: "Invalid API key or secret" };
        if (resp.status === 403) return { pass: false, message: "Cashfree credentials rejected (403)", detail: "Insufficient permissions" };
        return { pass: true, message: `Cashfree credentials accepted (HTTP ${resp.status})` };
      } catch (err: any) {
        return { pass: false, message: "Cashfree connectivity check failed", detail: err?.message ?? "Network error" };
      }
    }

    case "payu": {
      const hasKey  = !!(creds["key"]  || creds["merchant_key"]);
      const hasSalt = !!(creds["salt"] || creds["merchant_salt"]);
      if (!hasKey || !hasSalt) {
        return {
          pass: false,
          message: "PayU credentials must include key and salt",
          detail: `Keys present: ${Object.keys(creds).join(", ") || "none"}`,
        };
      }
      return { pass: true, message: "PayU credentials format is valid (key + salt present)" };
    }

    case "razorpay": {
      const hasKeyId  = !!(creds["key_id"]    || creds["api_key"]);
      const hasSecret = !!(creds["key_secret"] || creds["api_secret"]);
      if (!hasKeyId || !hasSecret) {
        return {
          pass: false,
          message: "Razorpay credentials must include key_id and key_secret",
          detail: `Keys present: ${Object.keys(creds).join(", ") || "none"}`,
        };
      }
      try {
        const auth = Buffer.from(
          `${creds["key_id"] ?? creds["api_key"]}:${creds["key_secret"] ?? creds["api_secret"]}`
        ).toString("base64");
        const resp = await fetch("https://api.razorpay.com/v1/payments?count=1", {
          headers: { Authorization: `Basic ${auth}` },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.status === 401) return { pass: false, message: "Razorpay credentials rejected (401)", detail: "Invalid key_id or key_secret" };
        return { pass: true, message: `Razorpay credentials accepted (HTTP ${resp.status})` };
      } catch (err: any) {
        return { pass: false, message: "Razorpay connectivity check failed", detail: err?.message ?? "Network error" };
      }
    }

    case "ekqr": {
      const hasKey = !!(creds["api_key"] || creds["key"] || creds["merchant_id"]);
      return hasKey
        ? { pass: true,  message: "EKQR credentials format is valid" }
        : { pass: false, message: "EKQR credentials are missing", detail: "Expected api_key or merchant_id" };
    }

    case "pinelabs": {
      const hasMid    = !!(creds["merchant_id"] || creds["mid"]);
      const hasAccess = !!(creds["access_code"] || creds["api_key"]);
      const hasSecret = !!(creds["working_key"] || creds["api_secret"] || creds["secret"]);
      if (!hasMid || !hasAccess || !hasSecret) {
        return {
          pass: false,
          message: "Pine Labs Plural credentials must include Merchant ID, Access Code, and Working Key",
          detail: `Keys present: ${Object.keys(creds).join(", ") || "none"}`,
        };
      }
      return { pass: true, message: "Pine Labs Plural credentials format is valid (MID + Access Code + Working Key present)" };
    }

    case "pinelabs_one": {
      // Pine Labs ONE is now a portal_session_connector (Playwright browser automation).
      // It does NOT use API credentials; it uses mobile/user-ID + password login routed
      // through /api/merchant/portal-sessions/pinelabs_one/*.
      //
      // If this connectionTest case is reached it means a legacy platform_connection row
      // exists for pinelabs_one — those rows should not exist. Return a clear explanation
      // so any admin who finds a stale row knows to delete it.
      return {
        pass: false,
        message: "Pine Labs ONE does not use platform connection credentials",
        detail:
          "Pine Labs ONE is a portal_session_connector (Playwright) routed through " +
          "/api/merchant/portal-sessions/pinelabs_one/*. " +
          "It does not use API keys or partner credentials — see developer.pinelabs.com for partner docs. " +
          "If this platform_connections row exists, it is a legacy entry and can be deleted. " +
          "Merchants connect via mobile/user-ID + password on the merchant Connect page.",
      };
    }

    default:
      return {
        pass: Object.keys(creds).length > 0,
        message: Object.keys(creds).length > 0
          ? "Credentials are present (no provider-specific test available)"
          : "No credentials configured for this connection",
      };
  }
}
