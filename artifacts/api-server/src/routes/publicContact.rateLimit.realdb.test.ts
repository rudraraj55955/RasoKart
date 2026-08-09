/**
 * Integration test: POST /public/contact — rate limiter (real DB)
 *
 * Covers three contracts:
 *
 * 1. **Spoofing bypass is blocked (no trusted proxy configured)**
 *    An attacker sending both X-Forwarded-For containing a Cloudflare CIDR
 *    *and* a fresh CF-Connecting-IP on every request still exhausts a single
 *    bucket, because CF-Connecting-IP is ignored when RATE_LIMIT_TRUSTED_PROXY_IPS
 *    is absent. The 6th request must return 429.
 *
 * 2. **Per-client limiting via trusted proxy (RATE_LIMIT_TRUSTED_PROXY_IPS set)**
 *    When the socket source is a configured trusted proxy (127.0.0.1 in the test,
 *    Nginx's loopback in production), CF-Connecting-IP is accepted as the real
 *    client identity. Five requests from one CF-reported IP succeed; the sixth
 *    returns 429.
 *
 * 3. **Different CF-reported client IPs are separate buckets**
 *    A second client IP from the same trusted proxy edge is unaffected by the
 *    first client's exhausted bucket.
 *
 * Implementation notes
 * ─────────────────────
 * The keyGenerator reads RATE_LIMIT_TRUSTED_PROXY_IPS at request time, so we
 * can toggle it between describe groups without restarting the server.
 * Rate-limit buckets are cleared between groups to prevent cross-contamination.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../app";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function post(
  server: http.Server,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const raw = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path: "/api/public/contact",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(raw),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          try { resolve({ status: res.statusCode!, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode!, body: { _raw: data } }); }
        });
      },
    );
    req.on("error", reject);
    req.write(raw);
    req.end();
  });
}

const VALID_BODY = {
  name: "Test User",
  email: "test-ratelimit@example.com",
  subject: "Rate limit test",
  message: "This message exists only for automated rate-limit testing.",
  category: "general",
};

async function clearBuckets() {
  await db.execute(sql`DELETE FROM rate_limit_hits WHERE key LIKE 'contact:%'`);
}

async function clearSubmissions() {
  await db.execute(
    sql`DELETE FROM contact_submissions WHERE email = 'test-ratelimit@example.com'`,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POST /api/public/contact — rate limiter (real DB)", () => {
  let server: http.Server;
  const originalEnv = process.env["RATE_LIMIT_TRUSTED_PROXY_IPS"];

  before(async () => {
    await clearBuckets();
    await clearSubmissions();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  after(async () => {
    // Restore env and clean up DB state.
    if (originalEnv === undefined) {
      delete process.env["RATE_LIMIT_TRUSTED_PROXY_IPS"];
    } else {
      process.env["RATE_LIMIT_TRUSTED_PROXY_IPS"] = originalEnv;
    }
    await clearBuckets();
    await clearSubmissions();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── Contract 1: spoofing bypass is blocked when no trusted proxy is configured ──

  describe("no trusted proxy configured (RATE_LIMIT_TRUSTED_PROXY_IPS absent)", () => {
    before(async () => {
      delete process.env["RATE_LIMIT_TRUSTED_PROXY_IPS"];
      await clearBuckets();
    });

    it("5 requests with rotating CF-Connecting-IP and spoofed X-Forwarded-For all succeed (same socket bucket)", async () => {
      // Simulate an attacker who: (a) injects a Cloudflare CIDR into XFF to make
      // req.ip look like a Cloudflare edge, and (b) rotates CF-Connecting-IP on
      // every request hoping to get a fresh per-IP bucket.
      // Because RATE_LIMIT_TRUSTED_PROXY_IPS is absent, CF-Connecting-IP is ignored
      // and all requests land in the socket-IP bucket (127.0.0.1).
      for (let i = 1; i <= 5; i++) {
        const res = await post(server, VALID_BODY, {
          "x-forwarded-for": "173.245.48.5", // Cloudflare CIDR — forged
          "cf-connecting-ip": `10.0.0.${i}`, // different fake client IP each time
        });
        assert.equal(
          res.status,
          200,
          `request ${i} should succeed (bucket not yet full; spoofed CF header must be ignored)`,
        );
      }
    });

    it("6th request returns 429 even with a fresh CF-Connecting-IP and Cloudflare XFF (spoofing does not create a new bucket)", async () => {
      const res = await post(server, VALID_BODY, {
        "x-forwarded-for": "173.245.48.5",
        "cf-connecting-ip": "10.0.0.99", // yet another "distinct" IP
      });
      assert.equal(
        res.status,
        429,
        "6th request must be blocked; rotating CF-Connecting-IP must not bypass the limit",
      );
    });

    it("rotating X-Forwarded-For (with Cloudflare CIDR) does not create fresh buckets — 6th request with new XFF+CF headers is still 429", async () => {
      // The bucket is already full (5 used above). This test confirms that even
      // if the attacker also rotates X-Forwarded-For to change req.ip, it makes
      // no difference: the fallback keys on socketIp (req.socket.remoteAddress),
      // not req.ip, so all requests remain in the same bucket.
      const res = await post(server, VALID_BODY, {
        "x-forwarded-for": "103.21.244.5", // different Cloudflare CIDR range
        "cf-connecting-ip": "10.1.2.3",    // fresh fake client IP
      });
      assert.equal(
        res.status,
        429,
        "rotating X-Forwarded-For must not bypass the rate limit — socketIp is the key, not req.ip",
      );
    });
  });

  // ── Contract 2 & 3: per-client limiting via trusted proxy ─────────────────

  describe("trusted proxy configured (RATE_LIMIT_TRUSTED_PROXY_IPS=127.0.0.1)", () => {
    before(async () => {
      // Set to 127.0.0.1 — the TCP socket address for all test HTTP connections,
      // mirroring Nginx's loopback address in production.
      process.env["RATE_LIMIT_TRUSTED_PROXY_IPS"] = "127.0.0.1";
      await clearBuckets();
    });

    after(() => {
      delete process.env["RATE_LIMIT_TRUSTED_PROXY_IPS"];
    });

    it("5 requests with CF-Connecting-IP 203.0.113.50 from trusted proxy all succeed", async () => {
      for (let i = 1; i <= 5; i++) {
        const res = await post(server, VALID_BODY, {
          "cf-connecting-ip": "203.0.113.50",
        });
        assert.equal(res.status, 200, `cloudflare-proxied request ${i} should succeed`);
        assert.equal((res.body as Record<string, unknown>)["success"], true);
      }
    });

    it("6th request from same CF-Connecting-IP is rejected with 429", async () => {
      const res = await post(server, VALID_BODY, {
        "cf-connecting-ip": "203.0.113.50",
      });
      assert.equal(res.status, 429, "6th request from same CF real IP must be rate-limited");
    });

    it("a different CF-Connecting-IP (203.0.113.60) is a separate bucket and succeeds", async () => {
      const res = await post(server, VALID_BODY, {
        "cf-connecting-ip": "203.0.113.60",
      });
      assert.equal(res.status, 200, "different CF real IP must have its own independent bucket");
      assert.equal((res.body as Record<string, unknown>)["success"], true);
    });
  });
});
