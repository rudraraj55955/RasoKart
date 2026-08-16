---
name: Drizzle .set typed-spread rule
description: Record<string,unknown> passed to Drizzle .set() silently drops columns; always use typed spread so every field maps correctly.
---

## Rule

Never pass `Record<string, unknown>` (or a plain mutable object typed as such) to Drizzle's `.set()`. Drizzle's runtime SQL builder only emits SET clauses for keys it can resolve against the table's column definitions. When TypeScript accepts a cast (`as Record<string, unknown>`), the column you added (e.g. `update.maskedIdentifier = value`) may silently produce no SQL — the row stays unchanged and no error is thrown.

**Why:** Observed in `merchantEnrollments.ts` PUT `/credentials` — `maskedIdentifier` was set on the Record object but the DB column stayed `null` after the update. `enrollmentStatus` (set in the literal object initializer) DID apply, which is why the bug was not obvious.

**How to apply:**

Use a typed spread instead:

```typescript
// BAD — column may be silently dropped
const update: Record<string, unknown> = { enrollmentStatus: "x", updatedAt: new Date() };
update.maskedIdentifier = value;  // may not apply!

// GOOD — all keys are type-resolved by Drizzle
const update = {
  enrollmentStatus: "x" as const,
  updatedAt: new Date(),
  ...(value ? { maskedIdentifier: value } : {}),
  ...(apiKey ? { encryptedApiKey: encryptSecret(apiKey) } : {}),
};
await db.update(table).set(update)...
```

Applies to any Drizzle `db.update().set()` call where columns are conditionally added to a mutable object.
