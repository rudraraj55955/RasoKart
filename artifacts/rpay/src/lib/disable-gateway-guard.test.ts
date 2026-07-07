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
