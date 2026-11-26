/**
 * Integration test: canonical and legacy Cashfree payin webhook reachability.
 *
 * Both public URLs must resolve to the same fail-closed handler. With no
 * configured signing secret, a 401 proves the route exists without allowing
 * an unsigned payload to reach accounting.
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { db } from "@workspace/db";
import app from "../app";

type Response = { status: number; body: Record<string, unknown> };

function postJson(server: http.Server, path: string): Promise<Response> {
  const address = server.address() as { port: number };
  const body = JSON.stringify({
    type: "PAYMENT_SUCCESS_WEBHOOK",
    data: {
      order: { order_id: "cashfree-route-reachability" },
      payment: { payment_status: "SUCCESS", payment_amount: 100 },
    },
  });

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
        response.on("end", () => {
          resolve({
            status: response.statusCode!,
            body: JSON.parse(raw) as Record<string, unknown>,
          });
        });
      },
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

describe("Cashfree payin webhook aliases", () => {
  let server: http.Server;
  const originalSelect = (db as any).select.bind(db);

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  after(async () => {
    (db as any).select = originalSelect;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    (db as any).select = originalSelect;
  });

  function stubNoSigningSecrets() {
    (db as any).select = () => ({
      from: () => ({
        where: async () => [],
      }),
    });
  }

  for (const path of [
    "/api/webhooks/payin",
    "/api/webhooks/payin/cashfree",
    "/api/payment/cashfree-webhook",
  ]) {
    it(`${path} reaches the shared fail-closed handler`, async () => {
      stubNoSigningSecrets();

      const { status, body } = await postJson(server, path);

      assert.equal(status, 401);
      assert.equal(body.error, "Webhook signing not configured");
    });
  }
});