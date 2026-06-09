# RasoKart — Production Readiness Report
**Date:** 2026-06-08  
**Auditor:** Automated production audit (pre-GitHub push)

---

## Executive Summary

RasoKart is a full-stack Payment Gateway SaaS platform built with a dark fintech UI. All 20 audited areas pass. The system is ready for production deployment on a Hetzner VPS or any Node.js-compatible host.

---

## ✅ 20-Area Audit Results

| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | Admin Login | ✅ PASS | JWT auth, bcrypt, rate limiting |
| 2 | Merchant Login | ✅ PASS | Role-scoped JWT, merchant context |
| 3 | Merchant Registration / Approval | ✅ PASS | Pending → Admin review → Approved/Rejected |
| 4 | Dashboard Statistics | ✅ PASS | Admin + merchant scoped stats |
| 5 | Dynamic QR | ✅ PASS | Create, list, update, delete; 5 seeded for demo |
| 6 | Static QR | ✅ PASS | UPI payload, static type |
| 7 | Virtual Accounts | ✅ PASS | IFSC, account number, balance tracking |
| 8 | Payment Links / Products | ✅ PASS | Feature flags per merchant |
| 9 | Transactions | ✅ PASS | Paginated, filterable, CSV export |
| 10 | Settlements | ✅ PASS | Full lifecycle (pending→processing→approved→paid→rejected) |
| 11 | Balance Ledger | ✅ PASS | Immutable audit trail, opening/closing balance |
| 12 | Plans & Billing | ✅ PASS | 6 tiers (Starter→Silver→Gold→Platinum→Custom→Enterprise) |
| 13 | Feature Permissions | ✅ PASS | Plan-gated API/Webhook/Provider access |
| 14 | Visibility Rules | ✅ PASS | Admin-controlled provider visibility per merchant |
| 15 | Provider Management | ✅ PASS | 16 UPI/Bank/Gateway providers, admin CRUD |
| 16 | Notifications | ✅ PASS | User-scoped, read/unread, real-time badge |
| 17 | Reconciliation Engine | ✅ PASS | Greedy 1:1 matching, period overlap, two-column UI |
| 18 | CSV Export | ✅ PASS | Transactions, settlements, virtual accounts |
| 19 | API Keys & Webhooks | ✅ PASS | Key pair seeded, webhook config with events |
| 20 | Audit Logs | ✅ PASS | Admin action log, paginated |

---

## Demo Accounts

### Admin Account
| Field | Value |
|-------|-------|
| URL | `/admin/login` |
| Email | `admin@rasokart.com` |
| Password | `Admin@123456` |
| Role | Super Admin (full access) |

### Merchant Account — Demo Business Pvt Ltd (Starter Plan)
| Field | Value |
|-------|-------|
| URL | `/merchant/login` |
| Email | `merchant@demo.com` |
| Password | `Merchant@123456` |
| Plan | Starter (30 days remaining) |
| Balance | ₹14,900 |
| QR Codes | 5 (4 active, 1 inactive) |
| Virtual Accounts | 2 |
| API Keys | 2 (live + test) |
| Webhook | Configured (4 events) |

### Merchant Account — TechPay Solutions (Gold Plan)
| Field | Value |
|-------|-------|
| Email | `merchant2@demo.com` |
| Password | `Merchant@123456` |
| Plan | Gold |
| QR Codes | 3 |
| Virtual Accounts | 2 |

### Pending Merchant Applications (for approval flow demo)
- `priya@globalpay.io` — GlobalPay Inc
- `rudraraj4496@gmail.com` — Test  
- `audit@test.com` — Audit Test Co

---

## Technical Verification

### TypeScript
- ✅ Zero errors across all packages (`pnpm run typecheck`)
- ✅ Strict mode enabled

### Build
- ✅ API server builds with esbuild (2.7 MB bundle)
- ✅ React frontend builds with Vite

### Database
- ✅ PostgreSQL with Drizzle ORM
- ✅ All migrations applied
- ✅ Seed runs idempotently on server start

### Security
- ✅ JWT authentication with 7-day expiry
- ✅ bcrypt password hashing (10 rounds)
- ✅ Rate limiting on auth endpoints
- ✅ Admin role guards on all sensitive routes
- ✅ Merchant scope isolation (can only see own data)
- ✅ No console.log in server code (uses pino structured logging)

### API Endpoints
All endpoints return proper HTTP status codes:
- `401` Unauthorized (missing/invalid JWT)
- `403` Forbidden (insufficient role)  
- `404` Not found
- `400` Bad request (validation errors)
- `500` with structured error body (never exposes stack traces)

---

## Seed Data Summary

| Table | Row Count |
|-------|-----------|
| Plans | 6 tiers |
| Merchants | 7 total (4 approved, 3 pending) |
| Transactions | 28+ (including 6 today) |
| Settlements | 12 (all lifecycle states) |
| QR Codes | 9 (8 active, 1 inactive) |
| Virtual Accounts | 6 |
| Ledger Entries | 10 |
| API Keys | 3 |
| Audit Logs | 9+ |
| Reconciliation Runs | 4 |
| Reconciliation Items | 9 |
| Notifications | 6 |
| Providers | 16 |

---

## Known Limitations (Post-Launch Roadmap)

| Issue | Task |
|-------|------|
| Reconciliation schedule not automated | Task #53 (pending) |
| No reconciliation CSV export | Task #54 (pending) |
| Manual resolve for unmatched items | Task #55 (pending) |
| Per-provider monthly usage tracking | Task #56 (proposed) |
| Merchant enable/disable provider toggle | Task #57 (proposed) |
| Date range filter on export | Task #58 (pending) |
| Search by UTR in export | Task #59 (pending) |

---

## Environment Requirements (Production)

```
DATABASE_URL=postgres://user:pass@host:5432/rpay
SESSION_SECRET=<64-char random string>
JWT_SECRET=<64-char random string>   # set in auth middleware
NODE_ENV=production
PORT=8080
```

See `DEPLOY_HETZNER.md` for full setup guide.
