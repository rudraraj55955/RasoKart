import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const credentialEventsTable = pgTable("credential_events", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  eventType: text("event_type").notNull(), // merchant_login | api_key_generated | api_key_revoked | callback_secret_rotated | ip_trusted
  actorId: integer("actor_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  keyPrefix: text("key_prefix"), // populated for api_key_* events
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CredentialEvent = typeof credentialEventsTable.$inferSelect;
