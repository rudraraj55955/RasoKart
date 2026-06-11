import rateLimit, { type Options } from "express-rate-limit";
import { PostgresRateLimitStore } from "../lib/rateLimitStore";

/**
 * Create a rate limiter backed by PostgreSQL so counters survive server
 * restarts and work correctly across multiple server replicas.
 *
 * `limiterId` must be a short, stable, unique identifier for this limiter
 * (e.g. "login", "qr-create"). It is prepended to every stored key so that
 * different limiters never share counters even when their client keys collide
 * (e.g. the same merchantId on two different endpoints).
 *
 * Usage is otherwise identical to `rateLimit(options)` — the `store` is
 * injected automatically from `limiterId` and `windowMs`.
 *
 * Configure via env:
 *   RATE_LIMIT_STORE=memory   — fall back to in-memory store (dev/test only)
 */
export function makeRateLimiter(
  options: Partial<Options> & { limiterId: string; windowMs: number },
) {
  const useMemory = process.env["RATE_LIMIT_STORE"] === "memory";
  const { limiterId, ...rest } = options;
  return rateLimit({
    ...rest,
    ...(useMemory ? {} : { store: new PostgresRateLimitStore(limiterId, options.windowMs) }),
  });
}
