---
name: Per-admin notification dedup for event feeds
description: How to build an admin-facing event history/list from notifications that were fanned out to multiple admin users
---

Some system alerts (e.g. gateway_failover_exhausted) insert one `notifications` row per active admin recipient at fire time, not one row per event. If you build an admin UI that lists "recent events" straight from that table, you'll show N duplicate entries per real event (N = admin count).

**Why:** notification fan-out and event history are different concerns — fan-out needs per-user rows (read/unread state per admin), but a history view needs per-event rows.

**How to apply:** when building an events/history endpoint from a fan-out notification type, group/dedupe by a key derived from `createdAt` + relevant `metadata` fields (e.g. failureCount, triggerMerchantId) rather than returning raw rows. Don't add a new table just for this — dedup at query time is sufficient unless the events need independent lifecycle state.
