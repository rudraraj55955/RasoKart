import { pgTable, text, serial, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const uploadedObjectsTable = pgTable(
  "uploaded_objects",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull(),
    contentHash: text("content_hash"),
    objectPath: text("object_path").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uploaded_objects_merchant_hash_unique").on(table.merchantId, table.contentHash),
    index("uploaded_objects_merchant_id_idx").on(table.merchantId),
  ]
);

export const insertUploadedObjectSchema = createInsertSchema(uploadedObjectsTable).omit({ id: true, createdAt: true });
export type InsertUploadedObject = z.infer<typeof insertUploadedObjectSchema>;
export type UploadedObject = typeof uploadedObjectsTable.$inferSelect;
