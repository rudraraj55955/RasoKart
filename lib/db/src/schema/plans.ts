import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  pricing: text("pricing").notNull().default("{}"), // JSON: { qr: { monthly: N, perTx: N }, va: { monthly: N, perTx: N } }
  features: text("features").notNull().default("[]"), // JSON array of feature strings
  dynamicQrLimit: integer("dynamic_qr_limit").notNull().default(10),
  staticQrLimit: integer("static_qr_limit").notNull().default(10),
  virtualAccountLimit: integer("virtual_account_limit").notNull().default(5),
  paymentLinkLimit: integer("payment_link_limit").notNull().default(10),
  payoutLimit: integer("payout_limit").notNull().default(20),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;
