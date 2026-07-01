import { pgTable, serial, varchar, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const cashfreePayoutsTable = pgTable("cashfree_payouts", {
  id: serial("id").primaryKey(),
  publicTransferId: varchar("public_transfer_id", { length: 64 }),
  providerKey: varchar("provider_key", { length: 64 }).default("cashfree"),
  transferId: varchar("transfer_id", { length: 255 }).notNull().unique(),
  beneficiaryName: varchar("beneficiary_name", { length: 255 }).notNull(),
  accountNumber: varchar("account_number", { length: 100 }),
  ifsc: varchar("ifsc", { length: 20 }),
  upiId: varchar("upi_id", { length: 255 }),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  remark: varchar("remark", { length: 255 }),
  status: text("status").notNull().default("PENDING"),
  cashfreeTransferId: varchar("cashfree_transfer_id", { length: 255 }),
  errorMessage: text("error_message"),
  merchantId: integer("merchant_id"),
  initiatedByEmail: varchar("initiated_by_email", { length: 255 }).notNull(),
  utr: text("utr"),
  rawResponse: text("raw_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CashfreePayout = typeof cashfreePayoutsTable.$inferSelect;
export type CashfreePayoutInsert = typeof cashfreePayoutsTable.$inferInsert;
