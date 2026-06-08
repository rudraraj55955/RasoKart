---
name: Seed vs plan history
description: Why seeded merchants have no plan history entries
---

## Rule
The seed script directly inserts into `merchantPlans` table — it does NOT call the
`/api/merchants/:id/assign-plan` route, so no `planHistory` rows are created.

**Why:** Avoiding circular dependency (seed → HTTP → auth → seed).

## How to apply
- Plan history will be empty for seed-created merchant–plan assignments. This is expected.
- Plan history only populates when an admin assigns/changes a plan through the UI/API.
- Do not add planHistory inserts to the seed; the empty state is intentional and correct.
