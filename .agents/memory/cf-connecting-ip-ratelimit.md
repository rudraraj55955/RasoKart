---
name: CF-Connecting-IP rate limit key
description: How to correctly key a rate limiter when the server sits behind Cloudflare → Nginx → Express
---

## Rule
When the API is behind Cloudflare → Nginx → Express (trust proxy: 1), **never key a rate limiter on `req.ip`** — it resolves to a Cloudflare edge-node IP, making the limit effectively per-Cloudflare-PoP rather than per-client.

Use `CF-Connecting-IP` header instead — Cloudflare always overwrites any client-supplied value with the real visitor IP, so it cannot be spoofed.

```ts
keyGenerator: (req) => {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) return cfIp.trim();
  return safeIpKey(req.ip ?? "unknown");
},
```

**Why:** In production tests, 21 unique-token requests from a single Replit IP all returned 404 (not 429) with the old `req.ip` key — different Cloudflare PoPs produced different IPs in `req.ip`, each getting its own bucket. After the fix, the same test hit 429 at request 21 as expected.

**How to apply:** Use this pattern for any public-facing rate limiter on the RasoKart API. Applies to `publicPayoutSlip.ts` verifyLimiter, and any future public endpoints added to `routes/public*.ts`.
