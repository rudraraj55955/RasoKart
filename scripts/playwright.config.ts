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
