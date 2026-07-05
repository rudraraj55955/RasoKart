---
name: React Query v5 useQuery onSuccess is a silent no-op
description: In this codebase's @tanstack/react-query v5 setup, passing onSuccess inside a generated hook's `query` options never fires for useQuery; must hydrate local state via useEffect instead.
---

Several orval-generated hooks in `lib/api-client-react/src/generated/api.ts` accept `options.query` and spread it directly into `useQuery(queryOptions)`. On `@tanstack/react-query` v5.x, `onSuccess` was removed from `useQuery`'s options — passing it (often via an `as any` cast to silence TypeScript) compiles fine but the callback **never runs**.

**Why:** This was discovered debugging a real bug: an admin settings page used `useGetXConfig({ query: { onSuccess: (d) => setState(d...) } } as any)` to hydrate local input state from a GET on mount. Saving via the paired `useMutation` worked (mutation `onSuccess` IS still supported in v5), so the UI looked correct immediately after save — but a full page reload silently reverted every input to its hardcoded `useState` default, because the hydration callback that was supposed to run on the GET request never fired. This is invisible to typecheck and to a naive e2e test that doesn't specifically test reload-persistence.

**How to apply:** Never rely on `query: { onSuccess }` (or `mutation` object nested under `query`) for `useQuery`-based generated hooks in this repo. Instead: `const { data } = useGetXConfig(); useEffect(() => { if (!initialized && data) { hydrate state; setInitialized(true); } }, [initialized, data]);`. If you see `as any` cast next to a `query: { onSuccess }` block on an existing `useGet*` hook elsewhere in this codebase, treat it as a likely pre-existing instance of this same bug, not a working pattern to copy. Any settings-hydration-from-GET feature should be verified with an e2e test that includes a full page reload step, not just save+toast.
