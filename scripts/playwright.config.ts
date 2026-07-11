import { defineConfig } from "@playwright/test";

// On NixOS (Replit environment) the playwright-managed headless shell binary
// is missing system-level shared libraries.  Use the nix-packaged chromium
// which has its rpaths correctly set within the nix store.
const CHROMIUM_EXECUTABLE =
  process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] ??
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: true,
  // This sandbox only has 2 CPU cores.  The validation runner executes both
  // playwright invocations (settings-persistence + merchant-settings-persistence)
  // simultaneously, so 2 workers × 2 invocations = 4 Chromium processes on 2
  // cores.  That causes the exact resource contention this comment originally
  // warned about (saves silently not landing, toasts not rendering, etc.).
  // With workers: 1, each invocation uses 1 Chromium process = 2 total across
  // both simultaneous runs, which fits cleanly within the 2-core budget.
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:80",
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      executablePath: CHROMIUM_EXECUTABLE,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  },
  reporter: [["list"]],
});
