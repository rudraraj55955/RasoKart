/**
 * GATEWAY PANELS REGISTRY
 *
 * Single source of truth for the disable-gateway guard enforcement check.
 * This module is imported by `gateway-panel-coverage.test.ts`, which
 * automatically fails the test suite whenever a new file calls a gateway
 * save mutation without also calling `useDisableGatewayGuard`.
 *
 * HOW TO ADD A NEW GATEWAY PANEL
 * ────────────────────────────────
 *  1. Create your component in src/pages/admin/.
 *  2. Call `useDisableGatewayGuard` inside the component (follow the pattern
 *     in any file in GATEWAY_PANEL_FILES below).
 *  3. In handleSave(), call `guardSave(computeWillDisable(serverEnabled, localEnabled), doSave)`.
 *  4. Add the relative file path (from artifacts/rpay/) to GATEWAY_PANEL_FILES.
 *  5. Add a row to the call-site registry table in disable-gateway-guard.test.ts.
 *  6. Run `cd artifacts/rpay && node --import tsx/esm --test src/lib/gateway-panel-coverage.test.ts`
 *     to confirm the check passes.
 *
 * NOTE ON ALIASES
 * ───────────────
 * The coverage test uses call-site regex (`\bhook\s*\(`) to detect usages.
 * If a file imports a hook under an alias (e.g., `useUpdateCashfreeConfig as
 * useUpdatePayinGatewayConfig`) the original hook name will appear in the
 * import statement but NOT as a call-site. In that case, add the alias to
 * GATEWAY_SAVE_MUTATIONS as well so the scan picks up both patterns.
 */

/**
 * Hook names that indicate a component is performing a gateway-config save.
 *
 * The coverage test scans all admin TSX files and checks for call-site
 * occurrences — regex `\b<hook>\s*\(` — so import-only references are
 * not flagged. Any file that calls one of these hooks must either be listed
 * in GATEWAY_PANEL_FILES (and call useDisableGatewayGuard) or be explicitly
 * acknowledged in GATEWAY_PANEL_KNOWN_GAPS.
 *
 * When adding a new gateway save hook, add it here. Include any locally
 * aliased names (e.g. `useUpdatePayinGatewayConfig`) alongside the generated
 * name (e.g. `useUpdateCashfreeConfig`) so aliased call-sites are detected.
 */
export const GATEWAY_SAVE_MUTATIONS = [
  // EKQR / UPI inline config (payment-gateways.tsx EkqrConfigPanel, providers.tsx)
  "useUpdateEkqrConfig",
  // Custom / provider integrations (payment-gateways.tsx CustomGatewayConfigPanel)
  "useUpdateProviderIntegration",
  // Cashfree payin config (payment-gateway.tsx — imported as useUpdatePayinGatewayConfig)
  "useUpdateCashfreeConfig",
  "useUpdatePayinGatewayConfig",
  // Cashfree payout config (payout-gateway.tsx SettingsTab)
  "useUpdatePayoutGatewayConfig",
  // UPIGateway payin config (payment-gateways.tsx UPIGatewaySettingsPanel — see KNOWN_GAPS)
  "useUpdateUpigatewaySettings",
] as const;

export type GatewaySaveMutation = (typeof GATEWAY_SAVE_MUTATIONS)[number];

/**
 * Canonical list of gateway config panel files.
 * All paths are relative to artifacts/rpay/.
 *
 * Each file MUST call `useDisableGatewayGuard` — the coverage test verifies
 * this automatically on every run.
 */
export const GATEWAY_PANEL_FILES = [
  "src/pages/admin/payment-gateways.tsx",
  "src/pages/admin/payment-gateway.tsx",
  "src/pages/admin/payout-gateway.tsx",
] as const;

export type GatewayPanelFile = (typeof GATEWAY_PANEL_FILES)[number];

/**
 * Files that call a gateway save mutation but intentionally skip the guard.
 *
 * These represent known gaps or non-panel usages. Before adding an entry here,
 * ask whether the file should actually be migrated to the full panel pattern
 * instead. Every entry must have a clear reason.
 *
 * Keys are relative paths from artifacts/rpay/.
 */
export const GATEWAY_PANEL_KNOWN_GAPS: Record<string, string> = {
  "src/pages/admin/providers.tsx":
    "TODO: contains an inline EKQR enable-toggle + save button that pre-dates " +
    "the useDisableGatewayGuard pattern. Disabling the gateway via this panel " +
    "skips the 'Disable Anyway' confirmation dialog. Should be migrated to " +
    "useDisableGatewayGuard (or the duplicate EKQR section removed in favour " +
    "of the canonical panel in payment-gateways.tsx).",

  // payment-gateways.tsx hosts multiple panels. The file as a whole IS registered
  // (GATEWAY_PANEL_FILES above) and calls useDisableGatewayGuard for EkqrConfigPanel
  // and CustomGatewayConfigPanel. However it also contains UPIGatewaySettingsPanel
  // (useUpdateUpigatewaySettings) which currently skips the guard. The file-level
  // registration passes because the guard IS present elsewhere in the file.
  // This note documents the intra-file gap for the panel-level fix.
  //
  // ACTION REQUIRED: UPIGatewaySettingsPanel in payment-gateways.tsx should be
  // migrated to useDisableGatewayGuard so every save path is guarded.
  //
  // NOTE: this key is intentionally absent — payment-gateways.tsx is already in
  // GATEWAY_PANEL_FILES so a KNOWN_GAPS entry would be unreachable. The comment
  // above serves as the paper trail.
};
