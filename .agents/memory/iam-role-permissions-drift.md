---
name: IAM role_permissions drift after migration locked
description: When new permission keys are added to ALL_PERMISSION_KEYS after the IAM migration has run, those keys are absent from role_permissions — requirePermission then silently denies legitimate users.
---

## The Rule
seed.ts must upsert ALL current ALL_PERMISSION_KEYS into role_permissions on every server start (idempotent), not just during the one-time migration run.

**Why:** The IAM migration (`POST /iam/migration/run`) marks itself complete in iam_migration_log and refuses to re-run (returns 409). Any permission key added to permissions.ts after migration ran will be missing from role_permissions. requirePermission looks up role_permissions; a missing row evaluates as false and blocks the user.

**How to apply:**
In seed.ts, after checking `iamMigRow` exists:
```js
for (const role of KNOWN_ROLES) {
  for (const key of ALL_PERMISSION_KEYS) {
    const isEnabled = (ROLE_DEFAULT_PERMISSIONS[role]?.[key] ?? false) === true;
    await db.insert(rolePermissionsTable).values({ role, permissionKey: key, isEnabled, ... })
      .onConflictDoUpdate({ target: [...], set: { isEnabled, updatedAt: new Date() } });
  }
}
```
This also prunes stale ALLOW overrides in user_permissions where the role now grants the key by default (avoiding false-positive "cross-role escalation" reports in validation scripts).
