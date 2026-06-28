---
name: Seed demo merchant guard
description: How to prevent seed.ts from re-creating deleted demo merchants; and how to run schema migrations without a TTY
---

**The rule:** Demo merchants (merchant@demo.com, merchant2@demo.com) must be SELECT-only in seed.ts — never upserted. All seed blocks that access `m1.id` or `m2.id` must be wrapped in `if (m1 && m2)`.

**Why:** The seed runs on every server start. If demo merchants are deleted for a clean production environment, an `onConflictDoUpdate` INSERT re-creates them on the next restart, defeating the cleanup. SELECT-only means "link if present, skip if absent."

**How to apply:**
- Replace INSERT+onConflictDoUpdate for m1/m2 users and merchants with `db.select().from(...).where(eq(..., "demo@email")).limit(1)`
- After resolving m1/m2, wrap ALL demo-data blocks (transactions, QR codes, VAs, settlements, webhooks, ledger, credential events, report schedules, etc.) in `if (m1 && m2) { ... }`
- For credential events: the guard SELECT itself uses `m1.id` — make it null-safe: `const rows = m1 ? await db.select({ c: count() })...where(eq(..., m1.id)) : [{ c: 1 }]`

**Non-interactive schema migrations:** `drizzle-kit push` requires a TTY (interactive prompt) — it will throw in CI or bash tool. Use direct SQL instead:
```sql
ALTER TABLE report_delivery_logs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS triggered_by text,
  ...;
```
