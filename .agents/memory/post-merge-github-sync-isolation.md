---
name: Post-merge GitHub sync isolation
description: Why GitHub mirroring is non-blocking in the post-merge setup script.
---

The application post-merge script must treat GitHub mirroring as best-effort: a failed sync may be recorded and alert administrators, but must not make the package install, migrations, seed verification, or workflow reconciliation fail.

**Why:** the GitHub credential helper may be unavailable in the non-interactive post-merge process even while the project itself is healthy. Failing the whole setup hides the actual merge status and leaves the environment unnecessarily unreconciled.

**How to apply:** keep essential setup commands fail-fast. Wrap only the final GitHub sync invocation in an explicit failure handler that emits a visible warning and returns success; do not suppress errors inside the sync job itself, because it owns failure history and alerting.