import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Persistent nonce store for callback replay-attack prevention.
 *
 * Each row is keyed by `${merchantId}:${nonce}` and carries an explicit
 * `expiresAt` timestamp.  Expired rows are pruned lazily by the middleware
 * on every successful write.
 *
 * Using Postgres (instead of an in-memory Map) means:
 *  - Nonces survive server restarts.
 *  - Replay protection works correctly across multiple server instances.
 */
export const callbackNoncesTable = pgTable("callback_nonces", {
  key: text("key").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type CallbackNonce = typeof callbackNoncesTable.$inferSelect;
