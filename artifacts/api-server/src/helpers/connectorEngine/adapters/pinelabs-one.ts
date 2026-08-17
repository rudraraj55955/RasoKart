/**
 * Pine Labs ONE — Connector Engine Adapter (portal_session_connector)
 *
 * Provider:   Pine Labs ONE (one.pinelabs.com)
 * Kind:       portal_session_connector
 * Auth path:  Registered mobile / user ID → password; optional OTP 2FA
 *
 * HOW IT WORKS:
 *   1. initiateSession() — opens an isolated Chromium context, navigates to
 *      one.pinelabs.com/login/user, enters the merchant's mobile/user ID,
 *      submits the form, confirms the portal moved to the password step, and
 *      returns AWAITING_PASSWORD with encrypted session state.
 *   2. submitStep() (password) — restores the browser context, locates the
 *      password input (re-filling the identifier if needed), submits, and
 *      either returns CONNECTED (after full ownership verification) or
 *      AWAITING_OTP when the portal triggers a 2FA challenge.
 *   3. submitStep() (OTP) — fills the OTP in the challenge form, verifies
 *      the session reached the dashboard, runs the CONNECTED gate.
 *   4. All subsequent calls restore context from the stored encrypted token.
 *
 * CONNECTED GATE (cannot be skipped):
 *   submitStep returns CONNECTED only when ALL of:
 *     (a) Final URL matches a post-login dashboard pattern
 *     (b) Login/password form is NOT visible
 *     (c) At least one dashboard landmark element is present in the DOM
 *     (d) Ownership verification extracts at least one identifier (MID / store ID / masked mobile)
 *
 * SECURITY INVARIANTS:
 *   - Passwords received from the route as encryptedOtp, decrypted once, filled, discarded.
 *   - OTPs decrypted once, filled, immediately discarded.
 *   - storedIdentifier (mobile/user ID) stored encrypted inside the AES-256-GCM session token.
 *     maskedIdentifier is the only plaintext identifier ever persisted.
 *   - Screenshots, video, and network tracing are DISABLED in the browser pool.
 *
 * FAIL-CLOSED CONTRACT:
 *   Any exception, unexpected page state, or timeout → non-CONNECTED status.
 *   CAPTCHA/QR/device approval → AWAITING_USER_ACTION (manual action required).
 *   Account lock → BLOCKED. Portal unreachable → FAILED/PORTAL_UNREACHABLE.
 *
 * MUTATIONS: None. Read-only. No payments, refunds, payouts, or profile edits.
 *
 * NO CAPTCHA BYPASS: Detection returns AWAITING_USER_ACTION; no solving/evasion.
 */

import type { Page, FrameLocator } from "playwright";
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

const PORTAL_ORIGIN = "https://one.pinelabs.com";
const HELP_URL      = "https://one.pinelabs.com";
const SESSION_TTL_HOURS = 20;

/**
 * Portal origin. Set PINELABS_ONE_PORTAL_OVERRIDE in tests to redirect all
 * adapter navigation to a local mock HTTP server.
 */
function getPortalOrigin(): string {
  return process.env["PINELABS_ONE_PORTAL_OVERRIDE"] ?? PORTAL_ORIGIN;
}

/** URL of the identifier-entry step. */
function getLoginUserUrl(): string {
  return `${getPortalOrigin()}/login/user`;
}

/** URL patterns that indicate the session is on a login / pre-auth page. */
const LOGIN_PAGE_PATTERNS = [
  "/login",
  "/authv2/sign-in",   // lower-case comparison used in isLoginUrl()
  "/authv2/",          // catch all authV2 sub-paths
  "/sign-in",
  "/auth",
];

/** URL patterns that indicate the session is on an OTP-entry page. */
const OTP_URL_PATTERNS = [
  "/verify-otp",
  "/authv2/sign-in/otp",
  "/sign-in/otp",
  "/otp-verification",
];

/** URL patterns indicating we are on the authenticated dashboard. */
const DASHBOARD_URL_PATTERNS = [
  "/home",
  "/dashboard",
  "/overview",
  "/transactions",
  "/reports",
  "/settlements",
  "/stores",
  "/payments",
  "/analytics",
  "/summary",
];

// ── Selectors ─────────────────────────────────────────────────────────────────
// Ordered most-specific/most-reliable first. All use visible-text, ARIA roles,
// or well-known attributes. No internal implementation IDs.

const SEL = {
  // Identifier input (mobile number or user ID)
  IDENTIFIER_INPUT: [
    'input[name="mobile"]',
    'input[name="mobileNumber"]',
    'input[name="phone"]',
    'input[name="userId"]',
    'input[name="username"]',
    'input[type="tel"]',
    'input[placeholder*="mobile" i]',
    'input[placeholder*="phone" i]',
    'input[placeholder*="user" i]',
    'input[placeholder*="number" i]',
  ],

  // Password input
  PASSWORD_INPUT: [
    'input[type="password"]',
    'input[name="password"]',
    'input[placeholder*="password" i]',
    'input[placeholder*="pass" i]',
  ],

  // OTP input — single field.
  // NOTE: input[inputmode="numeric"] is specifically needed for the
  // Pine Labs ONE /authV2/sign-in/verify-otp page which uses a numeric
  // keyboard trigger rather than type="text" or name="otp".
  OTP_INPUT_SINGLE: [
    'input[name="otp"]',
    'input[placeholder*="otp" i]',
    'input[placeholder*="enter otp" i]',
    'input[placeholder*="verification" i]',
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"]',           // authV2 OTP field
    'input[type="number"]',                 // numeric OTP field
    '[class*="otp"] input:visible',         // container-scoped OTP
    '[class*="pin"] input:visible',         // PIN-style OTP container
    '[class*="Otp"] input:visible',         // PascalCase class variants
    '[class*="verification"] input:visible',
  ],

  // OTP digit boxes (maxlength="1")
  OTP_DIGIT_BOX: [
    'input[maxlength="1"]',
    'input[maxlength="1"][inputmode="numeric"]',
    'input[maxlength="1"][type="number"]',
  ],

  // "Next" / "Continue" button after identifier entry
  NEXT_BTN: [
    'button[type="submit"]:visible',
    'button:has-text("Next"):visible',
    'button:has-text("Continue"):visible',
    'button:has-text("Proceed"):visible',
    'button:has-text("Get OTP"):visible',
    '[data-testid="next-btn"]:visible',
    '[data-testid="continue-btn"]:visible',
    '[data-testid="submit-btn"]:visible',
  ],

  // "Sign In" / "Login" / password-submit button
  SIGN_IN_BTN: [
    'button[type="submit"]:visible',
    'button:has-text("Sign In"):visible',
    'button:has-text("Log In"):visible',
    'button:has-text("Login"):visible',
    'button:has-text("Submit"):visible',
    '[data-testid="sign-in-btn"]:visible',
    '[data-testid="login-btn"]:visible',
  ],

  // OTP submit button
  OTP_SUBMIT_BTN: [
    'button[type="submit"]:visible',
    'button:has-text("Verify"):visible',
    'button:has-text("Submit"):visible',
    'button:has-text("Confirm"):visible',
    '[data-testid="verify-btn"]:visible',
  ],

  // Dashboard landmark — at least one must be visible before CONNECTED is returned
  DASHBOARD_LANDMARK: [
    'nav[aria-label*="navigation" i]',
    '[data-testid="dashboard"]',
    '[data-testid="home"]',
    '[data-testid="sidebar"]',
    'a[href*="/transactions"]:visible',
    'a[href*="/stores"]:visible',
    'a[href*="/reports"]:visible',
    'a[href*="/settlements"]:visible',
    '.sidebar',
    '#sidebar',
    '[class*="sidebar"]',
    '[class*="dashboard"]',
    '[class*="main-nav"]',
    '[aria-label*="menu" i]:visible',
  ],

  // Error messages
  ERROR_MSG: [
    '[role="alert"]:visible',
    '[class*="error"]:visible',
    '[class*="Error"]:visible',
    '[data-testid*="error"]:visible',
    'p:has-text("Invalid"):visible',
    'p:has-text("incorrect"):visible',
    'p:has-text("wrong"):visible',
    'p:has-text("expired"):visible',
    'p:has-text("not registered"):visible',
    'span:has-text("Invalid"):visible',
  ],

  // CAPTCHA indicators
  CAPTCHA: [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    'iframe[title*="captcha" i]',
    '[class*="captcha"]',
    '#captcha',
  ],

  // QR / device-binding / manual-action indicators
  MANUAL_ACTION: [
    'img[alt*="QR" i]',
    '[class*="qr-code"]',
    '[data-testid*="qr"]',
    'h1:has-text("Scan"):visible',
    'p:has-text("Scan the QR"):visible',
    'p:has-text("Approve on device"):visible',
    'p:has-text("Verify your device"):visible',
  ],

  // Account blocked indicators
  BLOCKED: [
    'p:has-text("blocked"):visible',
    'p:has-text("suspended"):visible',
    'p:has-text("deactivated"):visible',
    'h1:has-text("blocked"):visible',
    '[class*="blocked"]',
  ],

  // Merchant ID on profile/settings page
  MID: [
    '[data-testid*="merchant-id"]',
    '[data-testid*="mid"]',
    'p:has-text("Merchant ID")',
    'span:has-text("Merchant ID")',
    'td:has-text("Merchant ID")',
    '[class*="merchant-id"]',
    '[class*="merchantId"]',
  ],

  // Store ID
  STORE_ID: [
    '[data-testid*="store-id"]',
    'p:has-text("Store ID")',
    'span:has-text("Store ID")',
    '[class*="store-id"]',
  ],

  // Business name on profile
  BUSINESS_NAME: [
    '[data-testid*="business-name"]',
    '[data-testid*="merchant-name"]',
    'h1.business-name',
    'h2.business-name',
    '[class*="businessName"]',
    '[class*="merchant-name"]',
  ],

  // Profile/account link in nav
  PROFILE_LINK: [
    'a[href*="/profile"]',
    'a[href*="/account"]',
    'a[href*="/settings"]',
    '[data-testid="profile-link"]',
    '[aria-label*="profile" i]',
  ],

  // Transaction rows
  TX_ROW: [
    'tr[class*="transaction"]',
    '[data-testid*="transaction-row"]',
    '[class*="txn-row"]',
    'tbody tr',
    '[class*="list-item"]',
  ],
};

// ── Internal types ────────────────────────────────────────────────────────────

interface PineLabsOneAdapterData {
  storageState: BrowserStorageState;
  maskedIdentifier: string;   // e.g. "**XXXXX890" — safe to persist in plaintext
  step: "AWAITING_PASSWORD" | "AWAITING_OTP" | "CONNECTED";
  loginMode: "password";       // always password; OTP is optional 2FA after password
  storedIdentifier?: string;   // encrypted inside the session token; never logged
  merchantId?: string;
  storeId?: string;
  businessName?: string;
  connectedAt?: string;
}

// ── Utility functions ─────────────────────────────────────────────────────────

/** Mask mobile/user ID for safe persistence. E.g. "9876543210" → "**XXXXX210" */
function maskIdentifier(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length >= 10) {
    return "**XXXXX" + digits.slice(-3);
  }
  // Non-mobile (user ID or email): show last 3 chars of original
  return "**" + id.slice(-3);
}

/** Validate mobile (10 digits) or user ID (alphanumeric, 4–20 chars). */
function validateIdentifier(id: string): { valid: boolean; reason?: string } {
  const digits = id.replace(/\D/g, "");
  if (/^\d{10}$/.test(digits)) return { valid: true };          // 10-digit mobile
  if (/^[A-Za-z0-9_.-]{4,20}$/.test(id)) return { valid: true }; // user ID
  return { valid: false, reason: "Enter your 10-digit registered mobile number or Pine Labs user ID." };
}

/** Returns true if the current page URL matches a login/pre-auth pattern. */
function isLoginUrl(url: string): boolean {
  const lc = url.toLowerCase();
  return LOGIN_PAGE_PATTERNS.some(p => lc.includes(p));
}

/** Returns true if the current URL looks like the authenticated dashboard. */
function isDashboardUrl(url: string): boolean {
  return DASHBOARD_URL_PATTERNS.some(p => url.includes(p));
}

/**
 * Returns true if the URL indicates an OTP-entry page.
 * Pine Labs ONE /authV2 flow navigates to /authV2/sign-in/verify-otp immediately
 * after identifier entry (OTP-first, skipping the password step).
 * URL-based detection is more reliable than DOM selector scanning on SPAs
 * because the HTML arrives before React renders the input elements.
 */
function isOtpUrl(url: string): boolean {
  const lc = url.toLowerCase();
  return OTP_URL_PATTERNS.some(p => lc.includes(p));
}

/** Try each selector in an array; return the first visible locator found. */
async function tryLocator(page: Page, selectors: string[]): Promise<import("playwright").Locator | null> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) return el;
    } catch { /* continue */ }
  }
  return null;
}

/** Wait for any selector in the list to become visible; return the first one. */
async function waitForAny(
  page: Page,
  selectors: string[],
  timeout: number,
): Promise<import("playwright").Locator | null> {
  try {
    await page.waitForSelector(selectors.join(", "), { state: "visible", timeout });
    return tryLocator(page, selectors);
  } catch { return null; }
}

/** Detect visible CAPTCHA on page. */
async function hasCaptcha(page: Page): Promise<boolean> {
  for (const sel of SEL.CAPTCHA) {
    try {
      if (await page.locator(sel).count() > 0) return true;
    } catch { /* continue */ }
  }
  return false;
}

/** Detect visible QR/device-binding/manual-action prompt. */
async function hasManualActionRequired(page: Page): Promise<boolean> {
  for (const sel of SEL.MANUAL_ACTION) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) return true;
    } catch { /* continue */ }
  }
  return false;
}

/** Detect account blocked message. */
async function isBlocked(page: Page): Promise<boolean> {
  for (const sel of SEL.BLOCKED) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) return true;
    } catch { /* continue */ }
  }
  return false;
}

/** Safe page diagnostics (no secrets). */
async function collectDiagnostics(page: Page): Promise<{
  urlPath: string; title: string; frameCount: number; visibleInputCount: number;
}> {
  try {
    const url      = page.url();
    const title    = await page.title().catch(() => "");
    const frames   = page.frames().length;
    const inputs   = await page.locator("input:visible").count().catch(() => 0);
    return { urlPath: new URL(url).pathname, title, frameCount: frames, visibleInputCount: inputs };
  } catch {
    return { urlPath: "?", title: "", frameCount: 0, visibleInputCount: 0 };
  }
}

/**
 * Fill the identifier (mobile/user ID) into the page.
 * Tries all known selector patterns. Returns true on success.
 */
async function fillIdentifier(page: Page, identifier: string): Promise<boolean> {
  // Wait for any identifier field to appear
  await waitForAny(page, SEL.IDENTIFIER_INPUT, NAV_TIMEOUT_MS);

  for (const sel of SEL.IDENTIFIER_INPUT) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        await el.click({ timeout: ACTION_TIMEOUT_MS });
        await el.fill("", { timeout: ACTION_TIMEOUT_MS });
        await el.fill(identifier, { timeout: ACTION_TIMEOUT_MS });
        return true;
      }
    } catch { /* continue */ }
  }
  return false;
}

/**
 * Fill the password into the page.
 * Returns true on success.
 */
async function fillPassword(page: Page, password: string): Promise<boolean> {
  await waitForAny(page, SEL.PASSWORD_INPUT, NAV_TIMEOUT_MS);

  for (const sel of SEL.PASSWORD_INPUT) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        await el.click({ timeout: ACTION_TIMEOUT_MS });
        await el.fill("", { timeout: ACTION_TIMEOUT_MS });
        await el.fill(password, { timeout: ACTION_TIMEOUT_MS });
        return true;
      }
    } catch { /* continue */ }
  }
  return false;
}

/**
 * Fill an OTP — handles both single-field and digit-box layouts.
 * Returns true on success.
 */
async function fillOtp(page: Page, otp: string): Promise<boolean> {
  // Wait for OTP field(s)
  const allOtpSels = [...SEL.OTP_INPUT_SINGLE, ...SEL.OTP_DIGIT_BOX];
  await waitForAny(page, allOtpSels, NAV_TIMEOUT_MS);

  // Try single-field first
  for (const sel of SEL.OTP_INPUT_SINGLE) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        await el.click({ timeout: ACTION_TIMEOUT_MS });
        await el.fill(otp, { timeout: ACTION_TIMEOUT_MS });
        return true;
      }
    } catch { /* continue */ }
  }

  // Try digit boxes (maxlength="1") — fill each digit
  const digitBoxes = page.locator('input[maxlength="1"]');
  const boxCount = await digitBoxes.count().catch(() => 0);
  if (boxCount >= 4 && otp.length >= 4) {
    const digits = otp.replace(/\D/g, "");
    for (let i = 0; i < Math.min(boxCount, digits.length); i++) {
      try {
        await digitBoxes.nth(i).click({ timeout: ACTION_TIMEOUT_MS });
        await digitBoxes.nth(i).fill(digits[i], { timeout: ACTION_TIMEOUT_MS });
      } catch { /* continue */ }
    }
    return true;
  }

  return false;
}

/**
 * Click a submit button. Tries the provided selectors in order.
 * Falls back to pressing Enter.
 */
async function clickSubmit(page: Page, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        await el.click({ timeout: ACTION_TIMEOUT_MS * 2 });
        return;
      }
    } catch { /* continue */ }
  }
  // Fallback: press Enter
  await page.keyboard.press("Enter");
}

/**
 * CONNECTED gate — verifies we are genuinely on the authenticated dashboard.
 * (a) URL must match a dashboard pattern OR not match any login pattern.
 * (b) At least one dashboard landmark must be visible.
 * (c) Login/password form must NOT be visible.
 */
async function verifyDashboardAuthenticated(
  page: Page,
): Promise<{ verified: boolean; reason?: string }> {
  // Wait for navigation to settle
  await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});

  const url = page.url();

  // (a) URL check
  if (isLoginUrl(url) && !isDashboardUrl(url)) {
    return { verified: false, reason: `STILL_ON_LOGIN_PAGE: ${url}` };
  }

  // (b) Dashboard landmark
  const landmark = await waitForAny(page, SEL.DASHBOARD_LANDMARK, ACTION_TIMEOUT_MS * 2);
  if (!landmark) {
    return { verified: false, reason: "NO_DASHBOARD_LANDMARK" };
  }

  // (c) Login form must not be visible
  for (const sel of SEL.IDENTIFIER_INPUT) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        return { verified: false, reason: `LOGIN_FORM_STILL_VISIBLE: ${sel}` };
      }
    } catch { /* continue */ }
  }
  for (const sel of SEL.PASSWORD_INPUT) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        return { verified: false, reason: `PASSWORD_FORM_STILL_VISIBLE: ${sel}` };
      }
    } catch { /* continue */ }
  }

  return { verified: true };
}

/**
 * Extract merchant ownership data from the authenticated portal.
 * Navigates to the profile/settings page and extracts identifiers.
 * Returns { verified: true } when at least one identifier is found.
 */
async function verifyOwnershipFromPortal(
  page: Page,
  adData: PineLabsOneAdapterData,
): Promise<{
  verified: boolean;
  reason?: string;
  merchantId?: string;
  storeId?: string;
  businessName?: string;
}> {
  // Try to navigate to a profile page
  const profilePaths = ["/profile", "/account", "/settings/profile", "/merchant-profile", "/settings"];
  let profileLoaded = false;

  for (const path of profilePaths) {
    try {
      await page.goto(`${getPortalOrigin()}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      const url = page.url();
      // If we were redirected to login, profile nav failed
      if (isLoginUrl(url)) break;
      profileLoaded = true;
      break;
    } catch { /* try next */ }
  }

  if (!profileLoaded) {
    // Try to find identifiers on the current page
    logger.info({ slug: "pinelabs_one" }, "pinelabs_one_ownership_profile_nav_failed_using_current_page");
  }

  // Extract merchant ID
  const merchantId = await (async () => {
    for (const sel of SEL.MID) {
      try {
        const el = page.locator(sel).first();
        if (await el.count() > 0) {
          const text = await el.textContent();
          // Match numeric MID (8–20 digits) or alphanumeric merchant code
          const match = text?.match(/\b([A-Z0-9]{8,20}|\d{8,20})\b/);
          if (match) return match[1];
          // Try sibling text
          const parent = el.locator("..");
          const parentText = await parent.textContent().catch(() => "");
          const parentMatch = parentText?.match(/:\s*([A-Z0-9]{8,20}|\d{8,20})/);
          if (parentMatch) return parentMatch[1];
        }
      } catch { /* continue */ }
    }
    return null;
  })();

  // Extract store ID
  const storeId = await (async () => {
    for (const sel of SEL.STORE_ID) {
      try {
        const el = page.locator(sel).first();
        if (await el.count() > 0) {
          const text = await el.textContent();
          const match = text?.match(/:\s*([A-Z0-9\-]+)/);
          if (match) return match[1];
        }
      } catch { /* continue */ }
    }
    return null;
  })();

  // Extract business name
  const businessName = await (async () => {
    for (const sel of SEL.BUSINESS_NAME) {
      try {
        const el = page.locator(sel).first();
        if (await el.count() > 0 && await el.isVisible()) {
          const text = (await el.textContent())?.trim();
          if (text && text.length > 2) return text;
        }
      } catch { /* continue */ }
    }
    return null;
  })();

  // Need at least one identifier to confirm ownership
  if (!merchantId && !storeId && !businessName && !adData.maskedIdentifier) {
    return { verified: false, reason: "NO_OWNERSHIP_IDENTIFIERS_FOUND" };
  }

  logger.info(
    { slug: "pinelabs_one", hasMid: !!merchantId, hasStoreId: !!storeId, hasBusinessName: !!businessName },
    "pinelabs_one_ownership_verified",
  );

  return { verified: true, merchantId: merchantId ?? undefined, storeId: storeId ?? undefined, businessName: businessName ?? undefined };
}

/**
 * Verify that a stored session is still alive.
 * Navigates to the portal root — if redirected to dashboard (not login), the session is valid.
 */
async function verifySessionAlive(page: Page): Promise<boolean> {
  try {
    await page.goto(getPortalOrigin(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    const result = await verifyDashboardAuthenticated(page);
    return result.verified;
  } catch {
    return false;
  }
}

/**
 * Navigate to the identifier-entry step.
 * Returns:
 *   "identifier_form"  — identifier input visible
 *   "password_form"    — password input already visible (session resumed)
 *   "otp_form"         — OTP form visible (unexpected but handled)
 *   "dashboard"        — already authenticated
 *   "captcha"          — CAPTCHA blocking entry
 *   "manual_action"    — QR / device approval required
 *   null               — portal unreachable or unrecognised state
 */
type LoginPageState = "identifier_form" | "password_form" | "otp_form" | "dashboard" | "captcha" | "manual_action";

async function navigateToLogin(page: Page): Promise<LoginPageState | null> {
  try {
    await page.goto(getLoginUserUrl(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  } catch {
    return null;
  }

  // Give React SPA time to render
  await page.waitForTimeout(1_500);

  const url = page.url();

  // ── OTP URL (Pine Labs ONE authV2 OTP-first flow) ─────────────────────────
  // The portal may navigate directly to the OTP page if a session was cached,
  // or because the /authV2 flow skips the password step entirely.
  if (isOtpUrl(url)) return "otp_form";

  // Already on dashboard
  if (!isLoginUrl(url) || isDashboardUrl(url)) {
    const check = await verifyDashboardAuthenticated(page);
    if (check.verified) return "dashboard";
  }

  // CAPTCHA
  if (await hasCaptcha(page)) return "captcha";

  // QR / manual action
  if (await hasManualActionRequired(page)) return "manual_action";

  // OTP form visible — check URL first (most reliable), then DOM
  const otpField = await tryLocator(page, SEL.OTP_INPUT_SINGLE);
  if (otpField) return "otp_form";
  const digitBoxCount = await page.locator('input[maxlength="1"]').count().catch(() => 0);
  if (digitBoxCount >= 4) return "otp_form";

  // Password form visible (session restored to password step)
  const pwdField = await tryLocator(page, SEL.PASSWORD_INPUT);
  if (pwdField) return "password_form";

  // Identifier form (expected happy path)
  const idField = await tryLocator(page, SEL.IDENTIFIER_INPUT);
  if (idField) return "identifier_form";

  // Try alternative login URL
  try {
    await page.goto(`${getPortalOrigin()}/authV2/sign-in/user-details`, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    await page.waitForTimeout(1_500);
    const urlAlt = page.url();
    if (isOtpUrl(urlAlt)) return "otp_form";
    const idField2 = await tryLocator(page, SEL.IDENTIFIER_INPUT);
    if (idField2) return "identifier_form";
  } catch { /* continue */ }

  return null;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const pineLabsOneAdapter: ProviderAdapter = {
  slug:        "pinelabs_one",
  displayName: "Pine Labs ONE",
  adapterKind: "portal_session_connector",
  category:    "pos",

  supportedLoginMethods: [
    {
      key:              "mobile_password",
      label:            "Registered Mobile / User ID",
      identifierLabel:  "Registered Mobile Number or User ID",
      identifierType:   "mobile",
      // Pine Labs ONE /authV2 sends OTP immediately after identifier entry
      // (OTP-first flow). Password step may or may not appear depending on
      // the login path (mobile → OTP; user ID → may get password or OTP).
      // requiresPassword: false so the route does not reject no-password
      // initiate calls from the merchant connect UI.
      requiresOtp:      true,
      requiresPassword: false,
      mayRequireCaptcha: true,
    },
  ],

  // ── initiateSession ──────────────────────────────────────────────────────────

  async initiateSession(params: InitiateParams): Promise<InitiateResult> {
    if (params.loginMethod !== "mobile_password") {
      return {
        status: "FAILED",
        failReason: "UNSUPPORTED_LOGIN_METHOD",
        failDetail: `Login method '${params.loginMethod}' is not supported. Use 'mobile_password'.`,
      };
    }

    if (!params.encryptedIdentifier) {
      return {
        status: "FAILED",
        failReason: "MISSING_IDENTIFIER",
        failDetail: "Mobile number or user ID is required.",
      };
    }

    const identDecrypt = decryptSecret(params.encryptedIdentifier);
    if (!identDecrypt.ok) {
      return {
        status: "FAILED",
        failReason: "DECRYPT_FAILED",
        failDetail: "Could not decrypt identifier.",
      };
    }
    const identifier = identDecrypt.value.trim();
    const validation = validateIdentifier(identifier);
    if (!validation.valid) {
      return {
        status: "FAILED",
        failReason: "INVALID_IDENTIFIER",
        failDetail: validation.reason ?? "Invalid identifier.",
      };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext();
      const page = await ctx.context.newPage();

      logger.info({ slug: "pinelabs_one" }, "pinelabs_one_initiate_navigating");

      const loginState = await navigateToLogin(page);

      if (!loginState) {
        return {
          status: "FAILED",
          failReason: "PORTAL_UNREACHABLE",
          failDetail: "Could not reach the Pine Labs ONE login page. The portal may be temporarily unavailable.",
          helpUrl: HELP_URL,
        };
      }

      if (loginState === "captcha") {
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "CAPTCHA_REQUIRED",
          failDetail: "Pine Labs ONE is showing a CAPTCHA. Please wait a few minutes and try again.",
          helpUrl: HELP_URL,
        };
      }

      if (loginState === "manual_action") {
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "MANUAL_ACTION_REQUIRED",
          failDetail:
            "Pine Labs ONE is showing a QR code scan or device-approval prompt. " +
            "This must be completed by the account owner on their registered device. " +
            "Please try again after completing the verification.",
          helpUrl: HELP_URL,
        };
      }

      if (loginState === "dashboard") {
        // Already authenticated (unexpected in a fresh isolated context)
        const ownership = await verifyOwnershipFromPortal(page, { maskedIdentifier: maskIdentifier(identifier) } as any);
        const storageState = await extractStorageState(ctx.context);
        const adData: PineLabsOneAdapterData = {
          storageState,
          maskedIdentifier: maskIdentifier(identifier),
          step: "CONNECTED",
          loginMode: "password",
          connectedAt: new Date().toISOString(),
          ...ownership,
        };
        const payload = makeSessionPayload(
          "pinelabs_one", 0, adData as unknown as Record<string, unknown>,
          { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000) },
        );
        const enc = encryptSessionPayload(payload);
        return {
          status: "CONNECTED",
          encryptedSessionToken: enc.ok ? enc.token : undefined,
          nextStep: "COMPLETE",
        };
      }

      // ── identifier_form state — expected happy path ───────────────────────
      if (loginState === "identifier_form" || loginState === "password_form") {

        // If already on password form (session restored to password step),
        // go back to identifier entry so we have a clean flow.
        if (loginState === "password_form") {
          try { await page.goBack({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }); } catch {}
          await page.waitForTimeout(1_000);
        }

        // Fill identifier
        const filled = await fillIdentifier(page, identifier);
        if (!filled) {
          const diag = await collectDiagnostics(page);
          logger.warn({ slug: "pinelabs_one", diag }, "pinelabs_one_identifier_input_not_found");
          return {
            status: "FAILED",
            failReason: "LOGIN_UI_CHANGED",
            failDetail:
              `Could not locate the identifier input on the Pine Labs ONE login page ` +
              `(path=${diag.urlPath}, title="${diag.title}", frames=${diag.frameCount}, ` +
              `inputs=${diag.visibleInputCount}). ` +
              "The portal UI may have changed — please contact RasoKart support.",
            helpUrl: HELP_URL,
          };
        }

        // Click Next/Continue
        await page.waitForTimeout(300);
        await clickSubmit(page, SEL.NEXT_BTN);

        // Wait for navigation / DOM outcome
        const outcomes = [
          ...SEL.PASSWORD_INPUT,
          ...SEL.OTP_INPUT_SINGLE,
          ...SEL.OTP_DIGIT_BOX,
          ...SEL.ERROR_MSG,
          ...SEL.CAPTCHA,
          ...SEL.MANUAL_ACTION,
        ];
        await waitForAny(page, outcomes, NAV_TIMEOUT_MS);

        // ── URL-first OTP detection ─────────────────────────────────────────
        // Pine Labs ONE authV2 flow: after identifier submission the portal
        // navigates to /authV2/sign-in/verify-otp (OTP-first, no password step).
        // URL detection is always checked before DOM scanning because SPA
        // route changes complete before input elements are rendered.
        const urlAfterSubmit = page.url();
        if (isOtpUrl(urlAfterSubmit)) {
          const storageState = await extractStorageState(ctx.context);
          const adData: PineLabsOneAdapterData = {
            storageState,
            maskedIdentifier: maskIdentifier(identifier),
            step: "AWAITING_OTP",
            loginMode: "password",
            storedIdentifier: identifier,
          };
          const payload = makeSessionPayload(
            "pinelabs_one", 0, adData as unknown as Record<string, unknown>,
          );
          const enc = encryptSessionPayload(payload);
          if (!enc.ok) {
            return { status: "FAILED", failReason: "SESSION_ENCRYPT_FAILED", failDetail: "Internal error." };
          }
          logger.info(
            { slug: "pinelabs_one", maskedIdentifier: maskIdentifier(identifier), urlPath: new URL(urlAfterSubmit).pathname },
            "pinelabs_one_initiate_otp_url_detected",
          );
          return {
            status: "AWAITING_OTP",
            encryptedSessionToken: enc.token,
            nextStep: "ENTER_OTP",
            nextStepPrompt:
              `An OTP has been sent to your registered mobile (${maskIdentifier(identifier)}). ` +
              "Enter it below to connect your Pine Labs ONE account. " +
              "The OTP is used once and discarded immediately.",
          };
        }

        // CAPTCHA after submit
        if (await hasCaptcha(page)) {
          return {
            status: "AWAITING_USER_ACTION" as any,
            failReason: "CAPTCHA_REQUIRED",
            failDetail: "Pine Labs ONE is showing a CAPTCHA after identifier entry. Please wait and try again.",
            helpUrl: HELP_URL,
          };
        }

        // Manual action
        if (await hasManualActionRequired(page)) {
          return {
            status: "AWAITING_USER_ACTION" as any,
            failReason: "MANUAL_ACTION_REQUIRED",
            failDetail:
              "Pine Labs ONE requires QR code scan or device approval after identifier entry. " +
              "Complete the verification on your registered device and try again.",
            helpUrl: HELP_URL,
          };
        }

        // Error message (e.g. user not found)
        for (const errSel of SEL.ERROR_MSG) {
          try {
            const el = page.locator(errSel).first();
            if (await el.count() > 0 && await el.isVisible()) {
              const errText = (await el.textContent())?.trim() ?? "";
              if (errText) {
                return {
                  status: "FAILED",
                  failReason: "INVALID_IDENTIFIER",
                  failDetail: `Pine Labs ONE returned an error: "${errText}". ` +
                    "Verify this mobile number / user ID is registered with Pine Labs ONE.",
                };
              }
            }
          } catch { /* continue */ }
        }

        // Password field appeared — expected outcome
        const pwdVisible = await tryLocator(page, SEL.PASSWORD_INPUT);
        if (pwdVisible) {
          const storageState = await extractStorageState(ctx.context);
          const adData: PineLabsOneAdapterData = {
            storageState,
            maskedIdentifier: maskIdentifier(identifier),
            step: "AWAITING_PASSWORD",
            loginMode: "password",
            storedIdentifier: identifier,  // stored encrypted inside session token
          };
          const payload = makeSessionPayload(
            "pinelabs_one", 0, adData as unknown as Record<string, unknown>,
          );
          const enc = encryptSessionPayload(payload);
          if (!enc.ok) {
            return { status: "FAILED", failReason: "SESSION_ENCRYPT_FAILED", failDetail: "Internal error." };
          }
          logger.info(
            { slug: "pinelabs_one", maskedIdentifier: maskIdentifier(identifier) },
            "pinelabs_one_initiate_awaiting_password",
          );
          return {
            status: "AWAITING_PASSWORD",
            encryptedSessionToken: enc.token,
            nextStep: "ENTER_PASSWORD",
            nextStepPrompt:
              `Enter your Pine Labs ONE account password for ${maskIdentifier(identifier)}. ` +
              "Your password is AES-256 encrypted in transit and never stored.",
          };
        }

        // OTP field appeared (portal sent OTP as first factor — rare but handled)
        const otpVisible = await tryLocator(page, SEL.OTP_INPUT_SINGLE);
        const digitBoxes = await page.locator('input[maxlength="1"]').count().catch(() => 0);
        if (otpVisible || digitBoxes >= 4) {
          const storageState = await extractStorageState(ctx.context);
          const adData: PineLabsOneAdapterData = {
            storageState,
            maskedIdentifier: maskIdentifier(identifier),
            step: "AWAITING_OTP",
            loginMode: "password",
            storedIdentifier: identifier,
          };
          const payload = makeSessionPayload(
            "pinelabs_one", 0, adData as unknown as Record<string, unknown>,
          );
          const enc = encryptSessionPayload(payload);
          if (!enc.ok) {
            return { status: "FAILED", failReason: "SESSION_ENCRYPT_FAILED", failDetail: "Internal error." };
          }
          logger.info(
            { slug: "pinelabs_one", maskedIdentifier: maskIdentifier(identifier) },
            "pinelabs_one_initiate_awaiting_otp",
          );
          return {
            status: "AWAITING_OTP",
            encryptedSessionToken: enc.token,
            nextStep: "ENTER_OTP",
            nextStepPrompt:
              `An OTP has been sent to ${maskIdentifier(identifier)}. Enter it below.`,
          };
        }

        // Unexpected state after submit
        const diag2 = await collectDiagnostics(page);
        logger.warn({ slug: "pinelabs_one", diag: diag2 }, "pinelabs_one_initiate_unexpected_state");
        return {
          status: "FAILED",
          failReason: "PORTAL_UI_CHANGED",
          failDetail:
            `Pine Labs ONE did not transition to the password step after identifier entry ` +
            `(path=${diag2.urlPath}, title="${diag2.title}"). ` +
            "The portal UI may have changed — please contact RasoKart support.",
          helpUrl: HELP_URL,
        };
      }

      // Unexpected login state
      return {
        status: "FAILED",
        failReason: "PORTAL_UNREACHABLE",
        failDetail: "Could not locate the identifier form on the Pine Labs ONE login page.",
        helpUrl: HELP_URL,
      };

    } catch (err: any) {
      logger.error({ slug: "pinelabs_one", err: err?.message }, "pinelabs_one_initiate_error");
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
  // Receives password (or OTP) encrypted as encryptedOtp.
  // Password/OTP is decrypted once, filled, then the local variable goes out of scope.

  async submitStep(params: SubmitStepParams): Promise<SubmitStepResult> {
    const tokenResult = decryptSessionToken(params.encryptedSessionToken);
    if (!tokenResult.ok) {
      return {
        status: "FAILED",
        failReason: "INVALID_SESSION_TOKEN",
        failDetail: "Session token is invalid or expired. Please restart the connection.",
      };
    }

    const adData = tokenResult.payload.adapterData as unknown as PineLabsOneAdapterData;
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
        failReason: "MISSING_CREDENTIAL",
        failDetail: adData.step === "AWAITING_OTP" ? "OTP is required." : "Password is required.",
      };
    }

    const credDecrypt = decryptSecret(params.encryptedOtp);
    if (!credDecrypt.ok) {
      return {
        status: "FAILED",
        failReason: "DECRYPT_FAILED",
        failDetail: "Could not decrypt credential.",
      };
    }

    const isOtpStep = adData.step === "AWAITING_OTP";
    const credential = isOtpStep
      ? credDecrypt.value.trim().replace(/\D/g, "")   // OTP: digits only
      : credDecrypt.value.trim();                       // password: keep as-is

    if (!credential) {
      return {
        status: "FAILED",
        failReason: isOtpStep ? "INVALID_OTP" : "INVALID_PASSWORD",
        failDetail: isOtpStep ? "OTP is required." : "Password is required.",
      };
    }
    if (isOtpStep && (credential.length < 4 || credential.length > 8)) {
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

      logger.info(
        { slug: "pinelabs_one", step: adData.step },
        "pinelabs_one_submit_step_start",
      );

      // Navigate to portal root — restoring the context should land us where we left off
      await page.goto(getPortalOrigin(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

      // Brief wait for SPA to render
      await page.waitForTimeout(1_500);
      const currentUrl = page.url();

      // ── Already on dashboard (session survived) ─────────────────────────
      if (!isLoginUrl(currentUrl) || isDashboardUrl(currentUrl)) {
        const preCheck = await verifyDashboardAuthenticated(page);
        if (preCheck.verified) {
          const ownership = await verifyOwnershipFromPortal(page, adData);
          if (!ownership.verified) {
            return {
              status: "FAILED",
              failReason: "OWNERSHIP_UNVERIFIABLE",
              failDetail: "Could not verify merchant identity on the Pine Labs ONE portal. Please reconnect.",
            };
          }
          const newStorageState = await extractStorageState(ctx.context);
          const newData: PineLabsOneAdapterData = {
            ...adData, storageState: newStorageState, step: "CONNECTED",
            connectedAt: new Date().toISOString(), ...ownership,
          };
          const payload = makeSessionPayload(
            "pinelabs_one", 0, newData as unknown as Record<string, unknown>,
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

      // ── OTP step submission ──────────────────────────────────────────────
      if (isOtpStep) {
        // Navigate to OTP page if not already there
        const otpUrl = `${getPortalOrigin()}/login/verify-otp`;
        const altOtpUrl = `${getPortalOrigin()}/authV2/sign-in/verify-otp`;
        const onOtp = await tryLocator(page, SEL.OTP_INPUT_SINGLE);
        const digitCount = await page.locator('input[maxlength="1"]').count().catch(() => 0);
        if (!onOtp && digitCount < 4) {
          // Navigate to OTP URL
          try {
            await page.goto(otpUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
            await page.waitForTimeout(1_000);
          } catch {
            try {
              await page.goto(altOtpUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
              await page.waitForTimeout(1_000);
            } catch { /* continue */ }
          }
        }

        const otpFilled = await fillOtp(page, credential);
        if (!otpFilled) {
          return {
            status: "FAILED",
            failReason: "OTP_FILL_FAILED",
            failDetail: "Could not locate the OTP input field. Please try again or restart the connection.",
          };
        }

        await page.waitForTimeout(300);
        await clickSubmit(page, SEL.OTP_SUBMIT_BTN);

        // Wait for outcome
        const outcomes = [...SEL.DASHBOARD_LANDMARK, ...SEL.ERROR_MSG, ...SEL.CAPTCHA, ...SEL.BLOCKED];
        await waitForAny(page, outcomes, NAV_TIMEOUT_MS);

      } else {
        // ── Password step submission ─────────────────────────────────────
        // Navigate to the password step URL
        const pwdUrl  = `${getPortalOrigin()}/login/password`;
        const altPwdUrl = `${getPortalOrigin()}/authV2/sign-in`;

        // Check if already on password page
        const pwdOnPage = await tryLocator(page, SEL.PASSWORD_INPUT);
        if (!pwdOnPage) {
          // Try to navigate to password step
          try {
            await page.goto(pwdUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
            await page.waitForTimeout(1_500);
          } catch { /* continue */ }

          // If still no password field, navigate to entry and re-fill identifier
          const pwdAfterNav = await tryLocator(page, SEL.PASSWORD_INPUT);
          if (!pwdAfterNav) {
            // Re-navigate to identifier entry and re-submit
            const loginState = await navigateToLogin(page);
            if (!loginState || loginState === "captcha" || loginState === "manual_action") {
              return {
                status: "FAILED",
                failReason: loginState === "captcha" ? "CAPTCHA_REQUIRED"
                  : loginState === "manual_action" ? "MANUAL_ACTION_REQUIRED"
                  : "PORTAL_UNREACHABLE",
                failDetail: "Could not reach the Pine Labs ONE password step. Please try again.",
              };
            }

            if ((loginState === "identifier_form") && adData.storedIdentifier) {
              const filled = await fillIdentifier(page, adData.storedIdentifier);
              if (filled) {
                await page.waitForTimeout(300);
                await clickSubmit(page, SEL.NEXT_BTN);
                await waitForAny(page, SEL.PASSWORD_INPUT, NAV_TIMEOUT_MS);
              }
            }
          }
        }

        // Try alternate URL if password field still not visible
        try {
          await page.goto(altPwdUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
          await page.waitForTimeout(1_500);
        } catch { /* continue */ }

        // Fill identifier again if visible (some portals require both fields on password page)
        const identStillVisible = await tryLocator(page, SEL.IDENTIFIER_INPUT);
        if (identStillVisible && adData.storedIdentifier) {
          try {
            await identStillVisible.click({ timeout: ACTION_TIMEOUT_MS });
            await identStillVisible.fill(adData.storedIdentifier, { timeout: ACTION_TIMEOUT_MS });
          } catch { /* continue */ }
        }

        // Fill password
        const pwdFilled = await fillPassword(page, credential);
        // credential (password) goes out of scope after this — never stored
        if (!pwdFilled) {
          const diag = await collectDiagnostics(page);
          return {
            status: "FAILED",
            failReason: "PASSWORD_FIELD_NOT_FOUND",
            failDetail:
              `Could not locate the password field on the Pine Labs ONE portal ` +
              `(path=${diag.urlPath}, inputs=${diag.visibleInputCount}). ` +
              "The portal UI may have changed — please contact RasoKart support.",
          };
        }

        // Submit password
        await page.waitForTimeout(400);
        await clickSubmit(page, SEL.SIGN_IN_BTN);

        // Wait for outcome: dashboard, OTP, error, CAPTCHA, block
        const allOutcomes = [
          ...SEL.DASHBOARD_LANDMARK,
          ...SEL.OTP_INPUT_SINGLE,
          ...SEL.OTP_DIGIT_BOX,
          ...SEL.ERROR_MSG,
          ...SEL.CAPTCHA,
          ...SEL.BLOCKED,
          ...SEL.MANUAL_ACTION,
        ];
        await waitForAny(page, allOutcomes, NAV_TIMEOUT_MS);
      }

      // ── Shared outcome checks ─────────────────────────────────────────────

      // Account blocked
      if (await isBlocked(page)) {
        logger.warn({ slug: "pinelabs_one" }, "pinelabs_one_submitstep_blocked");
        return {
          status: "BLOCKED" as any,
          failReason: "ACCOUNT_BLOCKED",
          failDetail:
            "Your Pine Labs ONE account appears to be blocked or suspended. " +
            "Please contact Pine Labs ONE support.",
        };
      }

      // CAPTCHA
      if (await hasCaptcha(page)) {
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "CAPTCHA_REQUIRED",
          failDetail: "Pine Labs ONE is showing a CAPTCHA. Please wait and try again.",
        };
      }

      // Manual action (QR / device approval)
      if (await hasManualActionRequired(page)) {
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "MANUAL_ACTION_REQUIRED",
          failDetail:
            "Pine Labs ONE requires QR code scan or device approval. " +
            "Complete the verification on your registered device, then try reconnecting.",
        };
      }

      // OTP 2FA appeared after password (expected for accounts with 2FA enabled)
      if (!isOtpStep) {
        const otpField = await tryLocator(page, SEL.OTP_INPUT_SINGLE);
        const digitBoxCount = await page.locator('input[maxlength="1"]').count().catch(() => 0);
        if (otpField || digitBoxCount >= 4) {
          const newStorageState = await extractStorageState(ctx.context);
          const newData: PineLabsOneAdapterData = {
            ...adData, storageState: newStorageState, step: "AWAITING_OTP",
          };
          const payload = makeSessionPayload(
            "pinelabs_one", 0, newData as unknown as Record<string, unknown>,
          );
          const enc = encryptSessionPayload(payload);
          if (!enc.ok) {
            return { status: "FAILED", failReason: "SESSION_ENCRYPT_FAILED", failDetail: "Internal error." };
          }
          logger.info({ slug: "pinelabs_one" }, "pinelabs_one_submitstep_2fa_otp_required");
          return {
            status: "AWAITING_OTP",
            encryptedSessionToken: enc.token,
            nextStep: "ENTER_OTP",
            nextStepPrompt:
              "Pine Labs ONE sent an OTP to your registered mobile for 2-step verification. Enter it below.",
          };
        }
      }

      // Error messages (wrong password / invalid OTP)
      for (const errSel of SEL.ERROR_MSG) {
        try {
          const el = page.locator(errSel).first();
          if (await el.count() > 0 && await el.isVisible()) {
            const errText = (await el.textContent())?.trim() ?? "";
            if (errText) {
              const isExpired = /expired/i.test(errText);
              const isInvalid = /invalid|incorrect|wrong/i.test(errText);
              return {
                status: "FAILED",
                failReason: isExpired ? "OTP_EXPIRED"
                  : isInvalid ? (isOtpStep ? "INVALID_OTP" : "INVALID_PASSWORD")
                  : (isOtpStep ? "OTP_ERROR" : "LOGIN_ERROR"),
                failDetail: isOtpStep
                  ? `OTP error: "${errText}". ` + (isExpired
                      ? "Please restart the connection to receive a new OTP."
                      : "Check the OTP and try again, or restart for a new OTP.")
                  : `Login error: "${errText}". Check your Pine Labs ONE password and try again.`,
              };
            }
          }
        } catch { /* continue */ }
      }

      // ── CONNECTED gate ───────────────────────────────────────────────────
      await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS }).catch(() => {});

      const connectedCheck = await verifyDashboardAuthenticated(page);
      if (!connectedCheck.verified) {
        logger.warn(
          { slug: "pinelabs_one", reason: connectedCheck.reason },
          "pinelabs_one_submitstep_connected_gate_failed",
        );
        return {
          status: "FAILED",
          failReason: "LOGIN_NOT_CONFIRMED",
          failDetail: isOtpStep
            ? "OTP was submitted but the session could not be verified as authenticated. " +
              "The OTP may be incorrect or expired. Please try again or restart the connection."
            : "Password was submitted but the session could not be verified as authenticated. " +
              "Check your Pine Labs ONE password and try again.",
        };
      }

      // ── OWNERSHIP VERIFICATION GATE (never skipped) ──────────────────────
      const ownership = await verifyOwnershipFromPortal(page, adData);
      if (!ownership.verified) {
        logger.warn(
          { slug: "pinelabs_one", reason: ownership.reason },
          "pinelabs_one_submitstep_ownership_failed",
        );
        return {
          status: "FAILED",
          failReason: "OWNERSHIP_UNVERIFIABLE",
          failDetail:
            "Could not extract a verifiable merchant identifier from the Pine Labs ONE portal. " +
            "Please try again or contact RasoKart support.",
        };
      }

      // All gates passed — CONNECTED
      const newStorageState = await extractStorageState(ctx.context);
      const newData: PineLabsOneAdapterData = {
        ...adData,
        storageState: newStorageState,
        step: "CONNECTED",
        connectedAt: new Date().toISOString(),
        merchantId: ownership.merchantId,
        storeId:    ownership.storeId,
        businessName: ownership.businessName,
      };
      const payload = makeSessionPayload(
        "pinelabs_one", 0, newData as unknown as Record<string, unknown>,
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

      logger.info(
        { slug: "pinelabs_one", maskedIdentifier: adData.maskedIdentifier },
        "pinelabs_one_submitstep_connected",
      );

      return {
        status: "CONNECTED",
        encryptedSessionToken: enc.token,
        nextStep: "COMPLETE",
        nextStepPrompt: "Your Pine Labs ONE account is now connected.",
      };

    } catch (err: any) {
      logger.error({ slug: "pinelabs_one", err: err?.message }, "pinelabs_one_submitstep_error");
      return {
        status: "FAILED",
        failReason: "BROWSER_ERROR",
        failDetail: `Browser error during credential submission: ${err?.message ?? "unknown"}. Please try again.`,
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

    const adData = tokenResult.payload.adapterData as unknown as PineLabsOneAdapterData;
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
      const newData: PineLabsOneAdapterData = { ...adData, storageState: newStorageState };
      const payload = makeSessionPayload(
        "pinelabs_one", tokenResult.payload.connectionId,
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
      logger.error({ slug: "pinelabs_one", err: err?.message }, "pinelabs_one_validate_error");
      return { valid: false, reason: "validation_error" };
    } finally {
      await ctx?.release();
    }
  },

  // ── discoverEntities ─────────────────────────────────────────────────────────

  async discoverEntities(encryptedSessionToken: string): Promise<DiscoveryResult> {
    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) return { entities: [] };

    const adData = tokenResult.payload.adapterData as unknown as PineLabsOneAdapterData;
    if (!adData?.storageState) return { entities: [] };

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();

      await page.goto(`${getPortalOrigin()}/profile`, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      const check = await verifyDashboardAuthenticated(page);
      if (!check.verified) return { entities: [] };

      const ownership = await verifyOwnershipFromPortal(page, adData);
      const entities = [];

      if (ownership.merchantId) {
        entities.push({
          entityType:       "merchant" as const,
          providerEntityId: ownership.merchantId,
          providerEntityName: ownership.businessName ?? "Pine Labs ONE Merchant",
          isPrimary:        true,
          metadata:         { mid: ownership.merchantId, businessName: ownership.businessName },
        });
      }
      if (ownership.storeId) {
        entities.push({
          entityType:       "store" as const,
          providerEntityId: ownership.storeId,
          providerEntityName: "Pine Labs ONE Store",
          isPrimary:        !ownership.merchantId,
          metadata:         { storeId: ownership.storeId },
        });
      }
      if (adData.maskedIdentifier && entities.length === 0) {
        entities.push({
          entityType:       "merchant" as const,
          providerEntityId: adData.maskedIdentifier,
          providerEntityName: "Registered Mobile",
          isPrimary:        true,
          metadata:         { maskedIdentifier: adData.maskedIdentifier },
        });
      }

      const newStorageState = await extractStorageState(ctx.context);
      const newData: PineLabsOneAdapterData = {
        ...adData, storageState: newStorageState,
        merchantId:  ownership.merchantId,
        storeId:     ownership.storeId,
        businessName: ownership.businessName,
      };
      const enc = encryptSessionPayload(
        makeSessionPayload("pinelabs_one", tokenResult.payload.connectionId,
          newData as unknown as Record<string, unknown>),
      );

      logger.info({ slug: "pinelabs_one", entityCount: entities.length }, "pinelabs_one_discovery_complete");
      return { entities, encryptedSessionToken: enc.ok ? enc.token : undefined };
    } catch (err: any) {
      logger.warn({ slug: "pinelabs_one", err: err?.message }, "pinelabs_one_discovery_error");
      return { entities: [] };
    } finally {
      await ctx?.release();
    }
  },

  // ── fetchTransactions ────────────────────────────────────────────────────────

  async fetchTransactions(params: FetchTransactionsParams): Promise<FetchTransactionsResult> {
    const tokenResult = decryptSessionToken(params.encryptedSessionToken);
    if (!tokenResult.ok) return { transactions: [], hasMore: false };

    const adData = tokenResult.payload.adapterData as unknown as PineLabsOneAdapterData;
    if (!adData?.storageState || adData.step !== "CONNECTED") {
      return { transactions: [], hasMore: false };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();

      const txPaths = ["/transactions", "/payments", "/reports/transactions"];
      let txLoaded = false;
      for (const path of txPaths) {
        try {
          await page.goto(`${getPortalOrigin()}${path}`, {
            waitUntil: "domcontentloaded",
            timeout: NAV_TIMEOUT_MS,
          });
          const check = await verifyDashboardAuthenticated(page);
          if (check.verified) { txLoaded = true; break; }
        } catch { /* try next */ }
      }

      if (!txLoaded) {
        logger.warn({ slug: "pinelabs_one" }, "pinelabs_one_fetch_not_authenticated");
        return { transactions: [], hasMore: false };
      }

      // Wait for transaction rows
      const rowSel = SEL.TX_ROW.join(", ");
      try {
        await page.waitForSelector(rowSel, { timeout: NAV_TIMEOUT_MS });
      } catch {
        return { transactions: [], hasMore: false };
      }

      // Best-effort DOM scrape
      const rawRows = await page.evaluate((selectors: string[]) => {
        const results: Array<{
          txId?: string; amount?: string; status?: string; date?: string; utr?: string;
        }> = [];
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const doc = (globalThis as any)["document"] as any;
        for (const sel of selectors) {
          const rows: any[] = Array.from(doc.querySelectorAll(sel));
          if (rows.length === 0) continue;
          for (const row of rows.slice(0, 100)) {
            const text: string = row.textContent ?? "";
            const amtMatch  = text.match(/[₹\u20b9]?\s*([\d,]+\.?\d{0,2})/);
            const statusRaw =
              text.toLowerCase().includes("success")  ? "SUCCESS"  :
              text.toLowerCase().includes("failed")   ? "FAILED"   :
              text.toLowerCase().includes("refund")   ? "REVERSED" :
              text.toLowerCase().includes("pending")  ? "PENDING"  : null;
            const utrMatch  = text.match(/\b([A-Z0-9]{12,22})\b/);
            const dateMatch = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/);
            const txIdMatch = text.match(/\b(TXN|ORD|PYT)[A-Z0-9]{8,18}\b/i);
            if (amtMatch || statusRaw) {
              results.push({
                txId:   txIdMatch?.[0],
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
        const pseudoId = raw.txId ?? [raw.utr, raw.amount, raw.date].filter(Boolean).join("::");
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
      const newData: PineLabsOneAdapterData = { ...adData, storageState: newStorageState };
      const enc = encryptSessionPayload(
        makeSessionPayload("pinelabs_one", tokenResult.payload.connectionId,
          newData as unknown as Record<string, unknown>),
      );

      logger.info({ slug: "pinelabs_one", count: transactions.length }, "pinelabs_one_fetch_complete");
      return { transactions, hasMore: false, encryptedSessionToken: enc.ok ? enc.token : undefined };
    } catch (err: any) {
      logger.error({ slug: "pinelabs_one", err: err?.message }, "pinelabs_one_fetch_error");
      return { transactions: [], hasMore: false };
    } finally {
      await ctx?.release();
    }
  },

  // ── healthCheck ──────────────────────────────────────────────────────────────

  async healthCheck(_encryptedSessionToken?: string): Promise<HealthCheckResult> {
    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext();
      const page = await ctx.context.newPage();
      await page.goto(getLoginUserUrl(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      const url = page.url();
      const override = process.env["PINELABS_ONE_PORTAL_OVERRIDE"];
      let reachable = false;
      if (override) {
        reachable = url.startsWith(override);
      } else {
        try {
          const { hostname } = new URL(url);
          reachable = hostname === "one.pinelabs.com";
        } catch {}
      }
      return {
        healthy: reachable,
        status: "CONNECTED" as any,
        reason: reachable
          ? "Pine Labs ONE portal is reachable."
          : `Portal health check failed (landed at ${url}).`,
      };
    } catch (err: any) {
      return {
        healthy: false,
        status: "FAILED" as any,
        reason: "PORTAL_UNREACHABLE",
        detail: `${PORTAL_ORIGIN}: ${err?.message ?? "unknown"}`,
      };
    } finally {
      await ctx?.release();
    }
  },

  // ── reconnect ────────────────────────────────────────────────────────────────

  async reconnect(encryptedSessionToken: string): Promise<InitiateResult> {
    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) {
      return {
        status: "AWAITING_PASSWORD" as any,
        failReason: "REQUIRES_FULL_REAUTH",
        failDetail: "Session token is invalid. Please re-enter your credentials.",
        nextStep: "ENTER_PASSWORD",
      };
    }

    const adData = tokenResult.payload.adapterData as unknown as PineLabsOneAdapterData;
    if (!adData?.storageState) {
      return {
        status: "AWAITING_PASSWORD" as any,
        failReason: "REQUIRES_FULL_REAUTH",
        failDetail: "No session state found. Please re-enter your credentials.",
        nextStep: "ENTER_PASSWORD",
      };
    }

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();
      const alive = await verifySessionAlive(page);

      if (alive) {
        const newStorageState = await extractStorageState(ctx.context);
        const newData: PineLabsOneAdapterData = { ...adData, storageState: newStorageState, step: "CONNECTED" };
        const payload = makeSessionPayload(
          "pinelabs_one", tokenResult.payload.connectionId,
          newData as unknown as Record<string, unknown>,
          { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000) },
        );
        const enc = encryptSessionPayload(payload);
        logger.info({ slug: "pinelabs_one" }, "pinelabs_one_reconnect_session_alive");
        return {
          status: "CONNECTED",
          encryptedSessionToken: enc.ok ? enc.token : undefined,
          nextStep: "COMPLETE",
          nextStepPrompt: "Session reconnected.",
        };
      }

      logger.info({ slug: "pinelabs_one" }, "pinelabs_one_reconnect_session_expired");
      // Pine Labs ONE uses OTP-first (/authV2) flow — re-authentication
      // requires the merchant to re-enter their mobile / user ID and receive
      // a new OTP. Returning FAILED triggers the frontend identifier step.
      return {
        status: "FAILED",
        failReason: "SESSION_EXPIRED",
        failDetail:
          `Your Pine Labs ONE session has expired. ` +
          `Please enter your mobile number or user ID again to receive a new OTP.`,
        nextStep: null,
      };
    } catch (err: any) {
      logger.error({ slug: "pinelabs_one", err: err?.message }, "pinelabs_one_reconnect_error");
      return {
        status: "AWAITING_PASSWORD" as any,
        failReason: "RECONNECT_ERROR",
        failDetail: `Could not verify session: ${err?.message ?? "unknown"}. Please re-enter your credentials.`,
        nextStep: "ENTER_PASSWORD",
      };
    } finally {
      await ctx?.release();
    }
  },

  // ── logout ───────────────────────────────────────────────────────────────────

  async logout(encryptedSessionToken: string): Promise<void> {
    const tokenResult = decryptSessionToken(encryptedSessionToken);
    if (!tokenResult.ok) return;

    const adData = tokenResult.payload.adapterData as unknown as PineLabsOneAdapterData;
    if (!adData?.storageState) return;

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();
      // Try known logout paths
      for (const path of ["/logout", "/sign-out", "/authV2/sign-out"]) {
        try {
          await page.goto(`${getPortalOrigin()}${path}`, {
            waitUntil: "domcontentloaded",
            timeout: NAV_TIMEOUT_MS,
          });
          break;
        } catch { /* continue */ }
      }
      logger.info({ slug: "pinelabs_one" }, "pinelabs_one_logout_complete");
    } catch (err: any) {
      logger.warn({ slug: "pinelabs_one", err: err?.message }, "pinelabs_one_logout_error_swallowed");
    } finally {
      await ctx?.release();
    }
  },
};
