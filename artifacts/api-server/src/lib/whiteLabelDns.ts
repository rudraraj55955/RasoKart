import { createHash, timingSafeEqual } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { normalizeTenantHostname } from "./whiteLabelDomain.ts";

export function ownershipTxtName(hostname: string): string | null {
  const safe = normalizeTenantHostname(hostname);
  return safe ? `_rasokart-verification.${safe}` : null;
}
export function hashOwnershipToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function ownershipTokenMatches(token: string, expectedHash: string | null): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? "") || !/^rk-wl-[a-f0-9]{64}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(hashOwnershipToken(token), "hex"), Buffer.from(expectedHash!, "hex"));
}
export async function checkOwnershipTxt(hostname: string, token: string): Promise<boolean> {
  const record = ownershipTxtName(hostname);
  if (!record || !/^rk-wl-[a-f0-9]{64}$/.test(token)) return false;
  try {
    const records = await resolveTxt(record);
    return records.some(parts => parts.join("") === token);
  } catch { return false; } // DNS errors fail closed
}
