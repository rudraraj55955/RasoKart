import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildUpiId, buildUpiUrl, getBankHandle } from "./upi.ts";

describe("getBankHandle", () => {
  it("maps known IFSC prefixes to their registered UPI handle", () => {
    assert.equal(getBankHandle("HDFC0001234"), "hdfc");
    assert.equal(getBankHandle("ICIC0001234"), "icici");
    assert.equal(getBankHandle("SBIN0001234"), "sbi");
    assert.equal(getBankHandle("UTIB0001234"), "axisbank");
    assert.equal(getBankHandle("KKBK0001234"), "kotak");
    assert.equal(getBankHandle("YESB0001234"), "yesbank");
    assert.equal(getBankHandle("IDFB0001234"), "idfcbank");
    assert.equal(getBankHandle("RATN0001234"), "rblbank");
    assert.equal(getBankHandle("FDRL0001234"), "federalbank");
  });

  it("falls back to lowercased 4-char prefix for unknown banks", () => {
    assert.equal(getBankHandle("XYZB0001234"), "xyzb");
  });

  it("is case-insensitive for the IFSC input", () => {
    assert.equal(getBankHandle("hdfc0001234"), "hdfc");
    assert.equal(getBankHandle("Icic0001234"), "icici");
  });
});

describe("buildUpiId", () => {
  it("produces {accountNumber}@{bankHandle} format — not full IFSC", () => {
    assert.equal(
      buildUpiId("9876543210001234", "HDFC0001234"),
      "9876543210001234@hdfc",
    );
  });

  it("uses the UPI handle, not the full IFSC string", () => {
    const upiId = buildUpiId("1234567890", "ICIC0000001");
    assert.ok(!upiId.includes("ICIC0000001"), "Should not contain raw IFSC");
    assert.equal(upiId, "1234567890@icici");
  });

  it("works for SBI", () => {
    assert.equal(
      buildUpiId("000123456789", "SBIN0012345"),
      "000123456789@sbi",
    );
  });

  it("works for Axis Bank (UTIB prefix)", () => {
    assert.equal(
      buildUpiId("555000123456", "UTIB0000001"),
      "555000123456@axisbank",
    );
  });
});

describe("buildUpiUrl", () => {
  it("produces a valid UPI deep-link with pa, pn, and cu=INR params", () => {
    const url = buildUpiUrl("9876543210001234", "HDFC0001234", "TechMart Pvt Ltd");
    assert.ok(url.startsWith("upi://pay?"), `Expected upi:// scheme, got: ${url}`);
    assert.ok(url.includes("pa="), "Missing pa param");
    assert.ok(url.includes("pn="), "Missing pn param");
    assert.ok(url.includes("cu=INR"), "Missing cu=INR param");
    assert.ok(
      url.includes(encodeURIComponent("9876543210001234@hdfc")),
      "Must contain encoded VPA with bank handle (not full IFSC)",
    );
  });

  it("URL-encodes special characters in payee name", () => {
    const url = buildUpiUrl("111", "ICIC0001234", "Raj & Sons");
    assert.ok(
      url.includes(encodeURIComponent("Raj & Sons")),
      `Special chars must be encoded, url: ${url}`,
    );
  });

  it("URL-encodes the UPI ID in the pa param", () => {
    const url = buildUpiUrl("9999", "HDFC0001234", "Test");
    assert.ok(
      url.includes("pa=" + encodeURIComponent("9999@hdfc")),
    );
  });
});
