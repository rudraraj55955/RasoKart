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
