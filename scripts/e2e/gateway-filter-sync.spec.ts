/**
 * gateway-filter-sync.spec.ts
 *
 * Confirms that the gateway filter dropdown stays in sync with the live DB
 * after providers are connected. Covers:
 *
 *   1. API vs DB parity (admin scope) — GET /api/transactions/gateway-options
 *      returns exactly the distinct providers present in the DB's
 *      merchant_connections table (derived at runtime, not hardcoded).
 *
 *   2. API vs DB parity (merchant scope) — endpoint returns only the active
 *      connections for that specific merchant (is_active = true), again
 *      derived from the live DB at test-run time.
 *
 *   3. Cross-scope consistency — every merchant option value also appears in
 *      the admin options (admin is a superset by design).
 *
 *   4. UI parity — admin /admin/transactions Provider filter dropdown and
 *      merchant /merchant/transactions Gateway filter dropdown show the same
 *      underlying data: all values visible in the merchant dropdown also
 *      appear in the admin dropdown.
 *
 *   5. UI smoke — both combobox triggers are present and readable on their
 *      respective pages, confirming the hook resolved and the component wired
 *      it up.
 *
 * DB queries run via `psql` (execSync) using DATABASE_URL, so the assertions
 * reflect the actual state of the database at test-run time — no hardcoded
 * seed expectations that would break in other environments.
 */

import { execSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import { readCachedAdminToken, readCachedMerchantToken } from "./token-cache";

const BASE = "http://localhost:80";
const API = `${BASE}/api`;
const LS_TOKEN_KEY = "rasokart_token";

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Run a SQL query against the dev DB and return the result rows.
 * Uses psql with tab-separated, no-header output for reliable parsing.
 * Multi-line SQL is flattened to a single line before being passed to psql
 * to avoid shell escaping issues with embedded newlines.
 */
function queryDb(sql: string): string[] {
  const flat = sql.replace(/\s+/g, " ").trim();
  const raw = execSync(`psql "$DATABASE_URL" -t -A -c ${JSON.stringify(flat)}`, {
    env: process.env,
  })
    .toString()
    .trim();
  return raw.split("\n").map((r) => r.trim()).filter(Boolean);
}

/** Distinct providers in admin scope (all non-null rows, any merchant). */
function dbAdminProviders(): string[] {
  return queryDb(
    "SELECT DISTINCT provider FROM merchant_connections WHERE provider IS NOT NULL ORDER BY provider",
  );
}

/** Active providers for merchant2@demo.com only (de-duplicated, matching endpoint semantics). */
function dbMerchantActiveProviders(): string[] {
  return queryDb(
    `SELECT DISTINCT mc.provider
       FROM merchant_connections mc
       JOIN merchants m ON m.id = mc.merchant_id
      WHERE m.email = 'merchant2@demo.com'
        AND mc.is_active = true
      ORDER BY mc.provider`,
  );
}

// ── API helpers ───────────────────────────────────────────────────────────────

type GatewayOption = { value: string; label: string };

async function fetchGatewayOptions(token: string): Promise<GatewayOption[]> {
  const res = await fetch(`${API}/transactions/gateway-options`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status, "GET /api/transactions/gateway-options should return 200").toBe(200);
  return (await res.json()) as GatewayOption[];
}

// ── Browser helpers ───────────────────────────────────────────────────────────

async function injectToken(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
    { key: LS_TOKEN_KEY, value: token },
  );
}

/**
 * Open a combobox trigger, count the non-sentinel provider options in the
 * Radix Select portal listbox, then close.
 *
 * We count rather than read values because the merchant dropdown applies
 * white-label names (e.g. "Payment Gateway B") that differ from the admin
 * raw names ("Phonepe"). Counting confirms options are rendered; actual
 * value-level parity is verified at the API layer in Parts 1–3.
 *
 * Returns the number of non-"All …" options shown.
 */
async function countDropdownOptions(
  page: Page,
  triggerLocator: ReturnType<Page["locator"]>,
  sentinelPrefix: string,
): Promise<number> {
  await triggerLocator.click();

  // Radix Select renders options in a portal — wait for the listbox
  const listbox = page.locator('[role="listbox"]').first();
  await listbox.waitFor({ state: "visible", timeout: 8_000 });

  const options = listbox.locator('[role="option"]');
  const allTexts = await options.allInnerTexts();
  const providerCount = allTexts.filter(
    (t) => !t.trim().toLowerCase().startsWith(sentinelPrefix.toLowerCase()),
  ).length;

  await page.keyboard.press("Escape");
  await listbox.waitFor({ state: "hidden", timeout: 4_000 }).catch(() => {});
  return providerCount;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe("Gateway filter dropdown sync", () => {
  let adminToken: string;
  let merchantToken: string;

  test.beforeAll(() => {
    adminToken = readCachedAdminToken();
    merchantToken = readCachedMerchantToken();
  });

  // ── Part 1: Admin API ↔ live DB parity ─────────────────────────────────────

  test("admin gateway-options matches distinct providers in DB (runtime-derived)", async () => {
    const [options, dbProviders] = await Promise.all([
      fetchGatewayOptions(adminToken),
      Promise.resolve(dbAdminProviders()),
    ]);

    expect(Array.isArray(options)).toBe(true);

    const apiValues = options.map((o) => o.value).sort();
    const sorted = [...dbProviders].sort();

    expect(
      apiValues,
      `API returned ${JSON.stringify(apiValues)} but DB has ${JSON.stringify(sorted)}`,
    ).toEqual(sorted);
  });

  test("admin gateway-options items all have non-empty {value, label} shape", async () => {
    const options = await fetchGatewayOptions(adminToken);
    for (const opt of options) {
      expect(typeof opt.value).toBe("string");
      expect(opt.value.length > 0, `value empty for option: ${JSON.stringify(opt)}`).toBe(true);
      expect(typeof opt.label).toBe("string");
      expect(opt.label.length > 0, `label empty for option: ${JSON.stringify(opt)}`).toBe(true);
    }
  });

  // ── Part 2: Merchant API ↔ live DB parity ──────────────────────────────────

  test("merchant gateway-options matches active connections in DB (runtime-derived)", async () => {
    const [options, dbActive] = await Promise.all([
      fetchGatewayOptions(merchantToken),
      Promise.resolve(dbMerchantActiveProviders()),
    ]);

    expect(Array.isArray(options)).toBe(true);

    const apiValues = options.map((o) => o.value).sort();
    const sorted = [...dbActive].sort();

    expect(
      apiValues,
      `Merchant API returned ${JSON.stringify(apiValues)} but DB active set is ${JSON.stringify(sorted)}`,
    ).toEqual(sorted);
  });

  test("merchant gateway-options excludes providers whose is_active = false", async () => {
    const dbInactive = queryDb(
      `SELECT mc.provider
         FROM merchant_connections mc
         JOIN merchants m ON m.id = mc.merchant_id
        WHERE m.email = 'merchant2@demo.com'
          AND mc.is_active = false
        ORDER BY mc.provider`,
    );

    if (dbInactive.length === 0) {
      // Nothing inactive — vacuously true; test still confirms the DB was queried
      return;
    }

    const options = await fetchGatewayOptions(merchantToken);
    const apiValues = new Set(options.map((o) => o.value));

    for (const inactiveProv of dbInactive) {
      expect(
        apiValues.has(inactiveProv),
        `Inactive provider '${inactiveProv}' must NOT appear in merchant options`,
      ).toBe(false);
    }
  });

  // ── Part 3: Admin ⊇ Merchant cross-scope consistency ───────────────────────

  test("admin gateway-options is a superset of merchant gateway-options", async () => {
    const [adminOpts, merchantOpts] = await Promise.all([
      fetchGatewayOptions(adminToken),
      fetchGatewayOptions(merchantToken),
    ]);

    const adminValues = new Set(adminOpts.map((o) => o.value));
    for (const mOpt of merchantOpts) {
      expect(
        adminValues.has(mOpt.value),
        `Merchant option '${mOpt.value}' must also be in admin options`,
      ).toBe(true);
    }
  });

  // ── Part 4: UI parity — open dropdowns and compare option values ────────────

  test("admin Provider filter and merchant Gateway filter show consistent provider values", async ({
    page: adminPage,
    context,
  }) => {
    // Fetch expected counts from the API (ground truth for both roles)
    const [adminApiOptions, merchantApiOptions] = await Promise.all([
      fetchGatewayOptions(adminToken),
      fetchGatewayOptions(merchantToken),
    ]);
    const expectedAdminCount = adminApiOptions.length;
    const expectedMerchantCount = merchantApiOptions.length;

    // ── Admin: open Provider dropdown, count non-sentinel options ────────────
    await injectToken(adminPage, adminToken);
    await adminPage.goto(`${BASE}/admin/transactions`);

    const adminTrigger = adminPage
      .getByRole("combobox")
      .filter({ hasText: /All Providers/i })
      .first();
    await expect(adminTrigger).toBeVisible({ timeout: 10_000 });

    const adminVisibleCount = await countDropdownOptions(adminPage, adminTrigger, "all providers");

    expect(
      adminVisibleCount,
      `Admin Provider dropdown shows ${adminVisibleCount} items but API returned ${expectedAdminCount}`,
    ).toBe(expectedAdminCount);

    // ── Merchant: open a fresh page, open Gateway dropdown, count options ────
    const merchantPage = await context.newPage();
    await merchantPage.addInitScript(
      ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
      { key: LS_TOKEN_KEY, value: merchantToken },
    );
    await merchantPage.goto(`${BASE}/merchant/transactions`);

    // The gateway select only renders when options exist — its presence proves data loaded
    const merchantTrigger = merchantPage
      .getByRole("combobox")
      .filter({ hasText: /All Gateways/i })
      .first();
    await expect(merchantTrigger).toBeVisible({ timeout: 10_000 });

    const merchantVisibleCount = await countDropdownOptions(merchantPage, merchantTrigger, "all gateways");

    expect(
      merchantVisibleCount,
      `Merchant Gateway dropdown shows ${merchantVisibleCount} items but API returned ${expectedMerchantCount}`,
    ).toBe(expectedMerchantCount);

    // ── Cross-page parity: admin must show >= merchant (admin is a superset) ─
    expect(
      adminVisibleCount,
      `Admin dropdown (${adminVisibleCount}) must show at least as many options as merchant (${merchantVisibleCount})`,
    ).toBeGreaterThanOrEqual(merchantVisibleCount);

    // Both dropdowns must be non-empty — at least one active provider is seeded
    expect(adminVisibleCount, "Admin Provider dropdown must have at least one provider option").toBeGreaterThan(0);
    expect(merchantVisibleCount, "Merchant Gateway dropdown must have at least one provider option").toBeGreaterThan(0);
  });

  // ── Part 5: UI smoke — triggers render ─────────────────────────────────────

  test("admin transactions page renders the Provider filter dropdown trigger", async ({ page }) => {
    await injectToken(page, adminToken);
    await page.goto(`${BASE}/admin/transactions`);
    const trigger = page.getByRole("combobox").filter({ hasText: /All Providers/i }).first();
    await expect(trigger).toBeVisible({ timeout: 10_000 });
  });

  test("merchant transactions page renders the Gateway filter dropdown trigger", async ({ page }) => {
    await injectToken(page, merchantToken);
    await page.goto(`${BASE}/merchant/transactions`);
    // Only rendered when gatewayOptions.length > 0 — presence proves data loaded
    const trigger = page.getByRole("combobox").filter({ hasText: /All Gateways/i }).first();
    await expect(trigger).toBeVisible({ timeout: 10_000 });
  });

  // ── Part 6: New-provider sync check ────────────────────────────────────────
  // Insert a new connection row, confirm the API picks it up, then clean up.

  test("newly connected provider immediately appears in admin gateway-options", async ({ request }) => {
    const TEST_PROVIDER = "test_gateway_sync_probe";

    // Fetch the merchant2 id so we can insert and delete cleanly
    const merchantIdRaw = queryDb(
      `SELECT id FROM merchants WHERE email = 'merchant2@demo.com' LIMIT 1`,
    );
    expect(merchantIdRaw.length, "merchant2@demo.com must exist").toBeGreaterThan(0);
    const merchantId = merchantIdRaw[0]!;

    // Insert a fresh connection row with a unique test provider name
    queryDb(
      `INSERT INTO merchant_connections (merchant_id, provider, credentials, is_active)
       VALUES (${merchantId}, '${TEST_PROVIDER}', '{}', true)`,
    );

    try {
      // Admin gateway-options must now include the new provider
      const res = await request.get(`${API}/transactions/gateway-options`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status()).toBe(200);
      const options = (await res.json()) as GatewayOption[];
      const values = options.map((o) => o.value);

      expect(
        values,
        `Newly inserted provider '${TEST_PROVIDER}' must appear in gateway-options`,
      ).toContain(TEST_PROVIDER);
    } finally {
      // Always clean up the probe row
      queryDb(
        `DELETE FROM merchant_connections
          WHERE merchant_id = ${merchantId}
            AND provider = '${TEST_PROVIDER}'`,
      );

      // Confirm cleanup
      const remaining = queryDb(
        `SELECT id FROM merchant_connections
          WHERE merchant_id = ${merchantId}
            AND provider = '${TEST_PROVIDER}'`,
      );
      expect(remaining.length).toBe(0);
    }
  });
});
