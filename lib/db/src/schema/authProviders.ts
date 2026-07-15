import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Stores one row per (user, provider) pair so a single account can have
 * multiple OAuth providers linked to it.  The providerAccountId is the
 * stable identifier returned by the OAuth provider (e.g. Google's "sub").
 */
export const authProvidersTable = pgTable("auth_providers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  provider: text("provider").notNull(), // google | apple | microsoft | facebook
  providerAccountId: text("provider_account_id").notNull(),
  email: text("email"), // email returned by the provider at link time (normalised)
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  unlinkedAt: timestamp("unlinked_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertAuthProviderSchema = createInsertSchema(authProvidersTable).omit({ id: true, linkedAt: true });
export type InsertAuthProvider = z.infer<typeof insertAuthProviderSchema>;
export type AuthProvider = typeof authProvidersTable.$inferSelect;

/**
 * Super-Admin–controlled toggle for each social provider.
 * One row per provider name; missing row = disabled.
 */
export const socialProviderSettingsTable = pgTable("social_provider_settings", {
  provider: text("provider").primaryKey(), // google | apple | microsoft | facebook
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  updatedByEmail: text("updated_by_email"),
});

export type SocialProviderSetting = typeof socialProviderSettingsTable.$inferSelect;
