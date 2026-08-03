/**
 * Subdomain detection utility.
 *
 * Reads `window.location.hostname` at runtime so the same Vite build
 * can be served from all five role subdomains without a rebuild.
 *
 * Portal mapping:
 *   superadmin.rasokart.com → "superadmin"
 *   admin.rasokart.com      → "admin"
 *   merchant.rasokart.com   → "merchant"
 *   payoutmerchant.rasokart.com → "payoutmerchant"
 *   agent.rasokart.com      → "agent"
 *   anything else           → "public"  (rasokart.com, localhost, Replit preview)
 */

export type PortalId =
  | "superadmin"
  | "admin"
  | "merchant"
  | "payoutmerchant"
  | "agent"
  | "public";

const SUBDOMAIN_MAP: Record<string, PortalId> = {
  "superadmin.rasokart.com": "superadmin",
  "admin.rasokart.com": "admin",
  "merchant.rasokart.com": "merchant",
  "payoutmerchant.rasokart.com": "payoutmerchant",
  "agent.rasokart.com": "agent",
};

let _cachedPortal: PortalId | null = null;

/** Returns the portal identifier for the current hostname (cached after first call). */
export function getPortal(): PortalId {
  if (_cachedPortal !== null) return _cachedPortal;
  if (typeof window === "undefined") return "public";
  const hostname = window.location.hostname;
  _cachedPortal = SUBDOMAIN_MAP[hostname] ?? "public";
  return _cachedPortal;
}

/** Returns true when the current hostname matches one of the given portals. */
export function isPortal(...portals: PortalId[]): boolean {
  return portals.includes(getPortal());
}

/** Returns the canonical login path for the given portal. */
export function getPortalLoginPath(portal: PortalId): string {
  switch (portal) {
    case "superadmin":
    case "admin":
      return "/admin";
    case "merchant":
      return "/merchant";
    case "payoutmerchant":
      return "/payout-merchant/login";
    case "agent":
      return "/agent";
    default:
      return "/";
  }
}

/**
 * Returns the role(s) that are valid for the given portal, or `null` for
 * the public portal (no restriction — all paths are allowed).
 *
 * "superadmin" additionally requires `is_super_admin === true` on the user
 * object — checked separately in ProtectedRoute.
 */
export function getPortalAllowedRoles(portal: PortalId): string[] | null {
  switch (portal) {
    case "superadmin":
      return ["admin"]; // + is_super_admin check in ProtectedRoute
    case "admin":
      return ["admin"];
    case "merchant":
      return ["merchant"];
    case "payoutmerchant":
      return ["payout_merchant", "merchant"];
    case "agent":
      return ["agent"];
    default:
      return null; // public — no portal-level restriction
  }
}

/**
 * Returns the correct subdomain URL for the given role on rasokart.com.
 * Used to redirect a user to the right portal when they log in on the
 * wrong one.
 */
export function getSubdomainForRole(role: string, isSuperAdmin?: boolean): string {
  if (role === "admin") {
    return isSuperAdmin
      ? "https://superadmin.rasokart.com"
      : "https://admin.rasokart.com";
  }
  if (role === "merchant") return "https://merchant.rasokart.com";
  if (role === "payout_merchant") return "https://payoutmerchant.rasokart.com";
  if (role === "agent") return "https://agent.rasokart.com";
  return "https://rasokart.com";
}
