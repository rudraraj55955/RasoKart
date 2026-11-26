import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { whiteLabelTenantsTable } from "./whiteLabelTenants";

/** Additive, NOT activated. A unique scope key prevents duplicate command reservation.
 * Future handlers must reserve and finalize in a DB transaction before enabling payments.
 * Never persist raw provider credentials or full account numbers in result/metadata.
 */
export const whiteLabelFinanceCommandsTable = pgTable("white_label_finance_commands", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => whiteLabelTenantsTable.id),
  merchantId: integer("merchant_id").notNull(),
  operation: text("operation").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  status: text("status").notNull().default("reserved"),
  result: jsonb("result"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => ({
  uniqueRequest: uniqueIndex("wl_fin_cmd_unique_request").on(
    table.tenantId, table.merchantId, table.operation, table.idempotencyKey,
  ),
  createdIdx: index("wl_fin_cmd_tenant_created").on(table.tenantId, table.createdAt),
}));

export const whiteLabelFinanceAuditTable = pgTable("white_label_finance_audit", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => whiteLabelTenantsTable.id),
  merchantId: integer("merchant_id").notNull(),
  commandId: integer("command_id").references(() => whiteLabelFinanceCommandsTable.id),
  actorId: integer("actor_id").notNull(),
  action: text("action").notNull(),
  outcome: text("outcome").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  tenantAuditIdx: index("wl_fin_audit_tenant_created").on(table.tenantId, table.createdAt),
}));
