/**
 * CANONICAL PATTERN — every gateway config panel MUST follow this:
 *
 *   const willDisable = computeWillDisable(<serverEnabled>, <localEnabled>);
 *   guardSave(willDisable, doSave);
 *
 *   where:
 *     serverEnabled = config?.enabled ?? false   (or integration.isEnabled for custom panels)
 *     localEnabled  = current toggle value in component state
 *
 * CALL-SITE REGISTRY — grep for `useDisableGatewayGuard` to keep this in sync.
 * Every row here has a corresponding describe block below.
 *
 *  Panel                   File                              handleSave() predicate
 *  ─────────────────────   ────────────────────────────────  ──────────────────────────────────────────────────────────
 *  EkqrConfigPanel         pages/admin/payment-gateways.tsx  computeWillDisable(ekqrConfig?.enabled ?? false, currentEnabled)
 *  CashfreeConfigPanel     pages/admin/payment-gateway.tsx   (config?.enabled ?? false) === true && currentEnabled === false
 *  SettingsTab (Payout)    pages/admin/payout-gateway.tsx    (config?.enabled ?? false) === true && currentEnabled === false
 *  CustomGatewayConfigPanel pages/admin/payment-gateways.tsx computeWillDisable(integration.isEnabled, enabled)
 *
 * Adding a new gateway panel?
 *   1. Call useDisableGatewayGuard in the panel.
 *   2. In handleSave(), compute willDisable using computeWillDisable(serverEnabled, localEnabled).
 *   3. Add a new row to the registry above.
 *   4. Add a new describe block in this file (copy any block below as a template).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeWillDisable } from "./disable-gateway-guard.ts";

describe("computeWillDisable — disable-gateway confirmation guard predicate", () => {
  describe("cases that SHOULD trigger the confirmation dialog", () => {
    it("returns true when an enabled gateway is being disabled (enable → disable)", () => {
      assert.equal(computeWillDisable(true, false), true);
    });
  });

  describe("cases that must NOT trigger the confirmation dialog", () => {
    it("returns false when a disabled gateway is being re-enabled (disable → enable)", () => {
      assert.equal(
        computeWillDisable(false, true),
        false,
        "Re-enabling a disabled gateway must not show the confirmation dialog",
      );
    });

    it("returns false when saving fields on an already-disabled gateway with toggle still OFF (disable → disable)", () => {
      assert.equal(
        computeWillDisable(false, false),
        false,
        "Saving unrelated fields while gateway is already disabled must not show the confirmation dialog",
      );
    });

    it("returns false when saving fields on an already-enabled gateway with toggle still ON (enable → enable)", () => {
      assert.equal(
        computeWillDisable(true, true),
        false,
        "Saving field changes without touching the enable toggle must not show the confirmation dialog",
      );
    });
  });
});

/**
 * EkqrConfigPanel — handleSave() invocation guard scenarios
 *
 * EkqrConfigPanel.handleSave() calls:
 *   const willDisable = computeWillDisable(ekqrConfig?.enabled ?? false, currentEnabled);
 *   guardSave(willDisable, () => saveConfig(...));
 *
 * "serverEnabled" comes from the API response (ekqrConfig.enabled).
 * "localEnabled"  is the current toggle state in the panel
 *   (ekqrEnabled !== null ? ekqrEnabled : ekqrConfig?.enabled ?? false).
 *
 * These tests confirm that the two scenarios that must NOT show the dialog —
 * re-enabling a disabled UPI gateway and saving other settings while it is
 * already disabled — evaluate to false, meaning guardSave calls save()
 * directly without opening the AlertDialog.
 */
describe("EkqrConfigPanel — handleSave() guard invocation scenarios", () => {
  describe("must NOT show the 'Disable Anyway' dialog", () => {
    it("re-enable: server is disabled, user toggles ON — computeWillDisable(false, true) === false", () => {
      const serverEnabled = false;
      const localEnabled = true;
      const willDisable = computeWillDisable(serverEnabled, localEnabled);
      assert.equal(
        willDisable,
        false,
        "Enabling a previously-disabled UPI gateway must not trigger the Disable confirmation dialog",
      );
    });

    it("save-while-disabled: server is disabled, user does not change toggle — computeWillDisable(false, false) === false", () => {
      const serverEnabled = false;
      const localEnabled = false;
      const willDisable = computeWillDisable(serverEnabled, localEnabled);
      assert.equal(
        willDisable,
        false,
        "Saving other settings (mode, API key, etc.) on an already-disabled UPI gateway must not trigger the Disable confirmation dialog",
      );
    });
  });

  describe("SHOULD show the 'Disable Anyway' dialog (positive control)", () => {
    it("disable: server is enabled, user toggles OFF — computeWillDisable(true, false) === true", () => {
      const serverEnabled = true;
      const localEnabled = false;
      const willDisable = computeWillDisable(serverEnabled, localEnabled);
      assert.equal(
        willDisable,
        true,
        "Disabling an actively-enabled UPI gateway MUST trigger the Disable confirmation dialog",
      );
    });
  });
});

/**
 * CashfreeConfigPanel (AdminPaymentGateway in payment-gateway.tsx) — handleSave() guard scenarios
 *
 * handleSave() computes:
 *   const willDisable = (config?.enabled ?? false) === true && currentEnabled === false;
 *   guardSave(willDisable, doSave);
 *
 * This is the same enable→disable-only predicate as computeWillDisable, so these
 * tests confirm the Cashfree Payin panel's disable guard behaves identically to
 * the Ekqr panel: re-enabling a disabled gateway, or saving unrelated field
 * changes (credentials, limits, collection methods) on an already-disabled
 * gateway, must never surface the "Disable Anyway" confirmation dialog.
 */
describe("CashfreeConfigPanel (Payin) — handleSave() guard invocation scenarios", () => {
  describe("must NOT show the 'Disable Anyway' dialog", () => {
    it("re-enable: server is disabled, user toggles ON — computeWillDisable(false, true) === false", () => {
      const serverEnabled = false;
      const currentEnabled = true;
      const willDisable = computeWillDisable(serverEnabled, currentEnabled);
      assert.equal(
        willDisable,
        false,
        "Enabling a previously-disabled Cashfree Payin gateway must not trigger the Disable confirmation dialog",
      );
    });

    it("save-while-disabled: server is disabled, user does not change toggle — computeWillDisable(false, false) === false", () => {
      const serverEnabled = false;
      const currentEnabled = false;
      const willDisable = computeWillDisable(serverEnabled, currentEnabled);
      assert.equal(
        willDisable,
        false,
        "Saving other settings (env, API version, limits, collection methods, credentials) on an already-disabled Cashfree Payin gateway must not trigger the Disable confirmation dialog",
      );
    });
  });

  describe("SHOULD show the 'Disable Anyway' dialog (positive control)", () => {
    it("disable: server is enabled, user toggles OFF — computeWillDisable(true, false) === true", () => {
      const serverEnabled = true;
      const currentEnabled = false;
      const willDisable = computeWillDisable(serverEnabled, currentEnabled);
      assert.equal(
        willDisable,
        true,
        "Disabling an actively-enabled Cashfree Payin gateway MUST trigger the Disable confirmation dialog",
      );
    });
  });
});

/**
 * SettingsTab (Cashfree Payout panel in payout-gateway.tsx) — handleSave() guard scenarios
 *
 * handleSave() computes:
 *   const willDisable = (config?.enabled ?? false) === true && currentEnabled === false;
 *   guardSave(willDisable, doSave);
 *
 * This is the identical enable→disable-only predicate used by the Cashfree Payin
 * panel and the shared computeWillDisable helper. These tests confirm the
 * Cashfree Payout panel's disable guard never fires spuriously: re-enabling a
 * previously-disabled payout gateway, or saving unrelated fields (env, limits,
 * credentials, merchant/bulk toggles, admin approval) while it is already
 * disabled, must never surface the "Disable Anyway" confirmation dialog.
 */
describe("CashfreeConfigPanel (Payout) — handleSave() guard invocation scenarios", () => {
  describe("must NOT show the 'Disable Anyway' dialog", () => {
    it("re-enable: server is disabled, user toggles ON — computeWillDisable(false, true) === false", () => {
      const serverEnabled = false;
      const currentEnabled = true;
      const willDisable = computeWillDisable(serverEnabled, currentEnabled);
      assert.equal(
        willDisable,
        false,
        "Enabling a previously-disabled Cashfree Payout gateway must not trigger the Disable confirmation dialog",
      );
    });

    it("save-while-disabled: server is disabled, user does not change toggle — computeWillDisable(false, false) === false", () => {
      const serverEnabled = false;
      const currentEnabled = false;
      const willDisable = computeWillDisable(serverEnabled, currentEnabled);
      assert.equal(
        willDisable,
        false,
        "Saving other settings (env, limits, credentials, merchant/bulk toggles, admin approval) on an already-disabled Cashfree Payout gateway must not trigger the Disable confirmation dialog",
      );
    });
  });

  describe("SHOULD show the 'Disable Anyway' dialog (positive control)", () => {
    it("disable: server is enabled, user toggles OFF — computeWillDisable(true, false) === true", () => {
      const serverEnabled = true;
      const currentEnabled = false;
      const willDisable = computeWillDisable(serverEnabled, currentEnabled);
      assert.equal(
        willDisable,
        true,
        "Disabling an actively-enabled Cashfree Payout gateway MUST trigger the Disable confirmation dialog",
      );
    });
  });
});

/**
 * CustomGatewayConfigPanel (Provider Integrations in payment-gateways.tsx) — handleSave() guard scenarios
 *
 * handleSave() computes:
 *   const willDisable = computeWillDisable(integration.isEnabled, enabled);
 *   guardSave(willDisable, doSave);
 *
 * `integration.isEnabled` is the server-side boolean from the ProviderIntegration
 * API response. `enabled` is the local React state initialised from
 * `integration.isEnabled` and updated when the admin flips the toggle.
 *
 * This is the identical enable→disable-only predicate used by all other panels.
 * These tests confirm the custom-gateway panel's disable guard never fires
 * spuriously: re-enabling a previously-disabled custom gateway, or saving
 * unrelated field changes (display name, credentials, webhook URL, notes)
 * while it is already disabled, must never surface the "Disable Anyway"
 * confirmation dialog.
 */
describe("CustomGatewayConfigPanel — handleSave() guard invocation scenarios", () => {
  describe("must NOT show the 'Disable Anyway' dialog", () => {
    it("re-enable: integration.isEnabled is false, user toggles ON — computeWillDisable(false, true) === false", () => {
      const serverEnabled = false;
      const localEnabled = true;
      const willDisable = computeWillDisable(serverEnabled, localEnabled);
      assert.equal(
        willDisable,
        false,
        "Enabling a previously-disabled custom gateway must not trigger the Disable confirmation dialog",
      );
    });

    it("save-while-disabled: integration.isEnabled is false, user does not change toggle — computeWillDisable(false, false) === false", () => {
      const serverEnabled = false;
      const localEnabled = false;
      const willDisable = computeWillDisable(serverEnabled, localEnabled);
      assert.equal(
        willDisable,
        false,
        "Saving other settings (display name, credentials, webhook URL, notes) on an already-disabled custom gateway must not trigger the Disable confirmation dialog",
      );
    });
  });

  describe("SHOULD show the 'Disable Anyway' dialog (positive control)", () => {
    it("disable: integration.isEnabled is true, user toggles OFF — computeWillDisable(true, false) === true", () => {
      const serverEnabled = true;
      const localEnabled = false;
      const willDisable = computeWillDisable(serverEnabled, localEnabled);
      assert.equal(
        willDisable,
        true,
        "Disabling an actively-enabled custom gateway MUST trigger the Disable confirmation dialog",
      );
    });
  });
});
