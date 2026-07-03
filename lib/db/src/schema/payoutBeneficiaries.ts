import { pgTable, serial, varchar, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Tracks the Cashfree Payouts V2 beneficiary_id we registered for a given
 * merchant + bank/UPI detail combination, so we never guess or recompute an
 * ID that may not actually exist on Cashfree's side (root cause of the
 * "beneficiary_not_found" transfer failures).
 *
 * `beneficiaryKey` is a deterministic fingerprint of the payout destination
 * (bank account + IFSC, or UPI VPA) scoped to merchant + environment, used
 * to look up an already-registered beneficiary before creating a new one.
 */
export const payoutBeneficiariesTable = pgTable(
  "payout_beneficiaries",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull(),
    env: text("env").notNull(), // test | live
    payoutMode: text("payout_mode").notNull(), // IMPS | NEFT | RTGS | UPI
    beneficiaryKey: varchar("beneficiary_key", { length: 120 }).notNull(),
    providerBeneficiaryId: varchar("provider_beneficiary_id", { length: 64 }).notNull(),
    status: text("status").notNull().default("active"), // active | failed
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("payout_beneficiaries_merchant_env_key_unique").on(t.merchantId, t.env, t.beneficiaryKey)]
);

export const insertPayoutBeneficiarySchema = createInsertSchema(payoutBeneficiariesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPayoutBeneficiary = z.infer<typeof insertPayoutBeneficiarySchema>;
export type PayoutBeneficiary = typeof payoutBeneficiariesTable.$inferSelect;
