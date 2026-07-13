---
name: Login mutation key cross-session cache bleed
description: The generated useLogin hook uses mutationKey ['login'] — shared across all portal instances. Always call queryClient.clear() before saveAuthAndRedirect to evict stale data.
---

## Rule
Always call `queryClient.clear()` immediately before `saveAuthAndRedirect(...)` in every login page success handler.

**Why:** The Orval-generated `useLogin` hook uses `mutationKey: ['login']`. In React Query v5, mutations with a key persist their `data` in the query client's mutation cache. When a user logs into the merchant portal (getting `role: "merchant"`) and then opens the admin portal in the same browser session, `useLogin().data` may already hold the cached merchant response. Calling `queryClient.clear()` before navigating evicts this stale state — and also evicts any stale `/api/auth/me` data from the previous session — ensuring the destination page always loads with a completely clean cache.

**How to apply:** Every login success branch that calls `saveAuthAndRedirect`:
```ts
onSigningIn();           // show spinner immediately
queryClient.clear();     // evict stale /me + mutation data
saveAuthAndRedirect(token, userRecord, targetPath);
```

Additionally, `saveAuthAndRedirect` itself uses `window.location.replace(targetPath)` (hard navigation), which destroys and reinitialises the React tree on the new page — so even without the explicit clear, stale React state cannot survive the navigation. The `queryClient.clear()` call is a belt-and-suspenders guard for any in-flight or pending React state that might execute before navigation completes.
