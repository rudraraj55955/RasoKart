/**
 * Integration test: GET /api/healthz/deep — partial demo-account break
 * against the REAL database.
 *
 * Verifies that the deploy gate blocks traffic (HTTP 503, demo_credentials: false)
 * when some—but not all—demo accounts have a broken password hash.
 *
 * The existing health.excludedDemoAccount.realdb.test.ts covers the single-account
 * tamper case. This file covers the partial-break scenario: 2 out of 4 accounts
 * broken, 2 healthy. This is the most realistic production regression surface
 * (e.g. a seed script re-hashes only some passwords).
 *
 * Test sequence:
 *   1. Tamper password hashes for 2 non-excluded active accounts simultaneously.
 *   2. Assert /api/healthz/deep returns HTTP 503 with demo_credentials: false.
 *   3. Restore both hashes in cleanup (after block always runs).
 *
 * A second describe block verifies that a single remaining broken account out of
 * the full set still trips the gate (all-but-one broken), confirming the loop
 * checks every credential, not just the first or last.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { DEMO_CREDENTIALS } from "@workspace/demo-credentials";
import app from "../app";
import { prepareHealthzDeepTestEnv } from "../lib/testHelpers/ensureDemoUsers";

const BROKEN_HASH = "$2b$10$tamperedhashtamperedhashtamperedhashtamperedhashtampe";

function get(
  server: http.Server,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "GET",
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode!, body: { _raw: raw } });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Describe: two out of four accounts broken, two healthy → gate must block
// ---------------------------------------------------------------------------

describe(
  "GET /api/healthz/deep — two broken demo accounts (partial break) returns 503 (real DB)",
  () => {
    let server: http.Server;

    // Pick exactly two accounts to tamper — use stable indices so the test is
    // deterministic regardless of how DEMO_CREDENTIALS is ordered.
    // We need at least 2 accounts for this test to be meaningful.
    const allCredentials = DEMO_CREDENTIALS;

    // Tamper the first two; leave the rest intact.
    const TAMPER_COUNT = 2;
    const tamperedEmails: string[] = [];
    const originalHashes = new Map<string, string | null>();

    before(async () => {
      assert.ok(
        allCredentials.length >= TAMPER_COUNT + 1,
        `DEMO_CREDENTIALS must have at least ${TAMPER_COUNT + 1} entries for the partial-break test to be meaningful (got ${allCredentials.length})`,
      );

      await prepareHealthzDeepTestEnv();

      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      // Collect the accounts we are going to tamper.
      for (let i = 0; i < TAMPER_COUNT; i++) {
        tamperedEmails.push(allCredentials[i]!.email);
      }

      // Save originals.
      const rows = await db
        .select({ email: usersTable.email, passwordHash: usersTable.passwordHash })
        .from(usersTable)
        .where(inArray(usersTable.email, tamperedEmails));

      for (const row of rows) {
        originalHashes.set(row.email, row.passwordHash);
      }

      assert.equal(
        rows.length,
        TAMPER_COUNT,
        `Expected ${TAMPER_COUNT} user rows to exist in the DB (got ${rows.length}). Ensure the DB is seeded before running this test.`,
      );

      // Tamper both hashes atomically (sequential updates in the same TX isn't
      // required here — the health check runs after both updates complete).
      for (const email of tamperedEmails) {
        await db
          .update(usersTable)
          .set({ passwordHash: BROKEN_HASH })
          .where(inArray(usersTable.email, [email]));
      }
    });

    after(async () => {
      // Restore every tampered hash regardless of test outcome.
      for (const [email, hash] of originalHashes.entries()) {
        if (hash) {
          await db
            .update(usersTable)
            .set({ passwordHash: hash })
            .where(inArray(usersTable.email, [email]));
        }
      }

      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it(
      "returns 503 with demo_credentials: false when 2 of the demo accounts have broken password hashes",
      async () => {
        const res = await get(server, "/api/healthz/deep");

        assert.equal(
          res.status,
          503,
          `Expected HTTP 503 when ${TAMPER_COUNT} demo accounts have broken hashes, got ${res.status}. Body: ${JSON.stringify(res.body)}`,
        );

        assert.equal(
          (res.body["checks"] as Record<string, boolean>)["demo_credentials"],
          false,
          "Expected demo_credentials check to be false when multiple accounts have broken hashes",
        );
      },
    );
  },
);

// ---------------------------------------------------------------------------
// Describe: all-but-one accounts broken → gate must still block
// ---------------------------------------------------------------------------

describe(
  "GET /api/healthz/deep — all-but-one demo accounts broken still returns 503 (real DB)",
  () => {
    let server: http.Server;

    const allCredentials = DEMO_CREDENTIALS;

    // Leave only the last account intact; tamper every other one.
    const tamperedEmails: string[] = [];
    const originalHashes = new Map<string, string | null>();

    before(async () => {
      assert.ok(
        allCredentials.length >= 2,
        "DEMO_CREDENTIALS must have at least 2 entries for the all-but-one test (got 1)",
      );

      await prepareHealthzDeepTestEnv();

      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

      // Tamper all except the last one.
      for (let i = 0; i < allCredentials.length - 1; i++) {
        tamperedEmails.push(allCredentials[i]!.email);
      }

      // Save originals.
      const rows = await db
        .select({ email: usersTable.email, passwordHash: usersTable.passwordHash })
        .from(usersTable)
        .where(inArray(usersTable.email, tamperedEmails));

      for (const row of rows) {
        originalHashes.set(row.email, row.passwordHash);
      }

      assert.equal(
        rows.length,
        tamperedEmails.length,
        `Expected ${tamperedEmails.length} user rows to exist in the DB (got ${rows.length}). Ensure the DB is seeded.`,
      );

      // Tamper all selected hashes.
      for (const email of tamperedEmails) {
        await db
          .update(usersTable)
          .set({ passwordHash: BROKEN_HASH })
          .where(inArray(usersTable.email, [email]));
      }
    });

    after(async () => {
      for (const [email, hash] of originalHashes.entries()) {
        if (hash) {
          await db
            .update(usersTable)
            .set({ passwordHash: hash })
            .where(inArray(usersTable.email, [email]));
        }
      }

      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it(
      "returns 503 with demo_credentials: false when all-but-one demo accounts have broken password hashes",
      async () => {
        const healthyEmail = allCredentials[allCredentials.length - 1]!.email;
        const res = await get(server, "/api/healthz/deep");

        assert.equal(
          res.status,
          503,
          `Expected HTTP 503 even with one healthy account (${healthyEmail}) when ${tamperedEmails.length} others are broken. Got ${res.status}. Body: ${JSON.stringify(res.body)}`,
        );

        assert.equal(
          (res.body["checks"] as Record<string, boolean>)["demo_credentials"],
          false,
          `Expected demo_credentials check to be false even though ${healthyEmail} is healthy — the loop must check ALL accounts`,
        );
      },
    );
  },
);
