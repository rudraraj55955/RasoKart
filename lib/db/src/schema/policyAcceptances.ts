import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

export const policyAcceptancesTable = pgTable("policy_acceptances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  merchantId: integer("merchant_id"),
  policySlug: text("policy_slug").notNull(),
  policyVersion: text("policy_version").notNull().default("1.0"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("policy_acceptances_user_idx").on(table.userId, table.policySlug),
  index("policy_acceptances_merchant_idx").on(table.merchantId, table.policySlug),
]);

export type PolicyAcceptance = typeof policyAcceptancesTable.$inferSelect;
