---
name: Express inline middleware TS2345
description: When requireAdmin is passed inline to a route (not via router.use), TypeScript infers req.params values as string | string[] rather than string.
---

## Rule
When passing middleware as an inline argument to `router.put("/:id", requireAdmin, async (req, res) => ...)`, Express TypeScript types infer `req.params[key]` as `string | string[]` instead of `string`. Use `req.params['id'] as string` to avoid TS2345 errors.

**Why:** The Express types for multi-handler overloads don't narrow `ParamsDictionary` as precisely as single-handler routes.

**How to apply:** Any route file that passes middleware inline (not via `router.use(...)` at top) must cast path params: `parseInt(req.params['id'] as string)`. The pattern `router.use(requireAuth, requireAdmin)` at the top of the file avoids this issue entirely.
