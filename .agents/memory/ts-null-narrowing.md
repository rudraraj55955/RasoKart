---
name: TS null vs undefined narrowing
description: Use != null (not !== null) for optional nullable OpenAPI-generated fields
---

## Rule
OpenAPI optional+nullable fields are typed as `T | null | undefined` in generated Orval hooks.
Using `!== null` only narrows away `null`, leaving `undefined` — TS strict mode errors.

**Why:** `!= null` is the double-equals check that narrows both `null` and `undefined` in one shot.

## How to apply
When checking optional plan fields like `daysUntilExpiry`, write:
```ts
// CORRECT
const isExpiringSoon = plan.daysUntilExpiry != null && plan.daysUntilExpiry <= 7;

// WRONG — TS18048 "possibly undefined"
const isExpiringSoon = plan.daysUntilExpiry !== null && plan.daysUntilExpiry <= 7;
```
