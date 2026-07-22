import { pgTable, serial, varchar, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const CAPABILITY_STATUS = {
  CONFIGURED:               "CONFIGURED",
  TESTED:                   "TESTED",
  LIVE:                     "LIVE",
  DISABLED:                 "DISABLED",
  APPROVAL_REQUIRED:        "APPROVAL_REQUIRED",
  VERIFICATION_REQUIRED:    "VERIFICATION_REQUIRED",
  DASHBOARD_ONLY:           "DASHBOARD_ONLY",
  NOT_SUPPORTED_BY_API:     "NOT_SUPPORTED_BY_API",
  ERROR:                    "ERROR",
} as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUS)[keyof typeof CAPABILITY_STATUS];

export const providerProductsTable = pgTable("provider_products", {
  id: serial("id").primaryKey(),
  providerKey: varchar("provider_key", { length: 64 }),
  productKey: varchar("product_key", { length: 64 }).notNull().unique(),
  publicName: varchar("public_name", { length: 255 }).notNull(),
  internalName: varchar("internal_name", { length: 255 }),
  description: text("description"),
  iconKey: varchar("icon_key", { length: 64 }),
  isEnabled: boolean("is_enabled").notNull().default(true),
  status: varchar("status", { length: 32 }).notNull().default("coming_soon"),
  sortOrder: integer("sort_order").notNull().default(0),

  // ── Capability audit columns (added for Razorpay product matrix) ──────
  capabilityStatus: varchar("capability_status", { length: 64 }),
  officialApiAvailable: boolean("official_api_available"),
  officialSdkAvailable: boolean("official_sdk_available"),
  testModeStatus: varchar("test_mode_status", { length: 64 }),
  liveModeStatus: varchar("live_mode_status", { length: 64 }),
  webhookSupport: boolean("webhook_support"),
  webhookEvents: jsonb("webhook_events"),
  approvalRequired: boolean("approval_required"),
  approvalReason: text("approval_reason"),
  merchantAccess: boolean("merchant_access"),
  customerFacingModule: boolean("customer_facing_module"),
  lastTestAt: timestamp("last_test_at", { withTimezone: true }),
  lastFailAt: timestamp("last_fail_at", { withTimezone: true }),
  lastTestResponse: jsonb("last_test_response"),
  failureReason: text("failure_reason"),
  implNotes: text("impl_notes"),
  docsUrl: text("docs_url"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ProviderProduct = typeof providerProductsTable.$inferSelect;
export type ProviderProductInsert = typeof providerProductsTable.$inferInsert;
