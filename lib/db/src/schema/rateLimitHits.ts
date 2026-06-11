import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Persistent rate-limit counter store.
 *
 * Each row is keyed by `${ip}::${routeKey}` (or any string the middleware
 * chooses) and tracks the hit count within the current window.
 *
 * Expired rows accumulate over time and must be pruned by the scheduled
 * cleanup job (rateLimitCleanupScheduler) which runs every hour.
 */
export const rateLimitHitsTable = pgTable("rate_limit_hits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("rate_limit_hits_expires_at_idx").on(table.expiresAt),
]);

export type RateLimitHit = typeof rateLimitHitsTable.$inferSelect;
