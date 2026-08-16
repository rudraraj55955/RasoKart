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
      // Pine Labs ONE (one.pinelabs.com) — POS/QR merchant account platform.
      // Official partner/enterprise API agreement required (developer.pinelabs.com).
      //
      // ALWAYS returns pass:false — by design.
      //
      // Rationale: the partner API endpoint URL, auth scheme, and response contract
      // are documented in the Pine Labs partner onboarding agreement, which has not
      // yet been received. Until that endpoint is confirmed and wired in, this test
      // performs credential-presence validation only and deliberately returns
      // pass:false so the calling route never auto-promotes the connection to "active".
      //
      // When the Pine Labs partner onboarding docs arrive:
      //   1. Add the exact endpoint URL + auth headers here.
      //   2. Accept only documented successful responses as pass:true.
      //   3. Remove this comment block.
      // (See follow-up task: "Flip Pine Labs ONE live once partner credentials are in production")
      const hasKey    = !!(creds["partner_api_key"]    || creds["api_key"]);
      const hasSecret = !!(creds["partner_api_secret"] || creds["api_secret"] || creds["client_secret"]);
      if (!hasKey || !hasSecret) {
        return {
          pass: false,
          message: "Pine Labs ONE credentials must include Partner API Key and Partner API Secret",
          detail: `Keys present: ${Object.keys(creds).join(", ") || "none"}. ` +
            "Obtain credentials from the Pine Labs partner program at developer.pinelabs.com.",
        };
      }
      // Credentials are present and well-formed, but live verification is impossible
      // without the official partner API endpoint. Return pass:false so the connection
      // stays in "pending" status — it can only become "active" once a real network
      // test succeeds against the documented endpoint (Task #2726).
      return {
        pass: false,
        message: "Pine Labs ONE credentials saved but not yet live-verified",
        detail:
          "Credentials present: " + Object.keys(creds).join(", ") + ". " +
          "A live connectivity test requires the official partner API endpoint URL from your " +
          "Pine Labs partner onboarding agreement (developer.pinelabs.com). " +
          "The connection remains pending until that endpoint is confirmed and a real network " +
          "test can be run. No financial operations are affected.",
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
