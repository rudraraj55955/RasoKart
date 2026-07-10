# RasoKart — Hybrid Approval-Gated Production CI/CD

Repository: `rudraraj55955/RasoKart` (public, production branch: `main`)
Production VPS: `167.233.77.68` (`/var/www/rasokart`, PM2 process `rasokart-api`)
Production URL: `https://rasokart.com`

This pipeline auto-deploys **provably safe frontend-only** changes and
requires **manual approval** for everything else.

---

## 1. How it works

```
push to main
     │
     ▼
 classify  ──▶ diffs the push against its previous commit, runs
               scripts/classify-deployment.sh, decides:
                 frontend_auto        - every changed file is on the
                                         presentation-only allowlist
                 sensitive_approval   - anything else (default when unsure)
     │
     ▼
 validate  ──▶ pnpm install --frozen-lockfile, typecheck, API + frontend
               build, settings-persistence e2e tests, against a throwaway
               CI Postgres. Runs for EVERY push regardless of classification.
               If this fails, nothing deploys and the VPS is never touched.
     │
     ├── deployment_type == frontend_auto ──▶ auto_frontend_deploy
     │     - GitHub Environment: production-auto (no required reviewer)
     │     - Runs scripts/deploy-frontend-production.sh on the VPS
     │     - Rebuilds ONLY the static frontend. Never runs db-migrate.
     │       Never restarts pm2 / the API process.
     │     - Runs a frontend health check (curl https://rasokart.com/)
     │
     └── deployment_type == sensitive_approval ──▶ sensitive_production_deploy
           - GitHub Environment: production-sensitive (required reviewer:
             rudraraj55955)
           - WAITS for a human to click "Approve and deploy"
           - Only after approval: SSHes in and runs
             scripts/deploy-sensitive-production.sh (backup, migrate, build,
             restart, deep health check, auto-rollback on failure)
```

---

## 2. The classification allowlist (conservative, not a denylist)

`scripts/classify-deployment.sh` only marks a push `frontend_auto` if **every
single changed file** matches one of these real, existing directories:

| Pattern | What it is |
|---|---|
| `artifacts/rpay/src/styles/*.css` | Standalone stylesheet files |
| `artifacts/rpay/src/index.css` | Global stylesheet |
| `artifacts/rpay/src/components/ui/*.{ts,tsx}` | shadcn/ui primitives (buttons, cards, dialogs) — visual only, no data fetching or business logic |
| `artifacts/rpay/public/**` | Static assets: images, icons, favicon, manifest, robots.txt |

Everything else — including `src/pages/**`, `src/components/admin/**`,
`src/components/merchant/**`, `src/hooks/**`, `src/lib/**` — is **excluded**
from the allowlist on purpose, even though it's "frontend" code, because those
are exactly the places business logic, data fetching, and auth/permission
checks live.

On top of the allowlist, a **hard-block list** force-classifies as sensitive
even if a path superficially looks safe: `.github/workflows/`, `.env*`,
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the deploy/classify/
bootstrap scripts themselves, `lib/db/`, `lib/api-spec/`, generated API
clients, all of `artifacts/api-server/`, `.replit-artifact/` configs, and any
`.sql`/`.dump`/`.dump.enc` file.

**Always sensitive, by construction of the allowlist above** (never need
separate special-casing because none of these paths are on the allowlist):
backend/API routes & services, DB schema/migrations, auth/sessions/cookies,
OTP/password reset, RBAC, payouts/wallets/ledgers/settlements, pay-ins/
deposits/withdrawals/refunds/disputes, webhooks/provider integrations/
Cashfree logic, merchant KYC/PAN/Aadhaar/DigiLocker, transaction/
reconciliation status, security/encryption/secrets, OpenAPI specs/generated
clients, GitHub workflows/deploy scripts, PM2/nginx/VPS/infra config,
dependency files, env/config files.

**If classification can't be determined** (e.g. `git diff` fails, the base
commit is unreachable after a force-push, or the diff is empty/ambiguous) —
the classifier explicitly defaults to `sensitive_approval` rather than
guessing. See `scripts/classify-deployment.sh` for the exact logic; it's a
plain bash script you can read top to bottom.

### Tested examples

Run manually to sanity-check the classifier on this repo (see §7 for the full
verification transcript run before this pipeline was finalized):

```bash
# Safe: only a CSS file changed
git diff --name-only A B   # -> artifacts/rpay/src/styles/mobile-professional.css
scripts/classify-deployment.sh A B   # -> DEPLOYMENT_TYPE=frontend_auto

# Sensitive: a route handler changed
git diff --name-only A B   # -> artifacts/api-server/src/routes/payouts.ts
scripts/classify-deployment.sh A B   # -> DEPLOYMENT_TYPE=sensitive_approval

# Sensitive: mixed push (one safe file + one route file)
git diff --name-only A B   # -> artifacts/rpay/public/favicon.svg, artifacts/api-server/src/routes/auth.ts
scripts/classify-deployment.sh A B   # -> DEPLOYMENT_TYPE=sensitive_approval (one non-allowlisted file is enough)
```

A single non-frontend file anywhere in the push forces the entire push to
`sensitive_approval` — there is no partial/split deploy.

---

## 3. One-time GitHub setup — two environments

### 3.1 `production-auto` (no approval, frontend-only)

1. **Settings -> Environments -> New environment**, name exactly:
   `production-auto`
2. **Deployment protection rules**: leave **Required reviewers** unchecked —
   this environment auto-deploys.
3. **Deployment branches and tags**: **Selected branches and tags** -> add
   rule `main`. This is the only branch restriction needed since there's no
   reviewer gate.
4. **Environment secrets**: add the same five secrets as below (§3.3).

### 3.2 `production-sensitive` (approval required)

1. **Settings -> Environments -> New environment**, name exactly:
   `production-sensitive`
2. **Deployment protection rules**:
   - Check **Required reviewers**, add `rudraraj55955`.
   - Leave **"Prevent self-review"** **unchecked/disabled** so the repository
     owner can approve their own deployment, as requested.
3. **Deployment branches and tags**: **Selected branches and tags** -> add
   rule `main`.
4. **Environment secrets**: add the same five secrets as below.

### 3.3 Environment secrets (add to BOTH environments)

| Secret | Value |
|---|---|
| `VPS_HOST` | `167.233.77.68` |
| `VPS_PORT` | `22` (or your custom SSH port) |
| `VPS_USER` | `rasokart_deploy` (limited user from the bootstrap script — never `root`) |
| `VPS_SSH_PRIVATE_KEY` | Private half of a dedicated deploy keypair (see §4) |
| `VPS_KNOWN_HOSTS` | Output of `ssh-keyscan -p <port> 167.233.77.68` |

Both environments can share the same VPS credentials — the isolation between
"auto" and "sensitive" comes from which workflow job runs (and which
deploy-*.sh script it invokes), not from separate VPS accounts. Secrets are
never printed in logs; `deploy-*.sh` sources `.env` with `set -a` and never
echoes it.

---

## 4. Generate the SSH deploy key (locally, once)

```bash
ssh-keygen -t ed25519 -C "deploy@github-actions" -f ./rasokart_deploy_key -N ""
```

- `rasokart_deploy_key` (private) -> paste full contents into
  `VPS_SSH_PRIVATE_KEY` in **both** environments.
- `rasokart_deploy_key.pub` (public) -> pass to the bootstrap script (§6).

```bash
ssh-keyscan -p 22 167.233.77.68 > rasokart_known_hosts
cat rasokart_known_hosts   # -> VPS_KNOWN_HOSTS in both environments
```

Delete the local private key file once saved in GitHub Secrets.

---

## 5. What you'll see at each stage

**Every push to `main`** produces a run with a `classify` job whose **summary
tab** shows the changed file list and the exact reasoning:

```
## Deployment classification: frontend_auto
Reason: All 2 changed file(s) matched the presentation-only allowlist
(styles, public assets, ui primitives).
```

or

```
## Deployment classification: sensitive_approval
Reason: Blocked by: artifacts/api-server/src/routes/payouts.ts
```

### Case A — frontend-only push
```
production-deploy #58
  ✓ Classify changes                                 8s
  ✓ Validate (install, typecheck, build, test)       2m 30s
  ✓ Auto-deploy frontend (no approval)                45s
```
No approval step appears at all — it deploys automatically, then reports the
frontend health-check result in the job log.

### Case B — sensitive push
```
production-deploy #59
  ✓ Classify changes                                  8s
  ✓ Validate (install, typecheck, build, test)       2m 30s
  ⏳ Deploy to production VPS (sensitive)              Waiting for review
```

Opening the **"Deploy to production VPS (sensitive)"** job shows:

```
┌───────────────────────────────────────────────────────────┐
│  Review pending deployments                                │
│                                                             │
│  production-sensitive   1 environment must be reviewed     │
│                          before deploying to this job.      │
│                                                             │
│  ☐ production-sensitive                                    │
│                                                             │
│           [ Approve and deploy ]     [ Reject ]            │
└───────────────────────────────────────────────────────────┘
```

This banner (and the **Approve and deploy** / **Reject** buttons) is on the
**Actions -> [this workflow run] -> "Review deployments"** button at the top
of the run page — click it to open the panel above. Only `rudraraj55955`
(the required reviewer on `production-sensitive`) can see and use it.

- **Approve and deploy** -> starts the job, SSHes in, runs
  `deploy-sensitive-production.sh` (backup -> migrate -> build -> restart ->
  deep health check, with automatic rollback on any failure).
- **Reject** -> job is marked failed/skipped; the VPS is never contacted.

---

## 6. One-time VPS bootstrap

Run once, as root, on the VPS:

```bash
# On the VPS, as root:
bash scripts/bootstrap-vps-deploy-user.sh "$(cat rasokart_deploy_key.pub)"
```

This creates a dedicated `rasokart_deploy` user (not root) that:
- owns `/var/www/rasokart` only (existing files are preserved, nothing is deleted),
- authenticates via SSH key only,
- has passwordless sudo for **exactly** `pm2 restart rasokart-api --update-env`
  and `pm2 save` (used only by the sensitive path — the frontend-only path
  never needs sudo since it never restarts pm2),
- has `git safe.directory` configured for the app directory.

Verify `/var/www/rasokart` is already a working clone of
`rudraraj55955/RasoKart` on `main` with `.env` populated and PM2 already
running `rasokart-api` before the first automated deploy — this is an
"update" pipeline, not an initial installer.

---

## 7. Safety guarantees, verified before this pipeline was finalized

- ✅ YAML validated (`.github/workflows/production-deploy.yml` parses cleanly).
- ✅ All shell scripts pass `bash -n` (syntax check); `shellcheck` run where
  available in this environment.
- ✅ Classifier tested against representative safe changes (CSS-only,
  public/-only) and sensitive changes (routes, migrations, `.env`,
  `package.json`, mixed pushes) — see §2 examples.
- ✅ Uncertain/unparseable diffs default to `sensitive_approval` — confirmed
  in `classify-deployment.sh`'s empty-diff and unreachable-base-commit paths.
- ✅ `deploy-frontend-production.sh` re-verifies the file list itself (not
  just trusting the classifier output) and refuses to run if any
  non-allowlisted file is present in the diff it's about to deploy. It never
  calls `db-migrate` or `pm2 restart` anywhere in the script.
- ✅ `sensitive_production_deploy`'s job only runs after the
  `production-sensitive` environment gate is satisfied — GitHub enforces this
  natively; no VPS connection code executes before that.
- ✅ No secret, `.env`, or database dump is tracked in git (`.gitignore`
  already excludes `backups/`, `*.dump`, `*.dump.enc`, `.env*`; verified with
  `git status`/`git ls-files` before committing this pipeline).

---

## 8. Live-data protections (never automated, by design)

Neither deploy script ever deletes, replaces, or overwrites: live merchants,
admin/super-admin accounts, wallet balances, ledgers, payouts, beneficiaries,
UTRs, webhook logs, provider credentials, Cashfree production configuration,
merchant KYC documents, production uploads, the production database, or VPS
`.env` secrets. Both scripts refuse to proceed if the incoming diff touches
`server/`, `data/`, `uploads/`, `.env`, or `backups/`.

The encrypted Replit database transfer file and any existing production DB
backups already present on the VPS are **not referenced anywhere** in this
CI/CD pipeline and are never restored automatically. Merging data from the
Replit development database into production remains a separate, deliberate,
manual process outside of this pipeline.

`deploy-sensitive-production.sh` takes a **fresh** `pg_dump` backup before
every migration (kept in `backups/`, gitignored) but never restores one
automatically — restoring a backup is always a manual, deliberate `psql`
operation you run yourself if ever needed.

---

## 9. Manual retry

**Actions -> Production Deploy -> Run workflow** (`workflow_dispatch`)
re-runs `classify` and `validate` against the current `main` HEAD, then
follows the same auto/approval path as a normal push.
