---
name: IAM production state
description: Durable lessons from verifying IAM/RBAC is live on the Hetzner VPS
---

IAM/RBAC is fully deployed and active on production. The migration ran in July 2026 and cannot be re-run without consequences.

**What to know before touching IAM in production:**
- The migration log table has one row; cutoff_at is set. Re-running `POST /iam/migration/run` is a no-op (idempotent) but verify first.
- 71 permissions seeded across 7 categories; 497 role_permission rows for all 7 roles. SA-only keys are correctly FALSE for the non-SA admin role.
- `user_permissions` is empty — no per-user overrides have been set. Any new override will be the first.
- `verify-iam-migration` (16 checks) and `/api/healthz/deep` (all iam_tables.* checks) are the canonical verification commands.

**Super Admin bypass:** The SA account bypasses all `requirePermission` checks — effectivePerm returns `__all__` via the IAM users list endpoint. Tenant isolation confirmed: merchant tokens get 403 on all admin routes.

**Why:** Don't re-run the IAM migration or reset role_permissions without checking production state first — the data is already correct and an accidental re-seed could overwrite admin-customised role templates.
