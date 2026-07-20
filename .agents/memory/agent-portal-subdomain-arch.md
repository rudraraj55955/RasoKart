---
name: Agent Portal + Subdomain architecture
description: Key decisions for the subdomain portal routing and Agent Portal invite flow
---

## Subdomain routing architecture

**How:** Single SPA (artifacts/rpay dist/) served on all 5 subdomains by Nginx.
Frontend detects hostname at runtime (`lib/subdomain.ts`) and routes to correct portal.
No separate Vite builds. API stays on rasokart.com/api for all subdomains.

**Why:** Avoids multi-artifact complexity; Cloudflare proxies SSL so no extra certs
needed for subdomains (only apex needs certbot cert or use Cloudflare Full-Strict).

**How to apply:** When adding a new portal subdomain — add to SUBDOMAIN_MAP in
`lib/subdomain.ts`, add Nginx server_name entry, add to CORS allowlist in app.ts.

## Agent invite flow

**How:** Admin creates agent → server generates invite_token (crypto.randomBytes) + 72h
expiry → invite link points to `/agent/activate?token=...` → public endpoints verify
token + bcrypt-set password → inviteStatus flips to "accepted".
No plain-text password is ever sent or stored pre-activation.

**Key files:** `routes/adminAgents.ts`, `routes/agentActivate.ts`, `pages/agent/activate.tsx`

**How to apply:** Mount `/agent/activate` BEFORE the auth-guarded `/agent` router in
`routes/index.ts` so no JWT is required for activation.

## apiUrl helper

Cross-origin issue: agent.rasokart.com (subdomain) must call rasokart.com/api.
`lib/api-url.ts` detects if hostname is a non-apex *.rasokart.com and prefixes the
absolute origin. On dev/Replit (localhost / Replit preview) returns same-origin path.

## authHeaders() return type

Must be `Record<string, string>` (not inferred conditional type) or TypeScript rejects
the spread into `fetch()` `headers` because `{ Authorization?: undefined }` is not
assignable to `HeadersInit`.
