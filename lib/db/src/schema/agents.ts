import { pgTable, serial, text, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: text("name").notNull(),
  mobile: text("mobile").notNull(),
  email: text("email").notNull().unique(),
  referralCode: text("referral_code").notNull().unique(),
  status: text("status").notNull().default("active"),
  walletBalance: numeric("wallet_balance", { precision: 18, scale: 2 }).notNull().default("0"),
  totalCommissionEarned: numeric("total_commission_earned", { precision: 18, scale: 2 }).notNull().default("0"),
  totalCommissionPaid: numeric("total_commission_paid", { precision: 18, scale: 2 }).notNull().default("0"),
  createdByAdminId: integer("created_by_admin_id"),
  notes: text("notes"),
  // Extended agent profile fields (all nullable for backward compat)
  agentCode: text("agent_code").unique(),
  employeeId: text("employee_id"),
  department: text("department"),
  team: text("team"),
  reportingManager: text("reporting_manager"),
  // Invite / first-login flow
  inviteToken: text("invite_token"),
  inviteTokenExpiry: timestamp("invite_token_expiry", { withTimezone: true }),
  inviteStatus: text("invite_status").notNull().default("pending"),
  firstLoginAt: timestamp("first_login_at", { withTimezone: true }),
  passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
