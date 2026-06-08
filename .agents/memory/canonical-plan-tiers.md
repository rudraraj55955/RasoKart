---
name: Canonical plan tiers
description: The 5 official RPay plan tiers and how old ones were removed
---

## Rule
RPay has exactly 5 plan tiers: Starter, Silver, Gold, Platinum, Custom.
Legacy tiers (Startup, Business, Business Plus, Enterprise) were deleted from the DB manually
because the seed upserts by name but does not delete stale rows.

**Why:** The seed uses onConflictDoUpdate which only updates matching rows; orphan rows linger.

## How to apply
If the seed is re-run after adding new tier names, check for orphan rows with:
```sql
SELECT id, name FROM plans WHERE name NOT IN ('Starter','Silver','Gold','Platinum','Custom');
```
Delete them to keep the plan selector clean in the admin UI.
