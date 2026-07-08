import { pgTable, serial, varchar, text, boolean, numeric, timestamp } from "drizzle-orm/pg-core";

export const providerIntegrationsTable = pgTable("provider_integrations", {
  id: serial("id").primaryKey(),
  providerKey: varchar("provider_key", { length: 64 }).notNull().unique(),
  providerNameInternal: varchar("provider_name_internal", { length: 255 }).notNull(),
  displayNamePublic: varchar("display_name_public", { length: 255 }).notNull(),
  environment: text("environment").notNull().default("test"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  productType: varchar("product_type", { length: 100 }),
  webhookUrl: text("webhook_url"),
  notes: text("notes"),
  isCustom: boolean("is_custom").notNull().default(false),
  apiKeyEncrypted: text("api_key_encrypted"),
  apiSecretEncrypted: text("api_secret_encrypted"),
  webhookSecretEncrypted: text("webhook_secret_encrypted"),
  apiBaseUrl: text("api_base_url"),
  clientIdEncrypted: text("client_id_encrypted"),
  clientSecretEncrypted: text("client_secret_encrypted"),
  minAmount: numeric("min_amount", { precision: 18, scale: 2 }),
  maxAmount: numeric("max_amount", { precision: 18, scale: 2 }),
  dailyLimit: numeric("daily_limit", { precision: 18, scale: 2 }),
  supportsDynamicQr: boolean("supports_dynamic_qr").notNull().default(false),
  supportsStaticQr: boolean("supports_static_qr").notNull().default(false),
  supportsPaymentLinks: boolean("supports_payment_links").notNull().default(false),
  supportsWebhooks: boolean("supports_webhooks").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  updatedByEmail: varchar("updated_by_email", { length: 255 }),
  collectionType: text("collection_type").notNull().default("api_gateway"),
  ownUpiId: text("own_upi_id"),
  ownQrImageUrl: text("own_qr_image_url"),
  ownAccountHolder: text("own_account_holder"),
  ownInstructions: text("own_instructions"),
});

export type ProviderIntegration = typeof providerIntegrationsTable.$inferSelect;
export type ProviderIntegrationInsert = typeof providerIntegrationsTable.$inferInsert;
