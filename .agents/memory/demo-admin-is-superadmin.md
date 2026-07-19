---
name: demo admin@rasokart.com is Super Admin
description: The demo admin account has is_super_admin=true; SA bypasses requirePermission entirely.
---

## The Rule
`admin@rasokart.com` has `is_super_admin = TRUE` in the database. Super Admin bypasses all `requirePermission` checks and the SA guard inside IAM handlers (`if (!user.isSuperAdmin) return 403`).

**Why:** By design, the seed ensures the single admin account is the Super Admin so IAM management works out of the box. There is no separate "regular admin" demo account.

**How to apply:**
- E2E tests that call `PUT /iam/roles/:role/:key` as admin will get **200** (SA succeeds), not 403.
- Tests that want to verify "regular admin blocked by requirePermission" need to create a new non-SA admin user (INSERT users WHERE role='admin' AND is_super_admin=FALSE) as part of test setup.
- The `resolveUserPermissions` function returns `{ __all__: true }` for any SA user, so `requirePermission` always calls `next()` for them.
