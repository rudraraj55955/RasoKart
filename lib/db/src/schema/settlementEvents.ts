import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const settlementEventsTable = pgTable("settlement_events", {
  id: serial("id").primaryKey(),
  settlementId: integer("settlement_id").notNull(),
  event: text("event").notNull(), // requested | processing | approved | rejected | paid | held
  actorId: integer("actor_id"),
  actorEmail: text("actor_email"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
