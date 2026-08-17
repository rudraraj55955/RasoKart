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
 * Paytm Business dashboard domain (post-Aug 2026 migration).
 * The marketing site (business.paytm.com) still exists, but the actual login
 * and authenticated dashboard moved to dashboard.paytm.com.
 */
const PORTAL_DASHBOARD_BASE = "https://dashboard.paytm.com";

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

/**
 * Returns the base URL used for all post-authentication navigation (dashboard,
 * profile, transactions, logout). Separate from getPortalRoot() which is the
 * public marketing / login entry host.
 *
 * Production: https://dashboard.paytm.com (migrated ~Aug 2026)
 * Tests (PAYTM_PORTAL_ROOT_OVERRIDE set): uses the same override as getPortalRoot()
 */
function getPortalDashboardBase(): string {
  const override = process.env["PAYTM_PORTAL_ROOT_OVERRIDE"];
  return override ?? PORTAL_DASHBOARD_BASE;
}

/**
 * Login URL candidates in priority order.
 *
 * In production (no override):
 *   1. dashboard.paytm.com/login/ — current live URL (Aug 2026+)
 *   2. dashboard.paytm.com/login/ without referrer param
 *   3–5. Legacy business.paytm.com paths — now return HTTP 200 with 404 content;
 *        isActual404Page() skips them so they never match.
 *
 * In tests (PAYTM_PORTAL_ROOT_OVERRIDE set):
 *   Uses the mock server override origin for all three legacy path patterns.
 */
function getLoginUrlCandidates(): string[] {
  const override = process.env["PAYTM_PORTAL_ROOT_OVERRIDE"];
  if (override) {
    // Test mode: mock server serves all routes from a single origin
    return [`${override}/user/login`, `${override}/login`, override];
  }
  // Production: new dashboard.paytm.com URLs first; legacy as 404 fallbacks
  return [
    `${PORTAL_DASHBOARD_BASE}/login/?referrer=Business`,  // current live URL (Aug 2026+)
    `${PORTAL_DASHBOARD_BASE}/login/`,                    // without referrer param
    "https://business.paytm.com/user/login",              // legacy (HTTP 200 + 404 page)
    "https://business.paytm.com/login",                   // legacy
    "https://business.paytm.com",                         // last resort
  ];
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
  // Phone / mobile number input on the login form — single-field variants.
  // Ordered: most specific / most reliable first.
  MOBILE_INPUT: [
    'input[type="tel"]',
    'input[name="phone"]',
    'input[name="mobile"]',
    'input[name="mobileNo"]',
    'input[name="phoneNumber"]',
    'input[name="username"]',           // some portals label it "username"
    'input[placeholder*="mobile" i]',
    'input[placeholder*="phone" i]',
    'input[placeholder*="Enter mobile" i]',
    'input[placeholder*="Enter phone" i]',
    'input[placeholder*="Mobile number" i]',
    'input[id*="mobile" i]',
    'input[id*="phone" i]',
    'input[autocomplete="tel"]',
    'input[autocomplete="tel-national"]',
    'input[aria-label*="mobile" i]',
    'input[aria-label*="phone number" i]',
    // Broad type="text" variants for portals that don't use type="tel"
    'input[type="text"][placeholder*="mobile" i]',
    'input[type="text"][placeholder*="phone" i]',
    'input[type="number"][placeholder*="mobile" i]',
  ],

  // Mobile number as individual digit boxes (≥10 boxes = phone, not OTP).
  // Key disambiguator: OTP uses 4–8 boxes; mobile uses 10 boxes.
  MOBILE_DIGIT_BOXES: [
    'input[type="text"][maxlength="1"]',
    'input[type="number"][maxlength="1"]',
    'input[type="tel"][maxlength="1"]',
  ],

  // "Get OTP" / "Continue" button after mobile entry
  GET_OTP_BTN: [
    'button:has-text("Get OTP")',
    'button:has-text("Request OTP")',
    'button:has-text("Send OTP")',
    'button:has-text("Proceed")',
    'button:has-text("Continue")',
    'button:has-text("Next")',
    '[role="button"]:has-text("Get OTP")',
    '[role="button"]:has-text("Send OTP")',
    '[type="submit"]:has-text("OTP")',
    '[type="submit"]',                  // last-resort fallback
  ],

  // OTP input — single-field variants (maxlength ≥ 4 distinguishes from digit boxes)
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
  // Individual digit boxes for OTP (4–8 boxes disambiguated by countDigitBoxes < 10)
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
    'text=Total Transactions',
    'text=Gross Sales',
    'text=Settlement Amount',
    'text=Success Rate',
    'a[href*="/transactions"]',
    'a[href*="/settlement"]',
    'a[href*="/reports"]',
    '[data-testid*="dashboard"]',
    'nav[aria-label*="sidebar" i]',
    'nav[aria-label*="merchant" i]',
    '[aria-label*="merchant" i]',
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
    "text=I'm not a robot",
  ],

  // WAF / device-verification / rate-limit markers
  WAF_MARKERS: [
    '#challenge-running',
    '#cf-wrapper',
    '.cf-browser-verification',
    'text=Checking your browser',
    'text=Verifying you are human',
    'text=Device verification',
    'text=Verify your device',
    'text=Too many requests',
    'text=Rate limit exceeded',
    'text=Please solve the puzzle',
    'text=Security check required',
  ],

  // Cookie / privacy consent banner accept buttons
  COOKIE_BANNER: [
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Accept & Continue")',
    'button:has-text("I Accept")',
    'button:has-text("I Agree")',
    'button:has-text("Got it")',
    '[data-testid="cookie-accept"]',
    '[data-testid="consent-accept"]',
    '[aria-label="Accept cookies"]',
    '[id*="accept-cookies"]',
  ],

  // Phone / mobile login mode selectors (when email/phone toggle exists)
  LOGIN_MODE_PHONE: [
    'button:has-text("Mobile")',
    'button:has-text("Phone")',
    'button:has-text("Mobile Number")',
    '[role="tab"]:has-text("Mobile")',
    '[role="tab"]:has-text("Phone")',
    'a:has-text("Mobile Number")',
    '[data-testid="mobile-tab"]',
    '[data-testid="phone-tab"]',
    'input[type="radio"][value="mobile"]',
    'input[type="radio"][value="phone"]',
  ],

  // accounts.paytm.com OAuth SDK iframe — the actual login form host on the
  // new Paytm Business portal (dashboard.paytm.com/login, Aug 2026+).
  // Cross-origin but fully accessible via Playwright's CDP protocol.
  ACCOUNTS_IFRAME: [
    'iframe[src*="accounts.paytm.com"]',
    'iframe[src*="oauth-js-sdk"]',
  ],

  // OTP login link inside the accounts.paytm.com iframe.
  // May be absent if the portal removed OTP login (triggers password-mode fallback).
  OTP_LOGIN_LINK: [
    'a:has-text("Login with OTP")',
    'a:has-text("Send OTP to mobile")',
    'a:has-text("Use OTP")',
    'a:has-text("OTP")',
    'button:has-text("Login with OTP")',
    'button:has-text("Get OTP")',
    'button:has-text("Send OTP")',
    '[data-testid*="otp-login"]',
    '[data-testid*="send-otp"]',
  ],

  // Password input in accounts.paytm.com iframe
  PASSWORD_INPUT: [
    'input[name="password"]',
    'input[id="password_login"]',
    'input[type="password"]',
    'input[placeholder*="password" i]',
    'input[placeholder*="Password"]',
  ],

  // Submit / Sign-in button inside the accounts.paytm.com iframe
  ACCOUNTS_SUBMIT_BTN: [
    'button:has-text("Sign in Securely")',
    'button:has-text("Sign In")',
    'button[type="submit"]',
    '[role="button"]:has-text("Sign in")',
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
    'tbody tr',
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
  /**
   * Login mode used to complete authentication.
   * "otp"      — standard mobile OTP flow (traditional portal)
   * "password" — Paytm account password (new portal structure, Aug 2026+)
   * undefined  — unknown / legacy session; treated as "otp"
   */
  loginMode?: "otp" | "password";
  /**
   * Full mobile number stored for password-mode re-entry in submitStep.
   * SECURITY: Stored only within the encrypted session token (AES-256-GCM) —
   * never logged, never returned in API responses.
   * Only set when loginMode === "password".
   */
  storedMobile?: string;
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
 *
 * Accepts both the new dashboard.paytm.com host (Aug 2026+) and the legacy
 * business.paytm.com host, plus any test override origin.
 */
function isDashboardUrl(url: string): boolean {
  const override = process.env["PAYTM_PORTAL_ROOT_OVERRIDE"];
  if (override) {
    // Test mode: must be on the mock server origin
    if (!url.startsWith(override)) return false;
  } else {
    // Production: accept both the new dashboard host and the legacy marketing host
    try {
      const { hostname } = new URL(url);
      if (hostname !== "dashboard.paytm.com" && hostname !== "business.paytm.com") return false;
    } catch {
      return false;
    }
  }
  // Reject login-page URLs (path-based check handles both real and mock)
  if (isLoginUrl(url)) return false;
  // Extract pathname
  let pathname = "/";
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
 * Returns true if the page returned HTTP 200 but actually renders a 404 /
 * "Page Not Found" experience — Paytm Business does this for deprecated login
 * URLs (e.g. business.paytm.com/user/login returns HTTP 200 with "Uh-oh!
 * Page Not Found" content since the portal migrated to dashboard.paytm.com
 * in Aug 2026).
 * Never throws.
 */
async function isActual404Page(page: Page): Promise<boolean> {
  try {
    const title = await page.title();
    if (/404|not found|page not found/i.test(title)) return true;
    // Paytm's specific marker
    const bodySnippet = await page
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .evaluate(() => ((globalThis as any)["document"]?.body?.innerText ?? "").slice(0, 500))
      .catch(() => "");
    return /uh[.\s\-!]*oh|page not found|this page.*doesn.?t exist|404/i.test(bodySnippet);
  } catch {
    return false;
  }
}

/**
 * Polls for the accounts.paytm.com OAuth SDK iframe to appear and have its
 * form rendered (at least one input visible). This iframe hosts the actual
 * login form on the new Paytm Business portal (dashboard.paytm.com/login).
 *
 * Cross-origin but fully accessible via Playwright's CDP protocol — no
 * same-origin restriction applies for Playwright automation.
 *
 * Returns the Frame, or null if not found within the timeout. Never throws.
 */
async function waitForAccountsFrame(
  page: Page,
  timeoutMs = 12_000,
): Promise<import("playwright").Frame | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = page.frames().find(
      (f) => f.url().includes("accounts.paytm.com") || f.url().includes("oauth-js-sdk"),
    );
    if (frame) {
      // Confirm at least one input is present (form rendered)
      try {
        await frame.waitForSelector("input", { timeout: 3_000 });
        return frame;
      } catch {
        // Frame found but form not ready yet — keep polling
      }
    }
    await new Promise<void>((r) => setTimeout(r, 600));
  }
  return null;
}

/**
 * Like tryLocator() but operates on a specific Playwright Frame (including
 * cross-origin frames accessible via CDP). Returns the first visible matching
 * locator, or null. Never throws.
 */
async function tryFrameLocator(
  frame: import("playwright").Frame,
  selectors: string[],
  timeout = ACTION_TIMEOUT_MS / 2,
): Promise<import("playwright").Locator | null> {
  for (const sel of selectors) {
    try {
      const loc = frame.locator(sel).first();
      if (
        (await loc.count().catch(() => 0)) > 0 &&
        (await loc.isVisible({ timeout }).catch(() => false))
      ) {
        return loc;
      }
    } catch { /* try next */ }
  }
  return null;
}

// ── New resilience helpers ─────────────────────────────────────────────────────

/**
 * Count the total number of visible single-character digit input boxes on the
 * page (main frame only — cross-origin frames are inaccessible).
 *
 * KEY DISAMBIGUATOR:
 *   ≥ 10 boxes → mobile number digit entry (10-digit Indian phone)
 *    4–8 boxes → OTP digit entry
 * This prevents OTP_INPUT_DIGITS selectors from matching phone digit boxes.
 */
async function countDigitBoxes(page: Page): Promise<number> {
  for (const sel of SEL.MOBILE_DIGIT_BOXES) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) return count;
    } catch {}
  }
  return 0;
}

/**
 * Try each selector in the main page AND all accessible same-origin frames.
 * Returns the first visible locator found, or null. Never throws.
 *
 * Same-origin frames are accessible; cross-origin frames are silently skipped
 * (accessing their DOM throws a SecurityError that is caught and ignored).
 */
async function tryLocatorIncludingFrames(
  page: Page,
  selectors: string[],
  timeout = ACTION_TIMEOUT_MS / 2,
) {
  // Main page first (fast path)
  const mainResult = await tryLocator(page, selectors, timeout);
  if (mainResult) return mainResult;

  // Same-origin frames (e.g. iframe-wrapped login forms)
  const frames = page.frames();
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    const frameUrl = frame.url();
    // Skip blank and non-http frames (cross-origin data URIs, chrome-extension, etc.)
    if (!frameUrl || frameUrl === "about:blank" || !frameUrl.startsWith("http")) continue;
    for (const sel of selectors) {
      try {
        const loc = frame.locator(sel).first();
        const n = await loc.count();
        if (n > 0 && (await loc.isVisible().catch(() => false))) return loc as any;
      } catch {
        // SecurityError on cross-origin frame — skip silently
      }
    }
  }
  return null;
}

/**
 * Attempt to dismiss a cookie / privacy consent banner.
 * Best-effort — never throws. Returns true if a button was clicked.
 */
async function dismissCookieBanner(page: Page): Promise<boolean> {
  for (const sel of SEL.COOKIE_BANNER) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible())) {
        await el.click({ timeout: 3_000 });
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Attempt to select the mobile / phone login mode if a mode toggle is present
 * (e.g. "Mobile" / "Email" tabs on the login page).
 * Best-effort — never throws. Returns true if a mode selector was clicked.
 */
async function selectMobileLoginMode(page: Page): Promise<boolean> {
  for (const sel of SEL.LOGIN_MODE_PHONE) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible())) {
        await el.click({ timeout: 3_000 });
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Detect WAF / device-verification / rate-limit pages.
 * Returns a short reason code if detected, null otherwise. Never throws.
 */
async function detectWaf(page: Page): Promise<string | null> {
  for (const sel of SEL.WAF_MARKERS) {
    try {
      if ((await page.locator(sel).count()) > 0) return "WAF_OR_DEVICE_VERIFICATION";
    } catch {}
  }
  try {
    const title = await page.title();
    if (/checking your browser|verif(y|ying)|challenge|access denied/i.test(title)) {
      return "WAF_OR_DEVICE_VERIFICATION";
    }
  } catch {}
  return null;
}

/**
 * Collect safe page diagnostic information for error messages and logs.
 * NEVER captures: full HTML, cookies, user data, query params, or secrets.
 * Strips query strings to avoid leaking redirect tokens.
 */
async function collectPageDiagnostics(page: Page): Promise<{
  urlPath: string;
  title: string;
  frameCount: number;
  visibleInputCount: number;
  digitBoxCount: number;
  hasWaf: boolean;
  hasCaptcha: boolean;
  hasCookieBanner: boolean;
  hasModeSelector: boolean;
}> {
  let urlPath = "";
  let title = "";
  let frameCount = 0;
  let visibleInputCount = 0;
  let digitBoxCount = 0;
  let hasWaf = false;
  let hasCaptchaBool = false;
  let hasCookieBanner = false;
  let hasModeSelector = false;

  try { urlPath = new URL(page.url()).pathname; } catch { urlPath = page.url().split("?")[0]; }
  try { title = (await page.title()).slice(0, 80); } catch {}
  try { frameCount = Math.max(0, page.frames().length - 1); } catch {}
  try { visibleInputCount = await page.locator("input:visible").count(); } catch {}
  try { digitBoxCount = await countDigitBoxes(page); } catch {}
  try { hasWaf = (await detectWaf(page)) !== null; } catch {}
  try { hasCaptchaBool = await hasCaptcha(page); } catch {}
  try {
    for (const sel of SEL.COOKIE_BANNER) {
      if ((await page.locator(sel).count()) > 0) { hasCookieBanner = true; break; }
    }
  } catch {}
  try {
    for (const sel of SEL.LOGIN_MODE_PHONE) {
      if ((await page.locator(sel).count()) > 0) { hasModeSelector = true; break; }
    }
  } catch {}

  return { urlPath, title, frameCount, visibleInputCount, digitBoxCount, hasWaf, hasCaptcha: hasCaptchaBool, hasCookieBanner, hasModeSelector };
}

/**
 * Fill the mobile number in the current page.
 * Handles four layouts in priority order:
 *   1. accounts.paytm.com OAuth SDK iframe (new portal, Aug 2026+)
 *   2. Single-field input (main page)
 *   3. Single-field input inside a same-origin iframe
 *   4. Digit-box layout (10 individual maxlength="1" inputs)
 *
 * Returns true if filled successfully. NEVER logs the mobile number.
 */
async function fillMobileInPage(page: Page, mobile: string): Promise<boolean> {
  // (0) accounts.paytm.com OAuth SDK iframe — new Paytm Business portal.
  //     This is a cross-origin iframe but Playwright CDP can access it directly.
  //     Check it FIRST because the new portal has zero inputs in the main frame.
  const accFrame = await waitForAccountsFrame(page, 5_000);
  if (accFrame) {
    const loc = await tryFrameLocator(accFrame, SEL.MOBILE_INPUT);
    if (loc) {
      try {
        await loc.click({ timeout: ACTION_TIMEOUT_MS });
        await loc.fill(mobile, { timeout: ACTION_TIMEOUT_MS });
        return true;
      } catch {}
    }
  }

  // (1) Single-field input — main page + same-origin iframes
  const singleInput = await tryLocatorIncludingFrames(page, SEL.MOBILE_INPUT);
  if (singleInput) {
    try {
      await singleInput.click({ timeout: ACTION_TIMEOUT_MS });
      await singleInput.fill(mobile, { timeout: ACTION_TIMEOUT_MS });
      return true;
    } catch {}
  }

  // (2) Digit-box layout (main page only — cross-origin iframe digit boxes are inaccessible)
  const digitCount = await countDigitBoxes(page);
  if (digitCount >= mobile.length) {
    for (const sel of SEL.MOBILE_DIGIT_BOXES) {
      const boxes = page.locator(sel);
      const count = await boxes.count().catch(() => 0);
      if (count >= mobile.length) {
        for (let i = 0; i < mobile.length; i++) {
          try {
            await boxes.nth(i).click({ timeout: ACTION_TIMEOUT_MS });
            await boxes.nth(i).fill(mobile[i]!, { timeout: ACTION_TIMEOUT_MS });
          } catch {}
        }
        return true;
      }
    }
  }

  return false;
}

/**
 * Fill OTP — handles three layouts in priority order:
 *   1. accounts.paytm.com OAuth SDK iframe (new portal, Aug 2026+)
 *   2. Single-field OTP input (main page)
 *   3. Individual digit-box layout (Paytm's custom OTP input)
 *
 * Returns true if OTP was successfully filled.
 */
async function fillOtp(page: Page, otp: string): Promise<boolean> {
  // (0) accounts.paytm.com iframe — new portal structure. OTP field may be
  //     inside the cross-origin accounts.paytm.com frame after OTP link click.
  const accFrame = await waitForAccountsFrame(page, 5_000);
  if (accFrame) {
    const singleInFrame = await tryFrameLocator(accFrame, SEL.OTP_INPUT_SINGLE);
    if (singleInFrame) {
      try {
        await singleInFrame.fill(otp, { timeout: ACTION_TIMEOUT_MS });
        return true;
      } catch {}
    }
    // Digit boxes inside the frame
    for (const digitSel of SEL.OTP_INPUT_DIGITS) {
      const boxes = accFrame.locator(digitSel);
      const count = await boxes.count().catch(() => 0);
      if (count >= otp.length) {
        for (let i = 0; i < otp.length; i++) {
          try {
            await boxes.nth(i).fill(otp[i]!, { timeout: ACTION_TIMEOUT_MS });
          } catch {}
        }
        return true;
      }
    }
  }

  // (1) Try single OTP field on main page
  const single = await tryLocator(page, SEL.OTP_INPUT_SINGLE);
  if (single) {
    await single.fill(otp, { timeout: ACTION_TIMEOUT_MS });
    return true;
  }

  // (2) Try individual digit boxes (Paytm's custom OTP input, main page)
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
 * Describes the detected state of the login page after navigation.
 *
 *   "mobile_form"        — single-field mobile number input is visible (main page / same-origin iframe)
 *   "mobile_form_digits" — 10 individual digit-box inputs for mobile number (old portal)
 *   "mobile_form_iframe" — mobile field is inside a cross-origin accounts.paytm.com OAuth iframe
 *                          (new Paytm Business portal, dashboard.paytm.com, Aug 2026+)
 *   "otp_form"           — 4–8 digit boxes or single OTP field visible
 *   "dashboard"          — already on the authenticated dashboard
 *   "waf"                — WAF / device-verification / rate-limit page
 *   false                — could not reach any recognisable page
 */
type LoginPageState =
  | "mobile_form"
  | "mobile_form_digits"
  | "mobile_form_iframe"
  | "otp_form"
  | "dashboard"
  | "waf"
  | false;

/**
 * Navigate to the Paytm Business login page and detect the current auth state.
 *
 * Sequence of checks on each URL candidate:
 *   0. HTTP 200 with 404 content ("Uh-oh! Page Not Found") → skip candidate
 *   1. Dashboard URL → "dashboard"
 *   2. WAF / device verification markers → "waf"
 *   3. Dismiss cookie/privacy consent banner (best-effort)
 *   4. Select mobile login mode if a toggle is present (best-effort)
 *   5. Wait for accounts.paytm.com iframe → "mobile_form_iframe" (new portal)
 *   6. Count single-char digit boxes:
 *      ≥ 10 → "mobile_form_digits" (phone number, NOT OTP)
 *       4–8 → "otp_form"
 *   7. Single-field mobile input (main page + same-origin iframes) → "mobile_form"
 *   8. Single-field OTP input → "otp_form"
 *   If no URL candidate yields a recognisable state → false
 */
async function navigateToLoginPage(page: Page): Promise<LoginPageState> {
  for (const url of getLoginUrlCandidates()) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

      const currentUrl = page.url();

      // (0) Skip pages that return HTTP 200 but render 404 content.
      //     Paytm's deprecated /user/login and /login URLs do this since the
      //     portal migrated to dashboard.paytm.com in Aug 2026.
      if (await isActual404Page(page)) continue;

      // (1) Redirected to dashboard — session was still valid
      if (isDashboardUrl(currentUrl)) return "dashboard";

      // (2) WAF / device-verification / rate-limit page
      const wafReason = await detectWaf(page);
      if (wafReason) return "waf";

      // (3) Best-effort: dismiss cookie/privacy consent banner
      await dismissCookieBanner(page);

      // (4) Best-effort: select mobile login mode if a toggle is present
      await selectMobileLoginMode(page);

      // Brief wait for JS-driven DOM updates after the interactions above
      await page.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => {});

      // (5) Wait for accounts.paytm.com OAuth SDK iframe.
      //     This check runs BEFORE main-page selectors because the new portal
      //     (dashboard.paytm.com) has zero inputs in the main frame — all
      //     inputs are inside a cross-origin accounts.paytm.com iframe.
      //     Allow up to 10 s for the iframe to load (it is fetched asynchronously).
      const accFrame = await waitForAccountsFrame(page, 10_000);
      if (accFrame) {
        const mobileInFrame = await tryFrameLocator(accFrame, SEL.MOBILE_INPUT);
        if (mobileInFrame) return "mobile_form_iframe";
        // Frame appeared but has OTP form instead of mobile
        const otpInFrame = await tryFrameLocator(accFrame, SEL.OTP_INPUT_SINGLE);
        if (otpInFrame) return "otp_form";
      }

      // (6) Count single-char digit boxes — the critical disambiguator.
      //     Some Paytm portal versions use 10 individual maxlength="1" boxes for
      //     phone entry.  OTP_INPUT_DIGITS selectors match these boxes too, so
      //     the only reliable way to tell them apart is the count:
      //       ≥ 10 boxes → mobile number digit entry
      //        4–8 boxes → OTP digit entry
      const digitCount = await countDigitBoxes(page);
      if (digitCount >= 10) return "mobile_form_digits";
      if (digitCount >= 4)  return "otp_form";

      // (7) Single-field mobile input — main page + same-origin iframes
      const mobileInput = await tryLocatorIncludingFrames(
        page, SEL.MOBILE_INPUT, ACTION_TIMEOUT_MS,
      );
      if (mobileInput) return "mobile_form";

      // (8) Single-field OTP input
      const otpSingle = await tryLocatorIncludingFrames(
        page, SEL.OTP_INPUT_SINGLE, ACTION_TIMEOUT_MS,
      );
      if (otpSingle) return "otp_form";

    } catch {
      // Navigation or DOM query failed — try next URL candidate
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

      // Navigate to login page and detect its current state
      const loginState = await navigateToLoginPage(page);

      // ── State: portal unreachable ─────────────────────────────────────────
      if (!loginState) {
        return {
          status: "FAILED",
          failReason: "PORTAL_UNREACHABLE",
          failDetail: "Could not reach the Paytm Business login page. " +
            "The portal may be temporarily unavailable.",
          helpUrl: HELP_URL,
        };
      }

      // ── State: WAF / device verification ─────────────────────────────────
      if (loginState === "waf") {
        logger.warn({ slug: "paytm_merchant" }, "paytm_initiate_waf_detected");
        return {
          status: "AWAITING_USER_ACTION" as any,
          failReason: "WAF_OR_DEVICE_VERIFICATION",
          failDetail: "Paytm Business is showing a device-verification or rate-limit page. " +
            "This is transient — please wait a few minutes and try again.",
          helpUrl: HELP_URL,
        };
      }

      // ── State: already on dashboard (unexpected in a fresh context) ───────
      if (loginState === "dashboard") {
        const onDash = await verifyDashboardAuthenticated(page);
        if (onDash.verified) {
          const storageState = await extractStorageState(ctx.context);
          const adData: PaytmAdapterData = {
            storageState,
            maskedMobile: maskMobile(mobile),
            step: "CONNECTED",
            connectedAt: new Date().toISOString(),
          };
          const payload = makeSessionPayload(
            "paytm_merchant", 0, adData as unknown as Record<string, unknown>,
            { expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000) },
          );
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

      // ── State: OTP form visible before mobile entry (unexpected) ──────────
      // A fresh isolated context has no cookies, so seeing an OTP form here
      // means the portal's digit-box count was 4–8 (ambiguous, classified as
      // OTP) OR the portal showed an unexpected step. Fail closed with
      // diagnostics so support can investigate.
      if (loginState === "otp_form") {
        const diag = await collectPageDiagnostics(page);
        logger.warn({ slug: "paytm_merchant", diag }, "paytm_initiate_unexpected_otp_form");
        return {
          status: "FAILED",
          failReason: "LOGIN_UI_CHANGED",
          failDetail: `Paytm is showing an OTP/verification form before mobile entry ` +
            `(path=${diag.urlPath}, title="${diag.title}", inputs=${diag.visibleInputCount}, ` +
            `digitBoxes=${diag.digitBoxCount}). ` +
            "The portal UI may have changed — please contact RasoKart support.",
          helpUrl: HELP_URL,
        };
      }

      // ── State: mobile_form_iframe (new Paytm Business portal, Aug 2026+) ──
      // The login form lives inside a cross-origin accounts.paytm.com OAuth
      // SDK iframe. Primary flow is mobile + password; OTP may be available
      // as an alternative via a "Login with OTP" link.
      if (loginState === "mobile_form_iframe") {
        // CAPTCHA check
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

        // Fill mobile in the accounts.paytm.com iframe
        const filled = await fillMobileInPage(page, mobile);
        if (!filled) {
          const diag = await collectPageDiagnostics(page);
          logger.warn({ slug: "paytm_merchant", diag }, "paytm_initiate_iframe_mobile_not_found");
          return {
            status: "FAILED",
            failReason: "LOGIN_UI_CHANGED",
            failDetail: `Could not locate the mobile number input in the Paytm login iframe ` +
              `(path=${diag.urlPath}, title="${diag.title}", frames=${diag.frameCount}). ` +
              "The portal UI may have changed — please contact RasoKart support.",
            helpUrl: HELP_URL,
          };
        }

        // Look for OTP link in the accounts.paytm.com iframe.
        // If the portal offers OTP login, we use that flow.
        // If not (password-only), we prompt for the Paytm password instead.
        const accFrameForOtp = await waitForAccountsFrame(page, 5_000);
        const otpLink = accFrameForOtp
          ? await tryFrameLocator(accFrameForOtp, SEL.OTP_LOGIN_LINK)
          : null;

        if (otpLink) {
          // OTP option found — click it and wait for OTP input field
          try { await otpLink.click({ timeout: ACTION_TIMEOUT_MS }); } catch {}
          await page.waitForTimeout(1_500);
          const otpAppeared = accFrameForOtp
            ? await tryFrameLocator(accFrameForOtp, SEL.OTP_INPUT_SINGLE)
            : null;
          if (otpAppeared) {
            const storageState = await extractStorageState(ctx.context);
            const adData: PaytmAdapterData = {
              storageState,
              maskedMobile: maskMobile(mobile),
              step: "AWAITING_OTP",
              loginMode: "otp",
            };
            const payload = makeSessionPayload(
              "paytm_merchant", 0, adData as unknown as Record<string, unknown>,
            );
            const enc = encryptSessionPayload(payload);
            if (!enc.ok) {
              return { status: "FAILED", failReason: "SESSION_ENCRYPT_FAILED", failDetail: "Internal error." };
            }
            logger.info({ slug: "paytm_merchant", maskedMobile: maskMobile(mobile) }, "paytm_initiate_iframe_otp_awaiting");
            return {
              status: "AWAITING_OTP",
              encryptedSessionToken: enc.token,
              nextStep: "ENTER_OTP",
              nextStepPrompt:
                `An OTP has been sent to your Paytm-registered mobile (${maskMobile(mobile)}). ` +
                "Enter the OTP below to complete the connection.",
            };
          }
        }

        // No OTP option found — portal uses password login.
        // The "OTP" field on the merchant connect page is repurposed for the
        // Paytm Business password in this mode. The password is received
        // encrypted, decrypted once in submitStep, filled into the browser,
        // and never stored. storedMobile is needed for submitStep to re-fill
        // the mobile field (stored encrypted in the session token).
        logger.info({ slug: "paytm_merchant", maskedMobile: maskMobile(mobile) }, "paytm_initiate_iframe_password_mode");
        const storageState = await extractStorageState(ctx.context);
        const adData: PaytmAdapterData = {
          storageState,
          maskedMobile: maskMobile(mobile),
          step: "AWAITING_OTP",
          loginMode: "password",
          storedMobile: mobile,  // encrypted inside session token (AES-256-GCM), never logged
        };
        const payload = makeSessionPayload(
          "paytm_merchant", 0, adData as unknown as Record<string, unknown>,
        );
        const enc = encryptSessionPayload(payload);
        if (!enc.ok) {
          return { status: "FAILED", failReason: "SESSION_ENCRYPT_FAILED", failDetail: "Internal error." };
        }
        return {
          status: "AWAITING_OTP",
          encryptedSessionToken: enc.token,
          nextStep: "ENTER_OTP",
          nextStepPrompt:
            `Enter your Paytm Business account password for (${maskMobile(mobile)}). ` +
            "Your password is transmitted encrypted and never stored.",
        };
      }

      // ── State: mobile_form or mobile_form_digits ──────────────────────────
      // (loginState is one of those two at this point)

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

      // Fill mobile number — handles single-field, iframe-embedded, AND digit-box layouts
      const filled = await fillMobileInPage(page, mobile);
      if (!filled) {
        // Collect safe diagnostics for the error message (no secrets included)
        const diag = await collectPageDiagnostics(page);
        logger.warn({ slug: "paytm_merchant", diag }, "paytm_initiate_mobile_input_not_found");
        return {
          status: "FAILED",
          failReason: "LOGIN_UI_CHANGED",
          failDetail: `Could not locate the mobile number input on the Paytm Business ` +
            `login page (path=${diag.urlPath}, title="${diag.title}", ` +
            `frames=${diag.frameCount}, inputs=${diag.visibleInputCount}, ` +
            `digitBoxes=${diag.digitBoxCount}, waf=${diag.hasWaf}, ` +
            `captcha=${diag.hasCaptcha}, cookieBanner=${diag.hasCookieBanner}). ` +
            "The portal UI may have changed — please contact RasoKart support.",
          helpUrl: HELP_URL,
        };
      }

      // Click "Get OTP" button (searches main page + same-origin iframes)
      const otpBtn = await tryLocatorIncludingFrames(page, SEL.GET_OTP_BTN);
      if (!otpBtn) {
        return {
          status: "FAILED",
          failReason: "LOGIN_UI_CHANGED",
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

    // In password mode the merchant submits their Paytm Business password as
    // the "OTP". Passwords may contain non-digit characters and be >8 chars.
    // In OTP mode we strip non-digits and enforce the 4–8 digit range.
    const isPasswordMode = adData.loginMode === "password";
    const credential = isPasswordMode
      ? otpDecrypt.value.trim()                          // password: keep as-is
      : otpDecrypt.value.trim().replace(/\D/g, "");      // OTP: digits only
    if (!credential) {
      return {
        status: "FAILED",
        failReason: "INVALID_OTP",
        failDetail: isPasswordMode ? "Password is required." : "OTP is required.",
      };
    }
    if (!isPasswordMode && (credential.length < 4 || credential.length > 8)) {
      return {
        status: "FAILED",
        failReason: "INVALID_OTP",
        failDetail: "OTP must be 4–8 digits.",
      };
    }
    // Unify: "otp" is the credential value (OTP digits or password string)
    const otp = credential;

    let ctx = null as Awaited<ReturnType<typeof newIsolatedContext>> | null;
    try {
      ctx = await newIsolatedContext(adData.storageState);
      const page = await ctx.context.newPage();

      // Navigate to portal dashboard base — check current state of the restored session.
      // Uses dashboard.paytm.com (not marketing business.paytm.com) to match where
      // the portal actually lands after authentication (Aug 2026+ migration).
      await page.goto(getPortalDashboardBase(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      const preCheckUrl = page.url();

      if (!isLoginUrl(preCheckUrl)) {
        // Might already be logged in — run the full CONNECTED gate
        const preCheck = await verifyDashboardAuthenticated(page);
        if (preCheck.verified) {
          // Session is still alive — verify ownership before returning CONNECTED.
          // CONNECTED is never returned without this check.
          const ownership = await verifyOwnershipFromPortal(page, adData, getPortalDashboardBase());
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
        const ownership = await verifyOwnershipFromPortal(page, adData, getPortalDashboardBase());
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

      // Session-expired states — OTP/password session was not preserved in cookies
      if (loginState === "mobile_form" || loginState === "mobile_form_digits") {
        return {
          status: "FAILED",
          failReason: "SESSION_EXPIRED_REAUTH",
          failDetail: "OTP session has expired. Please restart the connection to receive a new OTP.",
        };
      }

      // ── Password mode (new Paytm Business portal, Aug 2026+) ─────────────
      // loginState === "mobile_form_iframe" with loginMode === "password":
      // The portal did not preserve OTP state in cookies (expected for password
      // mode — there is no server-side OTP session). Re-fill mobile + password.
      if (loginState === "mobile_form_iframe" && isPasswordMode) {
        if (!adData.storedMobile) {
          return {
            status: "FAILED",
            failReason: "SESSION_EXPIRED_REAUTH",
            failDetail: "Session data is incomplete. Please restart the connection.",
          };
        }

        const pwdFrame = await waitForAccountsFrame(page, 10_000);
        if (!pwdFrame) {
          return {
            status: "FAILED",
            failReason: "PORTAL_UNREACHABLE",
            failDetail: "Could not find the Paytm login iframe. The portal may have changed. " +
              "Please try again.",
          };
        }

        // Fill mobile
        const mobileInput = await tryFrameLocator(pwdFrame, SEL.MOBILE_INPUT);
        if (!mobileInput) {
          return {
            status: "FAILED",
            failReason: "LOGIN_UI_CHANGED",
            failDetail: "Could not locate the mobile number input in the Paytm login iframe.",
          };
        }
        await mobileInput.click({ timeout: ACTION_TIMEOUT_MS });
        await mobileInput.fill(adData.storedMobile, { timeout: ACTION_TIMEOUT_MS });

        // Fill password (`otp` holds the password value in password mode)
        const pwdInput = await tryFrameLocator(pwdFrame, SEL.PASSWORD_INPUT);
        if (!pwdInput) {
          return {
            status: "FAILED",
            failReason: "LOGIN_UI_CHANGED",
            failDetail: "Could not locate the password input in the Paytm login iframe. " +
              "The portal UI may have changed — please contact RasoKart support.",
          };
        }
        await pwdInput.click({ timeout: ACTION_TIMEOUT_MS });
        await pwdInput.fill(otp, { timeout: ACTION_TIMEOUT_MS }); // otp = password

        // Click "Sign in Securely" — button may be disabled until both fields filled;
        // wait a moment for React to enable it before clicking.
        await page.waitForTimeout(500);
        const signInBtn = await tryFrameLocator(pwdFrame, SEL.ACCOUNTS_SUBMIT_BTN);
        if (signInBtn) {
          await signInBtn.click({ timeout: ACTION_TIMEOUT_MS * 2 });
        } else {
          await pwdInput.press("Enter");
        }

        // Wait for dashboard or error
        const allOutcomes2 = [
          ...SEL.DASHBOARD_LANDMARK,
          ...SEL.ERROR_MSG,
          ...SEL.CAPTCHA,
          ...SEL.BLOCKED,
        ];
        await waitForAny(page, allOutcomes2, NAV_TIMEOUT_MS);

        // Check for error in iframe (wrong password, etc.)
        const pwdErrEl = await tryFrameLocator(pwdFrame, SEL.ERROR_MSG);
        if (pwdErrEl) {
          const errText = (await pwdErrEl.textContent().catch(() => ""))?.trim() ?? "";
          if (errText) {
            const isInvalid = /invalid|incorrect|wrong|not match/i.test(errText);
            return {
              status: "FAILED",
              failReason: isInvalid ? "INVALID_OTP" : "OTP_ERROR",
              failDetail: `Login error: "${errText}". ` +
                (isInvalid ? "Check your Paytm Business password and try again." : "Please try again."),
            };
          }
        }

        // Fall through to CONNECTED gate below — the page navigation after sign-in
        // is handled by the shared landmark check + ownership verification.
        // No extra code needed here.
      } else if (loginState === "mobile_form_iframe" && !isPasswordMode) {
        // OTP mode but cookies didn't restore OTP step — session expired
        return {
          status: "FAILED",
          failReason: "SESSION_EXPIRED_REAUTH",
          failDetail: "OTP session has expired. Please restart the connection to receive a new OTP.",
        };
      } else if (loginState !== "otp_form") {
        // Unexpected state
        return {
          status: "FAILED",
          failReason: "PORTAL_UNREACHABLE",
          failDetail: "Could not reach the login page. The session may have expired. " +
            "Please restart the connection.",
        };
      }

      // ── OTP mode submission ───────────────────────────────────────────────
      // loginState === "otp_form" — OTP inputs already visible on the login page
      // (accounts.paytm.com iframe or main-page OTP field)
      if (loginState === "otp_form") {
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

        // Submit OTP
        const submitBtn = await tryLocator(page, SEL.SUBMIT_OTP_BTN);
        if (submitBtn) {
          await submitBtn.click({ timeout: ACTION_TIMEOUT_MS });
        } else {
          // Try accounts iframe submit button
          const accFrame = await waitForAccountsFrame(page, 3_000);
          const iframeSubmitBtn = accFrame
            ? await tryFrameLocator(accFrame, SEL.ACCOUNTS_SUBMIT_BTN)
            : null;
          if (iframeSubmitBtn) {
            await iframeSubmitBtn.click({ timeout: ACTION_TIMEOUT_MS });
          } else {
            await page.keyboard.press("Enter");
          }
        }
      }

      // ── Shared post-submit outcome checks ─────────────────────────────────
      // Wait for dashboard landmark, error message, CAPTCHA, or block indicator.
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
          failDetail: "Paytm is showing a CAPTCHA during login verification. " +
            "Please wait a few minutes and try again.",
        };
      }

      // Check for error messages (invalid/expired OTP or incorrect password)
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
                failDetail: isPasswordMode
                  ? `Login error: "${errText}". Check your Paytm Business password and try again.`
                  : `OTP error: "${errText}". ` + (
                    isExpired
                      ? "Please restart the connection to receive a new OTP."
                      : "Check the OTP and try again, or restart for a new OTP."
                  ),
              };
            }
          }
        } catch { /* continue */ }
      }

      // ── CONNECTED gate ─────────────────────────────────────────────────────
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
          failDetail: isPasswordMode
            ? `Login was submitted but session could not be verified as authenticated. ` +
              `Check your Paytm Business password and try again.`
            : `OTP was submitted but session could not be verified as authenticated. ` +
              `The OTP may be incorrect or expired. Please try again or restart the connection.`,
        };
      }
      // ── End CONNECTED gate ─────────────────────────────────────────────────

      // ── OWNERSHIP VERIFICATION GATE ───────────────────────────────────────
      // CONNECTED is NEVER returned without this check passing.
      const ownership = await verifyOwnershipFromPortal(page, adData, getPortalDashboardBase());
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
      await page.goto(`${getPortalDashboardBase()}/profile`, {
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
      await page.goto(`${getPortalDashboardBase()}/transactions`, {
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
      const loginUrl = `${PORTAL_DASHBOARD_BASE}/login/?referrer=Business`;
      await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      const url = page.url();
      // Reachable if we stayed on dashboard.paytm.com (not a 404 or marketing redirect)
      let reachable = false;
      try {
        const { hostname } = new URL(url);
        reachable = (hostname === "dashboard.paytm.com" || hostname === "business.paytm.com") &&
          !(await isActual404Page(page));
      } catch {}
      const override = process.env["PAYTM_PORTAL_ROOT_OVERRIDE"];
      if (override) reachable = url.startsWith(override); // test mode
      return {
        healthy: reachable,
        status:  "CONNECTED" as any,
        reason:  reachable
          ? "Paytm Business portal is reachable."
          : `Portal login page check failed (landed at ${url}).`,
      };
    } catch (err: any) {
      return {
        healthy: false,
        status:  "FAILED" as any,
        reason:  "PORTAL_UNREACHABLE",
        detail:  `${PORTAL_DASHBOARD_BASE}: ${err?.message ?? "unknown"}`,
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
      await page.goto(`${getPortalDashboardBase()}/user/logout`, {
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
