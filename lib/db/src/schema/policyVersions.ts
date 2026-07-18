import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const policyVersionsTable = pgTable("policy_versions", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  versionTag: text("version_tag").notNull().default("1.0"),
  title: text("title").notNull(),
  status: text("status").notNull().default("published"),
  effectiveDate: text("effective_date").notNull(),
  changelogNotes: text("changelog_notes"),
  updatedByEmail: text("updated_by_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (table) => [
  index("policy_versions_slug_status_idx").on(table.slug, table.status),
  index("policy_versions_slug_created_idx").on(table.slug, table.createdAt),
]);

export type PolicyVersion = typeof policyVersionsTable.$inferSelect;
export type NewPolicyVersion = typeof policyVersionsTable.$inferInsert;
