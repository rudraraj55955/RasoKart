/**
 * openApiDocs.ts
 *
 * Serves the RasoKart OpenAPI 3.1.0 specification and an embedded Swagger UI.
 *
 * Routes (all public — no auth required):
 *   GET /api/openapi.yaml  — raw YAML spec (for Postman, code-gen, AI tools)
 *   GET /api/openapi.json  — same spec as JSON
 *   GET /api/swagger       — interactive Swagger UI (CDN-based, no build step)
 *
 * Security:
 *   - CORS is set to * for spec endpoints (standard practice for public API specs)
 *   - Swagger UI disables "Try it out" to prevent accidental live calls
 *   - No credentials, secrets, or private config are exposed
 */

import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

/**
 * Resolve path to openapi.yaml.
 * Works for both tsx (source) and compiled JS (dist) execution:
 * - ESM / tsx: use import.meta.url to derive __dirname equivalent
 * - CWD fallback: when pnpm changes to artifacts/api-server, 2 levels up = workspace root
 */
function resolveSpecPath(): string {
  // Derive __dirname-equivalent in ESM/tsx context; fall back gracefully if
  // import.meta.url is unavailable (e.g. synthetic CJS shim).
  try {
    const esmDirname = path.dirname(fileURLToPath(import.meta.url));
    const fromEsm = path.resolve(esmDirname, "../../../../lib/api-spec/openapi.yaml");
    if (fs.existsSync(fromEsm)) return fromEsm;
  } catch {
    // import.meta.url not available — fall through to CWD fallbacks
  }
  const fromCwd = path.resolve(process.cwd(), "../../lib/api-spec/openapi.yaml");
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromCwdRoot = path.resolve(process.cwd(), "lib/api-spec/openapi.yaml");
  return fromCwdRoot;
}

const SPEC_PATH = resolveSpecPath();

// ── GET /api/openapi.yaml ─────────────────────────────────────────────────────
router.get("/openapi.yaml", (_req: Request, res: Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/yaml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  try {
    const yaml = fs.readFileSync(SPEC_PATH, "utf-8");
    res.send(yaml);
  } catch {
    res.status(500).json({ error: "OpenAPI specification not available" });
  }
});

// ── GET /api/openapi.json ─────────────────────────────────────────────────────
router.get("/openapi.json", (_req: Request, res: Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  try {
    const yamlText = fs.readFileSync(SPEC_PATH, "utf-8");
    // js-yaml is available in the workspace (node_modules/js-yaml@4.1.1)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jsYaml = require("js-yaml") as { load: (s: string) => unknown };
    const parsed = jsYaml.load(yamlText);
    res.json(parsed);
  } catch {
    res.status(500).json({ error: "OpenAPI specification not available" });
  }
});

// ── GET /api/swagger ──────────────────────────────────────────────────────────
// Self-contained Swagger UI page served from Unpkg CDN.
// Points spec at /api/openapi.yaml (same-origin relative URL).
// tryItOutEnabled: false — read-only docs, no accidental live API calls.
router.get("/swagger", (_req: Request, res: Response) => {
  const SWAGGER_UI_VERSION = "5.18.2";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RasoKart API Reference</title>
  <meta name="description" content="Interactive API documentation for the RasoKart Payment Gateway REST API.">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; }

    /* ── Top bar ──────────────────────────────── */
    #swagger-ui .topbar { background: #0f172a; border-bottom: 1px solid #1e293b; padding: 0 16px; }
    #swagger-ui .topbar-wrapper { max-width: 1280px; margin: 0 auto; }
    #swagger-ui .topbar-wrapper .link { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    #swagger-ui .topbar-wrapper .link::before {
      content: "RasoKart";
      font-size: 17px; font-weight: 700; color: #60a5fa; letter-spacing: -0.5px;
    }
    #swagger-ui .topbar-wrapper img { display: none; }
    #swagger-ui .topbar-wrapper span { display: none; }

    /* ── Scheme selector ──────────────────────── */
    #swagger-ui .schemes { background: transparent; }

    /* ── Back link banner ────────────────────── */
    #back-banner {
      background: #0f172a; border-bottom: 1px solid #1e293b;
      padding: 8px 24px; font-size: 13px; color: #94a3b8;
      display: flex; align-items: center; gap: 16px;
    }
    #back-banner a { color: #60a5fa; text-decoration: none; }
    #back-banner a:hover { text-decoration: underline; }
    #back-banner .sep { color: #334155; }
    #back-banner .badge {
      margin-left: auto; background: #1e293b; color: #94a3b8;
      padding: 2px 8px; border-radius: 4px; font-size: 11px;
    }
  </style>
</head>
<body>
  <div id="back-banner">
    <a href="/api-docs">← API Docs</a>
    <span class="sep">|</span>
    <a href="/api/openapi.yaml">openapi.yaml</a>
    <span class="sep">|</span>
    <a href="/api/openapi.json">openapi.json</a>
    <span class="badge">OpenAPI 3.1.0 · Read-only</span>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: "/api/openapi.yaml",
        dom_id: "#swagger-ui",
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset,
        ],
        layout: "BaseLayout",
        deepLinking: true,
        displayRequestDuration: true,
        showExtensions: false,
        showCommonExtensions: true,
        // Read-only — no live API calls from docs page
        tryItOutEnabled: false,
        supportedSubmitMethods: [],
        // Persist auth across page refreshes (for copy-paste demos)
        persistAuthorization: true,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
      });
    };
  </script>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(html);
});

export default router;
