---
name: Main branch production protection
description: Live GitHub branch-protection policy for production-bound changes and its emergency override.
---

The `main` branch must require pull requests and the production release validation status check with strict/up-to-date checking. Force pushes and branch deletion stay disabled.

Repository administrators are deliberately exempt from enforcement as the emergency override. Use that bypass only intentionally; GitHub's actor and commit history provide audit visibility.

**Why:** Post-push deployment guards cannot prevent an unvalidated change from reaching the production branch. The required check must run on pull requests, or branch protection creates a merge deadlock.

**How to apply:** When changing the production workflow or GitHub branch rules, preserve the pull-request trigger, the required validation context, strict status checks, PR requirement, and admin-only emergency path together.