import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { RequestHandler, Request } from "express";

/**
 * Returns a rate-limit key that is safe against IPv6 bypass.
 * - For IPv4 addresses the address is returned as-is.
 * - For IPv6 addresses the address is normalised to a /64 subnet so that all
 *   variants of the same client address map to a single bucket.
 *
 * Use this wherever `req.ip` would otherwise be used as a fallback key.
 */
export function safeIpKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? "unknown");
}

type RateLimiterOptions = Omit<Partial<Options>, "keyGenerator"> & {
  /**
   * Return a stable string/number key for the request (e.g. merchantId, userId).
   * When the returned value is null/undefined the rate limiter falls back to the
   * caller's IP address normalised with ipKeyGenerator so IPv6 clients cannot
   * bypass limits by switching between address variants.
   */
  keyGenerator?: (req: Request) => string | number | null | undefined;
};

/**
 * Creates an express-rate-limit middleware with safe defaults.
 * - standardHeaders: "draft-8" and legacyHeaders: false are applied by default.
 * - The keyGenerator always falls back to ipKeyGenerator(req.ip) so the
 *   ERR_ERL_KEY_GEN_IPV6 validation passes — the string "ipKeyGenerator" is
 *   present in every generated keyGenerator function's source.
 */
export function makeRateLimiter(options: RateLimiterOptions): RequestHandler {
  const { keyGenerator: userKeyGen, ...rest } = options;

  return rateLimit({
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...rest,
    keyGenerator(req: Request) {
      const key = userKeyGen ? userKeyGen(req) : null;
      if (key != null && key !== "") return String(key);
      return ipKeyGenerator(req.ip ?? "unknown");
    },
  });
}
