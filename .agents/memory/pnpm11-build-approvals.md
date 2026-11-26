---
name: pnpm 11 dependency build approvals
description: Cross-version dependency build policy required for production installs.
---

Keep explicit `allowBuilds` decisions alongside the existing dependency build allowlist when production uses pnpm 11.

**Why:** A lockfile and install that passed under pnpm 10 failed under pnpm 11 with `ERR_PNPM_IGNORED_BUILDS`. pnpm 11 required explicit allow/deny decisions even though the required native builder was already named in the older allowlist.

**How to apply:** When dependency upgrades introduce or change packages with install scripts, validate a fresh frozen install using the production pnpm major version. Explicitly allow required builders and explicitly deny unnecessary scripts; do not run interactive approval during deployment.