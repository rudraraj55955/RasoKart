import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// On NixOS (Replit environment) the playwright-managed headless shell binary
// is missing system-level shared libraries. In GitHub Actions CI or local
// macOS/Linux machines, Playwright manages its own Chromium binary.
const NIX_CHROMIUM =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const isCI = process.env["GITHUB_ACTIONS"] === "true";

const CHROMIUM_EXECUTABLE: string | undefined =
  process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] ??
  (!isCI && existsSync(NIX_CHROMIUM) ? NIX_CHROMIUM : undefined);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /production-analytics-smoke\.spec\.ts/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env["PRODUCTION_BASE_URL"] ?? "https://rasokart.com",
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      executablePath: CHROMIUM_EXECUTABLE,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  },
  reporter: [["list"]],
});
