import { pgTable, serial, text, boolean, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const moduleVisibilityTable = pgTable("module_visibility", {
  id: serial("id").primaryKey(),
  moduleName: text("module_name").notNull(),
  entityType: text("entity_type").notNull(), // "merchant" | "customer"
  entityId: integer("entity_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  updatedByAdminId: integer("updated_by_admin_id"),
  updatedByAdminEmail: text("updated_by_admin_email"),
}, (t) => ({
  uniq: unique("module_visibility_uniq").on(t.moduleName, t.entityType, t.entityId),
}));

export const insertModuleVisibilitySchema = createInsertSchema(moduleVisibilityTable).omit({ id: true, updatedAt: true });
export type InsertModuleVisibility = z.infer<typeof insertModuleVisibilitySchema>;
export type ModuleVisibility = typeof moduleVisibilityTable.$inferSelect;
