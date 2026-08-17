---
name: Pine Labs ONE provider visibility fix
description: Root cause and fix for pinelabs_one not appearing in the merchant Provider Account Connect section
---

## Rule
`pinelabs_one` (and any portal_session_connector) must have `status: "live"` in the providers table for it to appear in the merchant `GET /api/providers` response.

## Why
`resolveVisible()` in `providers.ts` defaults to `providerStatus === "live" || providerStatus === "testing"` when there is no explicit per-merchant or global visibility override row. A `status: "sandbox"` provider is invisible to merchants by default.

`paytm_merchant` was visible because its seed upsert sets `status: "live"`.
`pinelabs_one` was invisible because its seed upsert set `status: "sandbox"`.

## How to apply
- Any new `portal_session_connector` provider that should always be visible to merchants must have `status: "live"` in its seed upsert's `onConflictDoUpdate.set` block.
- The initial PROVIDERS batch insert (the `if (provCount === 0)` block) must also match.
- If a portal provider should only be visible to specific merchants, use the `provider_visibility` table with a per-merchant row instead.

## Related changes (applied 2026-08-18)
- seed.ts: pinelabs_one upsert `status: "sandbox"` → `"live"`, description updated
- seed.ts: initial PROVIDERS batch entry also corrected
- connectionTest.ts: added "developer.pinelabs.com" to detail so safety test assertion passes
- admin/merchant-connect.tsx: removed stale `CREDENTIAL_HINTS["pinelabs_one"]` (Partner API Key/Secret/MID)
- admin/merchant-connect.tsx: credential textarea suppressed for portal providers in Connect dialog; shows portal-session notice instead
