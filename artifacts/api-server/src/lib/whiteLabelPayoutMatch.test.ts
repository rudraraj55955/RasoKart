import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPayoutIdentity } from "./whiteLabelPayoutMatch";
const expected = { merchantId: 22, transferId: "rk-123", providerTransferId: "cf-101" };
test("matches only exact merchant and both transfer identifiers", () => {
  assert.equal(matchPayoutIdentity(expected, { ...expected }), true);
  assert.equal(matchPayoutIdentity(expected, { ...expected, merchantId: 23 }), false);
  assert.equal(matchPayoutIdentity(expected, { ...expected, transferId: "rk-124" }), false);
  assert.equal(matchPayoutIdentity(expected, { ...expected, providerTransferId: null }), false);
  assert.equal(matchPayoutIdentity(expected, { ...expected, providerTransferId: "cf-102" }), false);
});
test("rejects unassigned payouts and missing transfer identifiers", () => {
  assert.equal(matchPayoutIdentity({ ...expected, merchantId: null }, expected), false);
  assert.equal(matchPayoutIdentity({ ...expected, transferId: null }, expected), false);
  assert.equal(matchPayoutIdentity({ ...expected, providerTransferId: null }, { ...expected, providerTransferId: "cf-101" }), false);
});
