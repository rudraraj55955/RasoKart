import { db, whiteLabelFinanceCommandsTable, whiteLabelFinanceAuditTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { financeOperationScope } from "./whiteLabelIdempotency";

import { classifyExistingCommand, type ReservationOutcome } from "./whiteLabelCommandPolicy";

/**
 * DB-backed reservation scaffold, unused by money-moving endpoints.
 * Unique index serializes duplicate keys across concurrent processes.
 * Important: reservation is NOT payment execution or a transactional outbox.
 */
export async function reserveWhiteLabelFinanceCommand(input: {
  tenantId: number; merchantId: number; actorId: number;
  operation: string; idempotencyKey: string; payloadHash: string;
}): Promise<{ outcome: ReservationOutcome; commandId: number | null }> {
  if (!financeOperationScope(input.tenantId, input.merchantId, input.operation, input.idempotencyKey) ||
      !Number.isSafeInteger(input.actorId) || input.actorId <= 0 ||
      !/^[a-f0-9]{64}$/.test(input.payloadHash)) {
    throw new Error("Invalid finance command reservation");
  }
  return db.transaction(async tx => {
    const [created] = await tx.insert(whiteLabelFinanceCommandsTable).values({
      tenantId: input.tenantId, merchantId: input.merchantId,
      operation: input.operation, idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash, createdBy: input.actorId,
    }).onConflictDoNothing().returning({ id: whiteLabelFinanceCommandsTable.id });
    const [existing] = created ? [] : await tx.select({
      id: whiteLabelFinanceCommandsTable.id,
      payloadHash: whiteLabelFinanceCommandsTable.payloadHash,
      status: whiteLabelFinanceCommandsTable.status,
    }).from(whiteLabelFinanceCommandsTable).where(and(
      eq(whiteLabelFinanceCommandsTable.tenantId, input.tenantId),
      eq(whiteLabelFinanceCommandsTable.merchantId, input.merchantId),
      eq(whiteLabelFinanceCommandsTable.operation, input.operation),
      eq(whiteLabelFinanceCommandsTable.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    const outcome = created ? "reserved" : classifyExistingCommand(existing, input.payloadHash);
    if (created) {
      await tx.insert(whiteLabelFinanceAuditTable).values({
        tenantId: input.tenantId, merchantId: input.merchantId,
        actorId: input.actorId, commandId: created.id,
        action: input.operation, outcome: "reserved",
      });
    }
    return { outcome, commandId: created?.id ?? existing?.id ?? null };
  });
}
