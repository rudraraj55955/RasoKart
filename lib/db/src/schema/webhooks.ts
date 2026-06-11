import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const webhooksTable = pgTable("webhooks", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull().unique(),
  url: text("url").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  events: text("events").array().notNull().default([]),
  secret: text("secret"),
  secretRotatedAt: timestamp("secret_rotated_at", { withTimezone: true }),
  maxRetries: integer("max_retries").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWebhookSchema = createInsertSchema(webhooksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWebhook = z.infer<typeof insertWebhookSchema>;
export type Webhook = typeof webhooksTable.$inferSelect;
