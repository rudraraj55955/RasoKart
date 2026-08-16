/**
 * Connector Engine — Adapter Registry
 *
 * Maps provider slugs to their adapter implementations.
 *
 * HOW TO REGISTER A NEW PROVIDER:
 *   1. Create adapters/<slug>.ts implementing ProviderAdapter
 *   2. Import it here and add it to ADAPTER_REGISTRY
 *   3. Add the provider row to seed.ts (matching slug)
 *   No other code changes are required.
 *
 * The engine dispatches to the adapter by slug at runtime. An unregistered
 * slug returns null from getAdapter(), which the engine treats as BLOCKED.
 */

import type { ProviderAdapter } from "../types";
import { pineLabsOneAdapter } from "./pinelabs-one";
import { razorpayAdapter } from "./razorpay";

/**
 * All registered provider adapters, keyed by their slug.
 * New adapters must be added here to be discoverable by the engine.
 */
const ADAPTER_REGISTRY: Record<string, ProviderAdapter> = {
  pinelabs_one: pineLabsOneAdapter,
  razorpay:     razorpayAdapter,
  // phonepay_merchant: phonepayMerchantAdapter,   // future
  // paytm_merchant:    paytmMerchantAdapter,       // future
};

/**
 * Returns the adapter for the given provider slug, or null if not registered.
 *
 * The engine treats null as BLOCKED — the connection will be kept disabled
 * and the admin UI will show "No adapter registered for this provider".
 */
export function getAdapter(slug: string): ProviderAdapter | null {
  return ADAPTER_REGISTRY[slug] ?? null;
}

/**
 * Returns all registered adapter slugs.
 * Used by the admin UI to determine which platform_connections rows
 * are portal-session-capable vs. API-key-only.
 */
export function getRegisteredSlugs(): string[] {
  return Object.keys(ADAPTER_REGISTRY);
}

/**
 * Returns whether a given slug has a registered adapter.
 */
export function isPortalProvider(slug: string): boolean {
  return slug in ADAPTER_REGISTRY;
}
