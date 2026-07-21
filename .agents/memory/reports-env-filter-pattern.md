---
name: Reports admin env filter pattern
description: How env filtering works on /api/reports/* endpoints and the /admin/reports frontend
---

## Rule
All 7 `/api/reports/*` admin endpoints accept `env` query param (enum: production | demo | sandbox | all).
Default when omitted: `"production"` — demo data is never shown by default.

## Backend pattern (for each endpoint)
```typescript
if (user.role === "admin") {
  const envParam = (req.query["env"] as string | undefined) ?? "production";
  if (envParam !== "all") {
    const envSubq = db.select({ id: merchantsTable.id })
      .from(merchantsTable)
      .where(eq(merchantsTable.environment, envParam));
    conditions.push(inArray(someTable.merchantId, envSubq));
  }
}
```
For `buildHealthData(from, to, env?)` — passes env down to a WHERE AND on `merchantsTable.environment`.

## Frontend pattern
- URL param `env` (default: "production") read via `_qp.get("env") ?? "production"`
- `setEnv(v)` = `setFilter({ env: v === "production" ? null : v })` — removes from URL when default
- `EnvBadge` component shows colored badge (emerald=production, amber=demo, blue=sandbox, muted=all)
- Globe icon + Select dropdown in page header for all tabs
- Passed to all hook params: txParams, stlParams, dhParams, delivery-history params, schedules params

## Values
- `production` → real merchants only (default)
- `demo` → demo/test merchants (seeded accounts: merchant@demo.com etc.)
- `sandbox` → future UAT/sandbox merchants (currently returns 0 rows)
- `all` → no env filter applied

**Why:** Admin reports were showing demo merchant data (merchant IDs 1, 2, 3) mixed with real production data. `merchants.environment` column distinguishes them. Default=production ensures clean reporting without explicit selection.
