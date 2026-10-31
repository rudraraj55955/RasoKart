import {
  pgTable, serial, text, integer, boolean, timestamp,
  uniqueIndex, index, jsonb,
} from "drizzle-orm/pg-core";

/**
 * White-label platform data model. Additive definitions only.
 * Do not deploy or run schema push until legacy merchant ownership is backfilled,
 * all tenant-scoped routes are authorized, and cross-tenant tests pass.
 */
export const whiteLabelTenantsTable = pgTable("white_label_tenants", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("draft"), // draft | active | suspended | archived
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  slugUnique: uniqueIndex("wl_tenants_slug_unique").on(table.slug),
}));

export const whiteLabelDomainsTable = pgTable("white_label_domains", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => whiteLabelTenantsTable.id),
  hostname: text("hostname").notNull(),
  portalKind: text("portal_kind").notNull().default("admin"), // admin | merchant | public
  ownershipStatus: text("ownership_status").notNull().default("pending"),
  verificationTokenHash: text("verification_token_hash"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  tlsStatus: text("tls_status").notNull().default("pending"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  hostnameUnique: uniqueIndex("wl_domains_hostname_unique").on(table.hostname),
  tenantIdx: index("wl_domains_tenant_idx").on(table.tenantId),
}));

export const whiteLabelBrandingTable = pgTable("white_label_branding", {
  tenantId: integer("tenant_id").primaryKey().references(() => whiteLabelTenantsTable.id),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  primaryColor: text("primary_color").notNull().default("#172C54"),
  supportEmail: text("support_email"),
  settings: jsonb("settings"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whiteLabelMembershipsTable = pgTable("white_label_memberships", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => whiteLabelTenantsTable.id),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(), // owner | admin | finance | support | auditor
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  oneMembershipPerTenant: uniqueIndex("wl_membership_tenant_user_unique").on(table.tenantId, table.userId),
  userIdx: index("wl_membership_user_idx").on(table.userId),
}));

export const whiteLabelMerchantAssignmentsTable = pgTable("white_label_merchant_assignments", {
  merchantId: integer("merchant_id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => whiteLabelTenantsTable.id),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  tenantIdx: index("wl_merchant_tenant_idx").on(table.tenantId),
}));

export const whiteLabelFeaturesTable = pgTable("white_label_features", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => whiteLabelTenantsTable.id),
  featureKey: text("feature_key").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  limits: jsonb("limits"),
}, table => ({
  tenantFeatureUnique: uniqueIndex("wl_tenant_feature_unique").on(table.tenantId, table.featureKey),
}));
