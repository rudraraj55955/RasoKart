import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Progressive soft-lock state for OTP / forgot-password identifiers.
 *
 * Each row tracks how many consecutive per-hour windows have been fully
 * exhausted for a given identifier hash. Once the threshold is crossed a
 * `locked_until` timestamp is set; the lock escalates in duration with each
 * additional exhaustion and expires automatically — no manual admin action
 * required.
 */
export const merchantAuthLocksTable = pgTable("merchant_auth_locks", {
  identifierHash: text("identifier_hash").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  windowExhaustionCount: integer("window_exhaustion_count").notNull().default(0),
  /** Timestamp of the most recent window-exhaustion event. Used to reset the
   *  counter when a full rate-limit window passes without exhaustion. */
  lastExhaustionAt: timestamp("last_exhaustion_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MerchantAuthLock = typeof merchantAuthLocksTable.$inferSelect;
