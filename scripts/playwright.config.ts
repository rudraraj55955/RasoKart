import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:80",
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  reporter: [["list"]],
});
