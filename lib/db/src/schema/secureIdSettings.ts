import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const secureIdSettingsTable = pgTable("secure_id_settings", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull().default("test"),
  clientIdEncrypted: text("client_id_encrypted"),
  clientIdIv: text("client_id_iv"),
  clientIdTag: text("client_id_tag"),
  clientSecretEncrypted: text("client_secret_encrypted"),
  clientSecretIv: text("client_secret_iv"),
  clientSecretTag: text("client_secret_tag"),
  apiVersion: text("api_version").notNull().default("2023-08-01"),
  onboardingEnabled: boolean("onboarding_enabled").notNull().default(false),
  panEnabled: boolean("pan_enabled").notNull().default(true),
  gstEnabled: boolean("gst_enabled").notNull().default(true),
  cinEnabled: boolean("cin_enabled").notNull().default(false),
  bankEnabled: boolean("bank_enabled").notNull().default(true),
  ocrEnabled: boolean("ocr_enabled").notNull().default(false),
  updatedByEmail: text("updated_by_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSecureIdSettingsSchema = createInsertSchema(secureIdSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSecureIdSettings = z.infer<typeof insertSecureIdSettingsSchema>;
export type SecureIdSettings = typeof secureIdSettingsTable.$inferSelect;
