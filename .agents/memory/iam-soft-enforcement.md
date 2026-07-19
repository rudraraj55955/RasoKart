---
name: IAM soft-enforcement contract
description: How resolveUserPermissions() works and the backward-compat soft-enforcement design
---

# IAM Soft-Enforcement Contract

## The rule
`resolveUserPermissions(user)` returns one of three values:
- `{ __all__: true }` — Super Admin (isSuperAdmin flag), unrestricted access
- `null` — IAM migration not yet run; system in legacy/soft mode
- `Record<string, boolean>` — flat effective permission map (role template + user overrides)

`requirePermission(key)` middleware always calls `next()` for Super Admin or when result is null. Only after migration, it enforces the map.

**Why:** Backward compatibility. Deploying IAM to a live system must not break existing admin access before the migration is explicitly triggered. The Super Admin runs the migration via `/api/iam/migration/run`, which seeds role templates from `ROLE_DEFAULT_PERMISSIONS` in `permissions.ts`. Until then, all authenticated users pass through.

**How to apply:**
- Never call `requirePermission` without also calling `requireAuth` first — it reads `req.user` set by `requireAuth`
- `requirePermission` is additive — stack it after `requireAdmin` or `requireAnyAdmin` for finer-grained gating
- `/auth/me` always returns `effectivePermissions` — null means soft-mode (frontend should treat null as "allow all")
- Super Admin bypasses all IAM checks; never add special-case SA logic inside protected routes — rely on the middleware
