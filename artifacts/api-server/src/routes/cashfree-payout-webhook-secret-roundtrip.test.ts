/**
 * Round-trip integration test: Cashfree Payout webhook-secret lifecycle
 *
 * Verifies the complete stack end-to-end using a stateful in-memory DB mock:
 *
 *   RT1 — set secret via PUT → bad sig → 401 (signature enforced)
 *   RT2 — clear secret via PUT (webhookSecret:"") → any payload → 200
 *          (upsertOrDelete deletes the row; no-secret branch skips verification)
 *   RT3 — re-set secret via PUT → correct sig → 200 (verification re-enabled)
 *   RT4 — re-set secret via PUT → bad sig → 401 (re-set secret enforced)
 *
 * The key difference from W1-W7 (unit stubs): here the DB mock is stateful —
 * writes from PUT /api/system-config/cashfree-payout are persisted in the mock
 * and visible to the subsequent webhook POST.  A regression in the PUT handler's
 * upsertOrDelete path (wrong key, missing delete, skipped encrypt) would break
 * the webhook step and be caught.
 *
 * Run:
 *   cd artifacts/api-server
 *   node --import tsx/esm --test \
 *     src/routes/cashfree-payout-webhook-secret-roundtrip.test.ts
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import {
  db,
  usersTable,
  systemConfigTable,
  auditLogsTable,
  SYSTEM_CONFIG_KEYS,
} from "@workspace/db";
import app from "../app.js";
import { generateToken } from "../middlewares/auth.js";

process.env["SESSION_SECRET"] ??= "rk_ci_wh_roundtrip_test_session_secret_32";

// ── Constants ─────────────────────────────────────────────────────────────────

const ADMIN_USER_ID = 9100;

const ADMIN_USER_ROW = {
  id: ADMIN_USER_ID,
  email: "admin-rt@ci.test",
  role: "admin",
  isActive: true,
  merchantId: null,
  passwordUpdatedAt: null,
  isSuperAdmin: true,   // bypasses requireAdmin permission check
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

function signPayoutWebhook(rawBody: string, secret: string, timestampSec?: number): Record<string, string> {
  const ts = String(timestampSec ?? Math.floor(Date.now() / 1000));
  const expected = crypto.createHmac("sha256", secret).update(ts + rawBody).digest("base64");
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
// Drizzle's eq(col, val) produces queryChunks where the value is wrapped in a
// Param object: chunk.encoder is truthy and chunk.value is the raw string.
// We use this to extract the key being deleted.

let configStore: Map<string, string>;

function extractDeleteKeyFromCondition(cond: any): string | null {
  const chunks: any[] = cond?.queryChunks ?? [];
  for (const chunk of chunks) {
    // Drizzle Param: has encoder (truthy) and a plain string value
    if (chunk?.encoder && typeof chunk.value === "string") {
      return chunk.value;
    }
  }
  return null;
}

/**
 * Build a thenable row list that also supports Drizzle's fluent chain methods:
 * .limit(), .orderBy(), .offset() — matching the pattern in the existing
 * webhook.security.audit.test.ts C-section stubs.
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

function getRowsForTable(tbl: unknown): any[] {
  if (tbl === usersTable) {
    // requireAuth looks up the user by userId
    return [ADMIN_USER_ROW];
  }
  if (tbl === systemConfigTable) {
    // Return all current configStore entries
    return Array.from(configStore.entries()).map(([key, value]) => ({ key, value }));
  }
  // auditLogsTable selects, merchantsTable for IAM, etc. — empty is fine
  return [];
}

function installStatefulDbMock() {
  // ── SELECT ────────────────────────────────────────────────────────────────
  // Handles db.select(cols?).from(tbl).where(cond)[.orderBy(...)][.limit(n)]
  (db as any).select = (_cols?: unknown) => {
    let _tbl: unknown = null;
    const chain: any = {
      from(tbl: unknown) {
        _tbl = tbl;
        return chain;
      },
      // .where() is the primary terminator — returns a thenable row list
      where(_cond: unknown) {
        return rows(getRowsForTable(_tbl));
      },
      // Support db.select().from(tbl).limit(n) without .where()
      limit(n: number) {
        return Promise.resolve(getRowsForTable(_tbl).slice(0, n));
      },
      // Support db.select().from(tbl).orderBy(...) without .where()
      orderBy(..._args: unknown[]) {
        return rows(getRowsForTable(_tbl));
      },
    };
    return chain;
  };

  // ── INSERT ────────────────────────────────────────────────────────────────
  // Handles:
  //   db.insert(systemConfigTable).values({key,value,...}).onConflictDoUpdate(...)
  //   db.insert(auditLogsTable).values({...})   [plain insert, no conflict clause]
  (db as any).insert = (tbl: unknown) => ({
    values: (vals: any) => {
      // The return value must be BOTH directly awaitable (for plain inserts)
      // AND have .onConflictDoUpdate() (for upserts).
      const upsertResult: any = Promise.resolve([]);
      upsertResult.onConflictDoUpdate = ({ set }: any) => {
        // For system_config: persist key → value into configStore
        if (tbl === systemConfigTable && vals?.key) {
          const storedValue = set?.value ?? vals.value ?? "";
          configStore.set(vals.key, storedValue);
        }
        return Promise.resolve([]);
      };
      return upsertResult;
    },
  });

  // ── DELETE ────────────────────────────────────────────────────────────────
  // Handles db.delete(systemConfigTable).where(eq(systemConfigTable.key, key))
  // Extracts the key from the Drizzle SQL Param chunk and removes it from configStore.
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
  // Some helpers (e.g. notifyAdminsOfCredentialRotation) may call update.
  // Return a no-op chain.
  (db as any).update = (_tbl: unknown) => ({
    set:   (_vals: unknown) => ({ where: () => Promise.resolve([]) }),
    where: ()               => Promise.resolve([]),
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

// ── RT section: Round-trip webhook-secret lifecycle ───────────────────────────

const PAYLOAD = {
  type: "TRANSFER_SUCCESS",
  data: {
    transfer: {
      transfer_id: "T_RT_LIFECYCLE",
      cf_transfer_id: "99999",
      transfer_status: "SUCCESS",
      transfer_utr: "UTR_RT",
    },
  },
};
const BODY_STR = JSON.stringify(PAYLOAD);

describe("RT — Cashfree Payout webhook-secret round-trip via config API", () => {
  it("RT1 — set secret via PUT → webhook enforces signature", async () => {
    configStore = new Map();
    installStatefulDbMock();

    const SECRET = "ci_rt_secret_set_phase_abc123";

    // ── Step 1: admin sets the webhook secret via the config API ─────────
    const putResp = await put(
      server,
      "/api/system-config/cashfree-payout",
      { webhookSecret: SECRET },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.ok(
      putResp.status === 200,
      `PUT should return 200, got ${putResp.status}. Body: ${putResp.body}`,
    );
    const cfg = putResp.json<{ webhookSecretSet: boolean }>();
    assert.equal(cfg.webhookSecretSet, true, "webhookSecretSet should be true after PUT");

    // ── Step 2: verify the secret is in the mock store ───────────────────
    assert.ok(
      configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET),
      "configStore must hold CASHFREE_PAYOUT_WEBHOOK_SECRET after PUT",
    );

    // ── Step 3: bad signature → 401 (secret is enforced) ────────────────
    const wrongHeaders = signPayoutWebhook(BODY_STR, "completely_wrong_secret");
    const webhookResp = await post(server, "/api/cashfree-payout/webhook", PAYLOAD, wrongHeaders);
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

  it("RT2 — clear secret via PUT (webhookSecret:'') → webhook accepts without signature", async () => {
    configStore = new Map();
    installStatefulDbMock();

    const SECRET = "ci_rt_secret_to_clear_xyz789";

    // ── Step 1: set the secret ────────────────────────────────────────────
    const setResp = await put(
      server,
      "/api/system-config/cashfree-payout",
      { webhookSecret: SECRET },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(setResp.status, 200, `Set PUT should return 200; got ${setResp.status}`);
    assert.ok(
      configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET),
      "Secret must be present in configStore after set",
    );

    // ── Step 2: clear the secret with webhookSecret: "" ──────────────────
    const clearResp = await put(
      server,
      "/api/system-config/cashfree-payout",
      { webhookSecret: "" },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(clearResp.status, 200, `Clear PUT should return 200; got ${clearResp.status}`);
    const cfg = clearResp.json<{ webhookSecretSet: boolean }>();
    assert.equal(cfg.webhookSecretSet, false, "webhookSecretSet must be false after clear");

    // ── Step 3: verify the key was deleted from the mock store ────────────
    assert.ok(
      !configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET),
      "configStore must NOT hold CASHFREE_PAYOUT_WEBHOOK_SECRET after clear",
    );

    // ── Step 4: bad signature → 200 (no secret → accept without verifying) ─
    const ts = String(Math.floor(Date.now() / 1000));
    const webhookResp = await post(server, "/api/cashfree-payout/webhook", PAYLOAD, {
      "Content-Type": "application/json",
      "x-webhook-signature": "bad_sig_after_clear",
      "x-webhook-timestamp": ts,
    });
    assert.equal(
      webhookResp.status,
      200,
      `No-secret branch must return 200; got ${webhookResp.status}. Body: ${webhookResp.body}`,
    );
    const whBody = webhookResp.json<{ ok: boolean; received: boolean }>();
    assert.equal(whBody.ok, true, "ok must be true when no secret configured");
    assert.equal(whBody.received, true, "received must be true when no secret configured");
  });

  it("RT2b — client-secret fallback: clearing dedicated webhookSecret keeps enforcement via clientSecret", async () => {
    configStore = new Map();
    installStatefulDbMock();

    const DEDICATED_SECRET = "ci_rt_dedicated_wh_secret_ddd444";
    const CLIENT_SECRET    = "ci_rt_client_fallback_eee555";

    // ── Step 1: set BOTH the dedicated webhook secret AND the client secret ─
    // The PUT endpoint encrypts clientSecret before storing (encryptSecret),
    // and stores webhookSecret as plain text. decryptSecret handles both.
    const setResp = await put(
      server,
      "/api/system-config/cashfree-payout",
      { webhookSecret: DEDICATED_SECRET, clientSecret: CLIENT_SECRET },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(setResp.status, 200, `Dual-secret PUT must return 200; got ${setResp.status}`);
    assert.ok(
      configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET),
      "Dedicated webhook secret must be in configStore",
    );
    assert.ok(
      configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET),
      "Client secret must be in configStore",
    );

    // ── Step 2: clear the dedicated webhook secret only ───────────────────
    // The handler falls back to clientSecret when the dedicated secret is absent.
    const clearResp = await put(
      server,
      "/api/system-config/cashfree-payout",
      { webhookSecret: "" },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(clearResp.status, 200, `Clear PUT must return 200; got ${clearResp.status}`);
    const clearCfg = clearResp.json<{ webhookSecretSet: boolean }>();
    assert.equal(clearCfg.webhookSecretSet, false, "webhookSecretSet must be false after clearing dedicated secret");
    assert.ok(
      !configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET),
      "Dedicated webhook secret must be absent from configStore after clear",
    );
    assert.ok(
      configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_CLIENT_SECRET),
      "Client secret must still be in configStore (not cleared)",
    );

    // ── Step 3: bad sig → 401 (client secret is now the active signing key) ─
    // The handler uses: activeSecret = decryptedWebhookSecret || decryptedClientSecret
    // With dedicated secret cleared, clientSecret becomes the fallback.
    // A wrong HMAC must still be rejected.
    const badHeaders = signPayoutWebhook(BODY_STR, "wrong_secret_after_clearing_dedicated");
    const badResp = await post(server, "/api/cashfree-payout/webhook", PAYLOAD, badHeaders);
    assert.equal(
      badResp.status,
      401,
      `Wrong sig must still return 401 when clientSecret is the fallback; got ${badResp.status}. Body: ${badResp.body}`,
    );

    // ── Step 4: correct sig for the CLIENT secret → 200 ──────────────────
    // The handler stores the client secret encrypted (encryptSecret). When it
    // reads it back, decryptSecret() decrypts it to the original CLIENT_SECRET
    // value. The HMAC signed with CLIENT_SECRET must pass.
    const correctHeaders = signPayoutWebhook(BODY_STR, CLIENT_SECRET);
    const goodResp = await post(server, "/api/cashfree-payout/webhook", PAYLOAD, correctHeaders);
    assert.equal(
      goodResp.status,
      200,
      `Correct sig for clientSecret must return 200; got ${goodResp.status}. Body: ${goodResp.body}`,
    );
    const goodBody = goodResp.json<{ ok: boolean; received: boolean }>();
    assert.equal(goodBody.ok, true, "ok must be true for correctly signed webhook");
    assert.equal(goodBody.received, true, "received must be true for correctly signed webhook");
  });

  it("RT3 — re-set secret via PUT → correct sig → 200 (verification re-enabled)", async () => {
    configStore = new Map();
    installStatefulDbMock();

    const FIRST_SECRET  = "ci_rt_first_secret_aaa111";
    const RESET_SECRET  = "ci_rt_reset_secret_bbb222";

    // ── Step 1: set secret ────────────────────────────────────────────────
    await put(
      server,
      "/api/system-config/cashfree-payout",
      { webhookSecret: FIRST_SECRET },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );

    // ── Step 2: clear it ─────────────────────────────────────────────────
    await put(
      server,
      "/api/system-config/cashfree-payout",
      { webhookSecret: "" },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.ok(
      !configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET),
      "Secret must be absent after clear",
    );

    // ── Step 3: re-set with a new secret ─────────────────────────────────
    const resetResp = await put(
      server,
      "/api/system-config/cashfree-payout",
      { webhookSecret: RESET_SECRET },
      { ...adminAuthHeader(), "Content-Type": "application/json" },
    );
    assert.equal(resetResp.status, 200, `Re-set PUT must return 200; got ${resetResp.status}`);
    const cfg = resetResp.json<{ webhookSecretSet: boolean }>();
    assert.equal(cfg.webhookSecretSet, true, "webhookSecretSet must be true after re-set");
    assert.ok(
      configStore.has(SYSTEM_CONFIG_KEYS.CASHFREE_PAYOUT_WEBHOOK_SECRET),
      "Secret must be present in configStore after re-set",
    );

    // ── Step 4: webhook with correct sig for the NEW secret → 200 ────────
    // The PUT handler stores webhookSecret as plain text (no encryptSecret call).
    // decryptSecret() treats non-enc:v1: strings as plain text pass-through,
    // so the active signing key is exactly RESET_SECRET.
    //
    // Note: the handler sends 200 immediately after signature verification
    // (before any DB payout lookups), so a valid sig always yields 200 +
    // { ok: true, received: true }.
    const correctHeaders = signPayoutWebhook(BODY_STR, RESET_SECRET);
    const webhookResp = await post(server, "/api/cashfree-payout/webhook", PAYLOAD, correctHeaders);
    assert.equal(
      webhookResp.status,
      200,
      `Correct sig after re-set must return 200; got ${webhookResp.status}. Body: ${webhookResp.body}`,
    );
    const whBody = webhookResp.json<{ ok: boolean; received: boolean }>();
    assert.equal(whBody.ok, true, "ok must be true for correctly signed webhook");
    assert.equal(whBody.received, true, "received must be true for correctly signed webhook");
  });

  it("RT4 — re-set secret via PUT → bad sig → 401 (re-enabled enforcement)", async () => {
    configStore = new Map();
    installStatefulDbMock();

    const RESET_SECRET = "ci_rt_enforcement_secret_ccc333";

    // Set, clear, re-set
    await put(server, "/api/system-config/cashfree-payout", { webhookSecret: "initial" }, { ...adminAuthHeader(), "Content-Type": "application/json" });
    await put(server, "/api/system-config/cashfree-payout", { webhookSecret: "" },         { ...adminAuthHeader(), "Content-Type": "application/json" });
    await put(server, "/api/system-config/cashfree-payout", { webhookSecret: RESET_SECRET }, { ...adminAuthHeader(), "Content-Type": "application/json" });

    // Bad signature must still be rejected
    const badHeaders = signPayoutWebhook(BODY_STR, "wrong_secret_post_reset");
    const webhookResp = await post(server, "/api/cashfree-payout/webhook", PAYLOAD, badHeaders);
    assert.equal(
      webhookResp.status,
      401,
      `Bad sig after re-set must return 401; got ${webhookResp.status}. Body: ${webhookResp.body}`,
    );
    const whBody = webhookResp.json<{ error: string }>();
    assert.ok(
      whBody.error?.toLowerCase().includes("invalid"),
      `Expected invalid-signature error; got: ${whBody.error}`,
    );
  });
});
