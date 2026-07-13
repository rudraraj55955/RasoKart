---
name: api-server has no direct zod dependency
description: api-server routes must use plain JS validation, not zod imports — importing zod/v4 (or plain zod) in a new route file causes TS2307 build failure.
---

## Rule
Never `import { z } from "zod"` or `import { z } from "zod/v4"` in `artifacts/api-server/src/`.

**Why:** The `@workspace/api-server` package.json does not list `zod` as a dependency. All routes in the package use manual if/typeof validation instead. Adding `zod` as a new import compiles but then fails `tsc --noEmit` with `TS2307: Cannot find module 'zod/v4'`.

**How to apply:** Write validation with plain JS predicates (`typeof x === "string"`, regex tests, etc.) in any new api-server route. For complex schemas, import pre-built Zod schemas from `@workspace/api-zod` (the generated package), but never use `z.object()` etc. directly inside api-server source files.
