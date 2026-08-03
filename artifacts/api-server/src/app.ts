import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { mapDbError } from "./lib/apiError";
import fs from "fs";
import path from "path";

const app: Express = express();
app.set("trust proxy", 1);

// ── CORS allowlist ────────────────────────────────────────────────────────────
// In production: accept any *.rasokart.com origin (regex) plus an optional
// CORS_ALLOWED_ORIGIN env var override for edge cases (e.g. staging mirrors).
// In development/Replit preview: also allow localhost:* and Replit preview URLs.
// API is shared across all portals — no api.rasokart.com split.

/** Matches https://rasokart.com and https://<subdomain>.rasokart.com */
const RASOKART_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)?rasokart\.com$/;

function buildCorsOriginList(): (string | RegExp)[] {
  const list: (string | RegExp)[] = [RASOKART_ORIGIN_RE];
  // CORS_ALLOWED_ORIGIN — comma-separated extra origins for edge cases
  const corsOverride = process.env["CORS_ALLOWED_ORIGIN"] ?? "";
  for (const o of corsOverride.split(",").map((s) => s.trim()).filter(Boolean)) {
    list.push(o);
  }
  // Replit preview domains — present in both dev and publish environments
  const replitDomains = process.env["REPLIT_DOMAINS"] ?? "";
  for (const d of replitDomains.split(",").map((s) => s.trim()).filter(Boolean)) {
    list.push(`https://${d}`);
  }
  // Dev localhost
  list.push(/^http:\/\/localhost(:\d+)?$/);
  return list;
}

const corsOriginList = buildCorsOriginList();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin / server-to-server requests have no Origin header — allow
      if (!origin) return callback(null, true);
      for (const allowed of corsOriginList) {
        if (typeof allowed === "string" ? allowed === origin : allowed.test(origin)) {
          return callback(null, true);
        }
      }
      logger.warn({ origin }, "cors_blocked_origin");
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// ── Security headers ─────────────────────────────────────────────────────────
// Applied to every API response. Nginx adds X-Frame-Options / HSTS / Referrer
// for the static SPA; these headers protect the /api/* surface specifically.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// TEMPORARY: deployment dist-only patch download — remove after VPS deploy
app.get("/api/_deploy/rasokart-dist-only.tgz", (req: Request, res: Response) => {
  const filePath = "/tmp/rasokart-dist-only.tgz";
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "patch file not found" });
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=rasokart-dist-only.tgz");
  res.sendFile(path.resolve(filePath));
});

// TEMPORARY: api-server dist-only patch download — remove after VPS deploy
app.get("/api/_deploy/rasokart-api-dist-only.tgz", (req: Request, res: Response) => {
  const filePath = "/tmp/rasokart-api-dist-only.tgz";
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "patch file not found" });
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=rasokart-api-dist-only.tgz");
  res.sendFile(path.resolve(filePath));
});

// Global error handler — maps DB/unknown errors to safe structured JSON;
// never forwards raw SQL, column names, stack traces, or secrets to clients.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled route error");
  const { status, body } = mapDbError(err);
  const requestId = (req as any).id as string | undefined;
  res.status(status).json({ ...body, ...(requestId ? { requestId } : {}) });
});

export default app;
