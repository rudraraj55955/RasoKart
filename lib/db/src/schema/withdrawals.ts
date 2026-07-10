import { pgTable, text, serial, timestamp, numeric, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const withdrawalsTable = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  merchantId: integer("merchant_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  // New payout-system fields
  transferStatus: text("transfer_status").notNull().default("NOT_STARTED"), // NOT_STARTED | INITIATED | PENDING | SUCCESS | FAILED | REVERSED
  providerReferenceId: text("provider_reference_id"),
  utr: text("utr"),
  failureReason: text("failure_reason"),
  approvedByAdminId: integer("approved_by_admin_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  payoutMode: text("payout_mode").notNull().default("IMPS"), // IMPS | NEFT | RTGS | UPI
  upiId: text("upi_id"),
  remarks: text("remarks"),
  // Bank details (snapshot at request time, for audit/history — the
  // authoritative beneficiary lives in payout_beneficiaries)
  bankAccount: text("bank_account").notNull(),
  bankName: text("bank_name").notNull(),
  ifscCode: text("ifsc_code").notNull(),
  accountHolder: text("account_holder").notNull(),
  // References payoutBeneficiariesTable.id — the saved beneficiary used for
  // this payout (nullable for legacy rows created before this field existed).
  beneficiaryId: integer("beneficiary_id"),
  rejectionReason: text("rejection_reason"),
  rejectedByAdminId: integer("rejected_by_admin_id"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  // Auto-approval tracking
  approvalType: text("approval_type").notNull().default("MANUAL"), // MANUAL | AUTO
  approvedBySystem: boolean("approved_by_system").notNull().default(false),
  autoApprovalRuleSnapshot: jsonb("auto_approval_rule_snapshot"),
  approvedBy: text("approved_by"), // admin email or "SYSTEM_AUTO"
  // Client-supplied idempotency key (per merchant) to make double-submit /
  // double-click of the "New Payout" form a no-op instead of creating a
  // second payout request. Nullable — legacy/no-key requests still work.
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWithdrawalSchema = createInsertSchema(withdrawalsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawalsTable.$inferSelect;
