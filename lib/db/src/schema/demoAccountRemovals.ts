import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Persistent, DB-backed record of demo merchant accounts an admin has
 * explicitly removed from the admin portal (see Merchants > Remove demo
 * account). This is the environment-independent replacement for manually
 * setting the SEED_EXCLUDE_DEMO_EMAILS env var + deleting rows over SQL —
 * seed.ts checks this table (in addition to the env var, which remains
 * supported for scripted/ops use) so a removal survives server restarts
 * without any shell/DB access.
 */
export const demoAccountRemovalsTable = pgTable("demo_account_removals", {
  email: text("email").primaryKey(),
  removedByAdminId: integer("removed_by_admin_id"),
  removedByEmail: text("removed_by_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDemoAccountRemovalSchema = createInsertSchema(demoAccountRemovalsTable).omit({ createdAt: true });
export type InsertDemoAccountRemoval = z.infer<typeof insertDemoAccountRemovalSchema>;
export type DemoAccountRemoval = typeof demoAccountRemovalsTable.$inferSelect;
