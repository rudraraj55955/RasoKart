---
name: IAM role_permissions drift after migration locked
description: New permission keys added to ALL_PERMISSION_KEYS after the IAM migration has run are absent from both permissions and role_permissions — two distinct bugs.
---

## The Rules

### Bug 1 — permissions catalog skipped for non-empty table
seed.ts had `const needsCatalogSync = count === 0` before the loop that upserts keys into the `permissions` table. On a live DB with existing permissions, the catalog sync was SKIPPED for any new keys, causing a FK violation when role_permissions tried to reference the missing key.

**Fix:** Remove the count guard. The upsert loop (`onConflictDoUpdate`) is idempotent — always run it on every start.

```ts
// WRONG — skips new keys when permissions table is non-empty:
if (needsCatalogSync) { for (const key of ALL_PERMISSION_KEYS) ... }

// RIGHT — always upsert:
for (const key of ALL_PERMISSION_KEYS) {
  await db.insert(permissionsTable).values({ key, ... })
    .onConflictDoUpdate({ target: permissionsTable.key, set: { ... } });
}
```

### Bug 2 — role_permissions rows never created for new keys
After the catalog is correct, new keys still won't have role_permissions rows unless seed.ts inserts them.

```ts
for (const role of KNOWN_ROLES) {
  for (const key of ALL_PERMISSION_KEYS) {
    await db.insert(rolePermissionsTable).values({ role, permissionKey: key, isEnabled, ... })
      .onConflictDoNothing();  // never overwrite admin-customised templates
  }
}
```

**Why:** The IAM migration marks itself complete and refuses to re-run (409). Any key added to permissions.ts after migration ran is absent from both tables. requirePermission looks up role_permissions; a missing row = denied.

**How to apply:** When adding any new permission key to `PERMISSIONS` / `ALL_PERMISSION_KEYS` in permissions.ts, the next server restart automatically syncs both tables via seed.ts — no manual migration needed. Just verify the key is in `ALL_PERMISSION_KEYS`.
