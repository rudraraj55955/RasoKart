import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT || "5173";
const port = Number(rawPort);

const basePath = process.env.BASE_PATH || "/";

function resolveRootVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8"),
    );
    if (typeof pkg.version === "string" && pkg.version && pkg.version !== "0.0.0") {
      return pkg.version;
    }
  } catch {
    // ignore
  }
  return "2.1.0";
}

const appVersion = process.env.APP_VERSION || resolveRootVersion();
const buildDate =
  process.env.BUILD_DATE ||
  new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

export default defineConfig({
  base: basePath,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      allow: [
        path.resolve(import.meta.dirname),
        path.resolve(import.meta.dirname, "../../lib"),
      ],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
