/**
 * Browser Pool — Isolated Chromium Context Manager
 *
 * Manages a singleton Playwright Chromium browser with isolated per-session
 * contexts. Used exclusively by the Connector Engine's portal_session_connector
 * adapters.
 *
 * DESIGN:
 *   Contexts are NOT kept alive between adapter calls. Each call:
 *     1. Decrypts the session token → gets serialized storage state
 *     2. Creates a fresh context pre-loaded with that storage state
 *     3. Does its work (navigate, fill, click, extract data)
 *     4. Calls extractStorageState() → updated cookie/localStorage blob
 *     5. Closes the context immediately
 *     6. Re-encrypts and returns the updated session token
 *   This is stateless and avoids memory leaks from zombie contexts.
 *
 * SECURITY:
 *   - Screenshots, video capture, and tracing are DISABLED.
 *   - Storage state (cookies/localStorage) contains auth tokens and must be
 *     encrypted by the caller before persistence. Never log or return it.
 *   - Passwords and OTPs are typed into page fields and the local string
 *     variable goes out of scope immediately after the fill() call.
 *   - No stealth plugins, fingerprint spoofing, or anti-bot evasion are used.
 *   - OTP interception via network request hooking is never used.
 *
 * LIMITS:
 *   - MAX_CONCURRENT = 5 simultaneous browser contexts.
 *   - Navigation timeout: 30 s.
 *   - Action timeout: 10 s.
 *   - Browser crash → singleton cleared → re-initialized on next request.
 *
 * ENVIRONMENT:
 *   Set PLAYWRIGHT_BROWSERS_PATH to override the default chromium location.
 *   Default: /home/runner/workspace/.cache/ms-playwright (Replit dev env).
 *   For VPS/production deployment, install chromium via `npx playwright install chromium`.
 */

import path from "path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { logger } from "../../lib/logger";

// ── Environment setup ─────────────────────────────────────────────────────────

// Point playwright to the pre-installed chromium binary if the env var is not
// already set. The binary was installed at this path by the workspace setup.
if (!process.env["PLAYWRIGHT_BROWSERS_PATH"]) {
  // Attempt: workspace root relative to this module's runtime location.
  // In dev: process.cwd() is artifacts/api-server → two levels up = workspace root.
  // In prod (VPS): override via PLAYWRIGHT_BROWSERS_PATH env var.
  const wsRoot = path.resolve(process.cwd(), "../..");
  const candidate = path.join(wsRoot, ".cache/ms-playwright");
  process.env["PLAYWRIGHT_BROWSERS_PATH"] = candidate;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const NAV_TIMEOUT_MS    = 30_000;  // 30 s — page navigation / goto
export const ACTION_TIMEOUT_MS = 10_000;  // 10 s — click, fill, waitFor, etc.
const MAX_CONCURRENT           = 5;       // max simultaneous open contexts

// ── Browser singleton ─────────────────────────────────────────────────────────

let browserSingleton: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;
let concurrentCount = 0;

async function getOrCreateBrowser(): Promise<Browser> {
  if (browserSingleton?.isConnected()) return browserSingleton;
  if (launchPromise) return launchPromise;

  launchPromise = chromium
    .launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-accelerated-2d-canvas",
        "--single-process",
        "--no-zygote",
        // Explicitly absent: no stealth flags, no user-agent spoofing
      ],
      timeout: 30_000,
    })
    .then((browser) => {
      browserSingleton = browser;
      launchPromise = null;
      browser.on("disconnected", () => {
        logger.warn({}, "browser_pool_disconnected");
        browserSingleton = null;
        launchPromise = null;
      });
      logger.info({}, "browser_pool_launched");
      return browser;
    })
    .catch((err: any) => {
      launchPromise = null;
      logger.error({ err: err?.message }, "browser_pool_launch_failed");
      throw err;
    });

  return launchPromise;
}

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Serialized browser storage state (cookies + localStorage + sessionStorage).
 * Returned by extractStorageState and accepted by newIsolatedContext.
 *
 * SECURITY: This object contains authentication cookies. The caller MUST
 * encrypt it before persistence and MUST NOT log or return it to the client.
 */
export type BrowserStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface IsolatedContext {
  context: BrowserContext;
  /** MUST be called when the adapter call is done, even if it throws. */
  release: () => Promise<void>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create an isolated browser context.
 *
 * @param storageState  Pre-serialized storage state from a previous session.
 *                      When provided, the new context is pre-authenticated
 *                      (cookies + localStorage restored). When absent, the
 *                      context starts fresh (no cookies).
 *
 * The caller MUST call release() when finished, even on error, to avoid
 * leaking the concurrent slot.
 *
 * Throws if the pool is at capacity or if Chromium fails to start.
 */
export async function newIsolatedContext(
  storageState?: BrowserStorageState,
): Promise<IsolatedContext> {
  if (concurrentCount >= MAX_CONCURRENT) {
    throw new Error(
      `Browser pool at capacity (${concurrentCount}/${MAX_CONCURRENT} active contexts). ` +
        `Retry in a moment.`,
    );
  }

  concurrentCount++;
  let released = false;

  let browser: Browser;
  try {
    browser = await getOrCreateBrowser();
  } catch (err) {
    concurrentCount = Math.max(0, concurrentCount - 1);
    throw err;
  }

  const context = await browser.newContext({
    storageState:         storageState ?? undefined,
    permissions:          [],          // no geolocation, camera, notifications
    geolocation:          undefined,
    serviceWorkers:       "block",     // reduce noise / side-effects
    // ── Security: all capture disabled ───────────────────────────────────────
    recordVideo:          undefined,
    // recordHar is not set → no HAR capture
  });

  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);

  async function release() {
    if (released) return;
    released = true;
    concurrentCount = Math.max(0, concurrentCount - 1);
    try {
      await context.close();
    } catch (err: any) {
      logger.warn({ err: err?.message }, "browser_pool_context_close_error");
    }
  }

  return { context, release };
}

/**
 * Extract the current storage state (cookies + localStorage) from a context.
 * Call this BEFORE release() — the context must still be open.
 *
 * SECURITY: The returned object contains authentication cookies. Encrypt
 * before persistence; never log or return to the client.
 */
export async function extractStorageState(
  context: BrowserContext,
): Promise<BrowserStorageState> {
  return context.storageState();
}

/**
 * Pool health status for health checks and monitoring.
 */
export function browserPoolStatus(): {
  browserConnected: boolean;
  concurrent: number;
  capacity: number;
} {
  return {
    browserConnected: browserSingleton?.isConnected() ?? false,
    concurrent:       concurrentCount,
    capacity:         MAX_CONCURRENT,
  };
}

/**
 * Close all contexts and shut down the browser. Called on server shutdown.
 */
export async function closeBrowserPool(): Promise<void> {
  if (browserSingleton) {
    try {
      await browserSingleton.close();
    } catch {
      // swallow — shutdown path
    }
    browserSingleton = null;
  }
}
