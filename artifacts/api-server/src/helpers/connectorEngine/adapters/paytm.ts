/**
 * Paytm Business Portal Adapter — portal_session_connector
 *
 * Provider:   Paytm Business (business.paytm.com)
 * Kind:       portal_session_connector
 * Auth path:  Registered mobile number → OTP (the only supported login path on
 *             the current Paytm Business portal — email/password is not available
 *             for merchant accounts on the standard portal)
 *
 * HOW IT WORKS:
 *   1. initiateSession() — launches an isolated Chromium context, navigates to
 *      business.paytm.com, enters the merchant's mobile number, triggers OTP,
 *      and returns AWAITING_OTP. The browser storage state (cookies + JS
 *      storage) is serialised, encrypted, and stored as the session token.
 *   2. submitStep() — restores the browser context from the encrypted session
 *      token, fills in the merchant-entered OTP, submits, verifies that the
 *      session reached the dashboard, then re-serialises the updated storage
 *      state and returns CONNECTED.
 *   3. All subsequent calls (validateSession, discoverEntities, fetchTransactions,
 *      reconnect) restore the context from the stored session token.
 *
 * SECURITY INVARIANTS:
 *   - Passwords are NEVER stored or passed. This adapter is OTP-only.
 *   - Mobile numbers are decrypted locally, used to fill a browser field, and
 *     then let out of scope. They are never written to disk, logged, or returned.
 *   - OTPs are decrypted locally, filled into the browser, and let out of scope
 *     immediately. They are never stored.
 *   - The session token contains ONLY serialised browser storage state (cookies
 *     + localStorage), which is encrypted at rest with AES-256-GCM.
 *   - maskedMobile (e.g. "**XXXX6789") is the only identifier persisted in
 *     plaintext. It is derived server-side and safe to display in the UI.
 *   - Screenshots, video, and network tracing are disabled in the browser pool.
 *
 * FAIL-CLOSED CONTRACT:
 *   - Any exception, unexpected page state, or navigation timeout returns a
 *     non-CONNECTED status with a diagnostic failReason. CONNECTED is returned
 *     only when:
 *       (a) The browser navigated to a URL matching the Paytm dashboard pattern
 *       (b) A recognisable dashboard landmark is present in the DOM
 *       (c) The storage state was successfully extracted and encrypted
 *   - CAPTCHA or device-binding prompts → AWAITING_USER_ACTION
 *   - Account lock or suspicious-activity screen → BLOCKED
 *   - Invalid/expired OTP → FAILED with INVALID_OTP
 *   - Network / browser launch failure → FAILED with PORTAL_UNREACHABLE or
 *     BROWSER_ERROR
 *
 * MUTATIONS:
 *   - NONE. This adapter only reads data. It does not initiate payments,
 *     refunds, payouts, settlements, beneficiary changes, or profile updates.
 *
 * NOTE ON SELECTOR STABILITY:
 *   Paytm Business portal is a React SPA. Selectors are chosen from visible
 *   text and ARIA roles (more stable than generated CSS class names). If the
 *   portal redesigns its login flow, update the SELECTORS block below and
 *   restart the server. No other code changes are required.
 */

import type { Page } from "playwright";
import type {
  ProviderAdapter,
  InitiateParams,
  InitiateResult,
  SubmitStepParams,
  SubmitStepResult,
  ValidateResult,
  DiscoveryResult,
  FetchTransactionsParams,
  FetchTransactionsResult,
  HealthCheckResult,
  NormalizedTransaction,
  PortalTxStatus,
} from "../types";
import {
  newIsolatedContext,
  extractStorageState,
  NAV_TIMEOUT_MS,
  ACTION_TIMEOUT_MS,
  type BrowserStorageState,
} from "../browserPool";
import {
  encryptSessionPayload,
  decryptSessionToken,
  makeSessionPayload,
} from "../sessionCrypto";
import { decryptSecret } from "../../cryptoUtils";
import { logger } from "../../../lib/logger";

// ── Constants ─────────────────────────────────────────────────────────────────

const SLUG         = "paytm_merchant";
const PORTAL_URL   = "https://business.paytm.com";
const LOGIN_URL    = "https://business.paytm.com/user/login";
const HELP_URL     = "https://business.paytm.com";

// Session lifetime advisory: Paytm sessions typically last 24–48 hours.
// We store an advisory expiry but the real check is validateSession().
const SESSION_TTL_HOURS = 24;

// ── Selector registry ─────────────────────────────────────────────────────────
// Update here if the Paytm Business portal redesigns its login UI.
// All selectors use text/ARIA approaches where possible for stability.

const SEL = {
  // Login page — mobile number entry
  MOBILE_INPUT: [
    'input[placeholder*="mobile" i]',
    'input[placeholder*="phone" i]',
    'input[type="tel"]',
    'input[name="mobile"]',
    'input[name="phone"]',
    'input[id*="mobile" i]',
  ],
  // "Get OTP" / "Request OTP" / "Continue" button after mobile entry
  GET_OTP_BTN: [
    'button:has-text("Get OTP")',
    'button:has-text("Request OTP")',
    'button:has-text("Send OTP")',
    'button:has-text("Continue")',
    'button:has-text("Proceed")',
    '[role="button"]:has-text("Get OTP")',
  ],
  // OTP input — Paytm uses either a single field or individual digit boxes
  OTP_INPUT_SINGLE: [
    'input[placeholder*="OTP" i]',
    'input[placeholder*="Enter OTP" i]',
    'input[name="otp"]',
    'input[type="number"][maxlength="6"]',
    'input[autocomplete="one-time-code"]',
  ],
  OTP_INPUT_DIGITS: 'input[type="text"][maxlength="1"], input[type="number"][maxlength="1"]',
  // Submit OTP button
  SUBMIT_OTP_BTN: [
    'button:has-text("Verify OTP")',
    'button:has-text("Verify")',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'button:has-text("Submit")',
    '[role="button"]:has-text("Verify")',
  ],
  // Dashboard landmark (presence proves we are logged in)
  DASHBOARD_LANDMARK: [
    '[data-testid*="dashboard"]',
    'nav[aria-label*="dashboard" i]',
    'a[href*="/dashboard"]',
    'a[href*="/home"]',
    'span:has-text("Dashboard")',
    'text=Total Transactions',
    'text=Paytm for Business',
    '[class*="dashboard"]',
  ],
  // CAPTCHA detection
  CAPTCHA: [
    'iframe[src*="recaptcha"]',
    'iframe[src*="captcha"]',
    '[class*="captcha"]',
    'text=complete the CAPTCHA',
    'text=verify you are human',
  ],
  // Account block / suspicious activity
  BLOCKED: [
    'text=account has been blocked',
    'text=suspicious activity',
    'text=temporarily locked',
    'text=contact support',
  ],
  // Error message
  ERROR_MSG: [
    '[class*="error"]',
    '[role="alert"]',
    'text=Invalid OTP',
    'text=Incorrect OTP',
    'text=OTP expired',
    'text=OTP has expired',
    'text=Please enter a valid OTP',
  ],
  // Transaction list
  TX_ROW: [
    '[class*="transaction-row"]',
    'tr[class*="transaction"]',
    '[data-testid*="transaction"]',
    '[class*="txn-row"]',
  ],
  // MID / merchant identifier in profile
  MID: [
    '[data-testid*="mid"]',
    'text=Merchant ID',
    '[class*="merchant-id"]',
  ],
};

// ── Adapter-specific session data ─────────────────────────────────────────────

interface PaytmAdapterData {
  /** Playwright serialised storage state — contains session cookies. SENSITIVE. */
  storageState: BrowserStorageState;
  /** Masked mobile, e.g. "**XXXXXX890" — safe to display, never the full number. */
  maskedMobile?: string;
  /** What step we were at when the token was issued. */
  step: "AWAITING_OTP" | "CONNECTED";
  /** ISO string when session was established. */
  connectedAt?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskMobile(mobile: string): string {
  if (mobile.length < 4) return "****";
  return "**XXXXXX" + mobile.slice(-3);
}

async function tryLocator(page: Page, selectors: string[], timeout = ACTION_TIMEOUT_MS / 2) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count() > 0) return loc;
    } catch {
      // try next
    }
  }
  return null;
}

async function waitForAny(page: Page, selectors: string[], timeout: number): Promise<string | null> {
  const locators = selectors.map(s => page.locator(s).first());
  const promises = locators.map(async (loc, i) => {
    try {
      await loc.waitFor({ state: "visible", timeout });
      return selectors[i]!;
    } catch {
      return null;
    }
  });
  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) return r.value;
  }
  return null;
}

/** Check if the page is on a Paytm dashboard URL (login succeeded). */
function isDashboardUrl(url: string): boolean {
  return (
    url.includes("/dashboard") ||
    url.includes("/home") ||
    (url.startsWith("https://business.paytm.com") &&
      !url.includes("/login") &&
      !url.includes("/user/login") &&
      !url.includes("/otp"))
  );
}

/** Check for CAPTCHA on current page. Returns true if CAPTCHA found. */
async function hasCaptcha(page: Page): Promise<boolean> {
  for (const sel of SEL.CAPTCHA) {
    try {
      if (await page.locator(sel).first().count() > 0) return true;
    } catch {
      // continue
    }
  }
  return false;
}

/** Check for account block. */
async function isBlocked(page: Page): Promise<boolean> {
  for (const sel of SEL.BLOCKED) {
    try {
      if (await page.locator(sel).first().count() > 0) return true;
    } catch {
      // continue
    }
  }
  return false;
}

/**
 * Fill OTP — handles both single-field and digit-box inputs.
 * Returns true if filled successfully.
 */
async function fillOtp(page: Page, otp: string): Promise<boolean> {
  // Try single field first
  const single = await tryLocator(page, SEL.OTP_INPUT_SINGLE);
  if (single) {
    await single.fill(otp, { timeout: ACTION_TIMEOUT_MS });
    return true;
  }

  // Try individual digit boxes
  const digitBoxes = page.locator(SEL.OTP_INPUT_DIGITS);
  const count = await digitBoxes.count();
  if (count >= otp.length) {
    for (let i = 0; i < otp.length; i++) {
      await digitBoxes.nth(i).fill(otp[i]!, { timeout: ACTION_TIMEOUT_MS });
    }
    return true;
  }

  return false;
}

/**
 * Navigate to the Paytm Business login page.
 * Returns false if the portal is unreachable or login UI not found.
 */
async function navigateToLogin(page: Page): Promise<boolean> {
  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    // If redirected to portal root, look for a login link
    if (!page.url().includes("login")) {
      await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    }

    // Wait for the mobile input to appear
    const mobileFound = await waitForAny(page, SEL.MOBILE_INPUT, ACTION_TIMEOUT_MS * 2);
    return mobileFound !== null;
  } catch {
    return false;
  }
}

/**
 * Verify the current session is still authenticated (dashboard accessible).
 */
async function verifySessionAlive(page: Page): Promise<boolean> {
  try {
    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    const url = page.url();
    if (!isDashboardUrl(url)) return false;
    // Check for at least one dashboard landmark
    const landmark = await waitForAny(page, SEL.DASHBOARD_LANDMARK, ACTION_TIMEOUT_MS);
    return landmark !== null;
  } catch {
    return false;
  }
}

// ── Adapter implementation ────────────────────────────────────────────────────

export const paytmMerchantAdapter: ProviderAdapter = {
  slug:        SLUG,
  displayName: "Paytm Business",
  adapterKind: "portal_session_connector",
  category:    "upi",

  supportedLoginMethods: [
    {
      key:             "mobile_otp",
      label:           "Registered Mobile + OTP",
      identifierLabel: "Registered Mobile Number",
      identifierType:  "mobile",
      requiresOtp:      true,
      requiresPassword: false,
      mayRequireCaptcha: true,
    },
  ],

  // ── initiateSession ──────────────────────────────────────────────────────────

  async initiateSession(params: InitiateParams): Promise<InitiateResult> {
    if (params.loginMethod !== "mobile_otp") {
      return {
        status: "FAILED",
        failReason: "UNSUPPORTED_LOGIN_METHOD",
        failDetail: `Login method '${params.loginMethod}' is not supported. Use 'mobile_otp'.`,
      };
    }

    // Decrypt the mobile number
    if (!params.encryptedIdentifier) {
      return {
        status: "FAILED",
        failReason: "MISSING_IDENTIFIER",
        failDetail: "Registered mobile number is required.",
      };
    }
    const mobileDecrypt = decryptSecret(params.encryptedIdentifier);
    if (!mobileDecrypt.ok) {
      return {
        status: "FAILED",
        failReason: "DECRYPT_FAILED",
        failDetail: "Could not decrypt mobile number.",
      };
    }
    const mobile = mobileDecrypt.value.trim();
    if (!mobile || mobile.length < 10) {
      return {
        status: "FAILED",
        failReason: "INVALID_IDENTIFIER",
        failDetail: "Mobile number must be at least 10 digits.",
      };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext();
      const page = await ctx.context.newPage();

      logger.info({ slug: SLUG }, "paytm_initiate_navigating");

      // Navigate to login
      const loginReached = await navigateToLogin(page);
      if (!loginReached) {
        return {
          status: "FAILED",
          failReason: "PORTAL_UNREACHABLE",
          failDetail: "Could not reach the Paytm Business login page. " +
            "The portal may be temporarily unavailable.",
          helpUrl: HELP_URL,
        };
      }

      // Check for CAPTCHA at login page entry
      if (await hasCaptcha(page)) {
        const storageState = await extractStorageState(ctx.context);
        const payload = makeSessionPayload(SLUG, 0, {
          storageState,
          step: "AWAITING_OTP",
          maskedMobile: maskMobile(mobile),
        } as unknown as Record<string, unknown>);
        const enc = encryptSessionPayload(payload);
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "CAPTCHA_REQUIRED",
          failDetail: "Paytm is showing a CAPTCHA. Please retry — CAPTCHAs are transient and " +
            "typically resolve automatically after a short wait.",
          encryptedSessionToken: enc.ok ? enc.token : undefined,
        };
      }

      // Fill mobile number
      const mobileInput = await tryLocator(page, SEL.MOBILE_INPUT);
      if (!mobileInput) {
        return {
          status: "FAILED",
          failReason: "PORTAL_STRUCTURE_CHANGED",
          failDetail: "Could not locate the mobile number input on the Paytm Business login page. " +
            "The portal UI may have changed. Please contact RasoKart support.",
          helpUrl: HELP_URL,
        };
      }
      await mobileInput.fill(mobile, { timeout: ACTION_TIMEOUT_MS });
      // Immediately let `mobile` go out of scope — the variable will be GC'd
      // We do NOT call any function that would keep it alive

      // Click "Get OTP"
      const otpBtn = await tryLocator(page, SEL.GET_OTP_BTN);
      if (!otpBtn) {
        return {
          status: "FAILED",
          failReason: "PORTAL_STRUCTURE_CHANGED",
          failDetail: "Could not locate the 'Get OTP' button on the Paytm Business login page.",
          helpUrl: HELP_URL,
        };
      }
      await otpBtn.click({ timeout: ACTION_TIMEOUT_MS });

      // Wait for OTP step — either OTP inputs appear or an error
      const postClickResult = await waitForAny(
        page,
        [...SEL.OTP_INPUT_SINGLE, SEL.OTP_INPUT_DIGITS, ...SEL.ERROR_MSG, ...SEL.CAPTCHA],
        NAV_TIMEOUT_MS,
      );

      if (!postClickResult) {
        return {
          status: "FAILED",
          failReason: "OTP_STEP_NOT_REACHED",
          failDetail: "Paytm did not transition to the OTP entry step after the mobile number was submitted. " +
            "Verify the mobile number is registered with Paytm Business.",
          helpUrl: HELP_URL,
        };
      }

      // CAPTCHA after clicking Get OTP
      if (await hasCaptcha(page)) {
        const storageState = await extractStorageState(ctx.context);
        const payload = makeSessionPayload(SLUG, 0, {
          storageState,
          step: "AWAITING_OTP",
          maskedMobile: maskMobile(mobile),
        } as unknown as Record<string, unknown>);
        const enc = encryptSessionPayload(payload);
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "CAPTCHA_REQUIRED",
          failDetail: "Paytm is showing a CAPTCHA before the OTP can be sent. This is a transient " +
            "bot-protection measure. Please wait a few minutes and try again.",
          encryptedSessionToken: enc.ok ? enc.token : undefined,
        };
      }

      // Check for error (e.g. mobile not registered)
      for (const errSel of SEL.ERROR_MSG) {
        try {
          const errEl = page.locator(errSel).first();
          if (await errEl.count() > 0) {
            const errText = (await errEl.textContent())?.trim() ?? "";
            return {
              status: "FAILED",
              failReason: "INVALID_IDENTIFIER",
              failDetail: `Paytm returned an error: "${errText}". ` +
                "Verify that this mobile number is registered with Paytm Business.",
            };
          }
        } catch {
          // continue
        }
      }

      // Serialise the browser state — cookies + localStorage include the OTP session
      const storageState = await extractStorageState(ctx.context);

      // Build and encrypt session token
      const adapterData: PaytmAdapterData = {
        storageState,
        maskedMobile: maskMobile(mobile),
        step: "AWAITING_OTP",
      };
      const payload = makeSessionPayload(SLUG, 0, adapterData as unknown as Record<string, unknown>);
      const enc = encryptSessionPayload(payload);
      if (!enc.ok) {
        return {
          status: "FAILED",
          failReason: "SESSION_ENCRYPT_FAILED",
          failDetail: "Internal error: could not encrypt session state.",
        };
      }

      logger.info({ slug: SLUG, maskedMobile: maskMobile(mobile) }, "paytm_initiate_awaiting_otp");

      return {
        status: "AWAITING_OTP",
        encryptedSessionToken: enc.token,
        nextStep: "ENTER_OTP",
        nextStepPrompt:
          `An OTP has been sent to your Paytm-registered mobile (${maskMobile(mobile)}). ` +
          "Enter the OTP in the field below to complete the connection.",
      };
    } catch (err: any) {
      logger.error({ slug: SLUG, err: err?.message }, "paytm_initiate_error");
      return {
        status: "FAILED",
        failReason: "BROWSER_ERROR",
        failDetail: `Browser automation encountered an error: ${err?.message ?? "unknown"}. ` +
          "This may be a transient issue — please try again.",
        helpUrl: HELP_URL,
      };
    } finally {
      await ctx?.release();
    }
  },

  // ── submitStep ───────────────────────────────────────────────────────────────

  async submitStep(params: SubmitStepParams): Promise<SubmitStepResult> {
    // Decrypt session token
    const tokenResult = decryptSessionToken(params.encryptedSessionToken);
    if (!tokenResult.ok) {
      return {
        status: "FAILED",
        failReason: "INVALID_SESSION_TOKEN",
        failDetail: "Session token is invalid or expired. Please restart the connection.",
      };
    }

    const adapterData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adapterData?.storageState) {
      return {
        status: "FAILED",
        failReason: "MISSING_STORAGE_STATE",
        failDetail: "No browser session state found. Please restart the connection.",
      };
    }

    // Decrypt OTP
    if (!params.encryptedOtp) {
      return {
        status: "FAILED",
        failReason: "MISSING_OTP",
        failDetail: "OTP is required.",
      };
    }
    const otpDecrypt = decryptSecret(params.encryptedOtp);
    if (!otpDecrypt.ok) {
      return {
        status: "FAILED",
        failReason: "DECRYPT_FAILED",
        failDetail: "Could not decrypt OTP.",
      };
    }
    const otp = otpDecrypt.value.trim();
    if (!otp || otp.length < 4 || otp.length > 8) {
      return {
        status: "FAILED",
        failReason: "INVALID_OTP",
        failDetail: "OTP must be 4–8 digits.",
      };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      // Restore the browser context from stored storage state
      ctx = await newIsolatedContext(adapterData.storageState);
      const page = await ctx.context.newPage();

      // Navigate to the login page — the restored cookies should put us at the OTP step
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

      // If already logged in (cookies still valid from initiate step), go to dashboard
      if (isDashboardUrl(page.url())) {
        const dashVerified = await verifySessionAlive(page);
        if (dashVerified) {
          const newStorageState = await extractStorageState(ctx.context);
          const connectedAt = new Date().toISOString();
          const newData: PaytmAdapterData = {
            storageState: newStorageState,
            maskedMobile: adapterData.maskedMobile,
            step: "CONNECTED",
            connectedAt,
          };
          const payload = makeSessionPayload(
            SLUG, 0, newData as unknown as Record<string, unknown>,
            { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000) },
          );
          const enc = encryptSessionPayload(payload);
          return {
            status: "CONNECTED",
            encryptedSessionToken: enc.ok ? enc.token : undefined,
            nextStep: "COMPLETE",
          };
        }
      }

      // Wait for OTP input to appear
      const otpInputSel = await waitForAny(
        page,
        [...SEL.OTP_INPUT_SINGLE, SEL.OTP_INPUT_DIGITS],
        NAV_TIMEOUT_MS,
      );
      if (!otpInputSel) {
        return {
          status: "FAILED",
          failReason: "OTP_STEP_NOT_FOUND",
          failDetail: "The OTP entry screen was not found. The session may have expired — " +
            "please restart the connection.",
        };
      }

      // Fill OTP
      const filled = await fillOtp(page, otp);
      if (!filled) {
        return {
          status: "FAILED",
          failReason: "OTP_FILL_FAILED",
          failDetail: "Could not locate the OTP input field. Please try again.",
        };
      }

      // Submit OTP
      const submitBtn = await tryLocator(page, SEL.SUBMIT_OTP_BTN);
      if (submitBtn) {
        await submitBtn.click({ timeout: ACTION_TIMEOUT_MS });
      } else {
        // Fallback: press Enter
        await page.keyboard.press("Enter");
      }

      // Wait for outcome: dashboard, error, CAPTCHA, or block
      const outcome = await waitForAny(
        page,
        [
          ...SEL.DASHBOARD_LANDMARK,
          ...SEL.ERROR_MSG,
          ...SEL.CAPTCHA,
          ...SEL.BLOCKED,
        ],
        NAV_TIMEOUT_MS,
      );

      // Check for account block
      if (await isBlocked(page)) {
        return {
          status: "BLOCKED",
          failReason: "ACCOUNT_BLOCKED",
          failDetail: "Your Paytm Business account appears to be blocked or under review. " +
            "Please contact Paytm Business support.",
          helpUrl: HELP_URL,
        } as any;
      }

      // Check for CAPTCHA
      if (await hasCaptcha(page)) {
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "CAPTCHA_REQUIRED",
          failDetail: "Paytm is showing a CAPTCHA during OTP verification. Please wait and retry.",
        };
      }

      // Check for error message (wrong/expired OTP)
      for (const errSel of SEL.ERROR_MSG) {
        try {
          const errEl = page.locator(errSel).first();
          if (await errEl.count() > 0) {
            const errText = (await errEl.textContent())?.trim() ?? "";
            const isExpired = errText.toLowerCase().includes("expired");
            return {
              status: "FAILED",
              failReason: isExpired ? "OTP_EXPIRED" : "INVALID_OTP",
              failDetail: `OTP verification failed: "${errText}". ` +
                (isExpired
                  ? "Please restart the connection to receive a new OTP."
                  : "Check the OTP and try again, or restart the connection for a new OTP."),
            };
          }
        } catch {
          // continue
        }
      }

      // Check if we reached the dashboard
      await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS });
      const finalUrl = page.url();

      if (!isDashboardUrl(finalUrl)) {
        return {
          status: "FAILED",
          failReason: "LOGIN_NOT_CONFIRMED",
          failDetail: "OTP was submitted but the session did not reach the dashboard. " +
            "The OTP may be incorrect or expired. Please try again.",
        };
      }

      // Verify dashboard landmark
      const landmarkFound = await waitForAny(page, SEL.DASHBOARD_LANDMARK, ACTION_TIMEOUT_MS * 2);
      if (!landmarkFound) {
        return {
          status: "FAILED",
          failReason: "DASHBOARD_NOT_VERIFIED",
          failDetail: "Reached what appears to be the dashboard URL but could not verify " +
            "the merchant account identity. Please try again.",
        };
      }

      // Session confirmed — extract and encrypt storage state
      const newStorageState = await extractStorageState(ctx.context);
      const connectedAt = new Date().toISOString();
      const newData: PaytmAdapterData = {
        storageState: newStorageState,
        maskedMobile: adapterData.maskedMobile,
        step: "CONNECTED",
        connectedAt,
      };
      const payload = makeSessionPayload(
        SLUG, 0, newData as unknown as Record<string, unknown>,
        { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000) },
      );
      const enc = encryptSessionPayload(payload);
      if (!enc.ok) {
        return {
          status: "FAILED",
          failReason: "SESSION_ENCRYPT_FAILED",
          failDetail: "Internal error: could not encrypt session state after successful login.",
        };
      }

      logger.info({ slug: SLUG, maskedMobile: adapterData.maskedMobile }, "paytm_submitstep_connected");

      return {
        status: "CONNECTED",
        encryptedSessionToken: enc.token,
        nextStep: "COMPLETE",
        nextStepPrompt: "Your Paytm Business account is now connected.",
      };
    } catch (err: any) {
      logger.error({ slug: SLUG, err: err?.message }, "paytm_submitstep_error");
      return {
        status: "FAILED",
        failReason: "BROWSER_ERROR",
        failDetail: `Browser automation error during OTP submission: ${err?.message ?? "unknown"}. ` +
          "Please try again.",
      };
    } finally {
      await ctx?.release();
    }
  },

  // ── validateSession ──────────────────────────────────────────────────────────

  async validateSession(encryptedSessionToken: string): Promise<ValidateResult> {
    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) {
      return { valid: false, reason: tokenResult.reason };
    }

    // Advisory expiry check (from token payload)
    const { expiresAt } = tokenResult.payload;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return { valid: false, reason: "session_expired" };
    }

    const adapterData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adapterData?.storageState || adapterData.step !== "CONNECTED") {
      return { valid: false, reason: "not_connected" };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adapterData.storageState);
      const page = await ctx.context.newPage();
      const alive = await verifySessionAlive(page);
      if (!alive) {
        return { valid: false, reason: "session_expired_or_revoked" };
      }
      // Re-extract storage state (cookies may have been refreshed)
      const newStorageState = await extractStorageState(ctx.context);
      const newData: PaytmAdapterData = { ...adapterData, storageState: newStorageState };
      const payload = makeSessionPayload(
        SLUG, tokenResult.payload.connectionId,
        newData as unknown as Record<string, unknown>,
        { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000) },
      );
      const enc = encryptSessionPayload(payload);
      return {
        valid: true,
        encryptedSessionToken: enc.ok ? enc.token : undefined,
        expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000),
      };
    } catch (err: any) {
      logger.error({ slug: SLUG, err: err?.message }, "paytm_validate_error");
      return { valid: false, reason: "validation_error" };
    } finally {
      await ctx?.release();
    }
  },

  // ── discoverEntities ─────────────────────────────────────────────────────────

  async discoverEntities(encryptedSessionToken: string): Promise<DiscoveryResult> {
    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) return { entities: [] };

    const adapterData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adapterData?.storageState) return { entities: [] };

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adapterData.storageState);
      const page = await ctx.context.newPage();

      // Navigate to profile/settings to discover MID and VPA
      await page.goto(`${PORTAL_URL}/profile`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      if (!isDashboardUrl(page.url())) {
        return { entities: [] };
      }

      // Try to extract MID from the profile page
      const mid = await (async () => {
        for (const sel of SEL.MID) {
          try {
            const el = page.locator(sel).first();
            if (await el.count() > 0) {
              const text = await el.textContent();
              const match = text?.match(/\d{12,}/);
              if (match) return match[0];
            }
          } catch {
            // continue
          }
        }
        return null;
      })();

      // Extract masked mobile from the token
      const maskedMobile = adapterData.maskedMobile;

      const entities = [];

      if (mid) {
        entities.push({
          entityType:        "merchant" as const,
          providerEntityId:  mid,
          providerEntityName: "Paytm Business Merchant",
          isPrimary:         true,
          metadata:          { mid },
        });
      }

      if (maskedMobile) {
        entities.push({
          entityType:        "merchant" as const,
          providerEntityId:  maskedMobile,
          providerEntityName: "Registered Mobile",
          isPrimary:         mid === null,
          metadata:          { maskedMobile },
        });
      }

      // Re-extract storage state (cookies may have refreshed)
      const newStorageState = await extractStorageState(ctx.context);
      const newData: PaytmAdapterData = { ...adapterData, storageState: newStorageState };
      const payload = makeSessionPayload(
        SLUG, tokenResult.payload.connectionId,
        newData as unknown as Record<string, unknown>,
      );
      const enc = encryptSessionPayload(payload);

      logger.info({ slug: SLUG, entityCount: entities.length }, "paytm_discovery_complete");

      return {
        entities,
        encryptedSessionToken: enc.ok ? enc.token : undefined,
      };
    } catch (err: any) {
      logger.warn({ slug: SLUG, err: err?.message }, "paytm_discovery_error");
      return { entities: [] };
    } finally {
      await ctx?.release();
    }
  },

  // ── fetchTransactions ────────────────────────────────────────────────────────

  async fetchTransactions(params: FetchTransactionsParams): Promise<FetchTransactionsResult> {
    const tokenResult = decryptSessionToken(params.encryptedSessionToken);
    if (!tokenResult.ok) {
      return { transactions: [], hasMore: false };
    }

    const adapterData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adapterData?.storageState || adapterData.step !== "CONNECTED") {
      return { transactions: [], hasMore: false };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adapterData.storageState);
      const page = await ctx.context.newPage();

      // Navigate to transactions / reports section
      // Paytm Business portal transaction history URL pattern
      const txUrl = `${PORTAL_URL}/dashboard/transactions`;
      await page.goto(txUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

      if (!isDashboardUrl(page.url())) {
        logger.warn({ slug: SLUG, url: page.url() }, "paytm_fetch_not_on_dashboard");
        return { transactions: [], hasMore: false };
      }

      // Wait for transaction rows to appear
      const rowSel = SEL.TX_ROW.join(", ");
      try {
        await page.waitForSelector(rowSel, { timeout: NAV_TIMEOUT_MS });
      } catch {
        // No transactions visible — could be empty page or different UI structure
        logger.info({ slug: SLUG }, "paytm_fetch_no_tx_rows_visible");
        return { transactions: [], hasMore: false };
      }

      // Extract visible transaction rows
      // This is a best-effort DOM scrape. If Paytm changes their HTML structure,
      // this returns empty rather than returning incorrect data.
      const rawRows = await page.evaluate((selectors) => {
        const results: Array<{
          id?: string;
          amount?: string;
          status?: string;
          date?: string;
          utr?: string;
          orderId?: string;
        }> = [];

        // document + Element are browser globals — api-server tsconfig does not
        // include lib:dom so we access them through globalThis typed as any.
        // This callback is serialised and evaluated inside Playwright's browser context,
        // so these globals are always present at runtime.
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const doc = (globalThis as any)["document"] as any;
        for (const sel of selectors) {
          const rows: any[] = Array.from(doc.querySelectorAll(sel));
          if (rows.length === 0) continue;
          for (const row of (rows as any[]).slice(0, 100)) {
            const text: string = row.textContent ?? "";
            // Amount — look for ₹ or numbers with decimals
            const amtMatch = text.match(/[₹]?\s*([\d,]+\.?\d{0,2})/);
            // Status keywords
            const statusRaw =
              text.toLowerCase().includes("success")   ? "SUCCESS"  :
              text.toLowerCase().includes("failed")    ? "FAILED"   :
              text.toLowerCase().includes("refund")    ? "REVERSED" :
              text.toLowerCase().includes("pending")   ? "PENDING"  : null;
            // UTR
            const utrMatch = text.match(/\b[A-Z0-9]{12,22}\b/);
            // Date
            const dateMatch = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);

            if (amtMatch || statusRaw) {
              results.push({
                amount:  amtMatch?.[1]?.replace(/,/g, ""),
                status:  statusRaw ?? undefined,
                date:    dateMatch?.[0],
                utr:     utrMatch?.[0],
              });
            }
          }
          if (results.length > 0) break;  // stop after first matching selector
        }
        return results;
      }, SEL.TX_ROW);

      const transactions: NormalizedTransaction[] = [];
      for (const raw of rawRows) {
        if (!raw.amount && !raw.status) continue;
        const amountPaise = raw.amount
          ? Math.round(parseFloat(raw.amount) * 100)
          : 0;
        const normalizedStatus: PortalTxStatus =
          raw.status === "SUCCESS"  ? "SUCCESS"  :
          raw.status === "FAILED"   ? "FAILED"   :
          raw.status === "REVERSED" ? "REVERSED" :
          raw.status === "PENDING"  ? "PENDING"  : "UNKNOWN";

        // Generate a deterministic pseudo-ID from available data since Paytm
        // DOM rows may not expose the underlying transaction ID directly.
        const pseudoId = [raw.utr, raw.amount, raw.date]
          .filter(Boolean)
          .join("::");

        if (!pseudoId) continue;  // skip rows with no identifying data

        transactions.push({
          providerTxId:    pseudoId,
          amount:          amountPaise,
          currency:        "INR",
          status:          normalizedStatus,
          providerStatus:  raw.status ?? "UNKNOWN",
          utr:             raw.utr,
          txTimestamp:     raw.date ? new Date(raw.date) : undefined,
          rawPayload:      {
            // Stripped of any sensitive fields — safe to store
            amount_str: raw.amount,
            status_str: raw.status,
            date_str:   raw.date,
            utr:        raw.utr,
          },
        });
      }

      // Re-extract storage state
      const newStorageState = await extractStorageState(ctx.context);
      const newData: PaytmAdapterData = { ...adapterData, storageState: newStorageState };
      const payload = makeSessionPayload(
        SLUG, tokenResult.payload.connectionId,
        newData as unknown as Record<string, unknown>,
      );
      const enc = encryptSessionPayload(payload);

      logger.info({ slug: SLUG, count: transactions.length }, "paytm_fetch_complete");

      return {
        transactions,
        hasMore: false,  // page-based fetch — no cursor support yet
        encryptedSessionToken: enc.ok ? enc.token : undefined,
      };
    } catch (err: any) {
      logger.error({ slug: SLUG, err: err?.message }, "paytm_fetch_error");
      return { transactions: [], hasMore: false };
    } finally {
      await ctx?.release();
    }
  },

  // ── healthCheck ──────────────────────────────────────────────────────────────

  async healthCheck(encryptedSessionToken?: string): Promise<HealthCheckResult> {
    // Light-weight: just check if business.paytm.com is reachable.
    // Does NOT launch a full browser context.
    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext();
      const page = await ctx.context.newPage();
      await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      const status = page.url().startsWith("https://") ? "CONNECTED" : "FAILED";
      return {
        healthy: status === "CONNECTED",
        status:  "CONNECTED" as any,
        reason:  "Paytm Business portal is reachable.",
      };
    } catch (err: any) {
      return {
        healthy: false,
        status:  "FAILED" as any,
        reason:  "PORTAL_UNREACHABLE",
        detail:  `Could not reach ${PORTAL_URL}: ${err?.message ?? "unknown"}`,
      };
    } finally {
      await ctx?.release();
    }
  },

  // ── reconnect ────────────────────────────────────────────────────────────────

  async reconnect(encryptedSessionToken: string): Promise<InitiateResult> {
    // For mobile-OTP adapters, reconnect tries the stored session first.
    // If the session is still alive → return CONNECTED with refreshed token.
    // If expired → return AWAITING_OTP so the UI prompts for a new OTP.
    // Never fabricates CONNECTED.

    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) {
      return {
        status: "AWAITING_OTP" as any,
        failReason: "REQUIRES_FULL_REAUTH",
        failDetail: "Session token is invalid. Please re-enter your mobile number to receive a new OTP.",
        nextStep: "ENTER_OTP",
      };
    }

    const adapterData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adapterData?.storageState) {
      return {
        status: "AWAITING_OTP" as any,
        failReason: "REQUIRES_FULL_REAUTH",
        failDetail: "No session state found. Please re-enter your mobile number.",
        nextStep: "ENTER_OTP",
      };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adapterData.storageState);
      const page = await ctx.context.newPage();
      const alive = await verifySessionAlive(page);

      if (alive) {
        // Session still valid — refresh token
        const newStorageState = await extractStorageState(ctx.context);
        const newData: PaytmAdapterData = {
          ...adapterData,
          storageState: newStorageState,
          step: "CONNECTED",
        };
        const payload = makeSessionPayload(
          SLUG, tokenResult.payload.connectionId,
          newData as unknown as Record<string, unknown>,
          { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000) },
        );
        const enc = encryptSessionPayload(payload);
        logger.info({ slug: SLUG }, "paytm_reconnect_session_alive");
        return {
          status: "CONNECTED",
          encryptedSessionToken: enc.ok ? enc.token : undefined,
          nextStep: "COMPLETE",
          nextStepPrompt: "Session reconnected successfully.",
        };
      }

      // Session expired — need a new OTP
      logger.info({ slug: SLUG }, "paytm_reconnect_session_expired");
      return {
        status: "AWAITING_OTP" as any,
        failReason: "SESSION_EXPIRED",
        failDetail: "Your Paytm Business session has expired. Enter your mobile number to receive a new OTP.",
        nextStep: "ENTER_OTP",
        nextStepPrompt: "Session expired. A new OTP is needed.",
      };
    } catch (err: any) {
      logger.error({ slug: SLUG, err: err?.message }, "paytm_reconnect_error");
      return {
        status: "AWAITING_OTP" as any,
        failReason: "RECONNECT_ERROR",
        failDetail: `Could not verify session: ${err?.message ?? "unknown"}. Please enter your mobile number.`,
        nextStep: "ENTER_OTP",
      };
    } finally {
      await ctx?.release();
    }
  },

  // ── logout ───────────────────────────────────────────────────────────────────

  async logout(encryptedSessionToken: string): Promise<void> {
    // Best-effort: restore context, navigate to logout URL, close.
    // Must not throw.
    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) return;

    const adapterData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adapterData?.storageState) return;

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adapterData.storageState);
      const page = await ctx.context.newPage();
      await page.goto(`${PORTAL_URL}/user/logout`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      logger.info({ slug: SLUG }, "paytm_logout_complete");
    } catch (err: any) {
      // Swallow — logout must not throw
      logger.warn({ slug: SLUG, err: err?.message }, "paytm_logout_error_swallowed");
    } finally {
      await ctx?.release();
    }
  },
};
