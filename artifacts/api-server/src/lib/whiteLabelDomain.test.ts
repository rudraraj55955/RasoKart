import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTenantHostname, resolveVerifiedWhiteLabelDomain } from "./whiteLabelDomain.ts";

const verified = {
  hostname: "pay.company.example",
  tenantId: 18,
  ownershipStatus: "verified" as const,
  tenantStatus: "active" as const,
};

test("exact verified domain resolves candidate tenant", () => {
  assert.equal(resolveVerifiedWhiteLabelDomain("PAY.Company.Example", [verified]), 18);
  assert.equal(resolveVerifiedWhiteLabelDomain("other.company.example", [verified]), null);
  assert.equal(resolveVerifiedWhiteLabelDomain("fakepay.company.example", [verified]), null);
});

test("unverified, suspended and duplicate records fail closed", () => {
  assert.equal(resolveVerifiedWhiteLabelDomain(verified.hostname, [{ ...verified, ownershipStatus: "pending" }]), null);
  assert.equal(resolveVerifiedWhiteLabelDomain(verified.hostname, [{ ...verified, tenantStatus: "suspended" }]), null);
  assert.equal(resolveVerifiedWhiteLabelDomain(verified.hostname, [verified, verified]), null);
});

test("host injection and malformed hostname rejected", () => {
  for (const value of ["pay.company.example:443", "pay.company.example/evil", "x@pay.company.example", "pay..example", "localhost", "pay.company.example\\evil"]) {
    assert.equal(normalizeTenantHostname(value), null, value);
  }
});
