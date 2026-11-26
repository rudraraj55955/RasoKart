---
name: VPS deploy recovery and no-op sync
description: Safe reconciliation cleanup and the guarded-deploy edge case where VPS HEAD advances before the running binary is rebuilt.
---

## Reconciliation cleanup rule
Known reconciliation-only paths may be removed, but the script must immediately restore every tracked deletion from the current HEAD before the dirty-tree guard runs. A raw `rm -rf` without that restoration leaves `D` entries and aborts deployment.

**Why:** stale reconciliation artifacts have previously included both untracked junk and tracked files. Cleanup is useful, but tracked deletions must not reach the strict preflight guard.

**How to apply:** after cleanup, derive deleted tracked paths from `git status --porcelain --untracked-files=no`, restore them from HEAD, then run the dirty-tree check. Never weaken the guard or run broad `git clean`.

## Guarded deploy no-op after external fast-forward
The VPS repository can already equal `origin/main` while PM2 still runs a binary built from an older commit. In that state, the sensitive deploy exits with “Nothing to deploy” before backup, migration, build, restart, or SHA verification.

**Why:** reconciliation/sync can advance the VPS working tree independently of the production build. Repository equality therefore does not prove runtime equality.

**How to apply:** check `/api/healthz/deep` and compare its baked commit with the target. If HEAD already equals the target but the runtime SHA differs, move only the VPS tracked working tree to the target’s first parent and rerun the guarded script. Never touch the database, `.env`, uploads, or runtime data.
