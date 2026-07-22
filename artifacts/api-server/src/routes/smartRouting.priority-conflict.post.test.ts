/**
 * Integration test: POST /api/smart-routing/configs/:id/rules — concurrent priority collision
 *
 * Verifies that the `suggestedPriority` field returned inside every 409 response is a
 * genuinely free slot — not a number that is already taken by the time the admin clicks
 * "Use suggested priority".
 *
 * Two scenarios:
 *
 * 1. TRUE CONCURRENT RACE (Promise.all, DB-level unique constraint fires)
 *    Both POSTs race past the app-level SELECT conflict check because neither INSERT has
 *    committed when both perform their conflict query.  The first INSERT wins; the second
 *    hits the unique constraint (23505) and the catch-handler computes suggestedPriority
 *    *after* the winner is committed, so it sees priority 5 as occupied and returns 6.
 *    The test asserts: exactly one success (200) and one 409, the 409 includes
 *    `suggestedPriority`, and that number is not in the occupied-priority set.
 *
 * 2. APP-LEVEL CONFLICT (both requests see the pre-existing rule, both return 409)
 *    A rule already occupies the target priority before either POST lands.
 *    Both concurrent POSTs are rejected by the app-level SELECT guard and both return a
 *    409 with `suggestedPriority`.  The test asserts both values are free (not occupied)
 *    and are deterministically equal (6 — first free slot above 5 given 3,5,7 are taken).
 *
 * Mock strategy (field-shape routing, mirrors smartRouting.priority-conflict.put.test.ts)
 * ──────────────────────────────────────────────────────────────────────────────────────
 * Every POST handler query is routed by (table identity, selected field keys):
 *
 *   usersTable,         no fields          → auth middleware         → ADMIN_USER
 *   routingConfigsTable, no fields         → config existence check  → EXISTING_CONFIG
 *   routingRulesTable,  { id, providerKey }→ app-level conflict check
 *   routingRulesTable,  { providerKey }    → catch: owning provider  → { providerKey }
 *   routingRulesTable,  { priority }       → getNextFreePriority     → occupied list
 *
 * db.insert() is mocked to succeed on the first call and throw 23505 on the second.
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  db,
  usersTable,
  routingConfigsTable,
  routingRulesTable,
} from "@workspace/db";
import { generateToken } from "../middlewares/auth";
import app from "../app";

function post(
  server: http.Server,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const addr = server.address() as { port: number };
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(raw) }));
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

describe(
  "POST /api/smart-routing/configs/:id/rules — concurrent priority collision",
  () => {
    let server: http.Server;
    let token: string;

    const ADMIN_USER = {
      id: 1,
      email: "admin@rasokart.com",
      role: "admin" as const,
      isActive: true,
      passwordUpdatedAt: null,
      isSuperAdmin: true,
    };

    const EXISTING_CONFIG = {
      id: 42,
      configName: "Test Config",
      description: null,
      strategy: "priority",
      isEnabled: true,
      fallbackEnabled: true,
      timeoutMs: 30000,
      minSuccessRateThreshold: "80.00",
      updatedByEmail: "admin@rasokart.com",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    /** The rule that wins the race — inserted at priority 5 by the first POST */
    const NEW_RULE_5 = {
      id: 300,
      configId: 42,
      providerKey: "razorpay",
      priority: 5,
      weightPercent: 100,
      minAmount: null,
      maxAmount: null,
      allowedPaymentModes: null,
      isEnabled: true,
      isFallbackOnly: false,
      maxRetries: 1,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const originalSelect = (db as any).select.bind(db);
    const originalInsert = (db as any).insert.bind(db);

    before(async () => {
      server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      token = generateToken({ userId: ADMIN_USER.id, role: "admin" });
    });

    after(async () => {
      (db as any).select = originalSelect;
      (db as any).insert = originalInsert;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    afterEach(() => {
      (db as any).select = originalSelect;
      (db as any).insert = originalInsert;
    });

    it(
      "concurrent inserts (Promise.all) — losing 409 suggestedPriority is not already occupied",
      async () => {
        /**
         * Both POSTs race past the app-level conflict check (priority 5 appears free at read
         * time).  The first INSERT succeeds; the second triggers the unique constraint.
         * The catch-handler then calls getNextFreePriority, which at that point sees
         * priorities 3, 5, and 7 as occupied and returns 6 — a genuinely free slot.
         *
         * Field-shape routing for this scenario:
         *   { id, providerKey } → app-level check   → [] (both race past — priority 5 looks free)
         *   { providerKey }     → catch: find owner  → [{ providerKey: "razorpay" }]
         *   { priority }        → getNextFreePriority → [3, 5, 7] occupied
         */
        let insertCount = 0;

        (db as any).select = (fields?: unknown) => {
          const keys = fields ? Object.keys(fields as object) : [];
          return {
            from: (table: unknown) => ({
              where: (_cond: unknown) => ({
                limit: async () => {
                  if (table === usersTable) return [ADMIN_USER];
                  if (table === routingConfigsTable) return [EXISTING_CONFIG];
                  if (table === routingRulesTable) {
                    if (keys.includes("id") && keys.includes("providerKey")) {
                      // App-level conflict check — both requests race past (priority 5 looks free)
                      return [];
                    }
                    if (keys.includes("providerKey") && !keys.includes("id")) {
                      // Catch-handler: find the provider that now owns priority 5 (the winner)
                      return [{ providerKey: "razorpay" }];
                    }
                    if (keys.includes("priority")) {
                      // getNextFreePriority: winner's INSERT is committed; 3, 5, 7 are occupied
                      return [{ priority: 3 }, { priority: 5 }, { priority: 7 }];
                    }
                  }
                  return [];
                },
              }),
              orderBy: async () => [],
              limit: async () => {
                if (table === usersTable) return [ADMIN_USER];
                return [];
              },
            }),
          };
        };

        (db as any).insert = (_table: unknown) => ({
          values: (_vals: unknown) => ({
            returning: async () => {
              insertCount += 1;
              if (insertCount === 1) {
                // First INSERT wins — new rule created at priority 5
                return [NEW_RULE_5];
              }
              // Second INSERT loses — DB unique constraint fires
              const err = new Error("duplicate key value violates unique constraint");
              (err as any).code = "23505";
              (err as any).constraint = "routing_rules_enabled_priority_uniq";
              throw err;
            },
          }),
        });

        const [a, b] = await Promise.all([
          post(server, "/api/smart-routing/configs/42/rules", { providerKey: "razorpay", priority: 5 }, token),
          post(server, "/api/smart-routing/configs/42/rules", { providerKey: "stripe", priority: 5 }, token),
        ]);

        const statuses = [a.status, b.status].sort((x, y) => x - y);
        assert.ok(
          statuses[0] === 200 && statuses[1] === 409,
          `Expected one 200 and one 409, got ${a.status} and ${b.status}`,
        );

        const rejected = a.status === 409 ? a : b;

        // The 409 must include a numeric suggestedPriority
        assert.ok(
          typeof (rejected.body as any)["suggestedPriority"] === "number",
          `409 body must include a numeric suggestedPriority, got: ${JSON.stringify(rejected.body)}`,
        );

        const suggested = (rejected.body as any)["suggestedPriority"] as number;

        // After both requests land, priorities 3, 5, and 7 are occupied.
        // The suggestedPriority must NOT be any of those — it must be a genuinely free slot.
        const occupiedAfterRace = new Set([3, 5, 7]);
        assert.ok(
          !occupiedAfterRace.has(suggested),
          `suggestedPriority ${suggested} collides with an occupied priority (${[...occupiedAfterRace].join(", ")}) — it is stale and the "Use it" button would cause another 409`,
        );

        // Verify the error message cites the conflict
        assert.match(
          (rejected.body as any)["error"] as string,
          /Priority 5 is already used/,
          "409 body must cite the conflicting priority number",
        );
      },
    );

    it(
      "app-level conflict (both see pre-existing rule) — both 409 responses suggest the same free slot",
      async () => {
        /**
         * A rule already occupies priority 5 before either POST arrives.
         * Both concurrent POSTs are caught by the app-level SELECT guard and return 409
         * immediately — no INSERT is attempted.  Both call getNextFreePriority(42, 5),
         * which with priorities 3, 5, 7 occupied deterministically returns 6.
         *
         * This is the "Use suggested priority" stale-number scenario: if getNextFreePriority
         * were reading stale data (e.g. missing the newly-inserted priority 5), it might
         * return 5 — which would immediately conflict again.  The test asserts it doesn't.
         *
         * Field-shape routing for this scenario:
         *   { id, providerKey } → app-level check   → [{ id:200, providerKey:"cashfree" }] (conflict found)
         *   { priority }        → getNextFreePriority → [3, 5, 7] occupied
         */
        (db as any).select = (fields?: unknown) => {
          const keys = fields ? Object.keys(fields as object) : [];
          return {
            from: (table: unknown) => ({
              where: (_cond: unknown) => ({
                limit: async () => {
                  if (table === usersTable) return [ADMIN_USER];
                  if (table === routingConfigsTable) return [EXISTING_CONFIG];
                  if (table === routingRulesTable) {
                    if (keys.includes("id") && keys.includes("providerKey")) {
                      // App-level conflict check — rule 200 already owns priority 5
                      return [{ id: 200, providerKey: "cashfree" }];
                    }
                    if (keys.includes("priority")) {
                      // getNextFreePriority: 3, 5, 7 occupied
                      return [{ priority: 3 }, { priority: 5 }, { priority: 7 }];
                    }
                  }
                  return [];
                },
              }),
              orderBy: async () => [],
              limit: async () => {
                if (table === usersTable) return [ADMIN_USER];
                return [];
              },
            }),
          };
        };

        const [a, b] = await Promise.all([
          post(server, "/api/smart-routing/configs/42/rules", { providerKey: "razorpay", priority: 5 }, token),
          post(server, "/api/smart-routing/configs/42/rules", { providerKey: "stripe", priority: 5 }, token),
        ]);

        assert.equal(a.status, 409, `Request A should be rejected with 409: ${JSON.stringify(a.body)}`);
        assert.equal(b.status, 409, `Request B should be rejected with 409: ${JSON.stringify(b.body)}`);

        // Both 409s must carry a numeric suggestedPriority
        assert.ok(
          typeof (a.body as any)["suggestedPriority"] === "number",
          `Request A 409 must include numeric suggestedPriority, got: ${JSON.stringify(a.body)}`,
        );
        assert.ok(
          typeof (b.body as any)["suggestedPriority"] === "number",
          `Request B 409 must include numeric suggestedPriority, got: ${JSON.stringify(b.body)}`,
        );

        const suggestedA = (a.body as any)["suggestedPriority"] as number;
        const suggestedB = (b.body as any)["suggestedPriority"] as number;

        // Both concurrent suggestions must be equal — getNextFreePriority is deterministic
        assert.equal(
          suggestedA,
          suggestedB,
          `Both concurrent 409s should suggest the same free priority (got A=${suggestedA}, B=${suggestedB})`,
        );

        // The suggestion must not collide with any occupied priority
        const occupiedPriorities = new Set([3, 5, 7]);
        assert.ok(
          !occupiedPriorities.has(suggestedA),
          `suggestedPriority ${suggestedA} collides with an occupied priority — clicking "Use it" would immediately conflict again`,
        );

        // Specifically: 6 is the first free slot above 5 with {3,5,7} occupied
        assert.equal(
          suggestedA,
          6,
          `Expected suggestedPriority=6 (first free above 5 with {3,5,7} occupied), got ${suggestedA}`,
        );

        // Both error messages must cite the conflict
        assert.match(
          (a.body as any)["error"] as string,
          /Priority 5 is already used/,
          "Request A: 409 must cite the conflicting priority",
        );
        assert.match(
          (b.body as any)["error"] as string,
          /Priority 5 is already used/,
          "Request B: 409 must cite the conflicting priority",
        );
        assert.match(
          (a.body as any)["error"] as string,
          /"cashfree"/,
          "Request A: 409 must name the provider that owns the priority",
        );
        assert.match(
          (b.body as any)["error"] as string,
          /"cashfree"/,
          "Request B: 409 must name the provider that owns the priority",
        );
      },
    );
  },
);
