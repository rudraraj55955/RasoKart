---
name: Settings initialized-flag reset antipattern
description: Why calling setXxxInitialized(false) in a settings form's onSuccess handler breaks persistence e2e tests.
---

## Rule
Never call `setXxxInitialized(false)` inside a settings form's `onSuccess` (or `mutate` success callback).

## Why
Settings forms use an `initialized` flag to guard a one-time sync effect: "copy server data into local state only on first load". The flow is:

1. `saveSmtp()` PUT succeeds → `onSuccess` fires
2. `invalidateQueries` marks the cache stale and triggers a background refetch
3. If `setXxxInitialized(false)` is called here, the guard effect fires again immediately — but at that moment the cache still holds the **baseline** value (the refetch hasn't landed yet)
4. Local state is overwritten with the old server value, discarding the user-typed canary
5. When the refetch does land, `smtpInitialized` is already `true` again, so the effect never re-runs → canary is lost
6. On page reload the 304 ETag may serve the browser-cached baseline, so the test reads back the wrong value

The working pattern (Finance email, QR/VA cleanup, webhook retries) all **omit** the `setXxxInitialized(false)` call. `invalidateQueries` still updates the cache for future renders; the user-typed value stays live in component state until the next full page load.

## How to apply
When adding a new settings panel that uses an `initialized` flag + `useEffect` hydration:
- Call `invalidateQueries` in `onSuccess` ✓
- Do NOT reset `setXxxInitialized(false)` in `onSuccess` ✗
- Only reset it if the component fully unmounts (e.g. navigation away), not after a successful save
