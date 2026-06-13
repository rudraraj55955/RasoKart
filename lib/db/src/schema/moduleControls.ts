import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const moduleControlsTable = pgTable("module_controls", {
  id: serial("id").primaryKey(),
  moduleName: text("module_name").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  label: text("label").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  updatedByAdminId: integer("updated_by_admin_id"),
  updatedByAdminEmail: text("updated_by_admin_email"),
});

export const insertModuleControlSchema = createInsertSchema(moduleControlsTable).omit({ id: true, updatedAt: true });
export type InsertModuleControl = z.infer<typeof insertModuleControlSchema>;
export type ModuleControl = typeof moduleControlsTable.$inferSelect;
