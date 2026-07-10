# RasoKart — Approval-Gated Production CI/CD

This document describes the automated GitHub Actions -> manual approval -> VPS
deployment pipeline for RasoKart.

Repository: `rudraraj55955/RasoKart` (production branch: `main`)
Production VPS: `167.233.77.68` (`/var/www/rasokart`, PM2 process `rasokart-api`)
Production URL: `https://rasokart.com`

---

## 1. How the pipeline works

```
push to main ──▶ validate job (GitHub-hosted runner)
                   - pnpm install --frozen-lockfile
                   - pnpm run typecheck
                   - pnpm run build
                   - db-migrate against a throwaway CI Postgres
                   - boots API + web behind an nginx proxy, runs the
                     settings-persistence e2e suites
                   │
                   ▼ (only if ALL of the above pass)
                 deploy job — WAITS for manual approval
                   - Gated by GitHub Environment "production"
                   - You see "Approve and deploy" / "Reject" in the Actions UI
                   - On approval: SSHes into the VPS and runs
                     scripts/deploy-production.sh
                   - Health-checks https://rasokart.com/api/healthz/deep
                   - Rolls back automatically if anything fails
```

If validation fails, the deploy job never runs and the VPS is never touched.
If you click **Reject**, the deploy job is skipped and the VPS is never touched.

Files:
- `.github/workflows/production-deploy.yml` — the pipeline definition.
- `scripts/deploy-production.sh` — runs ON the VPS, does the actual deploy.
- `scripts/bootstrap-vps-deploy-user.sh` — one-time VPS setup (see §5).

---

## 2. One-time GitHub setup

### 2.1 Create the `production` Environment

1. Go to your repo on GitHub: **Settings -> Environments -> New environment**.
2. Name it exactly: `production`
3. Under **Deployment protection rules**:
   - Check **Required reviewers**, add `rudraraj55955`.
   - Leave **"Prevent self-review"** **unchecked/disabled** — this lets
     `rudraraj55955` (the repo owner) approve their own deployment, as
     requested.
4. Under **Deployment branches and tags**, choose **Selected branches and
   tags** and add rule `main`. This makes it impossible for any other branch
   to ever trigger the `production` environment's approval gate or secrets.
5. Save.

### 2.2 Add environment secrets

Still inside the `production` environment page, under **Environment secrets**,
add:

| Secret | Value |
|---|---|
| `VPS_HOST` | `167.233.77.68` |
| `VPS_PORT` | `22` (or your custom SSH port) |
| `VPS_USER` | `rasokart_deploy` (the limited user created in §5 — **not** `root`) |
| `VPS_SSH_PRIVATE_KEY` | The **private** half of a dedicated deploy keypair (see §3) |
| `VPS_KNOWN_HOSTS` | Output of `ssh-keyscan -p <port> 167.233.77.68` (see §3) |

Never commit any of these values to the repo. Nothing in this pipeline ever
writes secrets to logs — `deploy-production.sh` sources `.env` with `set -a`
and never echoes it.

---

## 3. Generate the SSH deploy key (do this locally, not on the VPS)

```bash
ssh-keygen -t ed25519 -C "deploy@github-actions" -f ./rasokart_deploy_key -N ""
```

This produces:
- `rasokart_deploy_key` (private key) -> paste the **full contents** into the
  GitHub secret `VPS_SSH_PRIVATE_KEY`.
- `rasokart_deploy_key.pub` (public key) -> you'll pass this to the bootstrap
  script in §5.

Get the known-hosts entry (needed so SSH doesn't prompt on first connect):

```bash
ssh-keyscan -p 22 167.233.77.68 > rasokart_known_hosts
cat rasokart_known_hosts   # paste this into the GitHub secret VPS_KNOWN_HOSTS
```

Delete the local private key file once it's saved in GitHub Secrets — it
should not remain on your laptop or be committed anywhere.

---

## 4. What you'll see when a deploy is waiting for approval

After `validate` passes, the GitHub Actions run page for that workflow shows:

```
production-deploy #42
  ✓ Validate (install, typecheck, build, test)     2m 14s
  ⏳ Deploy to production VPS                        Waiting for review
```

Clicking into the **Deploy to production VPS** job shows a banner:

```
┌───────────────────────────────────────────────────────────┐
│  Review pending deployments                                │
│                                                             │
│  production   1 environment must be reviewed before        │
│               deploying to this job.                       │
│                                                             │
│  ☐ production                                              │
│                                                             │
│           [ Approve and deploy ]     [ Reject ]            │
└───────────────────────────────────────────────────────────┘
```

- **Approve and deploy** — starts the `deploy` job, which SSHes into the VPS
  and runs `deploy-production.sh`.
- **Reject** — marks the job as failed/skipped; the VPS is never contacted.

Only reviewers listed under the `production` environment's **Required
reviewers** (i.e. `rudraraj55955`) can see and click these buttons.

---

## 5. One-time VPS bootstrap

Run this **once**, as root, on the VPS, before the first automated deploy:

```bash
# On the VPS, as root:
curl -fsS https://raw.githubusercontent.com/rudraraj55955/RasoKart/main/scripts/bootstrap-vps-deploy-user.sh -o bootstrap-vps-deploy-user.sh
bash bootstrap-vps-deploy-user.sh "$(cat rasokart_deploy_key.pub)"
```

(Or copy `scripts/bootstrap-vps-deploy-user.sh` and the `.pub` key contents
over manually if you'd rather not curl-pipe a script from the internet —
either way, review the script contents first.)

This creates a dedicated `rasokart_deploy` system user (not root) that:
- owns `/var/www/rasokart` only,
- authenticates via SSH key only (the public key you pass in),
- has passwordless sudo for **exactly** `pm2 restart rasokart-api --update-env`
  and `pm2 save` — nothing else,
- has `git safe.directory` configured for the app directory.

After bootstrapping, verify `/var/www/rasokart` is a working clone of
`rudraraj55955/RasoKart` on `main`, with `.env` populated (per
`DEPLOY_HETZNER.md` §5) and PM2 already managing `rasokart-api` — the deploy
script assumes the app is already running once, it's an "update" script, not
an "initial install" script (use `DEPLOY_HETZNER.md` for first-ever setup).

---

## 6. What `deploy-production.sh` protects against

Run only after manual approval, on the VPS:

- **Deployment lock** (`flock` on `.deploy.lock`) — a second concurrent
  deploy attempt fails immediately instead of racing.
- **Timestamped logs** — every run writes to `deploy-logs/deploy-<ts>.log`.
- **Repo/branch verification** — refuses to run against the wrong remote or
  any branch other than `main`.
- **Dirty tree / divergence / untracked-collision checks** — refuses to pull
  if the VPS has uncommitted tracked changes, if local HEAD isn't an ancestor
  of `origin/main` (true divergence), or if untracked files would be
  overwritten. **Never runs `git clean -fd`.**
- **Protected paths** — refuses to deploy if the incoming diff touches
  `server/`, `data/`, `uploads/`, `.env`, or `backups/`.
- **Database backup before migration** — `pg_dump` to `backups/` (gzip),
  every single run, before `db-migrate` executes.
- **Secrets never printed** — `.env` is sourced, never echoed or logged.
- **Rollback on any failure** — if install, migration, build, restart, or the
  post-deploy deep health check fails, it resets to the pre-deploy commit,
  rebuilds, and restarts the previous working version automatically.
- **Success requires a passing deep health check** — `deployment successful`
  is only logged after `https://rasokart.com/api/healthz/deep` returns
  healthy AND `verify-demo-credentials` passes.

## 7. Live-data guarantees (never automated)

This pipeline **never**:
- deletes/overwrites live merchants, wallets, ledgers, payouts, beneficiaries,
  UTRs, or webhook logs (protected-path + diff checks above enforce this at
  the code level; there is also no code path here that touches those tables),
- replaces the production database with the Replit/dev database,
- syncs database dumps or uploaded KYC documents automatically,
- restores a DB backup automatically — restoring `backups/*.sql.gz` is a
  deliberate, manual `psql` operation you run yourself if ever needed,
- touches Cashfree production settings or any other VPS `.env` secret.

Merging data from the Replit development database into production remains a
manual, deliberate process outside of this pipeline, by design.

## 8. Manual retry

If a deploy needs to be re-run (e.g. after fixing a transient VPS issue), use
**Actions -> Production Deploy -> Run workflow** (this is the
`workflow_dispatch` trigger) — it re-runs `validate` and, on success, again
waits for your approval before touching the VPS.
