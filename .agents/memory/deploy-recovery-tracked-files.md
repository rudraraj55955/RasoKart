---
name: Deploy recovery block must not rm -rf tracked files
description: After git merge --abort, removing tracked directories creates D entries that trip the dirty-tree guard. Only untracked junk should be cleaned in recovery blocks.
---

## The rule
In `scripts/deploy-sensitive-production.sh` section 1b (stale-merge recovery), only `rm -rf` paths that are **untracked** in the VPS HEAD commit. Never remove tracked directories — `git merge --abort` already restores them cleanly, and deleting them creates `D` (deleted) entries in `git status --porcelain --untracked-files=no`, which trips the dirty-tree guard at section 2 and causes the deploy to fail.

**Currently safe to remove (untracked junk from reconciliation tooling):**
- `.github/workflows/sed8S3arA`
- `attached_assets/screenshots`

**Must NOT be removed (tracked at VPS HEAD):**
- `.agents/memory` — tracked at every deployed commit; `git merge --abort` restores it properly; the fast-forward updates it

**Why:**
Run #56 failed with 40+ `D .agents/memory/...` entries after the recovery block ran `rm -rf .agents/memory`. The path was tracked at `40f5d8d6` (VPS HEAD). `git merge --abort` restored it, then `rm -rf` deleted it again, creating dirty-tree entries. Run #57 fixed this by removing `.agents/memory` from the rm loop.

**How to apply:**
Any future stale-merge recovery patch must check `git ls-files <path>` before adding a path to the `rm -rf` loop — if it returns output, the path is tracked and must NOT be deleted before the fast-forward.
