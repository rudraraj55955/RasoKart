---
name: RasoKart inbound mail routing
description: Durable DNS and delivery constraints for rasokart.com admin mailboxes and MSG91 OTP email.
---

# RasoKart inbound mail routing

The root `rasokart.com` MX records must target Namecheap Private Email (`mx1.privateemail.com` and `mx2.privateemail.com`). Never point root MX back to the web VPS unless a functioning, monitored mail server and mailbox service are intentionally installed there.

**Why:** MSG91 can accept an OTP email with HTTP 200 while downstream delivery fails. The web VPS had no SMTP listener or active MTA/mailbox service, so an MX record pointing to the VPS made `admin@rasokart.com` unreachable despite provider acceptance.

**How to apply:** When diagnosing missing Admin OTP or reset email, verify all four layers separately: application dispatch result, provider acceptance, public MX propagation, and actual mailbox arrival. Do not treat provider HTTP 200 as proof of inbox delivery.