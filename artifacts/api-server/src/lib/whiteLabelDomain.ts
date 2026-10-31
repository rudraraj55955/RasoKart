/**
 * Resolve a candidate tenant ONLY from a previously verified exact hostname.
 * A caller-selected tenantId must never override authenticated ownership.
 * This helper deliberately does not trust X-Forwarded-Host or wildcard matching.
 */
export type VerifiedWhiteLabelDomain = {
  hostname: string;
  tenantId: number;
  ownershipStatus: "verified" | "pending" | "rejected";
  tenantStatus: "active" | "draft" | "suspended" | "archived";
};

export function normalizeTenantHostname(input: string): string | null {
  if (!input || input.length > 253 || input !== input.trim()) return null;
  const host = input.toLowerCase().replace(/\.$/, "");
  if (host.includes(":") || host.includes("/") || host.includes("@") || host.includes("\\") || host.includes("..")) return null;
  if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) return null;
  const labels = host.split(".");
  if (labels.some(label => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return host;
}

export function resolveVerifiedWhiteLabelDomain(
  incomingHostname: string,
  domains: readonly VerifiedWhiteLabelDomain[],
): number | null {
  const hostname = normalizeTenantHostname(incomingHostname);
  if (!hostname) return null;
  const matching = domains.filter(d => normalizeTenantHostname(d.hostname) === hostname);
  if (matching.length !== 1) return null; // duplicates fail closed
  const domain = matching[0]!;
  if (domain.ownershipStatus !== "verified" || domain.tenantStatus !== "active") return null;
  if (!Number.isSafeInteger(domain.tenantId) || domain.tenantId <= 0) return null;
  return domain.tenantId;
}
