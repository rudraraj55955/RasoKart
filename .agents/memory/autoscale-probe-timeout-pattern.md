---
name: autoscale-probe-timeout-pattern
description: Autoscale startup probe times out when server binds late — production DB cold-start can take 60-120s
---

# Autoscale startup probe timeout on cold-start DB

## The rule

Never call `app.listen()` after long async init work (schemaGuard, seed, migrations) in an autoscale deployment. Bind to the port **first**, then run init, then mark the server ready. The health endpoint must return 503 "starting" until init completes.

**Why:** The production Replit PostgreSQL database may start with very few tables (e.g. only `users`). On a cold deploy, schemaGuard must CREATE every table from scratch against a remote DB — 70+ tables at ~50-100 ms per statement = 60-120 seconds. If `app.listen()` is called only after this sequence, the autoscale startup probe never gets a TCP connection within its window and the promote step fails. The error is invisible: the build logs end at "Pushed image manifest" with no further output, and `fetchDeploymentLogs()` returns nothing (it queries the live instance, not the failed promote container).

**How to apply:** Use a `startupState.ts` module with `isServerInitialized() / markServerInitialized()`. Bind port immediately after DB connection check, run init, call `markServerInitialized()` at the end. The `/healthz/deep` probe returns `503 { status: "starting" }` while `!isServerInitialized()`, letting the probe retry until the server is genuinely ready.

## Symptom fingerprint

- Build phase succeeds (image pushed)
- Promote fails fast (within seconds of image push)
- `fetchDeploymentLogs()` returns zero lines for the failure window (expected — logs only come from the live instance)
- Binary runs fine locally (dev DB has all tables, init takes < 5 seconds)
- Production DB `information_schema.tables` shows very few tables

## Verified fix location

- `artifacts/api-server/src/lib/startupState.ts` — shared readiness flag
- `artifacts/api-server/src/index.ts` — `app.listen()` moved to step 2 (after DB check, before schemaGuard)
- `artifacts/api-server/src/routes/health.ts` — early 503 return while `!isServerInitialized()`
