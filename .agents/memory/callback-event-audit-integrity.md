---
name: Callback event audit integrity
description: Safety rules for provider callback history, replay detection, and legacy backfills.
---

Provider callback event IDs are opaque identifiers: preserve them exactly rather than trimming or truncating them. Record the unique event claim and apply its status change in one database transaction, so a failed update cannot leave a committed claim that suppresses every retry.

**Why:** A committed event row followed by a failed status update makes later retries look like harmless duplicates, permanently losing the intended status transition. Trimming or truncating opaque IDs can also collapse distinct provider events.

**How to apply:** Use a dedicated unique event-history row as the replay claim, wrap that insert and the parent-record update in one transaction, and commit valid stale events for audit purposes. Store only allowlisted fields and fixed sanitized summaries. Backfills must sanitize legacy values again rather than trusting old rows.