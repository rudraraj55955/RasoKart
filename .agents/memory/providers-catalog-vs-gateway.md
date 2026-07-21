---
name: Providers catalog vs gateway config
description: Distinction between the providers catalog table (UI display) and provider_integrations (actual credentials/config).
---

## The rule
Two separate tables serve different purposes:

1. **`providers` table** — public catalog for display; `status` controls the badge shown in admin UPI Gateways page.
   - `live` = actually configured payment gateway (razorpay, cashfree, payu, ekqr only)
   - `sandbox` = UPI collection method available in test mode (upi_id, google_pay, phonepe, paytm, bharatpe, freecharge, amazon_pay, mobikwik, sbi_yono, hdfc_smarthub, icici_eazypay, axis_pay, kotak_smart)
   - `coming_soon` / `testing` = not yet available

2. **`provider_integrations` table** — actual integration config: encrypted API keys, environment (test/live/uat), is_enabled.

**Why this matters:** Seeding UPI collection methods as `status='live'` in the catalog made them appear equivalent to real payment gateways in the dashboard Volume by Provider chart (which maps transaction.provider slugs to providers.name). Changed to `sandbox` to reflect actual test-only status.

## How to apply
When adding a new payment method to seed.ts: use `status='sandbox'` unless it has real live credentials in both `provider_integrations` AND `system_config`. The `onConflictDoUpdate` in seed.ts will reset DB values on every restart — keep seed in sync with what's in the DB.
