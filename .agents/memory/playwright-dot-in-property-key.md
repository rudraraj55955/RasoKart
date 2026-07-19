---
name: Playwright toHaveProperty dot-in-key
description: toHaveProperty("a.b") traverses nested objects; flat keys containing dots need bracket access.
---

## The Rule
`expect(obj).toHaveProperty("iam_tables.permissions_schema")` looks for `obj.iam_tables.permissions_schema` (nested). If the key is actually flat (`obj["iam_tables.permissions_schema"]`), the assertion always fails silently.

**Why:** Playwright/Jest treat dots in `toHaveProperty` paths as property-path separators, matching lodash `_.get` semantics.

**How to apply:**
For properties with dots in their names (e.g., healthz check keys like `"iam_tables.permissions_schema"`), use direct bracket access:
```js
// WRONG:
expect(body.checks).toHaveProperty("iam_tables.permissions_schema");
// CORRECT:
expect(body.checks["iam_tables.permissions_schema"]).toBe(true);
```
