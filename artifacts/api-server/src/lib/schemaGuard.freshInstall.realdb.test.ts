// ── Pino / process-exit fix ───────────────────────────────────────────────────
//
// Must be set BEFORE any import that instantiates pino (including the app and
// seed modules that import `./lib/logger`).  Pino creates a worker_thread for
// the pino-pretty transport in non-production environments, and that worker
// thread keeps the Node.js event loop alive indefinitely — causing the test
// runner to hang after all tests complete instead of exiting.  Setting
// NODE_ENV=production before any import makes pino use its built-in JSON sink
// (no worker thread) so the process exits cleanly once pool.end() drains the
// pg connections.  The tested routes and schemaGuard behaviour are identical
// in production mode; the only functional difference is log formatting.
//
// ⚠ This must remain the very first executable statement in the file — any
//   import appearing above it is evaluated before the assignment runs.
process.env["NODE_ENV"] = "production";

/**
 * schemaGuard.freshInstall.realdb.test.ts
 *
 * Self-contained fresh-install smoke test.  The test does NOT rely on any
 * pre-existing seeded data; it boots the full startup sequence itself so it
 * passes identically on a CI runner with a fresh PostgreSQL service (only
 * db-migrate has run) and on a developer's local machine.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * PART A — Isolated table-creation proof (before() step 1)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * A dedicated pg.PoolClient starts a BEGIN transaction, drops a representative
 * set of 12 guarded tables so they are genuinely absent from the database,
 * then calls runSchemaGuardWith(clientExecutor) — the exact SQL from
 * schemaGuard.ts executed on the same connection inside the transaction.
 * information_schema.tables is queried on the same client to confirm:
 *   (a) the 12 dropped tables are absent before the guard runs, and
 *   (b) all 84 guarded tables exist after the guard runs.
 * The transaction is then ROLLBACKed so no permanent data is mutated.
 *
 * On a CI runner with a genuinely fresh database the DROP is a no-op (tables
 * don't exist yet), and CREATE TABLE IF NOT EXISTS creates every table from
 * scratch — the canonical cold-start scenario.  Locally the DROP+CREATE+ROLLBACK
 * cycle exercises the same guard SQL idempotently.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * PART B — Normal startup + authenticated route reachability (before() step 2)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * After the ROLLBACK the test replays the normal server startup sequence:
 *   1. resetSchemaGuardCacheForTests() + ensureSchemaGuard() — creates all
 *      guarded tables on the real (persistent) database.
 *   2. seed() — inserts/upserts the documented demo accounts
 *      (admin@rasokart.com, merchant@demo.com, …).  Both calls are idempotent
 *      so they are safe on a pre-seeded dev database.
 *   3. http.createServer(app).listen(0) — starts the Express server.
 *   4. POST /api/auth/login is called for admin and merchant accounts to obtain
 *      real Bearer tokens.
 *   5. One GET request per guarded table is made with the appropriate token and
 *      HTTP 200 is asserted — proving the handler ran its DB query all the way
 *      through, not just past the auth middleware.  A 500 here means the table
 *      or a required column is absent ("relation does not exist").
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * TABLES COVERED
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Proved from absent state (Part A – DROP then recreate within transaction):
 *   company_settings, merchant_auth_otps, payin_charge_settings,
 *   platform_wallet_ledger, tax_liability_ledger, otp_sms_settings,
 *   sms_send_logs, merchant_tryit_presets, admin_tryit_presets,
 *   secure_id_settings, verification_logs, routing_configs (→ routing_rules)
 *
 * Verified to exist after guard runs (Part A information_schema check):
 *   all 84 guarded tables listed in ALL_GUARDED_TABLES
 *
 * Proven reachable via HTTP 200 with authenticated Bearer tokens (Part B):
 *   payment_links, routing_configs/rules, routing_logs, provider_metrics,
 *   payin_charge_settings, platform_wallet_ledger/tax_liability_ledger,
 *   transactions, withdrawals, api_keys, providers/provider_visibility,
 *   provider_integrations, merchant_connections, invoices, merchant_kyc_data
 *   + related, secure_id_settings, merchant_tryit_presets, sms_send_logs,
 *   company_settings (via /api/healthz)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { SQL } from "drizzle-orm";
import { pool, db, up } from "@workspace/db";
import { DEMO_CREDENTIALS } from "@workspace/demo-credentials";
import app from "../app";
import { seed } from "../seed";
import {
  runSchemaGuardWith,
  resetSchemaGuardCacheForTests,
  ensureSchemaGuard,
  type GuardExecutor,
} from "./schemaGuard";

// ── SQL renderer ──────────────────────────────────────────────────────────────
//
// All schemaGuard SQL is static DDL — no dynamic Drizzle parameters.
// This renderer flattens the Drizzle sql`` object to a plain string so we can
// execute it via a raw pg.PoolClient that is inside a transaction.

function renderSql(node: unknown, seen = new Set<unknown>()): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node !== "object") return String(node);
  if (seen.has(node)) return "";
  seen.add(node);
  const n = node as Record<string, unknown>;
  if (Array.isArray(node)) return node.map((c) => renderSql(c, seen)).join("");
  if (Array.isArray(n["queryChunks"])) return renderSql(n["queryChunks"], seen);
  if (typeof n["value"] === "string") return n["value"];
  if (Array.isArray(n["value"])) return renderSql(n["value"], seen);
  return "";
}

// Minimal structural type for the pg.PoolClient we use in this test.
// We avoid `import type pg from "pg"` because pg is a dep of @workspace/db,
// not artifacts/api-server; pool.connect() resolves to `void` via TypeScript's
// overload resolution when inferred with `typeof`.
interface PoolClient {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

/** Wraps a PoolClient as a GuardExecutor so runSchemaGuardWith can use it. */
function makeClientExecutor(client: PoolClient): GuardExecutor {
  return {
    execute: async (query: SQL) => {
      const sqlText = renderSql(query);
      const result = await client.query(sqlText);
      return { rows: result.rows };
    },
  };
}

// ── Tables dropped before the guard runs in Part A ────────────────────────────
//
// These 12 tables have no FK references from tables outside ALL_GUARDED_TABLES.
// Dropping them (CASCADE) will not disturb any data outside the guarded set.
// routing_configs CASCADE also drops routing_rules — both are recreated by
// the guard's CREATE TABLE IF NOT EXISTS statements.

const TABLES_TO_DROP = [
  "company_settings",
  "merchant_auth_otps",
  "payin_charge_settings",
  "platform_wallet_ledger",
  "tax_liability_ledger",
  "otp_sms_settings",
  "sms_send_logs",
  "merchant_tryit_presets",
  "admin_tryit_presets",
  "secure_id_settings",
  "verification_logs",
  "routing_configs", // CASCADE drops routing_rules too
] as const;

// All tables managed by schemaGuard — verified to exist after guard runs.
// Keep this list in sync with every CREATE TABLE IF NOT EXISTS block in
// schemaGuard.ts (including the four IAM tables created via up(db)).
const ALL_GUARDED_TABLES = [
  // ── Core auth / config ──────────────────────────────────────────────────
  "company_settings",
  "demo_account_removals",
  "merchant_auth_otps",
  "merchant_auth_locks",
  "rate_limit_hits",
  "system_config",

  // ── Providers / routing ─────────────────────────────────────────────────
  "providers",
  "provider_integrations",
  "provider_visibility",
  "routing_configs",
  "routing_rules",
  "routing_logs",
  "provider_metrics",
  "provider_products",
  "provider_product_visibility",

  // ── Merchant core ───────────────────────────────────────────────────────
  "merchant_connections",
  "merchant_trusted_ips",
  "merchant_features",
  "merchant_products",
  "merchant_charge_overrides",

  // ── Transactions / payments ─────────────────────────────────────────────
  "transactions",
  "withdrawals",
  "payment_links",
  "qr_payment_events",

  // ── Payin charges / ledger ──────────────────────────────────────────────
  "payin_charge_settings",
  "platform_wallet_ledger",
  "tax_liability_ledger",

  // ── API / webhooks ──────────────────────────────────────────────────────
  "api_keys",
  "webhooks",

  // ── Plans / billing ─────────────────────────────────────────────────────
  "invoices",
  "plan_history",

  // ── SMS / OTP ───────────────────────────────────────────────────────────
  "otp_sms_settings",
  "sms_send_logs",
  "otp_email_settings",

  // ── Try It ──────────────────────────────────────────────────────────────
  "merchant_tryit_presets",
  "admin_tryit_presets",

  // ── KYC / onboarding ────────────────────────────────────────────────────
  "secure_id_settings",
  "merchant_onboarding_sessions",
  "merchant_kyc_data",
  "merchant_kyc_verifications",
  "merchant_kyc_settings",
  "verification_logs",
  "kyc_verification_logs",
  "kyc_review_history",

  // ── Quiet hours ─────────────────────────────────────────────────────────
  "quiet_hours_queue",

  // ── Agents / commissions ────────────────────────────────────────────────
  "agents",
  "agent_commission_ledger",

  // ── Payouts ─────────────────────────────────────────────────────────────
  "payout_beneficiaries",
  "payout_wallet_load_orders",

  // ── Scheduled reports ───────────────────────────────────────────────────
  "scheduled_audit_reports",

  // ── Razorpay ────────────────────────────────────────────────────────────
  "razorpay_payment_orders",
  "razorpay_webhook_logs",
  "razorpay_refunds",
  "razorpayx_verification_log",

  // ── Cashfree ────────────────────────────────────────────────────────────
  "cashfree_payouts",
  "cashfree_payout_webhook_logs",
  "cashfree_payment_logs",

  // ── PayU ────────────────────────────────────────────────────────────────
  "payu_payment_orders",
  "payu_webhook_logs",

  // ── EKQR ────────────────────────────────────────────────────────────────
  "ekqr_webhook_logs",
  "ekqr_sync_alert_logs",

  // ── Support ─────────────────────────────────────────────────────────────
  "support_tickets",
  "ticket_replies",

  // ── CMS / promotions ────────────────────────────────────────────────────
  "promotional_campaigns",
  "promotional_analytics",

  // ── Policies ────────────────────────────────────────────────────────────
  "policy_acceptances",
  "policy_versions",

  // ── Contact / alert logs ────────────────────────────────────────────────
  "contact_submissions",
  "signature_failure_alert_logs",
  "webhook_failure_alert_logs",

  // ── Provider activation ─────────────────────────────────────────────────
  "account_visibility_rules",
  "activation_requests",

  // ── Misc ────────────────────────────────────────────────────────────────
  "callback_nonces",
  "saved_filters",
  "storage_cleanup_runs",
  "va_balance_history",
  "uploaded_objects",
  "cleanup_run_history",

  // ── Auth providers (OAuth) ──────────────────────────────────────────────
  "auth_providers",
  "social_provider_settings",

  // ── IAM (created via up(db)) ────────────────────────────────────────────
  "permissions",
  "role_permissions",
  "user_permissions",
  "iam_migration_log",
];

// ── HTTP helper ───────────────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  body: string;
  json: unknown;
}

function request(
  server: http.Server,
  method: "GET" | "POST",
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<HttpResponse> {
  const addr = server.address() as { port: number };
  const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string> = {};
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (bodyStr) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method, headers },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => { raw += c.toString(); });
        res.on("end", () => {
          let json: unknown = null;
          try { json = JSON.parse(raw); } catch { /* not JSON */ }
          resolve({ status: res.statusCode!, body: raw, json });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Route fixtures (Part B) ───────────────────────────────────────────────────

const GUARDED_ROUTES: Array<{
  path: string;
  role: "admin" | "merchant";
  table: string;
}> = [
  { path: "/api/payment-links/",                    role: "merchant", table: "payment_links" },
  { path: "/api/smart-routing/configs",              role: "admin",    table: "routing_configs + routing_rules" },
  { path: "/api/smart-routing/logs",                 role: "admin",    table: "routing_logs (smart-routing)" },
  { path: "/api/smart-routing/metrics",              role: "admin",    table: "provider metrics (smart-routing)" },
  { path: "/api/admin/payin-charges/",               role: "admin",    table: "payin_charge_settings + merchant_charge_overrides" },
  { path: "/api/admin/platform-profit/summary",      role: "admin",    table: "platform_wallet_ledger + tax_liability_ledger" },
  { path: "/api/transactions/",                      role: "merchant", table: "transactions" },
  { path: "/api/withdrawals/",                       role: "merchant", table: "withdrawals" },
  { path: "/api/api-keys/",                          role: "merchant", table: "api_keys" },
  { path: "/api/providers/",                         role: "admin",    table: "providers + provider_visibility" },
  { path: "/api/provider-integrations/integrations", role: "admin",    table: "provider_integrations" },
  { path: "/api/connections/",                       role: "merchant", table: "merchant_connections" },
  { path: "/api/invoices/",                          role: "merchant", table: "invoices" },
  { path: "/api/kyc/",                               role: "merchant", table: "merchant_kyc_data + merchant_kyc_verifications + merchant_onboarding_sessions + verification_logs" },
  { path: "/api/admin/secure-id-settings/",          role: "admin",    table: "secure_id_settings" },
  { path: "/api/merchant/tryit-presets",             role: "merchant", table: "merchant_tryit_presets" },
  { path: "/api/admin/sms-logs/",                    role: "admin",    table: "sms_send_logs" },
];

// ── Test suite ────────────────────────────────────────────────────────────────

describe(
  "schemaGuard fresh-install smoke — isolated table creation + startup sequence + authenticated route 200s (real DB)",
  () => {
    // Populated in before() and read by individual test cases
    let tablesFoundAfterGuard: Set<string>;
    let droppedTablesMissingBeforeGuard: boolean;
    let server: http.Server;
    let adminToken: string;
    let merchantToken: string;
    /**
     * True when platform_wallet_ledger and tax_liability_ledger contain no rows
     * at the time Part B starts (i.e. this is a CI fresh-install run).
     * Used to gate the "all fields = 0" assertions that are only valid on an
     * empty database; on a dev DB with existing ledger data the assertions are
     * relaxed to "all fields are finite numbers".
     */
    let ledgerTablesEmptyAtStartup: boolean;
    /**
     * True when payin_charge_settings contains no rows at the start of Part B.
     * On a dev DB the singleton row (id=1) may already exist from a prior run.
     */
    let payinChargesEmptyAtStartup: boolean;

    before(async () => {
      // ───────────────────────────────────────────────────────────────────────
      // PRE-STEP: Run the IAM migration on the real pool BEFORE the transaction.
      //
      // runSchemaGuardWith() (Part A below) calls up(db) internally.  up(db)
      // uses the drizzle global pool — a SEPARATE pg connection from the
      // transaction client.  up(db) creates FK constraints that reference the
      // `users` table, which requires a SHARE lock.  But the transaction client
      // holds an ACCESS EXCLUSIVE lock on `users` (from ALTER TABLE ADD COLUMN).
      // SHARE conflicts with ACCESS EXCLUSIVE → up(db) waits forever while the
      // transaction client (also in Node.js) waits for up(db) to finish.
      //
      // Fix: run up(db) once here, BEFORE any transaction is open.  When
      // runSchemaGuardWith() calls up(db) inside the transaction, all DO $$
      // IF NOT EXISTS guards short-circuit (FK constraints already exist,
      // columns already renamed, tables already present) — no SHARE lock on
      // `users` is ever taken, and the deadlock does not occur.
      await up(db);

      // ───────────────────────────────────────────────────────────────────────
      // PART A: Isolated table-creation proof
      //
      // A dedicated pg.PoolClient runs inside a BEGIN/ROLLBACK transaction so
      // ALL DDL (DROP + CREATE) is invisible to other connections and is fully
      // reversed at the end.  PostgreSQL DDL is transactional.
      // ───────────────────────────────────────────────────────────────────────
      const client = (await pool.connect()) as unknown as PoolClient;
      try {
        await client.query("BEGIN");

        // 1. Drop the representative set of guarded tables so they are genuinely
        //    absent.  On a fresh CI DB this is a no-op (they don't exist yet);
        //    on a dev DB with data the ROLLBACK at step 5 restores everything.
        for (const table of TABLES_TO_DROP) {
          await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        }

        // 2. Verify the dropped tables are absent inside this transaction.
        const droppedList = TABLES_TO_DROP.map((t) => `'${t}'`).join(",");
        const beforeResult = await client.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN (${droppedList})
        `);
        droppedTablesMissingBeforeGuard = beforeResult.rows.length === 0;

        // 3. Run schemaGuard against this client — recreates every dropped table
        //    from scratch, inside the transaction.
        await runSchemaGuardWith(makeClientExecutor(client));

        // 4. Verify ALL 84 guarded tables now exist in the database (within the
        //    same transaction so we see the CREATE TABLE results).
        const allList = ALL_GUARDED_TABLES.map((t) => `'${t}'`).join(",");
        const afterResult = await client.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN (${allList})
        `);
        tablesFoundAfterGuard = new Set(
          afterResult.rows.map((r) => (r["table_name"] as string).toLowerCase()),
        );
      } finally {
        // 5. ROLLBACK every DDL change so the real database is restored to its
        //    original state.  Non-destructive by design.
        await client.query("ROLLBACK");
        client.release();
      }

      // ───────────────────────────────────────────────────────────────────────
      // PART B: Normal startup sequence + authenticated route reachability
      //
      // Replays exactly what src/index.ts does at server startup so this test
      // is self-contained on a fresh CI database (only db-migrate has run):
      //   • ensureSchemaGuard() — creates all guarded tables on the real DB
      //   • seed()              — inserts/upserts demo accounts (idempotent)
      //   • starts the Express app
      //   • logs in to get Bearer tokens
      // ───────────────────────────────────────────────────────────────────────

      // Reset the singleton cache so ensureSchemaGuard() re-runs in full,
      // even if it already ran earlier in this Node process.
      resetSchemaGuardCacheForTests();
      await ensureSchemaGuard();

      // seed() is idempotent (upsert) — safe on an already-seeded dev DB and
      // required on a fresh CI DB where demo accounts don't exist yet.
      await seed();

      // Record whether the ledger / charge tables are empty right after seed().
      // On a CI fresh DB they will always be empty (seed() never writes to them).
      // On a dev DB they may have existing rows.  This flag gates the strict
      // "all fields = 0" assertions in Part C so they only run where meaningful.
      {
        const probe = (await pool.connect()) as unknown as PoolClient;
        try {
          const [ledger, charges] = await Promise.all([
            probe.query(
              "SELECT COUNT(*) AS n FROM platform_wallet_ledger",
            ),
            probe.query(
              "SELECT COUNT(*) AS n FROM payin_charge_settings",
            ),
          ]);
          ledgerTablesEmptyAtStartup =
            parseInt(String(ledger.rows[0]?.["n"] ?? "1"), 10) === 0;
          payinChargesEmptyAtStartup =
            parseInt(String(charges.rows[0]?.["n"] ?? "1"), 10) === 0;
        } finally {
          probe.release();
        }
      }

      // Start the Express app (note: app.ts does NOT call ensureSchemaGuard or
      // seed — those run in index.ts / this test's before()).
      server = http.createServer(app);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );

      // Obtain real Bearer tokens so route handlers run past the auth middleware
      // and execute their DB queries.  On a fresh CI DB this only works because
      // seed() above inserted the demo accounts.
      const adminCred = DEMO_CREDENTIALS.find((c) => c.role === "admin")!;
      const merchantCred = DEMO_CREDENTIALS.find((c) => c.role === "merchant")!;

      const adminLogin = await request(server, "POST", "/api/auth/login", {
        body: { email: adminCred.email, password: adminCred.password },
      });
      assert.equal(
        adminLogin.status,
        200,
        `Admin login failed (HTTP ${adminLogin.status}). ` +
          `seed() should have inserted ${adminCred.email}. ` +
          `Body: ${adminLogin.body.slice(0, 200)}`,
      );
      adminToken = (adminLogin.json as { token: string }).token;
      assert.ok(adminToken, "Admin login returned no token");

      const merchantLogin = await request(server, "POST", "/api/auth/login", {
        body: { email: merchantCred.email, password: merchantCred.password },
      });
      assert.equal(
        merchantLogin.status,
        200,
        `Merchant login failed (HTTP ${merchantLogin.status}). ` +
          `seed() should have inserted ${merchantCred.email}. ` +
          `Body: ${merchantLogin.body.slice(0, 200)}`,
      );
      merchantToken = (merchantLogin.json as { token: string }).token;
      assert.ok(merchantToken, "Merchant login returned no token");
    });

    after(async () => {
      // Destroy all open keep-alive connections before closing the server.
      // Without this, server.close() waits indefinitely for HTTP/1.1 keep-alive
      // connections to time out (default: never), which prevents the callback
      // from firing. closeAllConnections() is available in Node.js 18.2+.
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // End the pg pool so the Node.js process exits cleanly after all tests
      // complete.  Without this, the pool's idle connections are open handles
      // that prevent the test runner from terminating, causing an indefinite hang.
      await pool.end();
    });

    // ── Part A: dropped tables were absent before the guard ran ───────────────

    it("all 12 dropped tables were absent from the DB before runSchemaGuardWith()", () => {
      assert.ok(
        droppedTablesMissingBeforeGuard,
        "Some of the dropped tables were still visible before schemaGuard ran. " +
          "This means the DROP TABLE CASCADE did not take effect inside the " +
          "transaction, or information_schema.tables was not queried on the " +
          "same connection.",
      );
    });

    // ── Part A: every guarded table exists after the guard ran ────────────────

    for (const table of ALL_GUARDED_TABLES) {
      it(`schemaGuard created / preserved table "${table}"`, () => {
        assert.ok(
          tablesFoundAfterGuard.has(table.toLowerCase()),
          `Table "${table}" was NOT found in information_schema.tables after ` +
            `runSchemaGuardWith() executed inside the transaction.\n` +
            `For the 12 dropped tables this means the CREATE TABLE IF NOT EXISTS ` +
            `block is missing or incorrectly ordered in schemaGuard.ts.\n` +
            `For the other tables it means the table was absent even before the ` +
            `test ran — schemaGuard has no guard for it.`,
        );
      });
    }

    // ── Part B: every representative route returns HTTP 200 ───────────────────
    //
    // Routes are hit after ensureSchemaGuard() + seed() have run on the real DB,
    // so this section validates that the normal startup path makes every table-
    // touching route reachable.

    for (const { path, role, table } of GUARDED_ROUTES) {
      it(`GET ${path} returns 200 with ${role} Bearer token after startup (covers: ${table})`, async () => {
        const token = role === "admin" ? adminToken : merchantToken;
        const res = await request(server, "GET", path, { token });
        assert.equal(
          res.status,
          200,
          `Expected HTTP 200 from GET ${path} with ${role} token.\n` +
            `Got HTTP ${res.status}.  Covered table: ${table}.\n` +
            `• HTTP 500 → a table or column is missing after ensureSchemaGuard().\n` +
            `• HTTP 401/403 → Bearer token invalid or wrong role for route.\n` +
            `Response: ${res.body.slice(0, 400)}`,
        );
      });
    }

    // healthz — public endpoint; covers company_settings via startup path
    it("GET /api/healthz returns 200 after startup (covers company_settings)", async () => {
      const res = await request(server, "GET", "/api/healthz");
      assert.equal(
        res.status,
        200,
        `GET /api/healthz returned ${res.status}: ${res.body.slice(0, 200)}`,
      );
    });

    // ── Part C: payload validation for fresh-deploy initialisation logic ──────
    //
    // These two endpoints have "initialise on first GET" logic that can silently
    // 500 if the table was created without the expected DEFAULT values, or if a
    // NULL from SUM() over an empty table is not coerced to 0.
    //
    // On a CI fresh DB (ledgerTablesEmptyAtStartup / payinChargesEmptyAtStartup
    // are true) we assert exact zero values — the canonical fresh-deploy state.
    // On a developer's DB that already has rows we relax to "all fields are
    // finite numbers" so the test remains meaningful without requiring data
    // truncation.

    it("GET /api/admin/platform-profit/summary payload has all required numeric fields (no NaN / null)", async () => {
      const res = await request(server, "GET", "/api/admin/platform-profit/summary", {
        token: adminToken,
      });
      assert.equal(
        res.status,
        200,
        `Expected HTTP 200 from platform-profit/summary.\n` +
          `• HTTP 500 → SUM() over empty table returned NULL and was not safely coerced.\n` +
          `• HTTP 401/403 → admin token is not Super Admin.\n` +
          `Response: ${res.body.slice(0, 400)}`,
      );
      const payload = res.json as Record<string, unknown>;
      const SUMMARY_FIELDS = [
        "availableBalance",
        "todayProfit",
        "last7DaysProfit",
        "last15DaysProfit",
        "thisMonthProfit",
        "gstLiabilityBalance",
        "totalProviderCost",
        "netMargin",
      ] as const;
      for (const field of SUMMARY_FIELDS) {
        assert.ok(field in payload, `Summary payload missing field "${field}". Got: ${JSON.stringify(payload)}`);
        assert.equal(typeof payload[field], "number", `"${field}" should be a number, got ${typeof payload[field]}`);
        assert.ok(isFinite(payload[field] as number), `"${field}" is not finite (NaN or Infinity): ${payload[field]}`);
      }
    });

    it("GET /api/admin/platform-profit/summary all numeric fields are 0 on a fresh-install DB (no ledger rows)", async () => {
      if (!ledgerTablesEmptyAtStartup) {
        // Dev DB already has ledger entries — skip the zero-value check.
        // The previous test already validated structure + finite-number invariants.
        return;
      }
      const res = await request(server, "GET", "/api/admin/platform-profit/summary", {
        token: adminToken,
      });
      assert.equal(res.status, 200, `Unexpected HTTP ${res.status}: ${res.body.slice(0, 200)}`);
      const payload = res.json as Record<string, number>;
      for (const field of [
        "availableBalance", "todayProfit", "last7DaysProfit", "last15DaysProfit",
        "thisMonthProfit", "gstLiabilityBalance", "totalProviderCost", "netMargin",
      ]) {
        assert.equal(
          payload[field],
          0,
          `Expected "${field}" = 0 on empty ledger tables, got ${payload[field]}. ` +
            `Full payload: ${JSON.stringify(payload)}`,
        );
      }
    });

    it("GET /api/admin/payin-charges/ auto-creates singleton (id=1) with correct schema defaults when table is empty", async () => {
      const res = await request(server, "GET", "/api/admin/payin-charges/", {
        token: adminToken,
      });
      assert.equal(
        res.status,
        200,
        `Expected HTTP 200 from payin-charges/.\n` +
          `• HTTP 500 → INSERT singleton row failed — likely a NOT NULL column ` +
          `missing its DEFAULT value in schema or schemaGuard CREATE TABLE.\n` +
          `• HTTP 401/403 → admin token invalid.\n` +
          `Response: ${res.body.slice(0, 400)}`,
      );
      const payload = res.json as Record<string, unknown>;

      // id must always be 1 (singleton)
      assert.equal(payload["id"], 1, `Singleton id should be 1, got ${payload["id"]}`);

      // Boolean fields must be present and boolean-typed
      for (const field of ["enabled", "gstEnabled", "applyToOwnStaticUpi", "applyToDynamicQr", "applyToPaymentLinks", "applyToApiGateway"]) {
        assert.ok(field in payload, `Missing boolean field "${field}"`);
        assert.equal(typeof payload[field], "boolean", `"${field}" should be boolean, got ${typeof payload[field]}`);
      }

      // Numeric fields must be finite numbers
      for (const field of ["mdrPct", "fixedFee", "minFee", "gstPct"]) {
        assert.ok(field in payload, `Missing numeric field "${field}"`);
        assert.equal(typeof payload[field], "number", `"${field}" should be number`);
        assert.ok(isFinite(payload[field] as number), `"${field}" is not finite: ${payload[field]}`);
      }

      // roundingMode must be a string
      assert.equal(typeof payload["roundingMode"], "string", `"roundingMode" should be string`);

      if (payinChargesEmptyAtStartup) {
        // Fresh-install: singleton was just auto-created — verify schema defaults
        assert.equal(payload["enabled"],             false,   `"enabled" default should be false`);
        assert.equal(payload["gstEnabled"],          false,   `"gstEnabled" default should be false`);
        assert.equal(payload["mdrPct"],              0,       `"mdrPct" default should be 0`);
        assert.equal(payload["fixedFee"],            0,       `"fixedFee" default should be 0`);
        assert.equal(payload["minFee"],              0,       `"minFee" default should be 0`);
        assert.equal(payload["gstPct"],              18,      `"gstPct" default should be 18`);
        assert.equal(payload["roundingMode"],        "round", `"roundingMode" default should be "round"`);
        assert.equal(payload["applyToOwnStaticUpi"], true,    `"applyToOwnStaticUpi" default should be true`);
        assert.equal(payload["applyToDynamicQr"],    true,    `"applyToDynamicQr" default should be true`);
        assert.equal(payload["applyToPaymentLinks"], true,    `"applyToPaymentLinks" default should be true`);
        assert.equal(payload["applyToApiGateway"],   true,    `"applyToApiGateway" default should be true`);
        assert.equal(payload["maxFee"],              null,    `"maxFee" should be null on fresh singleton`);
      }
    });
  },
);
