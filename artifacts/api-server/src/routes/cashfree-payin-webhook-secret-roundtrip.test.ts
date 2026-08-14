/**
 * Round-trip integration test: Cashfree Payin webhook-secret lifecycle
 *
 * Verifies the complete stack end-to-end using a stateful in-memory DB mock:
 *
 *   RT1 — set secret via PUT → bad sig → 401 (signature enforced)
 *   RT2 — clear secret via PUT (webhookSecret:"") → any payload → 200
 *          (upsertOrDelete deletes the row; no-secret branch skips verification)
 *   RT3 — re-set secret via PUT → correctly-signed request → 200
 *          (verification re-enabled; correctly signed with stored encrypted value)
 *   RT4 — re-set secret via PUT → bad sig → 401 (re-set secret enforced)
 *
 * The key difference from stateless unit stubs: here the DB mock is stateful —
 * writes from PUT /api/system-config/cashfree are persisted in the mock and
 * visible to the subsequent webhook POST to /api/payment/cashfree-webhook.
 * A regression in the PUT handler's upsertOrDelete path (wrong key, missing
 * delete, skipped encrypt) would break the webhook step and be caught.
 *
 * Note on encryption: PUT /api/system-config/cashfree encrypts the webhook
 * secret via encryptSecret() before storing.  The cashfreeWebhook.ts handler
 * currently reads the stored value directly without calling decryptSecret().
 * RT3 therefore signs with the raw stored (encrypted) value from configStore
 * so that it matches exactly what the handler uses as its HMAC key.
 * (See task #2634 for the follow-up that adds decryptSecret() to the handler.)
 *
 * Run:
 *   cd artifacts/api-server
 *   node --import tsx/esm --test \
 *     src/routes/cashfree-payin-webhook-secret-roundtrip.test.ts
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import {
  db,
  usersTable,
  systemConfigTable,
  SYSTEM_CONFIG_KEYS,
} from "@workspace/db";
import app from "../app.js";
import { generateToken } from "../middlewares/auth.js";

process.env["SESSION_SECRET"] ??= "rk_ci_payin_wh_roundtrip_test_session_s32";

// ── Constants ─────────────────────────────────────────────────────────────────

const ADMIN_USER_ID = 9200;

const ADMIN_USER_ROW = {
  id: ADMIN_USER_ID,
  email: "admin-payin-rt@ci.test",
  role: "admin",
  isActive: true,
  merchantId: null,
  passwordUpdatedAt: null,
  isSuperAdmin: true,   // bypasses requirePermission for ADMIN_SETTINGS
  isSuperAdmin2: true,
  isPayoutAdmin: false,
};

// ── HTTP helpers ──────────────────────────────────────────────────────────────

interface HttpResult {
  status: number;
  body: string;
  json<T = unknown>(): T;
}

function doRequest(
  server: http.Server,
  method: string,
  path: string,
  bodyObj: object | null,
  extraHeaders: Record<string, string> = {},
): Promise<HttpResult> {
  const addr = server.address() as { port: number };
  const data = bodyObj != null ? JSON.stringify(bodyObj) : "";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...extraHeaders,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => { body += c; });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body,
            json<T>() { return JSON.parse(body) as T; },
          });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function post(server: http.Server, path: string, body: object | null, headers: Record<string, string> = {}) {
  return doRequest(server, "POST", path, body, headers);
}
function put(server: http.Server, path: string, body: object | null, headers: Record<string, string> = {}) {
  return doRequest(server, "PUT", path, body, headers);
}

// ── Signing helper (mirrors verifyCashfreeWebhookSignature) ───────────────────
//
// The payin handler computes:
//   HMAC-SHA256(timestamp + rawBody, storedSecretValue) → base64
// where storedSecretValue is whatever is in system_config (may be encrypted).
// Pass the raw stored value (from configStore) so the signature matches exactly.

function signPayinWebhook(rawBody: string, storedSecret: string, timestampSec?: number): Record<string, string> {
  const ts = String(timestampSec ?? Math.floor(Date.now() / 1000));
  const expected = crypto.createHmac("sha256", storedSecret).update(ts + rawBody).digest("base64");
  return {
    "x-webhook-signature": expected,
    "x-webhook-timestamp": ts,
    "Content-Type": "application/json",
  };
}

function adminAuthHeader(): Record<string, string> {
  const token = generateToken({ userId: ADMIN_USER_ID, role: "admin" });
  return { Authorization: `Bearer ${token}` };
}

// ── Stateful DB mock ──────────────────────────────────────────────────────────
//
// configStore mirrors what is in system_config after each PUT call.
// Reads (for the webhook handler) and writes (from the PUT handler) both go
// through configStore so the state flows through the entire stack.
//
// The mock intentionally models only the tables used in this test flow:
//   - usersTable       → requireAuth resolution
//   - systemConfigTable → config reads (webhook) and writes (PUT config)
//   - all other tables  → empty (the webhook acknowledges before order lookups)
//
// Drizzle's eq(col, val) produces queryChunks where the value is wrapped in a
// Param object: chunk.encoder is truthy and chunk.value is the raw string.
// We use this to extract the key being deleted.

let configStore: Map<string, string>;

function extractDeleteKeyFromCondition(cond: any): string | null {
  const chunks: any[] = cond?.queryChunks ?? [];
  for (const chunk of chunks) {
    if (chunk?.encoder && typeof chunk.value === "string") {
      return chunk.value;
    }
  }
  return null;
}

/**
 * Build a thenable row list that also supports Drizzle's fluent chain methods:
 * .limit(), .orderBy(), .offset()
 */
function rows<T>(data: T[]): any {
  const p: any = Promise.resolve(data);
  p.limit   = (n: number) => Promise.resolve(data.slice(0, n));
  p.orderBy = (..._: unknown[]) => {
    const p2: any = Promise.resolve(data);
    p2.limit  = (n: number) => Promise.resolve(data.slice(0, n));
    p2.offset = ()           => Promise.resolve([]);
    return p2;
  };
  p.offset = () => Promise.resolve([]);
  return p;
}

function getAllConfigRows(): Array<{ key: string; value: string }> {
  return Array.from(configStore.entries()).map(([key, value]) => ({ key, value }));
}

/**
 * Extract the equality key from a Drizzle eq() condition so the select mock
 * can filter configStore rows when the query uses eq(systemConfigTable.key, k).
 *
 * Drizzle eq() produces queryChunks where the bound value is a Param object
 * with an encoder (truthy) and a plain string value.  This is the same
 * extraction used by extractDeleteKeyFromCondition for DELETE queries.
 *
 * Returns null for inArray() and other complex conditions — those callers
 * (getCashfreeConfig, getLastUpdatedInfo) want all rows and get them.
 */
function extractEqKeyFromCondition(cond: any): string | null {
  const chunks: any[] = cond?.queryChunks ?? [];
  let paramCount = 0;
  let paramValue: string | null = null;
  for (const chunk of chunks) {
    if (chunk?.encoder && typeof chunk.value === "string") {
      paramCount++;
      paramValue = chunk.value;
    }
  }
  // inArray() produces multiple Param chunks; only eq() produces exactly one
  return paramCount === 1 ? paramValue : null;
}

function getRowsForTable(tbl: unknown): any[] {
  if (tbl === usersTable) {
    return [ADMIN_USER_ROW];
  }
  if (tbl === systemConfigTable) {
    return getAllConfigRows();
  }
  // cashfreePaymentOrdersTable, cashfreePaymentLogsTable, transactionsTable, etc.
  // The webhook handler sends the HTTP 200 response BEFORE reaching order lookups,
  // so returning empty here does not affect the HTTP status code under test.
  return [];
}

function getFilteredRows(tbl: unknown, cond: unknown): any[] {
  if (tbl === systemConfigTable) {
    const eqKey = extractEqKeyFromCondition(cond);
    if (eqKey !== null) {
      // Precise key filter: only return the matching row
      const val = configStore.get(eqKey);
      return val !== undefined ? [{ key: eqKey, value: val }] : [];
    }
    // inArray() or other complex condition: return all rows
    return getAllConfigRows();
  }
  return getRowsForTable(tbl);
}

function installStatefulDbMock() {
  // ── SELECT ────────────────────────────────────────────────────────────────
  (db as any).select = (_cols?: unknown) => {
    let _tbl: unknown = null;
    const chain: any = {
      from(tbl: unknown) {
        _tbl = tbl;
        return chain;
      },
      where(cond: unknown) {
        return rows(getFilteredRows(_tbl, cond));
      },
      limit(n: number) {
        return Promise.resolve(getRowsForTable(_tbl).slice(0, n));
      },
      orderBy(..._args: unknown[]) {
        return rows(getRowsForTable(_tbl));
      },
    };
    return chain;
  };

  // ── INSERT ────────────────────────────────────────────────────────────────
  // Handles:
  //   db.insert(systemConfigTable).values({key,value,...}).onConflictDoUpdate(...)
  //   db.insert(auditLogsTable).values({...})           [plain insert]
  //   db.insert(cashfreePaymentLogsTable).values({...}) [plain insert — log]
  (db as any).insert = (tbl: unknown) => ({
    values: (vals: any) => {
      const upsertResult: any = Promise.resolve([]);
      upsertResult.onConflictDoUpdate = ({ set }: any) => {
        if (tbl === systemConfigTable && vals?.key) {
          // The set object contains the final persisted value
          const storedValue = set?.value ?? vals.value ?? "";
          configStore.set(vals.key, storedValue);
        }
        return Promise.resolve([]);
      };
      // onConflictDoNothing (used by transactionsTable in the webhook)
      upsertResult.onConflictDoNothing = () => Promise.resolve([]);
      return upsertResult;
    },
  });

  // ── DELETE ────────────────────────────────────────────────────────────────
  // Handles db.delete(systemConfigTable).where(eq(systemConfigTable.key, key))
  // This is the path taken by upsertOrDelete when webhookSecret === "".
  (db as any).delete = (tbl: unknown) => ({
    where: (cond: unknown) => {
      if (tbl === systemConfigTable) {
        const key = extractDeleteKeyFromCondition(cond);
        if (key) {
          configStore.delete(key);
        }
      }
      return Promise.resolve([]);
    },
  });

  // ── UPDATE ────────────────────────────────────────────────────────────────
  // The webhook handler issues db.update(cashfreePaymentOrdersTable) after
  // sending the HTTP 200 response.  A no-op chain is sufficient — the HTTP
  // status is already set before this call is reached.
  (db as any).update = (_tbl: unknown) => ({
    set:   (_vals: unknown) => ({
      where: () => Promise.resolve([]),
    }),
    where: () => Promise.resolve([]),
  });
}

function restoreDbMock() {
  (db as any).select = undefined;
  (db as any).insert = undefined;
  (db as any).delete = undefined;
  (db as any).update = undefined;
}

// ── Test server ───────────────────────────────────────────────────────────────

let server: http.Server;

before(async () => {
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
});

after(async () => {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
});

afterEach(() => {
  restoreDbMock();
  configStore = new Map();
});

// ── RT section: Round-trip payin webhook-secret lifecycle ─────────────────────

const PAYIN_PAYLOAD = {
  type: "PAYMENT_SUCCESS_WEBHOOK",
  data: {
    order: { order_id: "PAYIN_RT_CI_001", order_amount: 500 },
    payment: { payment_status: "SUCCESS", payment_amount: 500, cf_payment_id: "CF_RT_CI_001" },
  },
};
const PAYIN_BODY_STR = JSON.stringify(PAYIN_PAYLOAD);

describe("RT — Cashfree Payin webhook-secret round-trip via config API", () => {
  it("RT1 — set secret via PUT → webhook enforces signature (bad sig → 401)", async () => {
    configStore = new Map([
      [SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED, "true"],
    ]);
    installStatefulDbMock();

    const SECRET = "ci_payin_rt_secret_set_abc123";

    // ── Step 1: admin sets the webhook secret via the config API ─────────
    const putResp = await put(
      server,
      "/api/system-config/cashfree",
      { webhookSecret: SECRET },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.ok(
      putResp.status === 200,
      `PUT should return 200, got ${putResp.status}. Body: ${putResp.body}`,
    );
    const cfg = putResp.json<{ webhookSecretSet: boolean }>();
    assert.equal(cfg.webhookSecretSet, true, "webhookSecretSet must be true after PUT");

    // ── Step 2: verify the secret is now in the mock store ───────────────
    assert.ok(
      configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET),
      "configStore must hold CASHFREE_WEBHOOK_SECRET after PUT",
    );

    // ── Step 3: bad signature → 401 (enforcement is active) ─────────────
    const wrongHeaders = signPayinWebhook(PAYIN_BODY_STR, "completely_wrong_secret");
    const webhookResp = await post(server, "/api/payment/cashfree-webhook", PAYIN_PAYLOAD, wrongHeaders);
    assert.equal(
      webhookResp.status,
      401,
      `Wrong sig must return 401 when secret is set; got ${webhookResp.status}. Body: ${webhookResp.body}`,
    );
    const whBody = webhookResp.json<{ error: string }>();
    assert.ok(
      whBody.error?.toLowerCase().includes("invalid"),
      `Expected invalid-signature error; got: ${whBody.error}`,
    );
  });

  it("RT2 — clear secret via PUT (webhookSecret:'') → webhook accepts without signature (200)", async () => {
    configStore = new Map([
      [SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED, "true"],
    ]);
    installStatefulDbMock();

    const SECRET = "ci_payin_rt_secret_to_clear_xyz789";

    // ── Step 1: set the secret ────────────────────────────────────────────
    const setResp = await put(
      server,
      "/api/system-config/cashfree",
      { webhookSecret: SECRET },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(setResp.status, 200, `Set PUT should return 200; got ${setResp.status}`);
    assert.ok(
      configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET),
      "Secret must be present in configStore after set",
    );

    // ── Step 2: clear the secret with webhookSecret: "" ──────────────────
    // The PUT handler calls upsertOrDelete(key, "") which runs
    // db.delete(systemConfigTable).where(eq(key, CASHFREE_WEBHOOK_SECRET)),
    // removing the row entirely.
    const clearResp = await put(
      server,
      "/api/system-config/cashfree",
      { webhookSecret: "" },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(clearResp.status, 200, `Clear PUT should return 200; got ${clearResp.status}`);
    const cfg = clearResp.json<{ webhookSecretSet: boolean }>();
    assert.equal(cfg.webhookSecretSet, false, "webhookSecretSet must be false after clear");

    // ── Step 3: verify the key was removed from the mock store ────────────
    assert.ok(
      !configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET),
      "configStore must NOT hold CASHFREE_WEBHOOK_SECRET after clear",
    );

    // ── Step 4: any payload with garbage sig → 200 (no-secret → skip verify) ─
    // The handler reads webhookSecret = secretRow?.value ?? "". When the row is
    // absent the value is "" which is falsy, so the if(webhookSecret) block is
    // skipped entirely and the request passes through to acknowledgement.
    const ts = String(Math.floor(Date.now() / 1000));
    const webhookResp = await post(server, "/api/payment/cashfree-webhook", PAYIN_PAYLOAD, {
      "Content-Type": "application/json",
      "x-webhook-signature": "garbage_sig_after_clear",
      "x-webhook-timestamp": ts,
    });
    assert.equal(
      webhookResp.status,
      200,
      `No-secret branch must return 200; got ${webhookResp.status}. Body: ${webhookResp.body}`,
    );
    const whBody = webhookResp.json<{ success: boolean }>();
    assert.equal(whBody.success, true, "success must be true when no secret configured");
  });

  it("RT3 — re-set secret via PUT → correctly-signed request → 200 (verification re-enabled)", async () => {
    configStore = new Map([
      [SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED, "true"],
    ]);
    installStatefulDbMock();

    const FIRST_SECRET = "ci_payin_rt_first_secret_aaa111";
    const RESET_SECRET = "ci_payin_rt_reset_secret_bbb222";

    // ── Step 1: set secret ────────────────────────────────────────────────
    await put(
      server,
      "/api/system-config/cashfree",
      { webhookSecret: FIRST_SECRET },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );

    // ── Step 2: clear it ─────────────────────────────────────────────────
    await put(
      server,
      "/api/system-config/cashfree",
      { webhookSecret: "" },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.ok(
      !configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET),
      "Secret must be absent after clear",
    );

    // ── Step 3: re-set with a new secret ─────────────────────────────────
    const resetResp = await put(
      server,
      "/api/system-config/cashfree",
      { webhookSecret: RESET_SECRET },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(resetResp.status, 200, `Re-set PUT must return 200; got ${resetResp.status}`);
    const cfg = resetResp.json<{ webhookSecretSet: boolean }>();
    assert.equal(cfg.webhookSecretSet, true, "webhookSecretSet must be true after re-set");
    assert.ok(
      configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET),
      "Secret must be present in configStore after re-set",
    );

    // ── Step 4: webhook with correctly-signed request → 200 ──────────────
    // The PUT handler stores encryptSecret(RESET_SECRET) as the raw value.
    // cashfreeWebhook.ts reads this raw stored value and passes it directly
    // to verifyCashfreeWebhookSignature() without decryption.
    // To produce a valid signature we must sign with the same raw stored value.
    //
    // (Follow-up task #2634 will add decryptSecret() to the handler, at which
    // point the correct signing key becomes the plain RESET_SECRET again.)
    const storedSecretValue = configStore.get(SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET)!;
    assert.ok(storedSecretValue, "Stored secret value must be non-empty after re-set");

    const correctHeaders = signPayinWebhook(PAYIN_BODY_STR, storedSecretValue);
    const webhookResp = await post(server, "/api/payment/cashfree-webhook", PAYIN_PAYLOAD, correctHeaders);
    assert.equal(
      webhookResp.status,
      200,
      `Correctly signed webhook must return 200 after re-set; got ${webhookResp.status}. Body: ${webhookResp.body}`,
    );
    const whBody = webhookResp.json<{ success: boolean }>();
    assert.equal(whBody.success, true, "success must be true for correctly signed webhook");
  });

  it("RT4 — re-set secret via PUT → bad sig → 401 (re-enabled enforcement)", async () => {
    configStore = new Map([
      [SYSTEM_CONFIG_KEYS.CASHFREE_ENABLED, "true"],
    ]);
    installStatefulDbMock();

    const RESET_SECRET = "ci_payin_rt_enforcement_secret_ccc333";

    // Set, clear, re-set
    await put(server, "/api/system-config/cashfree", { webhookSecret: "initial_secret" }, { ...adminAuthHeader(), "Content-Type": "application/json" });
    await put(server, "/api/system-config/cashfree", { webhookSecret: "" },               { ...adminAuthHeader(), "Content-Type": "application/json" });
    await put(server, "/api/system-config/cashfree", { webhookSecret: RESET_SECRET },     { ...adminAuthHeader(), "Content-Type": "application/json" });

    assert.ok(
      configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_WEBHOOK_SECRET),
      "Secret must be present after re-set",
    );

    // Bad signature must still be rejected after re-set
    const badHeaders = signPayinWebhook(PAYIN_BODY_STR, "wrong_secret_post_reset");
    const webhookResp = await post(server, "/api/payment/cashfree-webhook", PAYIN_PAYLOAD, badHeaders);
    assert.equal(
      webhookResp.status,
      401,
      `Bad sig after re-set must return 401; got ${webhookResp.status}. Body: ${webhookResp.body}`,
    );
    const whBody = webhookResp.json<{ error: string }>();
    assert.ok(
      whBody.error?.toLowerCase().includes("invalid"),
      `Expected invalid-signature error after re-set; got: ${whBody.error}`,
    );
  });
});
