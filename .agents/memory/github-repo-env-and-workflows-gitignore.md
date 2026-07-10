---
name: RasoKart GitHub sync repo target and workflow-file gitignore
description: Custom github-sync script defaults to the old RPAY repo name unless GITHUB_REPO is set; .github/workflows/ was wrongly gitignored for a scope reason that no longer applies to this repo's PAT.
---

- The in-repo custom sync (`scripts/src/github-sync.ts`, `routes/githubSync.ts`, triggered via `POST /api/github-sync/run`) defaults `GITHUB_REPO` to `rudraraj55955/RPAY` (the project's old name) when the `GITHUB_REPO` env var is unset. For RasoKart, `GITHUB_REPO` must be explicitly set to `rudraraj55955/RasoKart` (shared env) or every sync silently pushes to the wrong repo.
  **Why:** the fallback is a leftover from before the project was renamed; nothing else in the code warns about the mismatch — `GET /api/github-sync/status` just reports whatever `GITHUB_REPO` resolved to.
  **How to apply:** before relying on github-sync for a push, check `viewEnvVars` for `GITHUB_REPO` under `shared`; set it if missing/stale.
- `.gitignore` previously excluded `.github/workflows/` with the comment "Replit OAuth lacks workflow scope" — that referred to the separate OAuth-based GitHub integration, NOT the `GITHUB_TOKEN` PAT secret this repo's custom sync script uses. Checked via `GET https://api.github.com/user` with the PAT (`x-oauth-scopes` response header) and confirmed it already has `repo, workflow` scope, so the exclusion was blocking workflow files from ever being committed for no real reason. Removed the exclusion once scope was confirmed.
  **Why:** don't assume a scope limitation still applies — verify the actual token's scopes via the GitHub API before deciding a workflow file can't be pushed.
  **How to apply:** if `.github/workflows/*` changes seem to vanish from every commit, check `.gitignore` first, then verify token scope before concluding it's unfixable.
- The custom github-sync script only does `git push <remote> HEAD:main --force`; it never stages or commits uncommitted changes. New/edited files must already be committed (via the platform's own checkpoint mechanism, not manual `git commit` from the main-agent sandbox) before triggering a sync, or they silently won't be pushed.
