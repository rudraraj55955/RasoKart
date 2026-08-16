---
name: Connector Engine Phase Status
description: Current build status and decisions for the 7-phase Connector Engine project
---

## Phase 1 — OTP E2E CI Fix
**Status: COMPLETE** (commit 11e13520)

Root causes fixed:
1. `OtpCodeInput` had 6 separate `<input autocomplete="one-time-code">` elements → Playwright strict-mode violations.
   Fix: single transparent `<input>` overlay + 6 aria-hidden `<div>` boxes. `color:transparent ≠ opacity:0` — visibility passes.
2. Global `MutationCache.onError` in App.tsx fired for ALL mutations, even those with per-call `onError` in `mutate()`.
   Root cause: RQ v5 stores per-call callbacks on private `#observers` (not in `mutation.options`), so the guard
   `if (mutation.options.onError) return` did NOT fire when `onError` was passed to `mutate(vars, {onError})`.
   Fix: use `mutation.meta.suppressGlobalError = true` pattern. Login mutations carry this meta; guard checks it.

Tests: otp-auth.spec.ts 8/8 passing (was 0/8).

**CI observation:** plan-feature-gates (step 24) was pre-existing failing at commit 10439903 too.
All three suites pass in local sequence. Likely caused by OTP failure leaving bad state in prior runs.
Phase 2 CI run in progress to confirm fix.

## Phase 2 — Tenant Merchant Self-Service Portal Sessions
**Status: COMPLETE** (commit e93ef4b3, CI in progress)

New artifacts:
- `lib/db/src/schema/merchantPortalSessions.ts` — isolated per-merchant session table
- `artifacts/api-server/src/routes/merchantPortalSessions.ts` — 5 endpoints at /api/merchant/portal-sessions
- Merchant connect UI: `PORTAL_PROVIDER_SLUGS`, `PortalProviderCard`, `usePortalSessions`, "Portal Automation" section
- Schema guard: 122 Drizzle tables, 0 gaps

Isolation guarantee: every SQL query uses `WHERE merchant_id = req.user.merchantId`.

## Phase 3 — Provider Audit
**Status: COMPLETE** (documented, no code required)

ALL providers BLOCKED:
- PhonePe, Paytm, BharatPe, MobiKwik, Google Pay, Amazon Pay: no public partner portal API
- Bank UPI (SBI YONO, HDFC SmartHub, ICICI Eazypay, Axis Pay, Kotak Smart): regulated
- Pine Labs ONE: formal partner API agreement required (already fail-closed)

## Phase 4 — First Real Provider Adapter
**Status: BLOCKED** — no listed provider permits authorized portal automation
**Unblock condition:** provider issues formal partner API agreement

## Phase 5 — First Real Merchant Connection
**Status: BLOCKED** — depends on Phase 4

## Phase 6 — Transaction Fetch and Auto-Credit
**Status: BLOCKED** — depends on Phase 5

## Phase 7 — Full Production Completion
**Status: BLOCKED** — depends on Phase 6

## Architecture Decisions
- `portal_sessions` (admin-only) and `merchant_portal_sessions` (tenant-only) are separate tables
- All adapters must pass `adapter.supportedLoginMethods.length === 0` → PARTNER_API_REQUIRED without calling the provider
- `encryptedSession` column is always stripped from API responses (both admin and merchant routes)
- `meta: { suppressGlobalError: true }` on `useMutation()` is the RQ v5 pattern for suppressing global toast
