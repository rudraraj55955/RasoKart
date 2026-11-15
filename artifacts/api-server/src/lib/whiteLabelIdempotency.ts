/**
 * Strict validation for a future idempotent, tenant-scoped finance command.
 * Actual money-moving commands must atomically persist a unique
 * (tenant_id, merchant_id, operation, idempotency_key) record and result.
 * A validated key alone DOES NOT provide idempotency.
 */
export function validFinanceIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 16 && value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

export function financeOperationScope(
  tenantId: number, merchantId: number, operation: string, key: string,
): string | null {
  if (![tenantId, merchantId].every(n => Number.isSafeInteger(n) && n > 0) ||
      !/^[a-z][a-z0-9_]{1,39}$/.test(operation) ||
      !validFinanceIdempotencyKey(key)) return null;
  return `${tenantId}:${merchantId}:${operation}:${key}`;
}
