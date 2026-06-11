import { pgTable, text, serial, timestamp, numeric, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settlementsTable = pgTable("settlements", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  requestedAmount: numeric("requested_amount", { precision: 18, scale: 2 }),
  requestedNote: text("requested_note"),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("pending"), // pending | processing | approved | rejected | paid | cancelled
  periodFrom: date("period_from", { mode: "string" }),
  periodTo: date("period_to", { mode: "string" }),
  transactionCount: integer("transaction_count").notNull().default(0),
  adminRemark: text("admin_remark"),
  processedBy: integer("processed_by"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  referenceNumber: text("reference_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettlementSchema = createInsertSchema(settlementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSettlement = z.infer<typeof insertSettlementSchema>;
export type Settlement = typeof settlementsTable.$inferSelect;
