# Threat Model — RasoKart Payment Gateway SaaS

## Project Overview

RasoKart is a multi-tenant payment gateway SaaS. Admins onboard merchants, assign plans, and oversee financial operations; merchants collect payments via QR codes, virtual accounts, and payment links. Deployed publicly on Replit autoscale.

**Stack:** Node.js 24 / Express 5 / TypeScript, PostgreSQL + Drizzle ORM, React 19 + Vite. JWT auth stored in localStorage.

**Roles:** `admin`, `merchant`, `payout_merchant`, `payout_admin`, `payout_super_admin`, `agent`, `customer`. Super-admin flag (`isSuperAdmin`) is separate from role.

## Assets

- **User credentials & sessions** — bcrypt-hashed passwords, JWTs signed with SESSION_SECRET. Compromise allows impersonation across any portal.
- **Merchant financial data** — deposits, settlements, QR codes, virtual accounts, payout slips, bank account details, UPI IDs, UTRs. Core platform value; cross-tenant exposure is the primary risk.
- **API keys & webhook secrets** — live API keys (`rasokart_live_` prefix) and callback signing secrets. Compromise allows unauthorized callbacks and QR code manipulation.
- **Compliance/audit records** — policy acceptances, KYC records, audit logs. Integrity matters for regulatory compliance in a payment gateway context.
- **Application secrets** — `SESSION_SECRET` (JWT signing), database connection string. Exposure enables token forgery across all users.
- **Deployment artifacts** — compiled JS bundles in `/tmp` during deploys. May expose internal route structure and logic.

## Trust Boundaries

- **Browser → API** — all client requests are untrusted. JWT must be verified and user must be authorized on every request.
- **Admin → Merchant tenant** — admin actions cross merchant boundaries intentionally; unauthorized cross-tenant access by merchants is a critical breach.
- **Merchant → Merchant tenant** — every merchant endpoint must scope DB queries to the caller's `merchantId`. Absence of this filter is IDOR.
- **Public → Authenticated** — public endpoints (payment links, payout slip verification, contact form, policy acceptance) must never expose or mutate authenticated-user-owned data.
- **Admin role hierarchy** — `isSuperAdmin` > `admin` > restricted admin. Role assignment must enforce the hierarchy.
- **Webhook/API key boundary** — payment provider webhooks use API key auth, not JWTs. The `requireApiKey` middleware enforces this boundary.

## Scan Anchors

**Production entry points:**
- `artifacts/api-server/src/routes/index.ts` — all Express route mounts (260 lines, 50+ sub-routers)
- `artifacts/api-server/src/app.ts` — Express app, CORS, global middleware, deploy-patch endpoints (lines 98–119)
- `artifacts/api-server/src/middlewares/auth.ts` — requireAuth, requireAdmin, requirePermission middleware

**Highest-risk areas:**
- `routes/withdrawals.ts` — payout slip ownership guard (null-merchantId bypass, lines 2035–2037)
- `routes/users.ts` — role assignment without whitelist (lines 49–82)
- `routes/policyAcceptance.ts` — unauthenticated write with body-supplied userId/merchantId (line 26)
- `routes/auth.ts` — trust-IP and unsubscribe token signing (local JWT_SECRET without production guard, line 34)
- `app.ts` lines 97–119 — temporary unauthenticated deploy archive download endpoints

**Public surfaces (no auth required):**
- `POST /policy-acceptance` — no auth, accepts arbitrary userId/merchantId
- `GET /api/_deploy/rasokart-dist-only.tgz` — no auth, serves deployment archive from /tmp
- `GET /api/_deploy/rasokart-api-dist-only.tgz` — no auth
- `POST /public/contact` — no auth, no rate limit
- Payment provider webhooks (`/payment/webhook`, `/webhooks/payin`, etc.)
- `GET /api/public/payout-slip/verify/:token` — rate-limited, intentionally public

**Dev-only / safe-to-skip:**
- `artifacts/mockup-sandbox/` — design mockups, not production-reachable
- `scripts/` — CLI scripts, not mounted in the API server
- Test files (`*.test.ts`, `*.realdb.test.ts`) — never loaded in production

## Threat Categories

### Spoofing

Sessions use JWT signed with `SESSION_SECRET`. The middleware validates token on every request and checks `isActive` and `passwordUpdatedAt` to invalidate stale tokens. 

**Gap:** `routes/auth.ts` defines its own `JWT_SECRET` constant without a production crash-guard (unlike `middlewares/auth.ts`). This is a defense-in-depth gap for trust-IP and unsubscribe tokens. See `jwt-secret-missing-production-guard-auth-routes`.

**Guarantee:** `SESSION_SECRET` MUST be a random secret of ≥32 bytes in all environments. The startup crash guard in `middlewares/auth.ts` enforces this in production but not in dev/staging. The inconsistency in `auth.ts` must be resolved.

### Tampering

Prices, balances, and settlement amounts are computed server-side. Drizzle ORM parameterized queries prevent SQL injection throughout.

**Gap:** `POST /policy-acceptance` accepts body-supplied `userId` and `merchantId` without authentication, allowing forgery of compliance records. See `policy-acceptance-unauthenticated-userid-forgery`.

**Guarantee:** Every write endpoint that associates data with a user or merchant identity MUST verify the caller owns those IDs server-side.

### Information Disclosure

API responses are scoped to authenticated users. The main withdrawal list, settlement list, QR codes, and virtual accounts correctly filter by `merchantId`.

**Gap:** Three payout-slip endpoints use a flawed conditional: `if (!isAdmin && user.merchantId)`. Authenticated users with null `merchantId` (roles: payout_admin, payout_merchant, agent) can access any withdrawal's slip by raw ID. See `withdrawal-slip-ownership-bypass`.

**Gap:** Deployment archive endpoints in `app.ts` serve compiled bundles from `/tmp` with no authentication. See `unauthenticated-deploy-archive-download`.

**Guarantee:** Every non-admin data access MUST unconditionally apply `WHERE merchantId = currentUser.merchantId`. The merchantId guard must not be gated on the value being truthy.

### Elevation of Privilege

`requireAdmin`, `requirePermission`, and `requireSuperAdmin` middleware enforce role boundaries on admin operations.

**Gap:** `POST /api/users` and `PUT /api/users/:id` accept an arbitrary `role` string with no whitelist. An admin with `ADMIN_USERS` permission can create or promote accounts to `role: "admin"` or `role: "payout_super_admin"`. See `users-unrestricted-role-assignment`.

**Guarantee:** User creation and role-update endpoints MUST validate the `role` field against an explicit allowlist and MUST enforce that the acting admin cannot assign a role equal to or higher than their own.

### Denial of Service

Login is rate-limited via DB-backed `rate_limit_hits` table. Payout merchant signup is rate-limited (10/15 min). Payout slip verification is rate-limited (20/5 min).

**Gap:** `POST /public/contact` has no rate limiter, allowing database exhaustion. See `public-contact-no-rate-limit`.

**Guarantee:** All public-facing write endpoints MUST apply a rate limiter with a DB-backed store consistent with other public endpoints.
