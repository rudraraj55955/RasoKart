/**
 * admin-deposit-export-gateway-column.spec.ts
 *
 * Confirms that GET /api/transactions/export/csv:
 *
 *   1. Always includes a "Provider" gateway column in the CSV header
 *      regardless of whether a provider filter is active.
 *
 *   2. When connectionProvider=<value> is applied, every exported row has
 *      that provider value in the Provider column (no cross-contamination
 *      from other providers).
 *
 *   3. Without a provider filter the endpoint still produces a well-formed
 *      CSV with the Provider column present, and at least one row carries a
 *      non-empty provider value (confirming the column is wired end-to-end,
 *      not silently blanked).
 *
 * Approach: we insert a probe transaction directly into the DB (linked to a
 * known merchant_connections row so the FK join resolves the provider), run
 * the assertions, then delete the probe row in a `finally` block so the DB
 * is always left clean.
 *
 * The probe uses merchant_id=2 and the first merchant_connections row whose
 * provider is 'google_pay' (connection id=1 in the seed). If that row is
 * absent for any reason the test fails early with a clear message rather
 * than silently passing on an empty result set.
 */

import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { readCachedAdminToken } from "./token-cache";

const BASE = "http://localhost:80";
const API = `${BASE}/api`;

// ── DB helpers ─────────────────────────────────────────────────────────────────

function queryDb(sql: string): string[] {
  const flat = sql.replace(/\s+/g, " ").trim();
  const raw = execSync(`psql "$DATABASE_URL" -t -A -c ${JSON.stringify(flat)}`, {
    env: process.env,
  })
    .toString()
    .trim();
  return raw.split("\n").map((r) => r.trim()).filter(Boolean);
}

// ── CSV parsing helpers ────────────────────────────────────────────────────────

/**
 * Split a raw CSV string into rows where each row is an array of cell values.
 * Handles the quoting produced by the export route: fields are always wrapped
 * in double quotes with internal double-quotes escaped as `""`.
 */
function parseCsv(raw: string): string[][] {
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) =>
      line.split(",").map((cell) => {
        // Strip surrounding quotes and unescape internal ""
        const trimmed = cell.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
          return trimmed.slice(1, -1).replace(/""/g, '"');
        }
        return trimmed;
      }),
    );
}

// ── Suite ──────────────────────────────────────────────────────────────────────

test.describe("Admin deposit export — gateway column", () => {
  let adminToken: string;

  test.beforeAll(() => {
    adminToken = readCachedAdminToken();
  });

  // ── Part 1: Provider column is always present in the header ────────────────

  test("CSV header always contains a 'Provider' column", async ({ request }) => {
    const res = await request.get(`${API}/transactions/export/csv`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status(), "export/csv must return 200 for admin").toBe(200);

    const text = await res.text();
    const rows = parseCsv(text);
    expect(rows.length, "CSV must have at least a header row").toBeGreaterThanOrEqual(1);

    const header = rows[0]!;
    expect(
      header,
      `CSV header (${JSON.stringify(header)}) must include 'Provider'`,
    ).toContain("Provider");
  });

  // ── Part 2: Header column index is stable ──────────────────────────────────

  test("Provider column is at the expected position (index 3)", async ({ request }) => {
    const res = await request.get(`${API}/transactions/export/csv`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status()).toBe(200);

    const text = await res.text();
    const rows = parseCsv(text);
    const header = rows[0]!;

    // Canonical order: ID, UTR, Merchant, Provider, Type, Status, Amount, Currency, Reference, Date
    expect(header[3], `Expected 'Provider' at column index 3, got '${header[3]}'`).toBe("Provider");
  });

  // ── Part 3: Provider filter reduces rows + all rows carry the right value ──

  test("filtered export only contains rows for the requested provider", async ({ request }) => {
    // Resolve the probe connection row from the live DB
    const connRows = queryDb(
      `SELECT mc.id, mc.provider, mc.merchant_id
         FROM merchant_connections mc
        WHERE mc.provider IS NOT NULL
        ORDER BY mc.id
        LIMIT 1`,
    );
    expect(
      connRows.length,
      "At least one merchant_connections row must exist for this test to run",
    ).toBeGreaterThan(0);

    const [connId, probeProvider, merchantId] = connRows[0]!.split("|");

    // Use a timestamp-based UTR so re-runs never collide on the unique constraint.
    const probeUtr = `PROBE-EXP-GW-${Date.now()}`;
    // Insert a probe transaction linked to that connection so we know there is
    // at least one row the filter can match.
    const insertResult = queryDb(
      `INSERT INTO transactions
         (merchant_id, connection_id, type, status, amount, currency, utr, reference_id, description)
       VALUES
         (${merchantId}, ${connId}, 'deposit', 'success', '999.00', 'INR',
          '${probeUtr}', 'PROBE-EXPORT-GW-REF', 'probe: admin export gateway column test')
       RETURNING id`,
    );
    // psql may append a command-tag line (e.g. "INSERT 0 1") even in tuples-only mode;
    // pick the first purely-numeric token which is the returned row id.
    const probeId = insertResult.find((r) => /^\d+$/.test(r));
    expect(probeId, "Probe transaction insert must return the new id").toBeDefined();

    try {
      // Fetch the filtered export
      const res = await request.get(
        `${API}/transactions/export/csv?connectionProvider=${encodeURIComponent(probeProvider!)}`,
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      expect(res.status(), `export/csv?connectionProvider=${probeProvider} must return 200`).toBe(200);

      const text = await res.text();
      const rows = parseCsv(text);

      // Must have at least header + the probe row
      expect(
        rows.length,
        `Expected at least 2 rows (header + probe) but got ${rows.length}`,
      ).toBeGreaterThanOrEqual(2);

      const header = rows[0]!;
      const providerColIdx = header.indexOf("Provider");
      expect(providerColIdx, "Provider column must be present in filtered export header").not.toBe(-1);

      // Every data row must carry exactly the filtered provider value
      const dataRows = rows.slice(1);
      for (const row of dataRows) {
        const rowProvider = row[providerColIdx] ?? "";
        expect(
          rowProvider,
          `Row ${JSON.stringify(row)} has provider '${rowProvider}' but filter was '${probeProvider}'`,
        ).toBe(probeProvider);
      }
    } finally {
      // Always clean up the probe row (probeId is asserted defined above)
      queryDb(`DELETE FROM transactions WHERE id = ${probeId!}`);

      const remaining = queryDb(
        `SELECT id FROM transactions WHERE id = ${probeId!}`,
      );
      expect(remaining.length, "Probe transaction must be removed after test").toBe(0);
    }
  });

  // ── Part 4: Without filter, Provider column is non-blank for connected txns ─

  test("unfiltered export has non-empty Provider values for transactions with a connection", async ({
    request,
  }) => {
    // Insert a probe transaction linked to a known connection so we can assert
    // the Provider column is populated even in an unfiltered export.
    const connRows = queryDb(
      `SELECT mc.id, mc.provider, mc.merchant_id
         FROM merchant_connections mc
        WHERE mc.provider IS NOT NULL
        ORDER BY mc.id
        LIMIT 1`,
    );
    expect(connRows.length, "At least one merchant_connections row must exist").toBeGreaterThan(0);

    const [connId, probeProvider, merchantId] = connRows[0]!.split("|");

    const probeUtr = `PROBE-UNFILT-GW-${Date.now()}`;
    const insertResult = queryDb(
      `INSERT INTO transactions
         (merchant_id, connection_id, type, status, amount, currency, utr, reference_id, description)
       VALUES
         (${merchantId}, ${connId}, 'deposit', 'success', '888.00', 'INR',
          '${probeUtr}', 'PROBE-UNFILT-GW-REF', 'probe: admin unfiltered export provider column test')
       RETURNING id`,
    );
    const probeId = insertResult.find((r) => /^\d+$/.test(r));
    expect(probeId, "Probe transaction insert must return the new id").toBeDefined();

    try {
      const res = await request.get(`${API}/transactions/export/csv`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status()).toBe(200);

      const text = await res.text();
      const rows = parseCsv(text);

      const header = rows[0]!;
      const idColIdx = header.indexOf("ID");
      const providerColIdx = header.indexOf("Provider");
      expect(providerColIdx, "Provider column must be in header").not.toBe(-1);

      // Find the probe row and confirm its Provider cell matches
      const probeRow = rows
        .slice(1)
        .find((r) => r[idColIdx] === probeId);

      expect(
        probeRow,
        `Probe transaction id=${probeId} must appear in the unfiltered export`,
      ).toBeDefined();

      const rowProvider = probeRow![providerColIdx] ?? "";
      expect(
        rowProvider,
        `Probe row's Provider column must be '${probeProvider}' but was '${rowProvider}'`,
      ).toBe(probeProvider);
    } finally {
      queryDb(`DELETE FROM transactions WHERE id = ${probeId!}`);
    }
  });

  // ── Part 5: Filtering by unknown/nonexistent provider returns header only ──

  test("filtering by nonexistent provider returns header-only CSV (no data rows)", async ({
    request,
  }) => {
    const GHOST_PROVIDER = "nonexistent_provider_xyz_probe_2229";

    const res = await request.get(
      `${API}/transactions/export/csv?connectionProvider=${GHOST_PROVIDER}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(res.status(), "Should still 200 even when zero rows match").toBe(200);

    const text = await res.text();
    const rows = parseCsv(text);

    // Only the header row; no data rows
    expect(rows.length, "Ghost-provider export must contain only the header row").toBe(1);

    const header = rows[0]!;
    expect(header, "Header row must still include 'Provider' column").toContain("Provider");
  });
});
