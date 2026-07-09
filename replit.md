# RasoKart — Payment Gateway SaaS

RasoKart is a premium dark-themed payment gateway SaaS platform — admins onboard merchants, assign plans, and oversee all financial operations; merchants collect payments via QR codes, virtual accounts, and payment links.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — JWT signing key
- Optional env: `SEED_EXCLUDE_DEMO_EMAILS` — comma-separated demo merchant emails to permanently exclude from seeding in a given environment (see Gotchas)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + pino logging
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React 19 + Vite + shadcn/ui + Tailwind CSS

## Where things live

- `artifacts/api-server/src/routes/` — all Express route handlers
- `artifacts/api-server/src/seed.ts` — idempotent DB seed (runs on every server start)
- `artifacts/rpay/src/pages/` — React pages (admin/ and merchant/)
- `lib/db/src/schema/` — Drizzle schema definitions
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/api-client-react/src/generated/` — Orval-generated React Query hooks
- `lib/api-zod/src/generated/` — Orval-generated Zod validators
- `lib/api-spec/patch-zod-barrel.mjs` — post-codegen patch (removes TS2308 barrel collision)
- `lib/demo-credentials/src/index.ts` — **single source of truth** for all documented demo/test accounts; seed.ts, routes/health.ts, and scripts/verify-demo-credentials.ts all import from here
- `PRODUCTION_READINESS.md` — full production audit report
- `DEPLOY_HETZNER.md` — Hetzner VPS deployment guide

## Architecture decisions

- **Contract-first API**: OpenAPI spec drives codegen; server uses Zod schemas for validation, clients use React Query hooks
- **Seed is idempotent**: Uses merchant-scoped guards (not global count) so re-seeding on existing DB doesn't corrupt demo data
- **No console.log on server**: All logging via `req.log` (request context) or singleton `logger` (pino)
- **Plan gating via planLimits.ts**: `getMerchantPlanUsage()` is the single source of truth for feature access; Starter has no API/webhook/provider access
- **Reconciliation matching**: Greedy 1:1, sorted oldest-first, with per-pair period-window validation when settlement has `periodFrom/periodTo`

## Product

- **Admin portal** (`/admin/login`): Full operations dashboard — merchant lifecycle, settlements, QR/VA management, plan assignment, reconciliation engine, audit logs, provider management, feature flags
- **Merchant portal** (`/merchant/login`): Self-serve dashboard — deposit tracking, settlement requests, QR code management, virtual accounts, API key management, webhook config, balance ledger, notifications
- **Plans**: Starter (free), Silver (₹999/mo), Gold (₹2,499/mo), Platinum (₹4,999/mo), Enterprise (₹9,999/mo), Custom
- **Reconciliation**: Automated matching of deposits ↔ settlements with period-overlap logic and two-column matched/unmatched UI

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@rasokart.com` | `Admin@123456` |
| Merchant (Starter) | `merchant@demo.com` | `Merchant@123456` |
| Merchant (Gold) | `merchant2@demo.com` | `Merchant@123456` |
| Merchant (Starter) | `merchant3@demo.com` | `Merchant@123456` |

## User preferences

- Never use `console.log` in server code — use `req.log` or `logger`
- Use `parseInt(req.params['id'] as string)` for route param casting (not `req.params.id`)
- Codegen must be run after any OpenAPI spec change: `pnpm --filter @workspace/api-spec run codegen`
- Post-codegen: patch script runs automatically to fix TS2308 barrel collision
- Seed uses merchant-scoped guards: check `WHERE merchantId = m1.id` not global table count
- Documented demo/test logins are guarded by an automated check, not just a log line: `pnpm --filter @workspace/scripts run verify-demo-credentials` runs after migrations/seed in `scripts/post-merge.sh` (post-merge setup) and is documented as a required post-deploy step in `DEPLOY_HETZNER.md`. It exits non-zero if any account in the "Demo Credentials" table can't authenticate, blocking the merge/deploy. Keep it in sync with this table and with `seed.ts`
- **Replit deploy gate**: `/api/healthz/deep` is configured as the autoscale startup health path (`artifact.toml` `services.production.health.startup`). It includes a `demo_credentials` check that bcrypt-compares every non-excluded documented demo account against the live DB. If any credential is broken, the endpoint returns HTTP 503 and Replit does not route traffic to the new instance. This catches seed regressions automatically without any manual post-deploy step. The shallow `/api/healthz` remains available for frequent uptime pings. When adding/removing a demo account, update `DEMO_CREDENTIALS` in both `seed.ts` and `routes/health.ts`.

## Gotchas

- **Removing a demo account from production**: seed.ts always upserts `merchant@demo.com` / `merchant2@demo.com` / `merchant3@demo.com` on every start (so documented demo logins never silently 401). To actually and permanently remove one from a specific environment: (1) set `SEED_EXCLUDE_DEMO_EMAILS=<email1>,<email2>` as a secret in that environment, (2) manually delete that account's rows from the DB, (3) restart — the seed will skip recreating excluded emails going forward. `admin@rasokart.com` cannot be excluded this way (it's the only admin-portal login). Do not go back to a global SELECT-only seed — that previously caused demo logins to silently break on any fresh/cleaned DB.
- **Rate limiter**: Login is rate-limited via a DB-backed store (`rate_limit_hits` table via `DbRateLimitStore`), not in-memory — restarting the API server does NOT clear it. During development, run `DELETE FROM rate_limit_hits;` against the dev DB to clear it.
- **Seed guards**: QR/VA/API key seed uses merchant-scoped count, not global. Re-seeding is safe
- **`/api/plans/me`** (not `/merchant/current`) is the merchant plan endpoint
- **Reconciliation routes** require both `requireAuth` AND `requireAdmin` — admin-only
- **`pnpm dev` at root** is blocked; use workflows or `pnpm --filter @workspace/<pkg> run dev`
- **localStorage key**: `rasokart_token`
- **Admin email**: `admin@rasokart.com`
- **API key prefix**: `rasokart_live_` / `rasokart_secret_` for newly generated keys
- **Package name**: internal workspace name remains `@workspace/rpay` (do not rename — breaks pnpm)
- **Directory**: `artifacts/rpay/` directory name unchanged (internal tooling dependency)

## Pointers

- See `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `PRODUCTION_READINESS.md` for full audit results and seed data summary
- See `DEPLOY_HETZNER.md` for production deployment on Hetzner VPS (domain: rasokart.com)
