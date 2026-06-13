import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Append-only audit trail of every approve/reject action on a KYC document.
 * Intentionally no foreign key cascade on kycId — history must survive
 * document deletion so admins can audit past decisions even after a merchant
 * resubmits.
 */
export const kycReviewHistoryTable = pgTable(
  "kyc_review_history",
  {
    id: serial("id").primaryKey(),
    kycId: integer("kyc_id").notNull(),
    reviewedBy: integer("reviewed_by").notNull(),
    status: text("status").notNull(), // approved | rejected
    adminNote: text("admin_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("kyc_review_history_kyc_id_idx").on(table.kycId),
  ]
);

export type KycReviewHistory = typeof kycReviewHistoryTable.$inferSelect;
