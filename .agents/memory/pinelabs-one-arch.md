---
name: Pine Labs ONE connector architecture
description: Key decisions and production blockers for the Pine Labs ONE portal_session_connector
---

## Summary

Pine Labs ONE is implemented as a `portal_session_connector` (Playwright browser automation) under the Connector Engine — same pattern as Paytm.

**Why:** The live portal (one.pinelabs.com) is a React SPA with no server-side API; all credentials flow through Chromium, same as Paytm.

## Login flow

- URL: `https://one.pinelabs.com`
- Routes: `/login/user` → `/login/password` → optional `/login/verify-otp`
- Supported login method key: `mobile_password` (10-digit mobile or user ID → password → optional OTP 2FA)
- Password is passed via `encryptedOtp` field in `SubmitStepParams` (same convention as Paytm)
- CONNECTED gate: URL not on login + dashboard landmark visible + login form gone + ≥1 ownership identifier extracted from `/profile`

## Key files

| File | Role |
|---|---|
| `artifacts/api-server/src/helpers/connectorEngine/adapters/pinelabs-one.ts` | Full Playwright adapter (8 interface methods) |
| `adapters/pinelabs-one.mock-server.ts` | HTTP mock server for E2E tests (cookie state machine) |
| `adapters/pinelabs-one.failclosed.test.ts` | 28 structural + fail-closed tests (no real browser needed) |
| `adapters/pinelabs-one.e2e.test.ts` | Full E2E tests against mock server (real Chromium) |
| `artifacts/rpay/src/pages/merchant/connect.tsx` | `PineLabsOnePortalCard` component + dispatch routing |

## Test override

Set `PINELABS_ONE_PORTAL_OVERRIDE=http://...` in env to redirect Chromium to a local mock server.

## Production blockers

- **Not yet deployed to production** — requires a real Pine Labs ONE account holder to complete the live login test through the RasoKart merchant UI.
- VPS SSH key format issues prevent automated deploy; user must deploy manually.
- Until live login test passes, do NOT mark the connector as active in the providers catalog.

## How to apply

- When adding a new portal connector, follow the same pattern: adapter + mock-server + failclosed.test + e2e.test + frontend card in connect.tsx.
- The `PineLabsOneUiStep` type and card component in connect.tsx are the canonical reference for mobile-password portal cards.
