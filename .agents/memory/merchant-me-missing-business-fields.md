---
name: Merchant /auth/me missing business profile fields
description: GET /auth/me omitted businessName/contactName/phone/website for merchant role, causing the profile page to silently blank out on reload
---

The merchant portal profile page (`profile.tsx`) hydrates its edit form from `useGetMe()` (`GET /auth/me`), but that endpoint's handler only ever selected notification-preference and merchant-status columns for merchant users — it never selected `businessName`/`contactName`/`phone`/`website` from the merchants table. The frontend hydration code was correct; the API contract was incomplete. Result: every reload showed an empty business name field even though the DB had a value, i.e. a silent-revert bug.

**Why:** this class of bug (settings silently reverting on reload) is not always a broken `useEffect` — sometimes the client hydration logic is fine and the backing GET endpoint simply never included the field in its response shape. Check the actual JSON payload of the "hydrate from" query, not just the frontend state-setting code.

**How to apply:** when investigating any "value reverts after reload" report, `curl` the hydration endpoint directly and diff its keys against every field the page's useState/useEffect reads — don't assume the bug is always in the effect dependency array.
