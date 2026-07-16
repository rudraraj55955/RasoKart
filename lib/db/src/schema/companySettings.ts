import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companySettingsTable = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  supportPhone: text("support_phone").notNull(),
  supportEmail: text("support_email"),
  whatsappPhone: text("whatsapp_phone"),
  companyAddress: text("company_address"),
  footerText: text("footer_text"),
  grievanceOfficerName: text("grievance_officer_name"),
  updatedBy: integer("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCompanySettingsSchema = createInsertSchema(companySettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type CompanySettings = typeof companySettingsTable.$inferSelect;

export const COMPANY_SETTINGS_DEFAULTS = {
  companyName: "Nickey Collection Private Limited",
  supportPhone: "9358774496",
  supportEmail: null as string | null,
  whatsappPhone: null as string | null,
  companyAddress: null as string | null,
  footerText: null as string | null,
} as const;
