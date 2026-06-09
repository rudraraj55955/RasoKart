# RasoKart — Payment Gateway SaaS

RasoKart is a premium dark-themed payment gateway SaaS platform — admins onboard merchants, assign plans, and oversee all financial operations; merchants collect payments via QR codes, virtual accounts, and payment links.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — JWT signing key

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

## User preferences

- Never use `console.log` in server code — use `req.log` or `logger`
- Use `parseInt(req.params['id'] as string)` for route param casting (not `req.params.id`)
- Codegen must be run after any OpenAPI spec change: `pnpm --filter @workspace/api-spec run codegen`
- Post-codegen: patch script runs automatically to fix TS2308 barrel collision
- Seed uses merchant-scoped guards: check `WHERE merchantId = m1.id` not global table count

## Gotchas

- **Rate limiter**: Login is rate-limited in-memory; restart API server to clear during development
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
