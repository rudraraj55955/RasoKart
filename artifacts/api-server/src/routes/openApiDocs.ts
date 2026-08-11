/**
 * openApiDocs.ts
 *
 * Serves the RasoKart OpenAPI 3.1.0 specification and an embedded Swagger UI.
 *
 * Routes (all public — no auth required):
 *   GET /api/openapi.yaml           — raw YAML spec (for Postman, code-gen, AI tools)
 *   GET /api/openapi.json           — same spec as JSON
 *   GET /api/swagger                — interactive Swagger UI (CDN-based, no build step)
 *   GET /api/postman-collection     — Postman collection JSON (download)
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

function resolvePostmanCollectionPath(): string {
  try {
    const esmDirname = path.dirname(fileURLToPath(import.meta.url));
    const fromEsm = path.resolve(esmDirname, "../../../../lib/api-spec/rasokart.postman_collection.json");
    if (fs.existsSync(fromEsm)) return fromEsm;
  } catch {
    // fall through
  }
  const fromCwd = path.resolve(process.cwd(), "../../lib/api-spec/rasokart.postman_collection.json");
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(process.cwd(), "lib/api-spec/rasokart.postman_collection.json");
}

const POSTMAN_COLLECTION_PATH = resolvePostmanCollectionPath();

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

// ── GET /api/postman-collection ───────────────────────────────────────────────
router.get("/postman-collection", (_req: Request, res: Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="rasokart.postman_collection.json"');
  res.setHeader("Cache-Control", "public, max-age=300");
  try {
    const json = fs.readFileSync(POSTMAN_COLLECTION_PATH, "utf-8");
    res.send(json);
  } catch {
    res.status(500).json({ error: "Postman collection not available" });
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
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    }
    #back-banner a { color: #60a5fa; text-decoration: none; }
    #back-banner a:hover { text-decoration: underline; }
    #back-banner .sep { color: #334155; }
    #back-banner .badge {
      background: #1e293b; color: #94a3b8;
      padding: 2px 8px; border-radius: 4px; font-size: 11px;
    }
    #back-banner .postman-actions {
      margin-left: auto; display: flex; align-items: center; gap: 8px;
    }
    #back-banner .btn-postman {
      display: inline-flex; align-items: center; gap: 6px;
      background: #ff6c37; color: #fff; font-weight: 600; font-size: 12px;
      padding: 4px 12px; border-radius: 5px; text-decoration: none;
      transition: background 0.15s;
    }
    #back-banner .btn-postman:hover { background: #e05a29; text-decoration: none; }
    #back-banner .btn-postman svg { flex-shrink: 0; }
    #back-banner .btn-download {
      display: inline-flex; align-items: center; gap: 5px;
      background: #1e293b; color: #94a3b8; font-size: 12px;
      padding: 4px 10px; border-radius: 5px; text-decoration: none;
      border: 1px solid #334155; transition: border-color 0.15s, color 0.15s;
    }
    #back-banner .btn-download:hover { border-color: #60a5fa; color: #60a5fa; text-decoration: none; }
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
    <div class="postman-actions">
      <a id="postman-import-btn" class="btn-postman" href="#" title="Open this collection in the Postman desktop app">
        <svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="16" fill="#FF6C37"/>
          <path d="M18.1 9.3a7.5 7.5 0 1 0 4.6 6.7h-4.6V9.3z" fill="#fff"/>
        </svg>
        Run in Postman
      </a>
      <a class="btn-download" href="/api/postman-collection" download="rasokart.postman_collection.json" title="Download Postman collection JSON">
        ↓ Download collection
      </a>
    </div>
  </div>
  <script>
    (function () {
      // Build the Postman deep-link using the current page's origin so it works
      // on any deployment (localhost, staging, production).
      var collectionUrl = encodeURIComponent(window.location.origin + "/api/postman-collection");
      var deepLink = "postman://app/collections/import?url=" + collectionUrl;
      document.getElementById("postman-import-btn").href = deepLink;
    })();
  </script>
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
