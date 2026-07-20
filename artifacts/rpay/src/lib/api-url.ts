/**
 * Build an absolute URL for an API call.
 *
 * All portals (admin, merchant, agent, payout-merchant) share the same
 * backend at rasokart.com/api — there is no api.subdomain split.
 * JWT auth is stored in localStorage so cross-subdomain API calls work fine.
 *
 * In dev/Replit the API is reachable at the same origin on /api.
 * On production subdomains (agent.rasokart.com etc.) we always hit
 * https://rasokart.com/api directly.
 */

const PRODUCTION_API_ORIGIN = "https://rasokart.com";

function isProductionSubdomain(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    host !== "rasokart.com" &&
    host !== "www.rasokart.com" &&
    host.endsWith(".rasokart.com")
  );
}

/**
 * Returns a fully-qualified API URL.
 * - On rasokart.com or localhost → same-origin (relative path works)
 * - On a subdomain (agent.rasokart.com, admin.rasokart.com …) → absolute URL to rasokart.com
 */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (isProductionSubdomain()) {
    return `${PRODUCTION_API_ORIGIN}${p}`;
  }
  return p;
}
