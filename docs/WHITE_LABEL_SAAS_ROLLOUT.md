# RasoKart white-label SaaS rollout

Status: **foundation draft, NOT production-ready**.

## Verified existing components
- Five host-based portals in `artifacts/rpay/src/lib/subdomain.ts`; arbitrary custom domains are not yet resolved.
- Merchant-specific branding in `merchants`.
- Merchant provider credentials / capability flags in `merchant_connections`.
- Admin IAM, transaction, wallet and payout code already exists.

## Release gates (all required)
1. Inventory every API route and all DB paths touching merchants, users, wallets, payout, callbacks, statements and exports.
2. Add tenant resolver on backend using an **exact, verified hostname**; refuse unknown hosts. Treat Host / forwarded headers as untrusted unless proxy is configured.
3. Authenticate user and prove tenant membership on every request; reject cross-tenant IDs for all reads/writes/exports/webhooks/jobs.
4. Backfill each existing merchant to an explicit default tenant after dry-run mapping; preserve provider credentials and ledger balances; validate counts and reconciliation.
5. Add tenant-scoped RBAC, tenant audit events and billing before enabling any self-service white-label company.
6. Implement separate custom-domain DNS/TLS verification and safe redirect/cookie/CORS behavior.
7. Automated tests: IDOR isolation, duplicate webhook, wallet ledger precision, payout idempotency, tenant suspension, domain takeover protection and regression.
8. Verify staging, backups, rollback and CI checks. Production rollout guarded and reversible. Never run drizzle-kit push against production automatically.

## Security invariant
A public tenant domain may select a *candidate* tenant, but user authentication, resource ownership and provider connection ownership must all be verified server-side before any data is returned or funds move. Platform Super Admin role is never inherited by tenant admins.

## Scope of this first commit
Only additive schema definitions and rollout controls. No live endpoints, production database migrations, or tenant UI are enabled by this commit.

## Idempotent money-moving command release gate
- Proposed tables: white_label_finance_commands (unique tenant/merchant/operation/key) and white_label_finance_audit.
- **These tables are definitions only**, and no payment write handler uses them yet.
- Reserve inside a single DB transaction; enforce payload-hash mismatch as conflict.
- Handle concurrent duplicate requests by replaying only a completed matching result; in-progress requests return retryable conflict.
- Commit ledger, provider request outbox and command result atomically where possible; use provider idempotency keys and reconcile ambiguous provider outcomes before retrying.
- Audit both denied and accepted actions with sanitized metadata, no bank numbers or secrets.
- Add real PostgreSQL concurrency, crash recovery, rollback and negative tenant tests before any financial writes are enabled.
