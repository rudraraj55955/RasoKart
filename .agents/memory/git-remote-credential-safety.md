---
name: Git remote credential safety
description: Authentication and validation rules that prevent GitHub credentials from being persisted or printed.
---

GitHub automation must authenticate through a process-local askpass helper or the installed integration. Never put tokens in fetch URLs, push URLs, command arguments, or repository-local Git configuration. Checks must report only the remote name and URL kind, never the URL value.

**Why:** Credential-bearing remote URLs accumulated historically and exposed a token even though the intended use was temporary authentication.

**How to apply:** For every repository setup, sync, divergence check, or deployment change, keep configured remotes credential-free and check both fetch and push URL entries. Use redacted errors and remove temporary askpass files in a `finally` path.