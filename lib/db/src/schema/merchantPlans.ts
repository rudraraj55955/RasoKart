import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const merchantPlansTable = pgTable("merchant_plans", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull().unique(),
  planId: integer("plan_id").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  assignedBy: integer("assigned_by"),
  notes: text("notes"),
});

export const insertMerchantPlanSchema = createInsertSchema(merchantPlansTable).omit({ id: true, assignedAt: true });
export type InsertMerchantPlan = z.infer<typeof insertMerchantPlanSchema>;
export type MerchantPlan = typeof merchantPlansTable.$inferSelect;
