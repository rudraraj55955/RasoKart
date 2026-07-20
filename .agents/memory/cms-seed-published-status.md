---
name: CMS seed campaign status
description: CMS seed.ts must seed campaigns as 'published' not 'draft'; production DB campaigns are seeded on first deploy and need to be published immediately.
---

## Rule
Always seed promotional campaigns with `status: "published"` in seed.ts. The seed guard (`if cmsCampaignCount === 0`) runs once on a fresh DB — if status is "draft", campaigns are invisible on production until an admin manually publishes them.

**Why:** The Replit dev DB campaigns were published via the admin API (not seed). The production VPS DB is fresh and gets campaigns only from seed.ts. Campaigns seeded as `draft` return 0 results from `/api/cms/public/banners` even though the CMS code is deployed correctly.

**How to apply:** When adding new seeded campaigns, always set `status: "published"`. If you discover draft campaigns on production, log in with admin credentials and POST `/api/cms/campaigns/:id/status` with `{"status":"published"}` for each.
