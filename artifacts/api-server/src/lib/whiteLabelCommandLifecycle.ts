import { db, whiteLabelFinanceCommandsTable, whiteLabelFinanceAuditTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { allowedCommandTransition, type CommandStatus } from "./whiteLabelCommandLifecyclePolicy";

/** Scaffold only. Not connected to live payments. All updates are scoped by
 * tenant, merchant, command ID and expected reserved state.
 *
 * A provider call is NOT made here. Do not treat this helper as payment-safe
 * without a transactional outbox, reconciliation and real PostgreSQL tests.
 */
export async function finalizeWhiteLabelFinanceCommand(input: {
  tenantId: number;
  merchantId: number;
  commandId: number;
  actorId: number;
  outcome: Exclude<CommandStatus, "reserved">;
}): Promise<boolean> {
  if (![input.tenantId, input.merchantId, input.commandId, input.actorId].every(
    n => Number.isSafeInteger(n) && n > 0,
  ) || !allowedCommandTransition("reserved", input.outcome)) {
    throw new Error("Invalid financial command finalization");
  }
  return db.transaction(async tx => {
    const [updated] = await tx.update(whiteLabelFinanceCommandsTable)
      .set({ status: input.outcome, completedAt: new Date() })
      .where(and(
        eq(whiteLabelFinanceCommandsTable.id, input.commandId),
        eq(whiteLabelFinanceCommandsTable.tenantId, input.tenantId),
        eq(whiteLabelFinanceCommandsTable.merchantId, input.merchantId),
        eq(whiteLabelFinanceCommandsTable.status, "reserved"),
      )).returning({ id: whiteLabelFinanceCommandsTable.id, operation: whiteLabelFinanceCommandsTable.operation });
    if (!updated) return false;
    await tx.insert(whiteLabelFinanceAuditTable).values({
      tenantId: input.tenantId, merchantId: input.merchantId,
      commandId: updated.id, actorId: input.actorId,
      action: updated.operation, outcome: input.outcome,
    });
    return true;
  });
}
