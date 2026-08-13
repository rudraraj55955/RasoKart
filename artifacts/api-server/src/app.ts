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

// ── CORS ─────────────────────────────────────────────────────────────────────
// Payment gateway callback endpoints (PayU browser-return, S2S webhook) receive
// cross-origin requests from third-party domains (e.g. secure.payu.in).  A browser
// form POST from the payment gateway carries Origin: https://secure.payu.in, which
// the allowlist would reject → next(err) → INTERNAL_ERROR JSON shown to the customer
// BEFORE the route handler ever runs.  These endpoints secure themselves via
// SHA-512 hash/signature verification — CORS origin restriction must not block them.
//
// Strategy: mount a path-specific bypass middleware BEFORE the global CORS handler.
// It sets permissive CORS headers and calls next() directly, skipping the allowlist
// check for the payment callback paths.  All other paths still go through full CORS.

const PAYMENT_CALLBACK_PATHS = new Set([
  "/api/payment/payu-return",
  "/api/payment/payu-s2s",
]);

const apiCors = cors({
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
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (PAYMENT_CALLBACK_PATHS.has(req.path)) {
    // Payment gateway callback — allow any origin; security is hash-based in the route handler
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    return next();
  }
  apiCors(req, res, next);
});

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


// Global error handler — maps DB/unknown errors to safe structured JSON;
// never forwards raw SQL, column names, stack traces, or secrets to clients.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled route error");
  const { status, body } = mapDbError(err);
  const requestId = (req as any).id as string | undefined;
  res.status(status).json({ ...body, ...(requestId ? { requestId } : {}) });
});

export default app;
