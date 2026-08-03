/**
 * Integration tests: stale-outage boot cleanup and 2-hour safety-net
 *
 * Three scenarios, all against the real database:
 *
 *   1. Stale outage (35 min old): resolveStaleOutageOnBoot() must
 *      - delete the PAYIN_CHAIN_EXHAUSTED_SINCE system_config row
 *      - write gateway_recovered notifications with resolvedViaBootCleanup:true
 *        for every active admin
 *      - cause GET /api/smart-routing/failover-events to return status:"resolved"
 *        for the matching gateway_failover_exhausted event
 *
 *   2. Grace-period check (5 min old): resolveStaleOutageOnBoot() must leave
 *      the system_config row untouched when the outage is recent enough that a
 *      fast server restart should not auto-close it.
 *
 *   3. 2-hour endpoint safety-net: a gateway_failover_exhausted notification
 *      older than 2 hours must be returned as status:"resolved" by
 *      GET /api/smart-routing/failover-events without any call to
 *      resolveStaleOutageOnBoot (pure endpoint-level guard).
 *
 * Note: the `routing_logs` table is not created by schemaGuard in this
 * environment, so the before hook creates it with CREATE TABLE IF NOT EXISTS.
 * This is safe and idempotent — it simply ensures the table is present for
 * the code paths under test.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, and, inArray, gt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  db,
  usersTable,
  systemConfigTable,
  notificationsTable,
  SYSTEM_CONFIG_KEYS,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import { resolveStaleOutageOnBoot } from "../helpers/smartRouter";
import app from "../app";

// ── HTTP helpers ─────────────────────────────────────────────────────────────

type HttpResult = { status: number; body: unknown };

function httpGet(server: http.Server, path: string, token: string): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
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

// ── Shared setup ──────────────────────────────────────────────────────────────

describe("stale-outage boot cleanup + 2-hour safety-net (real DB)", () => {
  let server: http.Server;
  let adminToken: string;
  let adminId: number;
  /** Notification IDs created during tests — cleaned up in after(). */
  const insertedNotifIds: number[] = [];

  before(async () => {
    // Ensure routing_logs table exists. schemaGuard doesn't create it in this
    // environment (cascade abort), but resolveStaleOutageOnBoot and the
    // failover-events endpoint both query it.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS routing_logs (
        id            SERIAL PRIMARY KEY,
        merchant_id   INTEGER NOT NULL,
        config_id     INTEGER,
        config_name   VARCHAR(64),
        strategy_used VARCHAR(32),
        attempt_number INTEGER NOT NULL DEFAULT 1,
        provider_key  VARCHAR(64) NOT NULL,
        result        VARCHAR(32) NOT NULL,
        response_time_ms INTEGER,
        amount        NUMERIC(18,2),
        payment_mode  VARCHAR(32),
        public_reference_id  VARCHAR(64),
        provider_reference_id VARCHAR(128),
        error_message TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS routing_logs_merchant_idx ON routing_logs (merchant_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS routing_logs_created_idx ON routing_logs (created_at)
    `);

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const [admin] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.email, "admin@rasokart.com"),
          eq(usersTable.isActive, true),
        ),
      )
      .limit(1);
    assert.ok(admin, "seeded admin@rasokart.com must exist for this test suite");
    adminId = admin!.id;
    adminToken = generateToken({ userId: adminId, role: "admin" });
  });

  after(async () => {
    // Clean up any system_config row left behind if an assertion threw early.
    await db
      .delete(systemConfigTable)
      .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE));

    if (insertedNotifIds.length > 0) {
      await db
        .delete(notificationsTable)
        .where(inArray(notificationsTable.id, insertedNotifIds));
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ── Test 1: stale outage (35 min old) ──────────────────────────────────────

  it(
    "resolveStaleOutageOnBoot clears a 35-min-old outage marker and writes gateway_recovered notifications",
    async () => {
      // Timestamp simulating a crash that happened 35 minutes ago.
      const exhaustedAt = new Date(Date.now() - 35 * 60 * 1000);
      const exhaustedAtIso = exhaustedAt.toISOString();

      // 1. Plant the stale outage marker.
      await db
        .insert(systemConfigTable)
        .values({ key: SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE, value: exhaustedAtIso })
        .onConflictDoUpdate({
          target: systemConfigTable.key,
          set: { value: exhaustedAtIso },
        });

      // 2. Insert a matching gateway_failover_exhausted notification (simulating
      //    the alert that fired before the crash). outageStartedAt must equal
      //    exhaustedAtIso so recovery-correlation in the endpoint works.
      const [failoverNotif] = await db
        .insert(notificationsTable)
        .values({
          userId: adminId,
          type: "gateway_failover_exhausted",
          title: "Failover threshold exceeded",
          body: "Test: failover alert pre-crash",
          metadata: {
            failureCount: 5,
            windowMinutes: 60,
            triggerMerchantId: 1,
            outageStartedAt: exhaustedAtIso,
          },
        })
        .returning({ id: notificationsTable.id });
      insertedNotifIds.push(failoverNotif!.id);

      // Snapshot the current highest notification ID so we can find only rows
      // that were created by resolveStaleOutageOnBoot in this test.
      // db.execute() returns a pg QueryResult — rows live in .rows, not in the
      // top-level result itself.
      const maxBeforeResult = await db.execute<{ max_id: number | null }>(
        sql`SELECT MAX(id) AS max_id FROM notifications`,
      );
      const maxIdBefore = (maxBeforeResult.rows[0]?.max_id ?? 0) as number;

      try {
        // Snapshot active-admin count so we can verify one notification per admin.
        const activeAdmins = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(and(eq(usersTable.role, "admin"), eq(usersTable.isActive, true)));
        assert.ok(activeAdmins.length > 0, "at least one active admin must exist");

        // 3. Call the function under test.
        await resolveStaleOutageOnBoot();

        // 4. Assert the system_config row is cleared.
        const [remaining] = await db
          .select()
          .from(systemConfigTable)
          .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE))
          .limit(1);
        assert.equal(
          remaining,
          undefined,
          "PAYIN_CHAIN_EXHAUSTED_SINCE must be deleted after boot cleanup",
        );

        // 5. Assert gateway_recovered notifications were written for all active admins
        //    using only rows created AFTER our snapshot (eliminates pre-existing rows).
        const newRecoveryRows = await db
          .select({ id: notificationsTable.id, metadata: notificationsTable.metadata })
          .from(notificationsTable)
          .where(
            and(
              eq(notificationsTable.type, "gateway_recovered"),
              inArray(
                notificationsTable.userId,
                activeAdmins.map((a) => a.id),
              ),
              gt(notificationsTable.id, maxIdBefore),
            ),
          );

        // Track inserted IDs for cleanup.
        for (const r of newRecoveryRows) insertedNotifIds.push(r.id);

        assert.equal(
          newRecoveryRows.length,
          activeAdmins.length,
          `Expected exactly ${activeAdmins.length} new gateway_recovered notification(s), one per active admin`,
        );

        // 5a. Every new row must carry resolvedViaBootCleanup: true.
        for (const row of newRecoveryRows) {
          const meta = row.metadata as Record<string, unknown>;
          assert.equal(
            meta["resolvedViaBootCleanup"],
            true,
            `gateway_recovered notification id=${row.id} must have resolvedViaBootCleanup: true`,
          );
          assert.equal(
            meta["outageStartedAt"],
            exhaustedAtIso,
            `gateway_recovered notification id=${row.id} must carry the original outageStartedAt`,
          );
        }

        // 6. GET /api/smart-routing/failover-events — the matching event must be resolved.
        const resp = await httpGet(
          server,
          "/api/smart-routing/failover-events?limit=100",
          adminToken,
        );
        assert.equal(resp.status, 200, `failover-events returned ${resp.status}: ${JSON.stringify((resp.body as any)?.error ?? resp.body)}`);

        const body = resp.body as {
          events: Array<{
            id: number;
            eventKind: string;
            status: string;
            resolvedAt: string | null;
          }>;
        };
        assert.ok(Array.isArray(body.events), "response body must contain an events array");

        // Find the specific threshold_alert we inserted above.
        const matchingEvent = body.events.find((e) => e.id === failoverNotif!.id);
        assert.ok(
          matchingEvent !== undefined,
          `failover-events must include the gateway_failover_exhausted notification (id=${failoverNotif!.id})`,
        );
        assert.equal(
          matchingEvent!.eventKind,
          "threshold_alert",
          "event kind must be threshold_alert",
        );
        assert.equal(
          matchingEvent!.status,
          "resolved",
          'threshold_alert correlated with gateway_recovered must have status "resolved"',
        );
        assert.ok(
          typeof matchingEvent!.resolvedAt === "string" && matchingEvent!.resolvedAt.length > 0,
          "resolved event must carry a non-null resolvedAt timestamp",
        );
      } finally {
        // Ensure the marker is gone even if the test threw before resolveStaleOutageOnBoot ran.
        await db
          .delete(systemConfigTable)
          .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE));
      }
    },
  );

  // ── Test 2: grace-period check (5 min old — must NOT be cleared) ───────────

  it(
    "resolveStaleOutageOnBoot leaves a 5-min-old outage marker untouched (grace period)",
    async () => {
      const recentAt = new Date(Date.now() - 5 * 60 * 1000);
      const recentAtIso = recentAt.toISOString();

      // Plant a recent outage marker.
      await db
        .insert(systemConfigTable)
        .values({ key: SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE, value: recentAtIso })
        .onConflictDoUpdate({
          target: systemConfigTable.key,
          set: { value: recentAtIso },
        });

      try {
        await resolveStaleOutageOnBoot();

        // The row must still be present and unchanged.
        const [row] = await db
          .select()
          .from(systemConfigTable)
          .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE))
          .limit(1);

        assert.ok(
          row !== undefined,
          "PAYIN_CHAIN_EXHAUSTED_SINCE must NOT be deleted when the outage is only 5 minutes old",
        );
        assert.equal(
          row!.value,
          recentAtIso,
          "The stored timestamp must be unchanged after the grace-period skip",
        );
      } finally {
        await db
          .delete(systemConfigTable)
          .where(eq(systemConfigTable.key, SYSTEM_CONFIG_KEYS.PAYIN_CHAIN_EXHAUSTED_SINCE));
      }
    },
  );

  // ── Test 3: 2-hour endpoint safety-net (no resolveStaleOutageOnBoot call) ──

  it(
    "GET /api/smart-routing/failover-events auto-closes a gateway_failover_exhausted event older than 2 hours",
    async () => {
      // Insert a notification that is 3 hours old — past the 2-hour STALE_ONGOING_THRESHOLD_MS.
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

      const [oldNotif] = await db
        .insert(notificationsTable)
        .values({
          userId: adminId,
          type: "gateway_failover_exhausted",
          title: "Old failover threshold alert",
          body: "Test: 3-hour-old failover alert — should be auto-closed by endpoint",
          metadata: {
            failureCount: 10,
            windowMinutes: 60,
            triggerMerchantId: 1,
            // No outageStartedAt — no recovery row will match, so only the
            // 2-hour age check determines the status.
          },
          createdAt: threeHoursAgo,
        })
        .returning({ id: notificationsTable.id });
      insertedNotifIds.push(oldNotif!.id);

      const resp = await httpGet(
        server,
        "/api/smart-routing/failover-events?limit=100",
        adminToken,
      );
      assert.equal(
        resp.status,
        200,
        `failover-events returned ${resp.status}: ${JSON.stringify((resp.body as any)?.error ?? resp.body)}`,
      );

      const body = resp.body as {
        events: Array<{
          id: number;
          eventKind: string;
          status: string;
          note: string | null;
        }>;
      };
      assert.ok(Array.isArray(body.events), "response body must contain an events array");

      // Find the specific event we just inserted.
      const matchingEvent = body.events.find((e) => e.id === oldNotif!.id);
      assert.ok(
        matchingEvent !== undefined,
        `failover-events must include the 3-hour-old gateway_failover_exhausted notification (id=${oldNotif!.id})`,
      );

      assert.equal(matchingEvent!.eventKind, "threshold_alert", "event kind must be threshold_alert");
      assert.equal(
        matchingEvent!.status,
        "resolved",
        'event older than 2 hours must be auto-closed as status "resolved" by the endpoint safety-net',
      );
      assert.ok(
        typeof matchingEvent!.note === "string" && matchingEvent!.note.length > 0,
        "auto-closed event must carry a non-empty explanatory note",
      );
      assert.match(
        matchingEvent!.note!,
        /Auto-closed/i,
        'note must say "Auto-closed"',
      );
    },
  );
});
