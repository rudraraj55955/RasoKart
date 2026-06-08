import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  price: text("price").notNull().default("0"),
  pricing: text("pricing").notNull().default("{}"),
  features: text("features").notNull().default("[]"),
  dynamicQrLimit: integer("dynamic_qr_limit").notNull().default(10),
  staticQrLimit: integer("static_qr_limit").notNull().default(10),
  virtualAccountLimit: integer("virtual_account_limit").notNull().default(5),
  paymentLinkLimit: integer("payment_link_limit").notNull().default(10),
  payoutLimit: integer("payout_limit").notNull().default(20),
  dailyTransactionLimit: integer("daily_transaction_limit").notNull().default(999),
  monthlyTransactionLimit: integer("monthly_transaction_limit").notNull().default(9999),
  settlementFee: text("settlement_fee").notNull().default("2.0"),
  depositFee: text("deposit_fee").notNull().default("0.0"),
  apiAccess: boolean("api_access").notNull().default(true),
  webhookAccess: boolean("webhook_access").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;
