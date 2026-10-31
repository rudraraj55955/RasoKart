import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { getIsolatedWhiteLabelTestDatabaseUrl } from "../lib/whiteLabelPgTestSafety";

test("real Drizzle finance command reservation + lifecycle against isolated PostgreSQL", async () => {
  const url = getIsolatedWhiteLabelTestDatabaseUrl(process.env);
  // The DB module must not initialize until the test-only URL has been validated.
  process.env.DATABASE_URL = url;
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS white_label_tenants (
      id serial PRIMARY KEY, slug text NOT NULL UNIQUE, display_name text NOT NULL,
      status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS white_label_finance_commands (
      id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES white_label_tenants(id),
      merchant_id integer NOT NULL, operation text NOT NULL, idempotency_key text NOT NULL,
      payload_hash text NOT NULL, status text NOT NULL DEFAULT 'reserved', result jsonb,
      created_by integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      CONSTRAINT wl_fin_cmd_unique_request UNIQUE (tenant_id,merchant_id,operation,idempotency_key)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS white_label_finance_audit (
      id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES white_label_tenants(id),
      merchant_id integer NOT NULL, command_id integer REFERENCES white_label_finance_commands(id),
      actor_id integer NOT NULL, action text NOT NULL, outcome text NOT NULL,
      metadata jsonb, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    const suffix = Date.now().toString(36);
    const slug = "wl-test-" + suffix;
    const { rows: [tenant] } = await pool.query(
      "INSERT INTO white_label_tenants(slug,display_name) VALUES($1,$2) RETURNING id", [slug, "Isolated test"],
    );
    try {
      const { reserveWhiteLabelFinanceCommand } = await import("../lib/whiteLabelCommandReservation");
      const { finalizeWhiteLabelFinanceCommand } = await import("../lib/whiteLabelCommandLifecycle");
      const input = { tenantId: tenant.id as number, merchantId: 501, actorId: 1,
        operation: "wallet_adjustment", idempotencyKey: "test_request_" + suffix + "_123456789", payloadHash: "a".repeat(64) };
      const requests = await Promise.all(Array.from({ length: 12 }, () => reserveWhiteLabelFinanceCommand(input)));
      assert.equal(requests.filter(r => r.outcome === "reserved").length, 1);
      assert.equal(requests.filter(r => r.outcome === "in_progress").length, 11);
      const id = requests[0].commandId!;
      assert.ok(id);
      const changed = await reserveWhiteLabelFinanceCommand({ ...input, payloadHash: "b".repeat(64) });
      assert.equal(changed.outcome, "conflict");
      assert.equal(await finalizeWhiteLabelFinanceCommand({ tenantId: tenant.id, merchantId: 501, commandId: id, actorId: 1, outcome: "completed" }), true);
      assert.equal(await finalizeWhiteLabelFinanceCommand({ tenantId: tenant.id, merchantId: 501, commandId: id, actorId: 1, outcome: "failed" }), false);
      assert.equal(await finalizeWhiteLabelFinanceCommand({ tenantId: tenant.id + 1, merchantId: 501, commandId: id, actorId: 1, outcome: "failed" }), false);
      assert.equal((await reserveWhiteLabelFinanceCommand(input)).outcome, "replay");
      const audit = await pool.query("SELECT outcome FROM white_label_finance_audit WHERE tenant_id=$1 ORDER BY id", [tenant.id]);
      assert.deepEqual(audit.rows.map(r => r.outcome), ["reserved", "completed"]);
    } finally {
      await pool.query("DELETE FROM white_label_finance_audit WHERE tenant_id=$1", [tenant.id]);
      await pool.query("DELETE FROM white_label_finance_commands WHERE tenant_id=$1", [tenant.id]);
      await pool.query("DELETE FROM white_label_tenants WHERE id=$1", [tenant.id]);
    }
  } finally {
    await pool.end();
  }
});
