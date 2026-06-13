import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { merchantsTable } from "./merchants";
import { merchantVerificationsTable } from "./merchantVerifications";

export const DOCUMENT_TYPES = [
  "pan",
  "gst",
  "bank_statement",
  "address_proof",
  "business_registration",
  "cancelled_cheque",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const merchantDocumentsTable = pgTable(
  "merchant_documents",
  {
    id: serial("id").primaryKey(),
    verificationId: integer("verification_id").notNull().references(() => merchantVerificationsTable.id, { onDelete: "cascade" }),
    merchantId: integer("merchant_id").notNull().references(() => merchantsTable.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull(),
    fileUrl: text("file_url").notNull(),
    fileName: text("file_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("merchant_documents_verification_id_idx").on(table.verificationId),
    index("merchant_documents_merchant_id_idx").on(table.merchantId),
  ]
);

export const insertMerchantDocumentSchema = createInsertSchema(merchantDocumentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMerchantDocument = z.infer<typeof insertMerchantDocumentSchema>;
export type MerchantDocument = typeof merchantDocumentsTable.$inferSelect;
