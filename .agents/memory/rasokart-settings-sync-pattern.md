---
name: RasoKart settings save/sync pattern
description: The standard for merchant/admin settings forms to avoid stale-data reverts after save.
---

Merchant/admin settings forms must follow this pattern to avoid silently showing stale data:
1. Load initial form state from a react-query GET hook (never a raw `fetch()` outside the query cache) — otherwise `invalidateQueries` on save is a no-op since no query is registered under that key.
2. Sync local form state from query data only once (`initialized` flag) or while not actively editing/dirty — an unguarded `useEffect(() => sync(), [data])` will silently overwrite unsaved edits whenever a background refetch completes (window refocus, staleTime expiry).
3. On mutation `onSuccess`, either (a) trust the mutation's response body as the new source of truth (PATCH typically returns the just-written row) and set local state from it, or (b) explicitly `invalidateQueries` + `refetch()` and set local state from the refetched result — don't just assume local optimistic state is correct.
4. Every mutation must have an `onError` that shows `toast.error(getApiErrorMessage(err, ...))` — never swallow errors silently, and never auto-revert local state on error (let the user retry with their typed input intact).

**Why:** found during Task #2086 that `merchant/branding.tsx` loaded via raw `fetch()` (dead `invalidateQueries` call) and `merchant/webhook.tsx` re-synced from server data on every `config` change with no dirty/initialized guard, which could silently clobber in-progress edits.

**How to apply:** when auditing or adding any settings/profile save form in RasoKart, check for (1) raw fetch instead of a generated hook, (2) missing initialized/dirty guard on the sync `useEffect`, (3) no re-fetch or response-echo after save, (4) any mutation without `onError`.
