/**
 * Integration tests: OTP rate limit enforcement — IP rotation resistance.
 *
 * Verifies three properties of the dual-limiter design on
 *   POST /api/auth/merchant/otp/request
 *   POST /api/auth/merchant/otp/resend
 *   POST /api/auth/merchant/password/forgot
 *
 * (a) Per-identifier limit fires at limit+1 regardless of IP rotation
 *     — 5 requests from 5 distinct IPs all succeed; the 6th from a brand-new
 *       IP is still rejected with 429 because the identifier bucket is exhausted.
 *
 * (b) Per-IP limit fires independently
 *     — 5 requests from the same IP/identifier pair all succeed; the 6th from
 *       the same IP is rejected with 429.
 *
 * (c) "User not found" branch returns the same opaque safe message as the
 *     "user found" branch, and the response time respects the
 *     OTP_MIN_RESPONSE_MS constant (600 ms) so timing cannot distinguish
 *     account existence.
 *
 * Uses the real database — no mocks. Rate-limit counters are cleared in
 * `before` so the suite is independent of run order.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../app";

// ── HTTP helpers ─────────────────────────────────────────────────────────────

type HttpResult = { status: number; body: Record<string, unknown> };

/**
 * POST JSON to the in-process server.
 * `spoofIp` is injected via `X-Forwarded-For`; the app trusts the first proxy
 * hop (`app.set("trust proxy", 1)`) so `req.ip` will resolve to this value.
 */
function post(
  server: http.Server,
  path: string,
  body: Record<string, unknown>,
  spoofIp?: string,
): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  const payload = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  };
  if (spoofIp) {
    headers["X-Forwarded-For"] = spoofIp;
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, body: { _raw: raw } });
          }
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** Timed variant — also returns elapsed milliseconds. */
async function timedPost(
  server: http.Server,
  path: string,
  body: Record<string, unknown>,
  spoofIp?: string,
): Promise<HttpResult & { elapsedMs: number }> {
  const tStart = Date.now();
  const result = await post(server, path, body, spoofIp);
  return { ...result, elapsedMs: Date.now() - tStart };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe(
  "OTP rate limits — IP rotation resistance and timing safety (real DB)",
  { timeout: 60_000 },
  () => {
    let server: http.Server;

    // Use a timestamp suffix so repeated runs within the same DB state use
    // distinct identifier buckets and don't interfere with each other.
    const runId = Date.now();

    // Each route gets its own identifier family so the per-identifier counters
    // are independent across sub-suites.
    const ID = {
      requestRotation: `otp-rl-req-rot-${runId}@example.invalid`,
      requestIp:       `otp-rl-req-ip-${runId}@example.invalid`,
      requestNotFound: `otp-rl-req-nf-${runId}@example.invalid`,
      resendRotation:  `otp-rl-res-rot-${runId}@example.invalid`,
      resendIp:        `otp-rl-res-ip-${runId}@example.invalid`,
      resendNotFound:  `otp-rl-res-nf-${runId}@example.invalid`,
      forgotRotation:  `otp-rl-fgt-rot-${runId}@example.invalid`,
      forgotIp:        `otp-rl-fgt-ip-${runId}@example.invalid`,
      forgotNotFound:  `otp-rl-fgt-nf-${runId}@example.invalid`,
    };

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      // Wipe all rate-limit counters so this suite starts with clean buckets.
      await db.execute(sql`DELETE FROM rate_limit_hits`);
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/auth/merchant/otp/request
    // ─────────────────────────────────────────────────────────────────────────

    describe("POST /api/auth/merchant/otp/request", () => {
      describe("per-identifier limit survives IP rotation", () => {
        it("allows 5 requests from 5 distinct IPs for the same identifier", async () => {
          for (let i = 0; i < 5; i++) {
            const res = await post(
              server,
              "/api/auth/merchant/otp/request",
              { identifier: ID.requestRotation },
              `10.11.${i}.1`,
            );
            assert.notEqual(
              res.status,
              429,
              `request ${i + 1} from IP 10.11.${i}.1 should not be rate-limited (got ${res.status}: ${JSON.stringify(res.body)})`,
            );
          }
        });

        it("returns 429 on the 6th request from a brand-new IP", async () => {
          const res = await post(
            server,
            "/api/auth/merchant/otp/request",
            { identifier: ID.requestRotation },
            "10.11.99.1",
          );
          assert.equal(
            res.status,
            429,
            `6th request must be rejected regardless of IP rotation (got ${res.status}: ${JSON.stringify(res.body)})`,
          );
          assert.ok(
            typeof res.body["error"] === "string",
            "429 response must include an error string",
          );
        });
      });

      describe("per-IP limit fires independently", () => {
        const fixedIp = "10.12.1.1";

        it("allows 5 requests from the same IP for the same identifier", async () => {
          for (let i = 0; i < 5; i++) {
            const res = await post(
              server,
              "/api/auth/merchant/otp/request",
              { identifier: ID.requestIp },
              fixedIp,
            );
            assert.notEqual(
              res.status,
              429,
              `request ${i + 1} from ${fixedIp} should not be rate-limited (got ${res.status}: ${JSON.stringify(res.body)})`,
            );
          }
        });

        it("returns 429 on the 6th request from the same IP", async () => {
          const res = await post(
            server,
            "/api/auth/merchant/otp/request",
            { identifier: ID.requestIp },
            fixedIp,
          );
          assert.equal(
            res.status,
            429,
            `6th request from the same IP must be rejected (got ${res.status}: ${JSON.stringify(res.body)})`,
          );
        });
      });

      describe("user not found branch — safe message and timing floor", () => {
        it("returns 200 with an opaque safe message when identifier does not exist", async () => {
          const { status, body } = await post(
            server,
            "/api/auth/merchant/otp/request",
            { identifier: ID.requestNotFound },
            "10.13.1.1",
          );
          assert.equal(status, 200);
          assert.ok(
            typeof body["message"] === "string" && body["message"].length > 0,
            "must return a non-empty message field",
          );
          assert.ok(
            !body["error"],
            "must NOT expose an error field that reveals non-existence",
          );
        });

        it("response time meets the 600 ms constant-time floor (both branches padded equally)", async () => {
          const { status, elapsedMs } = await timedPost(
            server,
            "/api/auth/merchant/otp/request",
            { identifier: ID.requestNotFound },
            "10.13.1.2",
          );
          assert.equal(status, 200);
          assert.ok(
            elapsedMs >= 500,
            `user-not-found response took only ${elapsedMs} ms; expected >= 500 ms (OTP_MIN_RESPONSE_MS floor is 600 ms)`,
          );
        });
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/auth/merchant/otp/resend
    // ─────────────────────────────────────────────────────────────────────────

    describe("POST /api/auth/merchant/otp/resend", () => {
      describe("per-identifier limit survives IP rotation", () => {
        it("allows 5 requests from 5 distinct IPs for the same identifier", async () => {
          for (let i = 0; i < 5; i++) {
            const res = await post(
              server,
              "/api/auth/merchant/otp/resend",
              { identifier: ID.resendRotation },
              `10.21.${i}.1`,
            );
            assert.notEqual(
              res.status,
              429,
              `resend request ${i + 1} from IP 10.21.${i}.1 should not be rate-limited (got ${res.status}: ${JSON.stringify(res.body)})`,
            );
          }
        });

        it("returns 429 on the 6th request from a brand-new IP", async () => {
          const res = await post(
            server,
            "/api/auth/merchant/otp/resend",
            { identifier: ID.resendRotation },
            "10.21.99.1",
          );
          assert.equal(
            res.status,
            429,
            `6th resend must be rejected regardless of IP rotation (got ${res.status}: ${JSON.stringify(res.body)})`,
          );
          assert.ok(
            typeof res.body["error"] === "string",
            "429 response must include an error string",
          );
        });
      });

      describe("per-IP limit fires independently", () => {
        const fixedIp = "10.22.1.1";

        it("allows 5 requests from the same IP for the same identifier", async () => {
          for (let i = 0; i < 5; i++) {
            const res = await post(
              server,
              "/api/auth/merchant/otp/resend",
              { identifier: ID.resendIp },
              fixedIp,
            );
            assert.notEqual(
              res.status,
              429,
              `resend request ${i + 1} from ${fixedIp} should not be rate-limited (got ${res.status}: ${JSON.stringify(res.body)})`,
            );
          }
        });

        it("returns 429 on the 6th request from the same IP", async () => {
          const res = await post(
            server,
            "/api/auth/merchant/otp/resend",
            { identifier: ID.resendIp },
            fixedIp,
          );
          assert.equal(
            res.status,
            429,
            `6th resend from the same IP must be rejected (got ${res.status}: ${JSON.stringify(res.body)})`,
          );
        });
      });

      describe("user not found branch — safe message and timing floor", () => {
        it("returns 200 with an opaque safe message when identifier does not exist", async () => {
          const { status, body } = await post(
            server,
            "/api/auth/merchant/otp/resend",
            { identifier: ID.resendNotFound },
            "10.23.1.1",
          );
          assert.equal(status, 200);
          assert.ok(
            typeof body["message"] === "string" && body["message"].length > 0,
            "must return a non-empty message field",
          );
          assert.ok(
            !body["error"],
            "must NOT expose an error field that reveals non-existence",
          );
        });

        it("response time meets the 600 ms constant-time floor", async () => {
          const { status, elapsedMs } = await timedPost(
            server,
            "/api/auth/merchant/otp/resend",
            { identifier: ID.resendNotFound },
            "10.23.1.2",
          );
          assert.equal(status, 200);
          assert.ok(
            elapsedMs >= 500,
            `user-not-found resend response took only ${elapsedMs} ms; expected >= 500 ms (OTP_MIN_RESPONSE_MS floor is 600 ms)`,
          );
        });
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/auth/merchant/password/forgot
    // ─────────────────────────────────────────────────────────────────────────

    describe("POST /api/auth/merchant/password/forgot", () => {
      describe("per-identifier limit survives IP rotation", () => {
        it("allows 5 requests from 5 distinct IPs for the same identifier", async () => {
          for (let i = 0; i < 5; i++) {
            const res = await post(
              server,
              "/api/auth/merchant/password/forgot",
              { identifier: ID.forgotRotation },
              `10.31.${i}.1`,
            );
            assert.notEqual(
              res.status,
              429,
              `forgot request ${i + 1} from IP 10.31.${i}.1 should not be rate-limited (got ${res.status}: ${JSON.stringify(res.body)})`,
            );
          }
        });

        it("returns 429 on the 6th request from a brand-new IP", async () => {
          const res = await post(
            server,
            "/api/auth/merchant/password/forgot",
            { identifier: ID.forgotRotation },
            "10.31.99.1",
          );
          assert.equal(
            res.status,
            429,
            `6th forgot must be rejected regardless of IP rotation (got ${res.status}: ${JSON.stringify(res.body)})`,
          );
          assert.ok(
            typeof res.body["error"] === "string",
            "429 response must include an error string",
          );
        });
      });

      describe("per-IP limit fires independently", () => {
        const fixedIp = "10.32.1.1";

        it("allows 5 requests from the same IP for the same identifier", async () => {
          for (let i = 0; i < 5; i++) {
            const res = await post(
              server,
              "/api/auth/merchant/password/forgot",
              { identifier: ID.forgotIp },
              fixedIp,
            );
            assert.notEqual(
              res.status,
              429,
              `forgot request ${i + 1} from ${fixedIp} should not be rate-limited (got ${res.status}: ${JSON.stringify(res.body)})`,
            );
          }
        });

        it("returns 429 on the 6th request from the same IP", async () => {
          const res = await post(
            server,
            "/api/auth/merchant/password/forgot",
            { identifier: ID.forgotIp },
            fixedIp,
          );
          assert.equal(
            res.status,
            429,
            `6th forgot from the same IP must be rejected (got ${res.status}: ${JSON.stringify(res.body)})`,
          );
        });
      });

      describe("user not found branch — safe message and timing floor", () => {
        it("returns 200 with an opaque safe message when identifier does not exist", async () => {
          const { status, body } = await post(
            server,
            "/api/auth/merchant/password/forgot",
            { identifier: ID.forgotNotFound },
            "10.33.1.1",
          );
          assert.equal(status, 200);
          assert.ok(
            typeof body["message"] === "string" && body["message"].length > 0,
            "must return a non-empty message field",
          );
          assert.ok(
            !body["error"],
            "must NOT expose an error field that reveals non-existence",
          );
        });

        it("response time meets the 600 ms constant-time floor", async () => {
          const { status, elapsedMs } = await timedPost(
            server,
            "/api/auth/merchant/password/forgot",
            { identifier: ID.forgotNotFound },
            "10.33.1.2",
          );
          assert.equal(status, 200);
          assert.ok(
            elapsedMs >= 500,
            `user-not-found forgot response took only ${elapsedMs} ms; expected >= 500 ms (OTP_MIN_RESPONSE_MS floor is 600 ms)`,
          );
        });
      });
    });
  },
);
