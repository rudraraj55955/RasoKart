import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const rateLimitHitsTable = pgTable("rate_limit_hits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type RateLimitHit = typeof rateLimitHitsTable.$inferSelect;
