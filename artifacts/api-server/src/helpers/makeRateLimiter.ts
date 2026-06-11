import { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

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
