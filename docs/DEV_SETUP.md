# Developer Setup

This document covers one-time setup steps for contributors to the RasoKart monorepo.

## Prerequisites

- **Node.js 24+** — matches the CI environment  
- **pnpm 10+** — the workspace package manager (`npm i -g pnpm`)  
- **PostgreSQL** — a local or remote database for development  

## Getting started

```sh
# 1. Clone the repository
git clone https://github.com/rudraraj55955/RasoKart.git
cd RasoKart

# 2. Install dependencies
#    This also installs the git pre-commit hook automatically (see below).
pnpm install

# 3. Copy and fill in the environment file
cp .env.example .env   # edit DATABASE_URL and any other required vars

# 4. Run database migrations
pnpm --filter @workspace/scripts run db-migrate

# 5. Seed demo data
pnpm --filter @workspace/db run seed
```

## Git pre-commit hook

`pnpm install` automatically installs a pre-commit hook via the root `prepare`
script.  The hook runs:

```sh
pnpm --filter @workspace/scripts run schema-guard-coverage
```

### What it checks

Every table defined with `pgTable()` in `lib/db/src/schema/` must have a
matching `CREATE TABLE IF NOT EXISTS` block in either:

- `artifacts/api-server/src/lib/schemaGuard.ts` *(preferred)*
- `scripts/src/db-migrate.ts`

Without a guard, a fresh or drifted database will throw
`"relation does not exist"` and return an opaque HTTP 500 on the first request
to any route that queries the table.

### When the hook fires

The hook runs **before every commit** and takes under 2 seconds — it reads
source files only, no database connection required.  If it fails, fix the
issue and try the commit again:

```
✗  NEW UNGUARDED TABLES DETECTED (1):
   • my_new_table

Add a CREATE TABLE IF NOT EXISTS block to schemaGuard.ts, then commit.
```

### Manual install (if needed)

If you cloned before the hook was added, or if the hook is missing for any
reason, run:

```sh
sh scripts/install-hooks.sh
```

### Skipping the hook (not recommended)

If you absolutely must bypass the hook for a work-in-progress commit, use:

```sh
git commit --no-verify -m "wip: ..."
```

This skips the check locally but **CI will still block the pull request**
via the Schema Guard Coverage workflow (`.github/workflows/schema-guard-ci.yml`).

### Running the check manually

```sh
pnpm --filter @workspace/scripts run schema-guard-coverage
```

## CI checks

The same schema-guard-coverage check runs in GitHub Actions on every pull
request and on pushes to `main`.  It must pass before a PR can be merged.
