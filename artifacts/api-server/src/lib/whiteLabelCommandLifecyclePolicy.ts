export type CommandStatus = "reserved" | "completed" | "failed" | "requires_reconciliation";

/** Never retry an ambiguous provider outcome automatically. */
export function allowedCommandTransition(from: CommandStatus, to: CommandStatus): boolean {
  if (from === "reserved") return ["completed", "failed", "requires_reconciliation"].includes(to);
  return false;
}
