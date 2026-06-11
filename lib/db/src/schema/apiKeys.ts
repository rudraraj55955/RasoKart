import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  apiKey: text("api_key").notNull().unique(),
  secretKey: text("secret_key").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({ id: true, createdAt: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeysTable.$inferSelect;
