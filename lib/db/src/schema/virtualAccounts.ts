import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const virtualAccountsTable = pgTable("virtual_accounts", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  accountNumber: text("account_number").notNull().unique(),
  ifsc: text("ifsc").notNull(),
  bankName: text("bank_name").notNull(),
  accountHolder: text("account_holder").notNull(),
  label: text("label"),
  balance: text("balance").notNull().default("0.00"),
  status: text("status").notNull().default("active"), // active | closed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVirtualAccountSchema = createInsertSchema(virtualAccountsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVirtualAccount = z.infer<typeof insertVirtualAccountSchema>;
export type VirtualAccount = typeof virtualAccountsTable.$inferSelect;
