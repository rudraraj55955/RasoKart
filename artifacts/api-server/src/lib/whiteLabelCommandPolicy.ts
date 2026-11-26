import { createHash } from "node:crypto";

export type ReservationOutcome = "reserved" | "replay" | "conflict" | "in_progress";
export function classifyExistingCommand(
  existing: { payloadHash: string; status: string } | undefined,
  requestedHash: string,
): ReservationOutcome {
  if (!existing) return "reserved";
  if (existing.payloadHash !== requestedHash) return "conflict";
  return existing.status === "completed" ? "replay" : "in_progress";
}

/** Stable hash of an already canonicalized, non-sensitive operation payload.
 * Callers MUST enforce canonical payload serialization and input validation.
 */
export function hashCanonicalFinancePayload(canonicalJson: string): string {
  return createHash("sha256").update(canonicalJson).digest("hex");
}

