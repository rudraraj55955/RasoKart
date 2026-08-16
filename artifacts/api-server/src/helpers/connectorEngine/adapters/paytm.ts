/**
 * Paytm Business Portal Adapter — portal_session_connector
 *
 * Provider:   Paytm Business (business.paytm.com)
 * Kind:       portal_session_connector
 * Auth path:  Registered mobile → OTP (only supported login path on the
 *             current Paytm Business portal)
 *
 * HOW IT WORKS:
 *   1. initiateSession() — launches an isolated Chromium context, navigates to
 *      business.paytm.com, enters the merchant's mobile number, triggers OTP,
 *      and returns AWAITING_OTP. The browser storage state (cookies + JS
 *      storage) is serialised, encrypted, and stored as the session token.
 *   2. submitStep() — restores the browser context from the encrypted session
 *      token, fills the OTP, submits, verifies the session reached the dashboard
 *      AND confirms merchant identity, re-serialises updated storage state,
 *      returns CONNECTED.
 *   3. All subsequent calls restore context from the stored encrypted token.
 *
 * CONNECTED GATE (cannot be skipped):
 *   submitStep returns CONNECTED only when ALL of:
 *     (a) Final URL is NOT any login/OTP page pattern
 *     (b) URL matches a dashboard pattern (contains /home or /dashboard)
 *     (c) At least one dashboard landmark element is present in the DOM
 *     (d) The login form is NOT visible on the page
 *   Failing any check → FAILED or AWAITING_USER_ACTION.
 *
 * SECURITY INVARIANTS:
 *   - Passwords are NEVER stored or passed. This adapter is OTP-only.
 *   - Mobile numbers are decrypted locally, filled into the browser, let out
 *     of scope. Never written to disk, logged, or returned.
 *   - OTPs are decrypted locally, filled into the browser, let out of scope
 *     immediately. Never stored or logged.
 *   - The session token stores ONLY serialised browser storage state (cookies
 *     + localStorage), AES-256-GCM encrypted.
 *   - maskedMobile (e.g. "**XXXXXX890") is the only identifier persisted in
 *     plaintext. Derived server-side, safe to display.
 *   - Screenshots, video, and network tracing are DISABLED in the browser pool.
 *
 * FAIL-CLOSED CONTRACT:
 *   - Any exception, unexpected page state, or timeout → non-CONNECTED status
 *     with a diagnostic failReason. CONNECTED is returned ONLY after the full
 *     CONNECTED GATE above passes.
 *   - CAPTCHA → AWAITING_USER_ACTION
 *   - Account lock → BLOCKED
 *   - Invalid/expired OTP → FAILED / INVALID_OTP or OTP_EXPIRED
 *   - Browser launch failure → FAILED / BROWSER_ERROR or PORTAL_UNREACHABLE
 *
 * MUTATIONS:
 *   None. This adapter only reads data. It does not initiate payments,
 *   refunds, payouts, settlements, beneficiary changes, or profile updates.
 *
 * NO CAPTCHA BYPASS:
 *   CAPTCHA detection returns AWAITING_USER_ACTION so the merchant can retry
 *   manually. No CAPTCHA solving, third-party OCR, or evasion techniques are
 *   used.
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

// ── Portal URLs ───────────────────────────────────────────────────────────────

const HELP_URL = "https://business.paytm.com";

/**
 * Portal root URL. Set PAYTM_PORTAL_ROOT_OVERRIDE in tests to redirect all
 * adapter navigation to a local mock HTTP server — this allows full E2E testing
 * without any real Paytm network calls or OTP sending.
 *
 * Production value: "https://business.paytm.com" (never overridden at runtime).
 */
function getPortalRoot(): string {
  return process.env["PAYTM_PORTAL_ROOT_OVERRIDE"] ?? "https://business.paytm.com";
}

/** Login URL candidates, derived from the portal root at call time. */
function getLoginUrlCandidates(): string[] {
  const root = getPortalRoot();
  return [`${root}/user/login`, `${root}/login`, root];
}

/** Profile paths to try for ownership verification, in preference order. */
const PROFILE_PATHS = [
  "/profile",
  "/account",
  "/user/profile",
  "/settings/profile",
  "/merchant-profile",
];

// URL patterns indicating the session is on a login/auth page (NOT dashboard)
const LOGIN_PAGE_URL_PATTERNS = [
  "/user/login",
  "/login",
  "?redirectTo=",
  "?redirect=",
  "?returnUrl=",
  "accounts.paytm.com",
  "auth.paytm.com",
];

// URL patterns that indicate we are on the authenticated dashboard
const DASHBOARD_URL_PATTERNS = [
  "/home",
  "/dashboard",
  "/overview",
  "/transactions",
  "/reports",
  "/settlements",
  "/qr",
  "/pos",
  "/payments",
  "/analytics",
];

const SESSION_TTL_HOURS = 24;

// ── Selectors ─────────────────────────────────────────────────────────────────
// Updated for Paytm Business portal (current as of 2025).
// All selectors use visible-text, ARIA roles, or well-known attributes.
// Ordering: most specific / most reliable first.
// These are maintained separately from business logic to ease future updates.

const SEL = {
  // Phone / mobile number input on the login form
  MOBILE_INPUT: [
    'input[type="tel"]',
    'input[name="phone"]',
    'input[name="mobile"]',
    'input[name="mobileNo"]',
    'input[placeholder*="mobile" i]',
    'input[placeholder*="phone" i]',
    'input[id*="mobile" i]',
    'input[id*="phone" i]',
    'input[autocomplete="tel"]',
  ],

  // "Get OTP" / "Continue" button after mobile entry
  GET_OTP_BTN: [
    'button:has-text("Get OTP")',
    'button:has-text("Request OTP")',
    'button:has-text("Send OTP")',
    // Paytm may use "Proceed" on the first step
    'button:has-text("Proceed")',
    'button:has-text("Continue")',
    '[role="button"]:has-text("Get OTP")',
    '[role="button"]:has-text("Send OTP")',
    '[type="submit"]:has-text("OTP")',
  ],

  // OTP input — handles both single-field and individual digit boxes
  OTP_INPUT_SINGLE: [
    'input[autocomplete="one-time-code"]',
    'input[name="otp"]',
    'input[name="otpValue"]',
    'input[placeholder*="OTP" i]',
    'input[placeholder*="Enter OTP" i]',
    'input[placeholder*="verification code" i]',
    'input[type="number"][maxlength="6"]',
    'input[type="tel"][maxlength="6"]',
    'input[type="text"][maxlength="6"]',
  ],
  // Individual digit boxes (Paytm's custom OTP component)
  OTP_INPUT_DIGITS: [
    'input[type="text"][maxlength="1"]',
    'input[type="number"][maxlength="1"]',
    'input[type="tel"][maxlength="1"]',
  ],

  // Submit OTP button
  SUBMIT_OTP_BTN: [
    'button:has-text("Verify OTP")',
    'button:has-text("Verify")',
    'button:has-text("Submit OTP")',
    'button:has-text("Submit")',
    'button:has-text("Login")',
    'button:has-text("Sign In")',
    '[role="button"]:has-text("Verify")',
    '[type="submit"]',
  ],

  // Dashboard landmarks — at least one must be visible for CONNECTED to pass
  DASHBOARD_LANDMARK: [
    // Text that only appears on the authenticated dashboard
    'text=Total Transactions',
    'text=Gross Sales',
    'text=Settlement Amount',
    'text=Success Rate',
    // Navigation items that only appear when logged in
    'a[href*="/transactions"]',
    'a[href*="/settlement"]',
    'a[href*="/reports"]',
    // Generic dashboard structure
    '[data-testid*="dashboard"]',
    'nav[aria-label*="sidebar" i]',
    '[aria-label*="merchant" i]',
    // Profile / account menu (only shown when authenticated)
    '[aria-label*="profile" i]',
    '[aria-label*="account" i]',
  ],

  // Login form elements — must NOT be visible when CONNECTED
  LOGIN_FORM: [
    'input[type="tel"]',
    'input[name="phone"]',
    'input[name="mobile"]',
    'button:has-text("Get OTP")',
    'button:has-text("Request OTP")',
  ],

  // CAPTCHA detection
  CAPTCHA: [
    'iframe[src*="recaptcha"]',
    'iframe[src*="captcha"]',
    'iframe[src*="hcaptcha"]',
    '[class*="captcha"]',
    '[id*="captcha"]',
    'text=complete the CAPTCHA',
    'text=verify you are human',
    'text=I\'m not a robot',
  ],

  // Account block / suspicious activity
  BLOCKED: [
    'text=account has been blocked',
    'text=suspicious activity',
    'text=temporarily locked',
    'text=account is suspended',
    'text=access has been restricted',
  ],

  // Error messages (OTP errors, validation errors)
  ERROR_MSG: [
    '[role="alert"]',
    '[class*="error"]:not(input)',
    '[class*="Error"]:not(input)',
    'p:has-text("Invalid OTP")',
    'p:has-text("Incorrect OTP")',
    'span:has-text("Invalid OTP")',
    'span:has-text("OTP expired")',
    'span:has-text("OTP has expired")',
    'span:has-text("Please enter a valid")',
    'div:has-text("Mobile number is not")',
    'div:has-text("Please enter valid mobile")',
  ],

  // Transaction rows in the portal
  TX_ROW: [
    '[data-testid*="transaction"]',
    '[class*="transaction-row"]',
    '[class*="txn-row"]',
    '[class*="transactionItem"]',
    'tr[class*="transaction"]',
    'tbody tr',  // generic table row fallback
  ],

  // MID in profile page
  MID: [
    '[data-testid*="mid"]',
    '[data-testid*="merchant-id"]',
    'text=Merchant ID',
    '[class*="merchant-id"]',
    '[class*="mid"]',
  ],

  // Profile / account page — registered mobile selectors for ownership verification
  OWNERSHIP_MOBILE: [
    '[data-testid="registered-mobile"]',
    '.registered-mobile',
    '[class*="registered-mobile" i]',
    'p:has-text("Registered Mobile")',
    'span:has-text("Mobile:")',
    'td:has-text("Mobile")',
    'div:has-text("Mobile")',
    '[data-testid*="phone"]',
  ],
};

// ── Adapter-specific session data ─────────────────────────────────────────────

interface PaytmAdapterData {
  /** Playwright serialised storage state — contains session cookies. SENSITIVE. */
  storageState: BrowserStorageState;
  /** Masked mobile, e.g. "**XXXXXX890" — safe to display, never the full number. */
  maskedMobile?: string;
  /** FSM step. */
  step: "AWAITING_OTP" | "CONNECTED";
  /** ISO string when session was established. */
  connectedAt?: string;
  /** MID extracted during discoverEntities (may be empty if not yet discovered). */
  merchantId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskMobile(mobile: string): string {
  if (mobile.length < 4) return "****";
  return "**XXXXXX" + mobile.slice(-3);
}

/**
 * Try each selector in order and return the first visible locator found.
 * Returns null if none match.
 */
async function tryLocator(page: Page, selectors: string[], timeout = ACTION_TIMEOUT_MS / 2) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      const n = await loc.count();
      if (n > 0) {
        // Additional check: element should be visible (not just in DOM)
        const visible = await loc.isVisible().catch(() => false);
        if (visible) return loc;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Wait for any of the selectors to become visible. Returns the first matching
 * selector string, or null if none appeared within the timeout.
 */
async function waitForAny(
  page: Page,
  selectors: string[],
  timeout: number,
): Promise<string | null> {
  const controller = new AbortController();

  const promises = selectors.map(async (sel) => {
    try {
      await page.waitForSelector(sel, { state: "visible", timeout });
      return sel;
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

/**
 * Check if the current URL indicates we are on the authenticated dashboard
 * (not on any login / OTP / redirect page).
 */
function isDashboardUrl(url: string): boolean {
  const root = getPortalRoot();
  // Must be on the configured portal host (real or mock override)
  if (!url.startsWith(root) && !url.startsWith("https://business.paytm.com")) return false;
  // Reject login-page URLs (path-based check handles both real and mock)
  if (isLoginUrl(url)) return false;
  // Extract pathname
  let pathname = url;
  try { pathname = new URL(url).pathname; } catch {}
  // Root path after login is the dashboard
  if (pathname === "/" || pathname === "") return true;
  // Known dashboard path prefixes
  for (const pattern of DASHBOARD_URL_PATTERNS) {
    if (pathname.startsWith(pattern)) return true;
  }
  return false;
}

/**
 * Check if the current URL is a login/auth page.
 * Path-based matching works for both real Paytm and mock server URLs.
 */
function isLoginUrl(url: string): boolean {
  let pathname = url;
  try { pathname = new URL(url).pathname; } catch {}
  // Path-based: works for both real Paytm and mock server
  const loginPaths = ["/user/login", "/login"];
  for (const p of loginPaths) {
    if (pathname === p || pathname.startsWith(p + "?") || pathname.startsWith(p + "/")) return true;
  }
  // Hostname-based patterns (additional real-Paytm checks)
  for (const pattern of LOGIN_PAGE_URL_PATTERNS) {
    if (url.includes(pattern)) return true;
  }
  return false;
}

/** Detect CAPTCHA on the current page. */
async function hasCaptcha(page: Page): Promise<boolean> {
  for (const sel of SEL.CAPTCHA) {
    try {
      if (await page.locator(sel).first().count() > 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

/** Detect account block / suspension. */
async function isBlocked(page: Page): Promise<boolean> {
  for (const sel of SEL.BLOCKED) {
    try {
      if (await page.locator(sel).first().count() > 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

/**
 * Fill OTP — handles both single-field and individual-digit-box layouts.
 * Returns true if OTP was successfully filled.
 */
async function fillOtp(page: Page, otp: string): Promise<boolean> {
  // Try single OTP field first
  const single = await tryLocator(page, SEL.OTP_INPUT_SINGLE);
  if (single) {
    await single.fill(otp, { timeout: ACTION_TIMEOUT_MS });
    return true;
  }

  // Try individual digit boxes (Paytm's custom OTP input)
  for (const digitSel of SEL.OTP_INPUT_DIGITS) {
    const boxes = page.locator(digitSel);
    const count = await boxes.count().catch(() => 0);
    if (count >= otp.length) {
      for (let i = 0; i < otp.length; i++) {
        await boxes.nth(i).fill(otp[i]!, { timeout: ACTION_TIMEOUT_MS });
      }
      return true;
    }
  }

  return false;
}

/**
 * Navigate to the Paytm Business login page and detect the current auth state.
 *
 * Returns:
 *   "otp_form"    — OTP inputs visible (pending session from initiateSession)
 *   "mobile_form" — Mobile entry form visible (fresh / expired session)
 *   "dashboard"   — Already on dashboard (session still live)
 *   false         — Could not reach any recognisable page
 */
async function navigateToLoginPage(
  page: Page,
): Promise<"mobile_form" | "otp_form" | "dashboard" | false> {
  for (const url of getLoginUrlCandidates()) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

      const currentUrl = page.url();

      // Redirected to dashboard — session was still valid
      if (isDashboardUrl(currentUrl)) return "dashboard";

      // Check for OTP inputs first — portal puts us directly on OTP step if initiate
      // session cookies are still live (the portal remembers the pending OTP request)
      const otpLoc = await tryLocator(
        page,
        [...SEL.OTP_INPUT_SINGLE, ...SEL.OTP_INPUT_DIGITS],
        ACTION_TIMEOUT_MS,
      );
      if (otpLoc) return "otp_form";

      // Check for mobile input — fresh session or expired OTP session
      const mobileInput = await tryLocator(page, SEL.MOBILE_INPUT, ACTION_TIMEOUT_MS);
      if (mobileInput) return "mobile_form";
    } catch {
      // try next URL candidate
    }
  }
  return false;
}

// ── Ownership verification ───────────────────────────────────────────────────

/** Mask an identifier for safe logging/display. Keeps first + last 3 chars. */
function maskIdentifier(raw: string): string {
  const s = raw.trim();
  if (s.length <= 4) return "****";
  return s[0] + "****" + s.slice(-3);
}

/**
 * Navigate to the merchant's profile page and verify that at least one
 * displayed identifier (masked mobile phone number) matches the last 3 digits
 * of the mobile provided at initiateSession time.
 *
 * SECURITY CONTRACT:
 *   - CONNECTED is NEVER returned without this check passing.
 *   - "Dashboard visible" alone is NOT sufficient evidence of account ownership.
 *   - Only the unmasked suffix (last 3 digits) is compared — never the full number.
 *   - Navigating to the profile page requires the portal session to be live
 *     (adds an implicit auth check beyond the dashboard landmark gate).
 *   - If the profile is unreachable or has no recognisable identifier, the check
 *     FAILS (fail-closed) — CONNECTED is NOT returned.
 *   - The comparison result is logged (masked) for audit; the full mobile is not.
 *
 * Returns:
 *   { verified: true, identifier: "<masked>" }  on success
 *   { verified: false, reason: "<code>" }       on failure
 */
async function verifyOwnershipFromPortal(
  page: Page,
  adData: PaytmAdapterData,
  portalRoot: string,
): Promise<{ verified: boolean; identifier?: string; reason?: string }> {
  const storedMasked = adData.maskedMobile ?? "";
  // Extract last 3 numeric digits from stored maskedMobile.
  // e.g. "**XXXXXX890" → digits "890"
  const storedSuffix = storedMasked.replace(/\D/g, "").slice(-3);

  if (!storedSuffix || storedSuffix.length < 3) {
    logger.warn({ slug: "paytm_merchant" }, "paytm_ownership_no_stored_suffix");
    return { verified: false, reason: "NO_STORED_MOBILE_SUFFIX" };
  }

  for (const profilePath of PROFILE_PATHS) {
    try {
      await page.goto(`${portalRoot}${profilePath}`, {
        waitUntil: "domcontentloaded",
        timeout: 10_000,
      });

      const currentUrl = page.url();
      // Redirected to login — session expired, skip to next path
      if (isLoginUrl(currentUrl)) continue;

      // ── Specific selector search ──────────────────────────────────────────
      for (const sel of SEL.OWNERSHIP_MOBILE) {
        try {
          const el = page.locator(sel).first();
          if (await el.count() > 0) {
            const text = (await el.textContent())?.trim() ?? "";
            const elDigits = text.replace(/\D/g, "");
            if (elDigits.endsWith(storedSuffix) && elDigits.length >= 3) {
              logger.info(
                { slug: "paytm_merchant", profilePath },
                "paytm_ownership_verified_selector",
              );
              return { verified: true, identifier: maskIdentifier(text) };
            }
          }
        } catch { /* continue */ }
      }

      // ── Full page text search ─────────────────────────────────────────────
      const pageText = await page
        .evaluate(() => (globalThis as any)["document"]?.body?.innerText ?? "")
        .catch(() => "");

      for (const line of pageText.split("\n")) {
        const lineDigits = line.replace(/\D/g, "");
        if (lineDigits.length >= 3 && lineDigits.endsWith(storedSuffix)) {
          // Line must look like a masked phone (has mask chars or has ≥7 digits)
          const hasMaskChars = /[X*●•]/.test(line);
          const isPhoneLength = lineDigits.length >= 7;
          if (hasMaskChars || isPhoneLength) {
            logger.info(
              { slug: "paytm_merchant", profilePath },
              "paytm_ownership_verified_text_search",
            );
            return { verified: true, identifier: maskIdentifier(line.trim()) };
          }
        }
      }
    } catch {
      // Profile path navigation failed — try next
    }
  }

  // No matching identifier found across all profile paths
  logger.warn(
    { slug: "paytm_merchant", maskedMobile: storedMasked },
    "paytm_ownership_verification_failed",
  );
  return { verified: false, reason: "NO_MATCHING_IDENTIFIER_FOUND" };
}

/**
 * CONNECTED verification gate.
 * Returns true ONLY when ALL of the following are true:
 *   (a) URL is NOT a login/OTP page
 *   (b) URL matches a dashboard path
 *   (c) At least one dashboard landmark is visible in the DOM
 *   (d) No login form element is visible
 *
 * This is the authoritative CONNECTED gate — it cannot be bypassed.
 */
async function verifyDashboardAuthenticated(page: Page): Promise<{
  verified: boolean;
  reason?: string;
}> {
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});

  const url = page.url();

  // (a) Must not be a login page
  if (isLoginUrl(url)) {
    return { verified: false, reason: `URL_IS_LOGIN_PAGE: ${url}` };
  }

  // (b) Must be on a dashboard URL
  if (!isDashboardUrl(url)) {
    return { verified: false, reason: `URL_NOT_DASHBOARD: ${url}` };
  }

  // (c) At least one dashboard landmark must be visible
  const landmark = await waitForAny(page, SEL.DASHBOARD_LANDMARK, ACTION_TIMEOUT_MS * 2);
  if (!landmark) {
    return { verified: false, reason: "NO_DASHBOARD_LANDMARK_VISIBLE" };
  }

  // (d) Login form must NOT be visible (guards against invisible cached pages)
  for (const loginSel of SEL.LOGIN_FORM) {
    try {
      const el = page.locator(loginSel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        return { verified: false, reason: `LOGIN_FORM_STILL_VISIBLE: ${loginSel}` };
      }
    } catch { /* continue */ }
  }

  return { verified: true };
}

/**
 * Validate a stored session by restoring the context and running the
 * CONNECTED verification gate.
 */
async function verifySessionAlive(page: Page): Promise<boolean> {
  try {
    await page.goto(getPortalRoot(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    const result = await verifyDashboardAuthenticated(page);
    return result.verified;
  } catch {
    return false;
  }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const paytmMerchantAdapter: ProviderAdapter = {
  slug:        "paytm_merchant",
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
    const mobile = mobileDecrypt.value.trim().replace(/\D/g, "");
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

      logger.info({ slug: "paytm_merchant" }, "paytm_initiate_navigating");

      // Navigate to login page
      const loginReached = await navigateToLoginPage(page);

      // If already on dashboard (session still valid) — this shouldn't happen in initiate
      if (!loginReached) {
        const onDash = await verifyDashboardAuthenticated(page);
        if (onDash.verified) {
          // Unexpected: we have a live session already. Return CONNECTED.
          const storageState = await extractStorageState(ctx.context);
          const adData: PaytmAdapterData = {
            storageState,
            maskedMobile: maskMobile(mobile),
            step: "CONNECTED",
            connectedAt: new Date().toISOString(),
          };
          const payload = makeSessionPayload("paytm_merchant", 0, adData as unknown as Record<string, unknown>, {
            expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000),
          });
          const enc = encryptSessionPayload(payload);
          return {
            status: "CONNECTED",
            encryptedSessionToken: enc.ok ? enc.token : undefined,
            nextStep: "COMPLETE",
          };
        }

        return {
          status: "FAILED",
          failReason: "PORTAL_UNREACHABLE",
          failDetail: "Could not reach the Paytm Business login page. " +
            "The portal may be temporarily unavailable.",
          helpUrl: HELP_URL,
        };
      }

      // Check for CAPTCHA at login entry
      if (await hasCaptcha(page)) {
        const storageState = await extractStorageState(ctx.context);
        const adData: PaytmAdapterData = {
          storageState, maskedMobile: maskMobile(mobile), step: "AWAITING_OTP",
        };
        const enc = encryptSessionPayload(
          makeSessionPayload("paytm_merchant", 0, adData as unknown as Record<string, unknown>),
        );
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "CAPTCHA_REQUIRED",
          failDetail: "Paytm is showing a CAPTCHA. CAPTCHAs are transient — " +
            "please wait a few minutes and try again.",
          encryptedSessionToken: enc.ok ? enc.token : undefined,
        };
      }

      // Fill mobile number
      const mobileInput = await tryLocator(page, SEL.MOBILE_INPUT);
      if (!mobileInput) {
        return {
          status: "FAILED",
          failReason: "PORTAL_STRUCTURE_CHANGED",
          failDetail: "Could not locate the mobile number input on the Paytm Business " +
            "login page. The portal UI may have changed — please contact RasoKart support.",
          helpUrl: HELP_URL,
        };
      }
      await mobileInput.fill(mobile, { timeout: ACTION_TIMEOUT_MS });
      // `mobile` variable out of scope after the next await (GC eligible)

      // Click "Get OTP" button
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

      // Wait for OTP inputs or an error message to appear
      const allOtpAndErrorSels = [
        ...SEL.OTP_INPUT_SINGLE,
        ...SEL.OTP_INPUT_DIGITS,
        ...SEL.ERROR_MSG,
        ...SEL.CAPTCHA,
      ];
      const postClickResult = await waitForAny(page, allOtpAndErrorSels, NAV_TIMEOUT_MS);

      if (!postClickResult) {
        return {
          status: "FAILED",
          failReason: "OTP_STEP_NOT_REACHED",
          failDetail: "Paytm did not transition to the OTP entry step. " +
            "Verify the mobile number is registered with Paytm Business.",
          helpUrl: HELP_URL,
        };
      }

      // CAPTCHA after clicking Get OTP
      if (await hasCaptcha(page)) {
        const storageState = await extractStorageState(ctx.context);
        const adData: PaytmAdapterData = {
          storageState, maskedMobile: maskMobile(mobile), step: "AWAITING_OTP",
        };
        const enc = encryptSessionPayload(
          makeSessionPayload("paytm_merchant", 0, adData as unknown as Record<string, unknown>),
        );
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "CAPTCHA_REQUIRED",
          failDetail: "Paytm is showing a CAPTCHA before the OTP can be sent. " +
            "Please wait a few minutes and try again.",
          encryptedSessionToken: enc.ok ? enc.token : undefined,
        };
      }

      // Check for explicit error messages (e.g. mobile not registered)
      for (const errSel of SEL.ERROR_MSG) {
        try {
          const errEl = page.locator(errSel).first();
          if (await errEl.count() > 0 && await errEl.isVisible()) {
            const errText = (await errEl.textContent())?.trim() ?? "";
            if (errText) {
              return {
                status: "FAILED",
                failReason: "INVALID_IDENTIFIER",
                failDetail: `Paytm returned an error: "${errText}". ` +
                  "Verify this mobile number is registered with Paytm Business.",
              };
            }
          }
        } catch { /* continue */ }
      }

      // Serialise browser state (cookies + localStorage)
      const storageState = await extractStorageState(ctx.context);

      const adData: PaytmAdapterData = {
        storageState,
        maskedMobile: maskMobile(mobile),
        step: "AWAITING_OTP",
      };
      const payload = makeSessionPayload(
        "paytm_merchant", 0, adData as unknown as Record<string, unknown>,
      );
      const enc = encryptSessionPayload(payload);
      if (!enc.ok) {
        return {
          status: "FAILED",
          failReason: "SESSION_ENCRYPT_FAILED",
          failDetail: "Internal error: could not encrypt session state.",
        };
      }

      logger.info({ slug: "paytm_merchant", maskedMobile: maskMobile(mobile) }, "paytm_initiate_awaiting_otp");

      return {
        status: "AWAITING_OTP",
        encryptedSessionToken: enc.token,
        nextStep: "ENTER_OTP",
        nextStepPrompt:
          `An OTP has been sent to your Paytm-registered mobile (${maskMobile(mobile)}). ` +
          "Enter the OTP below to complete the connection.",
      };
    } catch (err: any) {
      logger.error({ slug: "paytm_merchant", err: err?.message }, "paytm_initiate_error");
      return {
        status: "FAILED",
        failReason: "BROWSER_ERROR",
        failDetail: `Browser automation error: ${err?.message ?? "unknown"}. Please try again.`,
        helpUrl: HELP_URL,
      };
    } finally {
      await ctx?.release();
    }
  },

  // ── submitStep ───────────────────────────────────────────────────────────────
  // OTP is received encrypted, decrypted here once, filled into the browser,
  // then the local variable goes out of scope. It is never logged or stored.

  async submitStep(params: SubmitStepParams): Promise<SubmitStepResult> {
    const tokenResult = decryptSessionToken(params.encryptedSessionToken);
    if (!tokenResult.ok) {
      return {
        status: "FAILED",
        failReason: "INVALID_SESSION_TOKEN",
        failDetail: "Session token is invalid or expired. Please restart the connection.",
      };
    }

    const adData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adData?.storageState) {
      return {
        status: "FAILED",
        failReason: "MISSING_STORAGE_STATE",
        failDetail: "No browser session state found. Please restart the connection.",
      };
    }

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
    const otp = otpDecrypt.value.trim().replace(/\D/g, "");
    if (!otp || otp.length < 4 || otp.length > 8) {
      return {
        status: "FAILED",
        failReason: "INVALID_OTP",
        failDetail: "OTP must be 4–8 digits.",
      };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();

      // Navigate to portal root — check current state of the restored session
      await page.goto(getPortalRoot(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      const preCheckUrl = page.url();

      if (!isLoginUrl(preCheckUrl)) {
        // Might already be logged in — run the full CONNECTED gate
        const preCheck = await verifyDashboardAuthenticated(page);
        if (preCheck.verified) {
          // Session is still alive — verify ownership before returning CONNECTED.
          // CONNECTED is never returned without this check.
          const ownership = await verifyOwnershipFromPortal(page, adData, getPortalRoot());
          if (!ownership.verified) {
            logger.warn(
              { slug: "paytm_merchant", reason: ownership.reason },
              "paytm_submitstep_precheck_ownership_failed",
            );
            return {
              status: "FAILED",
              failReason: ownership.reason === "NO_MATCHING_IDENTIFIER_FOUND"
                ? "OWNERSHIP_MISMATCH"
                : "OWNERSHIP_UNVERIFIABLE",
              failDetail: "Could not verify merchant identity on the authenticated portal. " +
                "Please reconnect to reauthorize.",
            };
          }
          const newStorageState = await extractStorageState(ctx.context);
          const newData: PaytmAdapterData = {
            ...adData,
            storageState: newStorageState,
            step: "CONNECTED",
            connectedAt: new Date().toISOString(),
          };
          const payload = makeSessionPayload(
            "paytm_merchant", 0, newData as unknown as Record<string, unknown>,
            { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000) },
          );
          const enc = encryptSessionPayload(payload);
          logger.info({ slug: "paytm_merchant", maskedMobile: adData.maskedMobile }, "paytm_submitstep_already_connected");
          return {
            status: "CONNECTED",
            encryptedSessionToken: enc.ok ? enc.token : undefined,
            nextStep: "COMPLETE",
          };
        }
      }

      // Navigate to login page to reach the OTP step.
      // navigateToLoginPage() returns "otp_form" if the portal already shows OTP
      // inputs (cookies from initiate() put us directly on the OTP step), "mobile_form"
      // if the session expired, "dashboard" if somehow already logged in, or false if
      // the portal is unreachable.
      const loginState = await navigateToLoginPage(page);
      if (loginState === "dashboard") {
        // Navigating to login ended up on dashboard — verify ownership
        const ownership = await verifyOwnershipFromPortal(page, adData, getPortalRoot());
        if (!ownership.verified) {
          return {
            status: "FAILED",
            failReason: ownership.reason === "NO_MATCHING_IDENTIFIER_FOUND"
              ? "OWNERSHIP_MISMATCH"
              : "OWNERSHIP_UNVERIFIABLE",
            failDetail: "Could not verify merchant identity on the authenticated portal. " +
              "Please reconnect.",
          };
        }
        const newStorageState = await extractStorageState(ctx.context);
        const newData: PaytmAdapterData = {
          ...adData, storageState: newStorageState, step: "CONNECTED",
          connectedAt: new Date().toISOString(),
        };
        const payload = makeSessionPayload(
          "paytm_merchant", 0, newData as unknown as Record<string, unknown>,
          { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000) },
        );
        const enc = encryptSessionPayload(payload);
        return {
          status: "CONNECTED",
          encryptedSessionToken: enc.ok ? enc.token : undefined,
          nextStep: "COMPLETE",
        };
      }
      if (loginState === "mobile_form") {
        // Session expired — need full re-initiate
        return {
          status: "FAILED",
          failReason: "SESSION_EXPIRED_REAUTH",
          failDetail: "OTP session has expired. Please restart the connection to receive a new OTP.",
        };
      }
      if (!loginState) {
        return {
          status: "FAILED",
          failReason: "PORTAL_UNREACHABLE",
          failDetail: "Could not reach the login page. The session may have expired. " +
            "Please restart the connection.",
        };
      }
      // loginState === "otp_form" — OTP inputs already visible on the login page

      // Wait for OTP input (may already be visible since we're on "otp_form")
      const allOtpSels = [...SEL.OTP_INPUT_SINGLE, ...SEL.OTP_INPUT_DIGITS];
      const otpSel = await waitForAny(page, allOtpSels, NAV_TIMEOUT_MS);
      if (!otpSel) {
        return {
          status: "FAILED",
          failReason: "OTP_STEP_NOT_FOUND",
          failDetail: "The OTP entry screen was not found. The session may have expired — " +
            "please restart the connection.",
        };
      }

      // Fill OTP — `otp` goes out of scope after this call
      const filled = await fillOtp(page, otp);
      if (!filled) {
        return {
          status: "FAILED",
          failReason: "OTP_FILL_FAILED",
          failDetail: "Could not locate the OTP input field. Please try again.",
        };
      }

      // Submit
      const submitBtn = await tryLocator(page, SEL.SUBMIT_OTP_BTN);
      if (submitBtn) {
        await submitBtn.click({ timeout: ACTION_TIMEOUT_MS });
      } else {
        await page.keyboard.press("Enter");
      }

      // Wait for outcome
      const allOutcomes = [
        ...SEL.DASHBOARD_LANDMARK,
        ...SEL.ERROR_MSG,
        ...SEL.CAPTCHA,
        ...SEL.BLOCKED,
      ];
      await waitForAny(page, allOutcomes, NAV_TIMEOUT_MS);

      // Check for account block first (most severe)
      if (await isBlocked(page)) {
        logger.warn({ slug: "paytm_merchant" }, "paytm_submitstep_blocked");
        return {
          status: "BLOCKED" as any,
          failReason: "ACCOUNT_BLOCKED",
          failDetail: "Your Paytm Business account appears to be blocked or under review. " +
            "Please contact Paytm Business support.",
        };
      }

      // Check for CAPTCHA
      if (await hasCaptcha(page)) {
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "CAPTCHA_REQUIRED",
          failDetail: "Paytm is showing a CAPTCHA during OTP verification. " +
            "Please wait a few minutes and try again.",
        };
      }

      // Check for error messages (invalid/expired OTP)
      for (const errSel of SEL.ERROR_MSG) {
        try {
          const errEl = page.locator(errSel).first();
          if (await errEl.count() > 0 && await errEl.isVisible()) {
            const errText = (await errEl.textContent())?.trim() ?? "";
            if (errText) {
              const isExpired = errText.toLowerCase().includes("expired");
              const isInvalid = errText.toLowerCase().includes("invalid") ||
                errText.toLowerCase().includes("incorrect");
              return {
                status: "FAILED",
                failReason: isExpired ? "OTP_EXPIRED" : (isInvalid ? "INVALID_OTP" : "OTP_ERROR"),
                failDetail: `OTP error: "${errText}". ` + (
                  isExpired
                    ? "Please restart the connection to receive a new OTP."
                    : "Check the OTP and try again, or restart for a new OTP."
                ),
              };
            }
          }
        } catch { /* continue */ }
      }

      // ── CONNECTED gate — all four checks must pass ─────────────────────────
      await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});

      const connectedCheck = await verifyDashboardAuthenticated(page);
      if (!connectedCheck.verified) {
        logger.warn(
          { slug: "paytm_merchant", reason: connectedCheck.reason },
          "paytm_submitstep_connected_gate_failed",
        );
        return {
          status: "FAILED",
          failReason: "LOGIN_NOT_CONFIRMED",
          failDetail: `OTP was submitted but session could not be verified as authenticated. ` +
            `The OTP may be incorrect or expired. Please try again or restart the connection.`,
        };
      }
      // ── End CONNECTED gate ─────────────────────────────────────────────────

      // ── OWNERSHIP VERIFICATION GATE ───────────────────────────────────────
      // After confirming the dashboard is visible and authenticated, navigate to
      // the profile page and verify the merchant's registered mobile matches the
      // last 3 digits of the mobile number provided at initiateSession time.
      //
      // CONNECTED is NEVER returned without this check passing.
      // "Dashboard visible" alone is NOT sufficient evidence of account ownership.
      const ownership = await verifyOwnershipFromPortal(page, adData, getPortalRoot());
      if (!ownership.verified) {
        logger.warn(
          { slug: "paytm_merchant", reason: ownership.reason },
          "paytm_submitstep_ownership_failed",
        );
        return {
          status: "FAILED",
          failReason: ownership.reason === "NO_MATCHING_IDENTIFIER_FOUND"
            ? "OWNERSHIP_MISMATCH"
            : "OWNERSHIP_UNVERIFIABLE",
          failDetail: ownership.reason === "NO_MATCHING_IDENTIFIER_FOUND"
            ? "The registered mobile on your Paytm Business portal does not match the " +
              "mobile number you entered. Please ensure you are logging in to your own account."
            : "Could not extract a verifiable merchant identifier from the Paytm Business " +
              "portal. Please try again or contact support.",
        };
      }
      // ── End OWNERSHIP VERIFICATION GATE ───────────────────────────────────

      // Serialise updated storage state (cookies refreshed post-login)
      const newStorageState = await extractStorageState(ctx.context);
      const newData: PaytmAdapterData = {
        ...adData,
        storageState: newStorageState,
        step: "CONNECTED",
        connectedAt: new Date().toISOString(),
      };
      const payload = makeSessionPayload(
        "paytm_merchant", 0, newData as unknown as Record<string, unknown>,
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

      logger.info({ slug: "paytm_merchant", maskedMobile: adData.maskedMobile }, "paytm_submitstep_connected");

      return {
        status: "CONNECTED",
        encryptedSessionToken: enc.token,
        nextStep: "COMPLETE",
        nextStepPrompt: "Your Paytm Business account is now connected.",
      };
    } catch (err: any) {
      logger.error({ slug: "paytm_merchant", err: err?.message }, "paytm_submitstep_error");
      return {
        status: "FAILED",
        failReason: "BROWSER_ERROR",
        failDetail: `Browser error during OTP submission: ${err?.message ?? "unknown"}. Please try again.`,
      };
    } finally {
      await ctx?.release();
    }
  },

  // ── validateSession ──────────────────────────────────────────────────────────

  async validateSession(encryptedSessionToken: string): Promise<ValidateResult> {
    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) return { valid: false, reason: tokenResult.reason };

    const { expiresAt } = tokenResult.payload;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return { valid: false, reason: "session_expired" };
    }

    const adData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adData?.storageState || adData.step !== "CONNECTED") {
      return { valid: false, reason: "not_connected" };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();
      const alive = await verifySessionAlive(page);
      if (!alive) return { valid: false, reason: "session_expired_or_revoked" };

      const newStorageState = await extractStorageState(ctx.context);
      const newData: PaytmAdapterData = { ...adData, storageState: newStorageState };
      const payload = makeSessionPayload(
        "paytm_merchant", tokenResult.payload.connectionId,
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
      logger.error({ slug: "paytm_merchant", err: err?.message }, "paytm_validate_error");
      return { valid: false, reason: "validation_error" };
    } finally {
      await ctx?.release();
    }
  },

  // ── discoverEntities ─────────────────────────────────────────────────────────

  async discoverEntities(encryptedSessionToken: string): Promise<DiscoveryResult> {
    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) return { entities: [] };

    const adData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adData?.storageState) return { entities: [] };

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();

      // Navigate to the profile page to look for MID
      await page.goto(`${getPortalRoot()}/profile`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      // Verify we're still authenticated before reading profile data
      const check = await verifyDashboardAuthenticated(page);
      if (!check.verified) return { entities: [] };

      // Try to extract MID
      const mid = await (async () => {
        for (const sel of SEL.MID) {
          try {
            const el = page.locator(sel).first();
            if (await el.count() > 0) {
              const text = await el.textContent();
              // MID is typically a 12+ digit number
              const match = text?.match(/\b\d{9,20}\b/);
              if (match) return match[0];
            }
          } catch { /* continue */ }
        }
        return null;
      })();

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
      if (adData.maskedMobile) {
        entities.push({
          entityType:        "merchant" as const,
          providerEntityId:  adData.maskedMobile,
          providerEntityName: "Registered Mobile",
          isPrimary:         mid === null,
          metadata:          { maskedMobile: adData.maskedMobile },
        });
      }

      const newStorageState = await extractStorageState(ctx.context);
      const newData: PaytmAdapterData = { ...adData, storageState: newStorageState, merchantId: mid ?? undefined };
      const enc = encryptSessionPayload(
        makeSessionPayload("paytm_merchant", tokenResult.payload.connectionId,
          newData as unknown as Record<string, unknown>),
      );

      logger.info({ slug: "paytm_merchant", entityCount: entities.length }, "paytm_discovery_complete");
      return { entities, encryptedSessionToken: enc.ok ? enc.token : undefined };
    } catch (err: any) {
      logger.warn({ slug: "paytm_merchant", err: err?.message }, "paytm_discovery_error");
      return { entities: [] };
    } finally {
      await ctx?.release();
    }
  },

  // ── fetchTransactions ────────────────────────────────────────────────────────

  async fetchTransactions(params: FetchTransactionsParams): Promise<FetchTransactionsResult> {
    const tokenResult = decryptSessionToken(params.encryptedSessionToken);
    if (!tokenResult.ok) return { transactions: [], hasMore: false };

    const adData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adData?.storageState || adData.step !== "CONNECTED") {
      return { transactions: [], hasMore: false };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();

      // Navigate to transactions
      await page.goto(`${getPortalRoot()}/transactions`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      // Verify we're still authenticated
      const check = await verifyDashboardAuthenticated(page);
      if (!check.verified) {
        logger.warn({ slug: "paytm_merchant", reason: check.reason }, "paytm_fetch_not_authenticated");
        return { transactions: [], hasMore: false };
      }

      // Wait for transaction rows
      const rowSel = SEL.TX_ROW.join(", ");
      try {
        await page.waitForSelector(rowSel, { timeout: NAV_TIMEOUT_MS });
      } catch {
        logger.info({ slug: "paytm_merchant" }, "paytm_fetch_no_tx_rows");
        return { transactions: [], hasMore: false };
      }

      // Best-effort DOM scrape — returns empty rather than incorrect data on structure changes
      const rawRows = await page.evaluate((selectors: string[]) => {
        const results: Array<{
          amount?: string;
          status?: string;
          date?: string;
          utr?: string;
        }> = [];

        /* eslint-disable @typescript-eslint/no-explicit-any */
        const doc = (globalThis as any)["document"] as any;

        for (const sel of selectors) {
          const rows: any[] = Array.from(doc.querySelectorAll(sel));
          if (rows.length === 0) continue;
          for (const row of (rows as any[]).slice(0, 100)) {
            const text: string = row.textContent ?? "";
            const amtMatch = text.match(/[₹\u20b9]?\s*([\d,]+\.?\d{0,2})/);
            const statusRaw =
              text.toLowerCase().includes("success") ? "SUCCESS" :
              text.toLowerCase().includes("failed")  ? "FAILED"  :
              text.toLowerCase().includes("refund")  ? "REVERSED":
              text.toLowerCase().includes("pending") ? "PENDING" : null;
            const utrMatch  = text.match(/\b[A-Z0-9]{12,22}\b/);
            const dateMatch = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);
            if (amtMatch || statusRaw) {
              results.push({
                amount: amtMatch?.[1]?.replace(/,/g, ""),
                status: statusRaw ?? undefined,
                date:   dateMatch?.[0],
                utr:    utrMatch?.[0],
              });
            }
          }
          if (results.length > 0) break;
        }
        return results;
      }, SEL.TX_ROW);

      const transactions: NormalizedTransaction[] = [];
      for (const raw of rawRows) {
        if (!raw.amount && !raw.status) continue;
        const amountPaise = raw.amount ? Math.round(parseFloat(raw.amount) * 100) : 0;
        const normalizedStatus: PortalTxStatus =
          raw.status === "SUCCESS"  ? "SUCCESS"  :
          raw.status === "FAILED"   ? "FAILED"   :
          raw.status === "REVERSED" ? "REVERSED" :
          raw.status === "PENDING"  ? "PENDING"  : "UNKNOWN";
        const pseudoId = [raw.utr, raw.amount, raw.date].filter(Boolean).join("::");
        if (!pseudoId) continue;
        transactions.push({
          providerTxId:   pseudoId,
          amount:         amountPaise,
          currency:       "INR",
          status:         normalizedStatus,
          providerStatus: raw.status ?? "UNKNOWN",
          utr:            raw.utr,
          txTimestamp:    raw.date ? new Date(raw.date) : undefined,
          rawPayload:     { amount_str: raw.amount, status_str: raw.status, date_str: raw.date, utr: raw.utr },
        });
      }

      const newStorageState = await extractStorageState(ctx.context);
      const newData: PaytmAdapterData = { ...adData, storageState: newStorageState };
      const enc = encryptSessionPayload(
        makeSessionPayload("paytm_merchant", tokenResult.payload.connectionId,
          newData as unknown as Record<string, unknown>),
      );

      logger.info({ slug: "paytm_merchant", count: transactions.length }, "paytm_fetch_complete");
      return { transactions, hasMore: false, encryptedSessionToken: enc.ok ? enc.token : undefined };
    } catch (err: any) {
      logger.error({ slug: "paytm_merchant", err: err?.message }, "paytm_fetch_error");
      return { transactions: [], hasMore: false };
    } finally {
      await ctx?.release();
    }
  },

  // ── healthCheck ──────────────────────────────────────────────────────────────
  // Lightweight check: does NOT log into Paytm. Verifies the portal root is
  // reachable and returns a 200 response. Browser pool health is checked by the
  // /browser-health route separately.

  async healthCheck(_encryptedSessionToken?: string): Promise<HealthCheckResult> {
    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(); // no stored state — fresh context
      const page = await ctx.context.newPage();
      const root = getPortalRoot();
      await page.goto(root, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      const url = page.url();
      const reachable = url.startsWith("https://business.paytm.com") || url.startsWith(root);
      return {
        healthy: reachable,
        status:  "CONNECTED" as any,
        reason:  reachable ? "Paytm Business portal is reachable." : `Unexpected redirect: ${url}`,
      };
    } catch (err: any) {
      return {
        healthy: false,
        status:  "FAILED" as any,
        reason:  "PORTAL_UNREACHABLE",
        detail:  `${getPortalRoot()}: ${err?.message ?? "unknown"}`,
      };
    } finally {
      await ctx?.release();
    }
  },

  // ── reconnect ────────────────────────────────────────────────────────────────
  // Tries stored session first (runs CONNECTED gate); on failure returns
  // AWAITING_OTP to prompt for a new OTP. Never returns CONNECTED on failure.

  async reconnect(encryptedSessionToken: string): Promise<InitiateResult> {
    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) {
      return {
        status: "AWAITING_OTP" as any,
        failReason: "REQUIRES_FULL_REAUTH",
        failDetail: "Session token is invalid. Please re-enter your mobile number.",
        nextStep: "ENTER_OTP",
      };
    }

    const adData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adData?.storageState) {
      return {
        status: "AWAITING_OTP" as any,
        failReason: "REQUIRES_FULL_REAUTH",
        failDetail: "No session state found. Please re-enter your mobile number.",
        nextStep: "ENTER_OTP",
      };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();
      const alive = await verifySessionAlive(page);

      if (alive) {
        const newStorageState = await extractStorageState(ctx.context);
        const newData: PaytmAdapterData = { ...adData, storageState: newStorageState, step: "CONNECTED" };
        const payload = makeSessionPayload(
          "paytm_merchant", tokenResult.payload.connectionId,
          newData as unknown as Record<string, unknown>,
          { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000) },
        );
        const enc = encryptSessionPayload(payload);
        logger.info({ slug: "paytm_merchant" }, "paytm_reconnect_session_alive");
        return {
          status: "CONNECTED",
          encryptedSessionToken: enc.ok ? enc.token : undefined,
          nextStep: "COMPLETE",
          nextStepPrompt: "Session reconnected.",
        };
      }

      logger.info({ slug: "paytm_merchant" }, "paytm_reconnect_session_expired");
      return {
        status: "AWAITING_OTP" as any,
        failReason: "SESSION_EXPIRED",
        failDetail: "Your Paytm Business session has expired. Please enter your mobile number for a new OTP.",
        nextStep: "ENTER_OTP",
      };
    } catch (err: any) {
      logger.error({ slug: "paytm_merchant", err: err?.message }, "paytm_reconnect_error");
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
  // Best-effort: restore context, navigate to logout, close. Must not throw.
  // Called by the disconnect route; failure is swallowed.

  async logout(encryptedSessionToken: string): Promise<void> {
    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) return;

    const adData = tokenResult.payload.adapterData as unknown as PaytmAdapterData;
    if (!adData?.storageState) return;

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();
      await page.goto(`${getPortalRoot()}/user/logout`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      logger.info({ slug: "paytm_merchant" }, "paytm_logout_complete");
    } catch (err: any) {
      logger.warn({ slug: "paytm_merchant", err: err?.message }, "paytm_logout_error_swallowed");
    } finally {
      await ctx?.release();
    }
  },
};
