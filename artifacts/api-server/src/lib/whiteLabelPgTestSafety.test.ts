import { test } from "node:test";
import assert from "node:assert/strict";
import { getIsolatedWhiteLabelTestDatabaseUrl } from "./whiteLabelPgTestSafety";
const testUrl = "postgresql://localhost:5432/rasokart_wl_test";
test("rejects absent and live database URLs", () => {
  assert.throws(() => getIsolatedWhiteLabelTestDatabaseUrl({}));
  assert.throws(() => getIsolatedWhiteLabelTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://localhost:5432/rasokart" }));
  assert.throws(() => getIsolatedWhiteLabelTestDatabaseUrl({ TEST_DATABASE_URL: testUrl, DATABASE_URL: testUrl }));
});
test("rejects production runtime", () => {
  assert.throws(() => getIsolatedWhiteLabelTestDatabaseUrl({ TEST_DATABASE_URL: testUrl, NODE_ENV: "production" }));
});
test("accepts explicitly isolated database names", () => {
  assert.equal(getIsolatedWhiteLabelTestDatabaseUrl({ TEST_DATABASE_URL: testUrl }), testUrl);
});
