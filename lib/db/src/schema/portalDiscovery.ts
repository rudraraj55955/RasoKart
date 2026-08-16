import { pgTable, serial, text, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { platformConnectionsTable } from "./platformConnections";
import { portalSessionsTable } from "./portalSessions";

/**
 * PORTAL_DISCOVERED_ENTITIES — merchants, stores, devices, and QR codes
 * discovered from an authenticated portal session.
 *
 * Written only by the connector engine after a successful discoverEntities()
 * call. Read-only for all other paths. Each row represents one logical entity
 * as identified by the provider's own portal.
 *
 * entity_type values:
 *   merchant      — top-level merchant account
 *   store         — physical or virtual store under a merchant
 *   device        — POS terminal / EDC machine
 *   qr            — static or dynamic QR code bound to store/device
 *   staff_account — sub-user / staff login discovered under the account
 */

export const PORTAL_ENTITY_TYPE = [
  "merchant",
  "store",
  "device",
  "qr",
  "staff_account",
] as const;
export type PortalEntityType = (typeof PORTAL_ENTITY_TYPE)[number];

export const portalDiscoveryTable = pgTable(
  "portal_discovered_entities",
  {
    id: serial("id").primaryKey(),

    platformConnectionId: integer("platform_connection_id")
      .notNull()
      .references(() => platformConnectionsTable.id, { onDelete: "cascade" }),

    portalSessionId: integer("portal_session_id")
      .notNull()
      .references(() => portalSessionsTable.id, { onDelete: "cascade" }),

    /** "merchant" | "store" | "device" | "qr" | "staff_account" */
    entityType: text("entity_type").notNull(),

    /** ID as returned by the provider portal (e.g. Pine Labs ONE Merchant ID) */
    providerEntityId: text("provider_entity_id").notNull(),

    /** Human-readable name as returned by the portal */
    providerEntityName: text("provider_entity_name"),

    /** Optional parent entity ID (e.g. store's parent merchant ID) */
    parentEntityId: text("parent_entity_id"),

    /** True if this is the primary / account-level entity */
    isPrimary: boolean("is_primary").notNull().default(false),

    /**
     * JSON blob of raw discovery data from the portal.
     * Stored as plain JSON (not encrypted) — contains no credentials,
     * only publicly visible entity metadata.
     */
    metadata: text("metadata"),

    /** True while the entity is still observed as active in latest discovery */
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("portal_discovery_connection_idx").on(table.platformConnectionId),
    index("portal_discovery_session_idx").on(table.portalSessionId),
    index("portal_discovery_entity_type_idx").on(table.entityType),
  ],
);

export type PortalDiscoveredEntity = typeof portalDiscoveryTable.$inferSelect;
