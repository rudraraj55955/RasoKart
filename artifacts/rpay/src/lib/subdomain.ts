/**
 * Subdomain-aware routing helpers.
 *
 * Maps rasokart.com subdomains to expected portal roles.
 * Each subdomain should only allow one specific portal.
 *
 * Subdomain → Portal:
 *   superadmin.rasokart.com  → Super Admin (admin role + isSuperAdmin)
 *   admin.rasokart.com       → Admin portal (admin role)
 *   merchant.rasokart.com    → Merchant portal
 *   payoutmerchant.rasokart.com → Payout Merchant portal
 *   agent.rasokart.com       → Agent portal
 *   rasokart.com / localhost → Main site (all portals accessible via paths)
 */

export type PortalId =
  | "superadmin"
  | "admin"
  | "merchant"
  | "payoutmerchant"
  | "agent"
  | "main";

const SUBDOMAIN_MAP: Record<string, PortalId> = {
  superadmin: "superadmin",
  admin: "admin",
  merchant: "merchant",
  payoutmerchant: "payoutmerchant",
  agent: "agent",
};

/**
 * Detect which portal this hostname is for.
 * Returns "main" for rasokart.com, localhost, Replit preview, or unknown hosts.
 */
export function getHostnamePortal(): PortalId {
  if (typeof window === "undefined") return "main";
  const host = window.location.hostname;
  // Extract subdomain: "admin.rasokart.com" → "admin"
  const parts = host.split(".");
  if (parts.length >= 3) {
    const sub = parts[0].toLowerCase();
    return SUBDOMAIN_MAP[sub] ?? "main";
  }
  return "main";
}

/** True when running on any dedicated role subdomain (not the main site). */
export function isSubdomain(): boolean {
  return getHostnamePortal() !== "main";
}

/** Return the canonical login path for a given portal. */
export function portalLoginPath(portal: PortalId): string {
  switch (portal) {
    case "superadmin": return "/admin/login";
    case "admin":      return "/admin/login";
    case "merchant":   return "/merchant/login";
    case "payoutmerchant": return "/payout-merchant/login";
    case "agent":      return "/agent/login";
    default:           return "/";
  }
}

/** Return the canonical dashboard path for a given portal. */
export function portalDashboardPath(portal: PortalId): string {
  switch (portal) {
    case "superadmin": return "/admin/dashboard";
    case "admin":      return "/admin/dashboard";
    case "merchant":   return "/merchant/dashboard";
    case "payoutmerchant": return "/payout-merchant/dashboard";
    case "agent":      return "/agent/dashboard";
    default:           return "/";
  }
}

/**
 * Given an authenticated user's role (and optional isSuperAdmin flag),
 * return which portal they belong to.
 */
export function roleToPortal(role: string, isSuperAdmin?: boolean): PortalId {
  if (role === "admin" && isSuperAdmin) return "superadmin";
  if (role === "admin") return "admin";
  if (role === "merchant") return "merchant";
  if (role === "payout_merchant") return "payoutmerchant";
  if (role === "agent") return "agent";
  return "main";
}

/**
 * Given a portal, return the correct subdomain URL on rasokart.com.
 * Falls back to same-host path navigation when not on rasokart.com
 * (e.g. localhost dev / Replit preview).
 */
export function portalSubdomainUrl(portal: PortalId, path = "/"): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isRasokart = host === "rasokart.com" || host === "www.rasokart.com" || host.endsWith(".rasokart.com");

  if (!isRasokart) {
    // Dev / Replit: just use the path, no subdomain redirect
    return path;
  }

  const subdomainMap: Record<PortalId, string> = {
    superadmin:     "https://superadmin.rasokart.com",
    admin:          "https://admin.rasokart.com",
    merchant:       "https://merchant.rasokart.com",
    payoutmerchant: "https://payoutmerchant.rasokart.com",
    agent:          "https://agent.rasokart.com",
    main:           "https://rasokart.com",
  };

  const base = subdomainMap[portal] ?? "https://rasokart.com";
  return base + (path.startsWith("/") ? path : `/${path}`);
}

/**
 * Redirect to the correct subdomain for the given role.
 * Safe: only redirects if the current hostname doesn't already match.
 * Never causes a redirect loop.
 */
export function redirectToCorrectPortal(
  role: string,
  isSuperAdmin?: boolean,
  targetPath?: string,
): void {
  if (typeof window === "undefined") return;
  const expectedPortal = roleToPortal(role, isSuperAdmin);
  const currentPortal = getHostnamePortal();

  // Already on the correct portal — no redirect
  if (expectedPortal === currentPortal) return;
  // Not on rasokart.com at all (dev/Replit) — don't try subdomain redirect
  const host = window.location.hostname;
  const isRasokart = host === "rasokart.com" || host === "www.rasokart.com" || host.endsWith(".rasokart.com");
  if (!isRasokart) return;

  const dashPath = targetPath ?? portalDashboardPath(expectedPortal);
  const url = portalSubdomainUrl(expectedPortal, dashPath);
  window.location.replace(url);
}

/**
 * Build legacy redirect target URL — safe, allowlist-checked.
 * Returns null if the target is not on an allowed rasokart.com domain.
 */
export function safeReturnUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl, window.location.origin);
    const allowed = [
      "rasokart.com",
      "admin.rasokart.com",
      "superadmin.rasokart.com",
      "merchant.rasokart.com",
      "payoutmerchant.rasokart.com",
      "agent.rasokart.com",
    ];
    if (!allowed.includes(u.hostname)) return null;
    // Never allow open-redirect via protocol abuse
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
