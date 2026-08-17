---
name: Browser-health public endpoint routing
description: Why GET /api/browser-health lives in routes/index.ts not in merchantPortalSessions router
---

The browser runtime health check must be mounted in `routes/index.ts` directly, BEFORE the
`router.use("/merchant", authRouter)` alias (line 121), NOT inside the merchantPortalSessions sub-router.

**Why:**
`router.use("/merchant", authRouter)` in routes/index.ts intercepts every `/merchant/*` request
first. Even though the sub-router (router60) registers the GET handler before `router.use(requireAuth)`,
the outer auth alias processes the request before the sub-router has a chance to respond —
Express processes all `/merchant/*` middleware layers in registration order, and the authRouter
alias is registered first. Result: every unauthenticated request to
`/merchant/portal-sessions/browser-health` returns 401 regardless of handler registration order
inside the sub-router.

**How to apply:**
- Keep `GET /api/browser-health` in `routes/index.ts` (around line 113, after healthRouter)
- Import `browserPoolStatus` and `probeBrowserReady` from `../helpers/connectorEngine/browserPool`
- Never re-add this route inside a sub-router mounted under `/merchant/*`
- The path used in deploy-vps.yml verify step and monitoring is `/api/browser-health`
- Response shape: `{ ready: bool, durationMs: number, version?: string, pool: { browserConnected, concurrent, capacity } }`
