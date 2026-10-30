import { test } from "node:test";
import assert from "node:assert/strict";
import { ownershipTxtName, hashOwnershipToken, ownershipTokenMatches, checkOwnershipTxt } from "./whiteLabelDns.ts";
const token = "rk-wl-" + "a".repeat(64);
test("TXT record name is exact hostname scoped", () => {
  assert.equal(ownershipTxtName("Pay.Company.Example"), "_rasokart-verification.pay.company.example");
  assert.equal(ownershipTxtName("company.example:80"), null);
});
test("only exact cryptographic challenge matches", () => {
  assert.equal(ownershipTokenMatches(token, hashOwnershipToken(token)), true);
  assert.equal(ownershipTokenMatches("rk-wl-" + "b".repeat(64), hashOwnershipToken(token)), false);
  assert.equal(ownershipTokenMatches(token, null), false);
});
test("invalid DNS challenge fails before lookup", async () => {
  assert.equal(await checkOwnershipTxt("example.com", "invalid"), false);
});
