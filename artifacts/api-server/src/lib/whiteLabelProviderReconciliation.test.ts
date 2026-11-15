import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePayoutReconciliation, type ProviderObservation } from "./whiteLabelProviderReconciliation";

test("only confirmed provider success marks a payout completed", () => {
  assert.equal(decidePayoutReconciliation("confirmed_success").commandStatus, "completed");
  assert.equal(decidePayoutReconciliation("confirmed_failure").commandStatus, "failed");
});
test("ambiguous provider results require reconciliation and never trigger payout retry", () => {
  const ambiguous: ProviderObservation[] = ["pending", "unknown", "network_timeout", "invalid_response"];
  for (const observation of ambiguous) {
    assert.deepEqual(decidePayoutReconciliation(observation), {
      commandStatus: "requires_reconciliation",
      retryPayout: false,
      requiresProviderLookup: true,
    });
  }
});
