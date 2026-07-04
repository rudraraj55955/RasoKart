---
name: System config "last changed by" attribution
description: How admin-facing "last changed by X on <date>" labels are sourced for gateway credential config panels, and a null-email edge case to expect.
---

Gateway credential config panels (Cashfree Payin, Cashfree Payout, EKQR) show a "Last changed by {email} on {date}" line sourced from `systemConfigTable.updatedByEmail`/`updatedAt`, computed server-side via a shared `getLastUpdatedInfo(keys)` helper in `systemConfig.ts` that picks the most-recently-updated row among a config's underlying keys.

**Why:** these panels persist to multiple `systemConfigTable` keys per gateway (not a single row), so "last changed" must be derived by taking the max `updatedAt` across that gateway's key set, not read off one arbitrary key.

**How to apply:** when adding a similar "last changed by" attribution to any other multi-key config panel, reuse `getLastUpdatedInfo`, spread its result into the config response type in the OpenAPI schema (nullable fields, not required), and guard the UI render on both `lastUpdatedByEmail && lastUpdatedAt` being non-null — older/seeded config rows may have `updatedByEmail = null` even though `updatedAt` is set, since attribution tracking was added after some rows already existed. The UI should simply omit the line in that case, not show "Last changed by null".
