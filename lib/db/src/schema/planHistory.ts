import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const planHistoryTable = pgTable("plan_history", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  fromPlanId: integer("from_plan_id"),
  toPlanId: integer("to_plan_id"),
  action: text("action").notNull(),
  assignedBy: integer("assigned_by"),
  adminEmail: text("admin_email"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlanHistory = typeof planHistoryTable.$inferSelect;
