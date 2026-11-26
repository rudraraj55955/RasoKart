/**
 * Browser Pool — Isolated Chromium Context Manager
 *
 * Manages a singleton Playwright Chromium browser with isolated per-session
 * contexts. Used exclusively by the Connector Engine's portal_session_connector
 * adapters.
 *
 * ── CHROMIUM RESOLUTION (no hardcoded paths) ─────────────────────────────────
 *
 * Priority chain for locating the Chromium executable:
 *
 *   1. PLAYWRIGHT_CHROMIUM_EXECUTABLE (env var)
 *      Set this on the VPS/production server to an absolute path.
 *      Example: /usr/bin/chromium-browser  or  /opt/playwright/chrome
 *
 *   2. PLAYWRIGHT_BROWSERS_PATH (env var, any environment)
 *      If set, the code scans this directory for versioned chromium dirs
 *      (chromium_headless_shell-*  or  chromium-*) and picks the first
 *      binary found. Playwright itself also reads this env var, so setting
 *      it is the recommended approach for CI.
 *
 *   3. Auto-scan common workspace-relative locations
 *      Checks ../.. .cache/ms-playwright and ./.cache/ms-playwright relative
 *      to process.cwd(), scanning for versioned chromium directories.
 *      This covers the Replit dev workspace layout without hardcoding it.
 *
 *   4. Fallback: executablePath = undefined
 *      Playwright uses its own default detection (works when chromium is
 *      installed system-wide via `npx playwright install chromium`).
 *
 * ── DESIGN ───────────────────────────────────────────────────────────────────
 *   Contexts are NOT kept alive between adapter calls. Each call:
 *     1. Decrypts the session token → gets serialized storage state
 *     2. Creates a fresh context pre-loaded with that storage state
 *     3. Does its work (navigate, fill, click, extract data)
 *     4. Calls extractStorageState() → updated cookie/localStorage blob
 *     5. Closes the context immediately
 *     6. Re-encrypts and returns the updated session token
 *   This is stateless and avoids memory leaks from zombie contexts.
 *
 * ── SECURITY ─────────────────────────────────────────────────────────────────
 *   - Screenshots, video capture, and tracing are DISABLED.
 *   - Storage state (cookies/localStorage) contains auth tokens and must be
 *     encrypted by the caller before persistence. Never log or return it.
 *   - Passwords and OTPs are typed into page fields and the local string
 *     variable goes out of scope immediately after the fill() call.
 *   - No stealth plugins, fingerprint spoofing, or anti-bot evasion.
 *   - OTP interception via network request hooking is NOT used.
 *
 * ── LIMITS ───────────────────────────────────────────────────────────────────
 *   - MAX_CONCURRENT = 5 simultaneous browser contexts.
 *   - Navigation timeout: 30 s.
 *   - Action timeout: 10 s.
 *   - Browser crash → singleton cleared → re-initialized on next request.
 */

import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { logger } from "../../lib/logger";

// ── Browser runtime error ─────────────────────────────────────────────────────

/**
 * Thrown when Chromium cannot be found or is not executable.
 *
 * Propagated to API route handlers which catch it and return a sanitized 503
 * response — no server paths, binary locations, or Playwright stack traces are
 * ever exposed to the merchant or customer.
 */
export class BrowserRuntimeUnavailableError extends Error {
  readonly code = "BROWSER_RUNTIME_UNAVAILABLE" as const;
  constructor() {
    super("Browser runtime is unavailable. Contact support.");
    this.name = "BrowserRuntimeUnavailableError";
  }
}

/**
 * Sanitize a browser error message before including it in an API response.
 *
 * Playwright's launch error messages include the full path to the expected
 * Chromium binary ("Executable doesn't exist at /root/.cache/...").
 * This function replaces all path-exposing messages with the stable token
 * "BROWSER_RUNTIME_UNAVAILABLE" and strips filesystem path segments from
 * anything else, capping the result at 80 characters.
 */
export function sanitizeBrowserError(msg: string): string {
  const pathExposingPatterns = [
    "Executable doesn't exist",
    "ENOENT",
    "spawn",
    "Cannot find module",
    "BROWSER_RUNTIME_UNAVAILABLE",
    "browserType.launch",
  ];
  if (pathExposingPatterns.some((p) => msg.includes(p))) {
    return "BROWSER_RUNTIME_UNAVAILABLE";
  }
  // Remove any filesystem path segments (starts with /) then cap length
  return msg.replace(/\/[^\s)]+/g, "[path]").slice(0, 80);
}

// ── Chromium binary resolution ────────────────────────────────────────────────

/**
 * Return p if it exists AND has the execute bit set (X_OK), otherwise undefined.
 * Used to validate every Chromium path before passing it to Playwright so that
 * Playwright's "Executable doesn't exist at <full-server-path>" error is never
 * triggered — we throw BrowserRuntimeUnavailableError first instead.
 */
function assertExecutable(p: string): string | undefined {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return p;
  } catch {
    return undefined;
  }
}

/**
 * Look up a system-installed Chromium binary using `which`.
 * On Replit (NixOS) with `pkgs.chromium` in `replit.nix`, this resolves to
 * the nix-store chromium which has correct library RPATHs and does not require
 * additional LD_LIBRARY_PATH setup.
 *
 * Returns undefined if no system chromium is found in PATH.
 */
function findSystemChromium(): string | undefined {
  const candidates = [
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
  ];
  for (const name of candidates) {
    try {
      const p = execFileSync("which", [name], {
        encoding: "utf8",
        timeout: 2_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (p) return assertExecutable(p);
    } catch {
      // not in PATH — try next
    }
  }
  return undefined;
}

/**
 * Scan a playwright browsers directory for a Chromium binary.
 * Looks for versioned directories matching chromium_headless_shell-* or
 * chromium-* and returns the first executable found.
 *
 * Does NOT hardcode any revision number — scans by prefix so it works with
 * any installed playwright revision.
 */
function scanForChromium(browsersDir: string): string | undefined {
  if (!fs.existsSync(browsersDir)) return undefined;
  let entries: string[];
  try {
    entries = fs.readdirSync(browsersDir);
  } catch {
    return undefined;
  }

  // Try headless shell first (lighter, preferred for automation)
  // then fall back to full Chromium
  const prefixCandidates = [
    {
      prefix: "chromium_headless_shell-",
      binRelPaths: ["chrome-headless-shell-linux64/chrome-headless-shell"],
    },
    {
      prefix: "chromium-",
      binRelPaths: ["chrome-linux64/chrome", "chrome-linux/chrome"],
    },
  ];

  for (const { prefix, binRelPaths } of prefixCandidates) {
    // Sort descending so highest revision wins (matches playwright's own logic)
    const dirs = entries
      .filter((d) => d.startsWith(prefix))
      .sort()
      .reverse();

    for (const dir of dirs) {
      for (const rel of binRelPaths) {
        const candidate = path.join(browsersDir, dir, rel);
        if (assertExecutable(candidate)) {
          logger.debug({ candidate }, "browser_pool_chromium_found");
          return candidate;
        }
      }
    }
  }

  return undefined;
}

/**
 * Resolve the Chromium executable path using a priority chain.
 * Returns undefined to let Playwright use its own detection when no candidate
 * is found — this works after `npx playwright install chromium`.
 */
function resolveChromiumExecutable(): string | undefined {
  // Priority 1: explicit env var — for VPS / production
  const explicit = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];
  if (explicit) {
    if (assertExecutable(explicit)) {
      logger.info({ path: explicit }, "browser_pool_using_explicit_executable");
      return explicit;
    }
    // Path set but not runnable — warn and fall through to system detection
    logger.warn(
      { code: "BROWSER_RUNTIME_UNAVAILABLE" },
      "browser_pool_explicit_executable_not_runnable",
    );
  }

  // Priority 2: system chromium via `which chromium` (NixOS / apt / brew)
  // On Replit, `pkgs.chromium` in replit.nix provides a nix-store binary with
  // all library RPATHs correctly set — far more reliable than the playwright-
  // downloaded headless shell which has no LD_LIBRARY_PATH hints.
  const systemChromium = findSystemChromium();
  if (systemChromium) {
    logger.info({ path: systemChromium }, "browser_pool_using_system_chromium");
    return systemChromium;
  }

  // Priority 3: scan PLAYWRIGHT_BROWSERS_PATH
  const envBrowsersPath = process.env["PLAYWRIGHT_BROWSERS_PATH"];
  if (envBrowsersPath) {
    const found = scanForChromium(envBrowsersPath);
    if (found) return found;
  }

  // Priority 3: auto-scan workspace-relative locations.
  // We check multiple candidates so this works regardless of the CWD at launch.
  // None of these are hardcoded final paths — they are search roots.
  const searchRoots = [
    path.resolve(process.cwd(), "../..", ".cache/ms-playwright"),
    path.resolve(process.cwd(), "..", ".cache/ms-playwright"),
    path.resolve(process.cwd(), ".cache/ms-playwright"),
    "/home/runner/.cache/ms-playwright",           // common Replit home path
    "/root/.cache/ms-playwright",                  // common Linux home path
  ];

  for (const root of searchRoots) {
    const found = scanForChromium(root);
    if (found) {
      logger.info({ root, found }, "browser_pool_chromium_auto_detected");
      return found;
    }
  }

  // Priority 4: undefined — Playwright's own PLAYWRIGHT_BROWSERS_PATH handling
  // will take over, which works after `npx playwright install chromium`
  logger.warn(
    {},
    "browser_pool_chromium_not_found_using_playwright_default",
  );
  return undefined;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const NAV_TIMEOUT_MS    = 30_000;
export const ACTION_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT           = 5;

// ── Browser singleton ─────────────────────────────────────────────────────────

let browserSingleton: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;
let concurrentCount = 0;

/**
 * Keepalive browser context — opened immediately after browser launch and kept
 * alive indefinitely. Without it, Chromium exits when all user contexts are
 * closed (Chromium's default idle-exit behaviour under --single-process).
 * This allows the browser singleton to survive between adapter calls, avoiding
 * a 7-second relaunch penalty on every submitStep / validateSession / etc.
 *
 * Closed only in closeBrowserPool() (server shutdown).
 */
let keepaliveCtx: import("playwright").BrowserContext | null = null;

const CHROMIUM_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-accelerated-2d-canvas",
  // NOTE: --single-process and --no-zygote are intentionally absent.
  // Those flags cause Chromium to exit when all open contexts are closed, even
  // when a keepalive context is present, because they disable Chromium's normal
  // multi-process supervision. The flags reduce memory slightly but make the
  // singleton unstable for multi-call flows (initiateSession → submitStep).
  // Security: no stealth flags, no user-agent overrides, no anti-bot args.
];

async function getOrCreateBrowser(): Promise<Browser> {
  if (browserSingleton?.isConnected()) return browserSingleton;
  if (launchPromise) return launchPromise;

  const executablePath = resolveChromiumExecutable();

  // Pre-validate: if a path was resolved, confirm it is executable BEFORE calling
  // chromium.launch(). This prevents Playwright from emitting its verbose
  // "Executable doesn't exist at <full-server-path>" error which leaks server paths.
  if (executablePath !== undefined && !assertExecutable(executablePath)) {
    logger.error({ code: "BROWSER_RUNTIME_UNAVAILABLE" }, "browser_pool_resolved_path_not_runnable");
    throw new BrowserRuntimeUnavailableError();
  }

  launchPromise = chromium
    .launch({
      headless: true,
      executablePath,           // undefined = let playwright find it
      args: CHROMIUM_LAUNCH_ARGS,
      timeout: 30_000,
    })
    .then(async (browser) => {
      browserSingleton = browser;
      launchPromise = null;
      browser.on("disconnected", () => {
        logger.warn({}, "browser_pool_disconnected");
        browserSingleton = null;
        launchPromise = null;
        keepaliveCtx = null;
      });
      // Open a background context immediately so Chromium never sees zero open
      // contexts. Without this, --single-process Chromium exits when the only
      // user context is released (between initiateSession and submitStep calls).
      try {
        keepaliveCtx = await browser.newContext({ permissions: [], serviceWorkers: "block" });
        logger.info({}, "browser_pool_keepalive_opened");
      } catch {
        // Non-fatal — if keepalive open fails, the pool still works but may
        // suffer browser exits between calls.
        logger.warn({}, "browser_pool_keepalive_open_failed");
      }
      logger.info(
        { executablePath: executablePath ?? "playwright-default" },
        "browser_pool_launched",
      );
      return browser;
    })
    .catch((err: any) => {
      launchPromise = null;
      const msg: string = err?.message ?? "";
      // Playwright's "Executable doesn't exist at ..." leaks the server binary path.
      // Catch it here and re-throw as BrowserRuntimeUnavailableError so callers
      // always get a path-free error they can safely surface in API responses.
      if (
        err instanceof BrowserRuntimeUnavailableError ||
        msg.includes("Executable doesn't exist") ||
        msg.includes("ENOENT") ||
        msg.includes("browserType.launch")
      ) {
        logger.error({ code: "BROWSER_RUNTIME_UNAVAILABLE" }, "browser_pool_launch_failed_missing_binary");
        throw new BrowserRuntimeUnavailableError();
      }
      logger.error(
        { err: msg, code: "BROWSER_LAUNCH_ERROR" },
        "browser_pool_launch_failed",
      );
      throw err;
    });

  return launchPromise;
}

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Serialized browser storage state (cookies + localStorage + sessionStorage).
 * SECURITY: This object contains authentication cookies. Encrypt before
 * persistence; never log or return to the client.
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
 *                      When provided the new context is pre-authenticated.
 *                      When absent the context starts fresh (no cookies).
 *
 * The caller MUST call release() when finished, even on error.
 * Throws if the pool is at capacity or Chromium fails to start.
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
    storageState:   storageState ?? undefined,
    permissions:    [],
    geolocation:    undefined,
    serviceWorkers: "block",
    // Security: all capture disabled
    recordVideo:    undefined,
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
 * Call BEFORE release() — the context must still be open.
 *
 * SECURITY: Contains authentication cookies. Encrypt before persistence;
 * never log or return to the client.
 */
export async function extractStorageState(
  context: BrowserContext,
): Promise<BrowserStorageState> {
  return context.storageState();
}

// ── Browser readiness probe ───────────────────────────────────────────────────

/**
 * Lightweight browser readiness check that does NOT visit any portal.
 * Opens a blank page, verifies JS execution, and closes immediately.
 * Safe to call from a health-check endpoint with no authentication.
 *
 * Returns:
 *   { ready: true, durationMs: number }
 *   { ready: false, reason: string }
 */
export async function probeBrowserReady(): Promise<
  | { ready: true; durationMs: number; version: string }
  | { ready: false; reason: string }
> {
  const t0 = Date.now();
  let ctx: IsolatedContext | null = null;
  try {
    ctx = await newIsolatedContext();
    const page = await ctx.context.newPage();
    // Load a blank page and execute a trivial JS expression
    await page.goto("about:blank", { timeout: 10_000 });
    const val = await page.evaluate(() => 1 + 1);
    if (val !== 2) {
      return { ready: false, reason: "js_evaluation_mismatch" };
    }
    // browser.version() is safe to expose — no paths, no credentials
    const version = browserSingleton?.version() ?? "unknown";
    return { ready: true, durationMs: Date.now() - t0, version };
  } catch (err: any) {
    // Sanitize: never expose server paths or Playwright stack traces in responses
    return { ready: false, reason: sanitizeBrowserError(err?.message ?? "unknown_error") };
  } finally {
    await ctx?.release();
  }
}

// ── Pool status ───────────────────────────────────────────────────────────────

export function browserPoolStatus(): {
  browserConnected: boolean;
  concurrent: number;
  capacity: number;
} {
  return {
    browserConnected: browserSingleton?.isConnected() ?? false,
    concurrent:       concurrentCount,
    capacity:         MAX_CONCURRENT,
    // executablePath deliberately omitted — never expose server paths in API responses
  };
}

/**
 * Close all contexts and shut down the browser (server shutdown hook).
 */
export async function closeBrowserPool(): Promise<void> {
  // Close keepalive context first so browser sees zero contexts gracefully
  if (keepaliveCtx) {
    try {
      await keepaliveCtx.close();
    } catch { /* swallow */ }
    keepaliveCtx = null;
  }
  if (browserSingleton) {
    try {
      await browserSingleton.close();
    } catch { /* swallow */ }
    browserSingleton = null;
  }
}
