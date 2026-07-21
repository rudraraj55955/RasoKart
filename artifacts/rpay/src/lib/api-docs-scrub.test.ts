/**
 * Unit tests for the credential-scrubbing utilities in api-docs-scrub.ts.
 *
 * These tests guard against regressions in `looksLikeCredential`, `scrubFields`,
 * and the two adapters (`scrubCredentialsFromPreset` / `scrubCredentialsForShare`).
 * A silent change to the detection rules would cause credentials to leak into
 * export files or share links without any runtime warning.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeCredential,
  scrubFields,
  scrubCredentialsFromPreset,
  scrubCredentialsForShare,
} from "./api-docs-scrub.ts";

// ---------------------------------------------------------------------------
// looksLikeCredential
// ---------------------------------------------------------------------------

describe("looksLikeCredential", () => {
  describe("RasoKart API keys", () => {
    it("detects rasokart_live_ prefix", () => {
      assert.ok(looksLikeCredential("rasokart_live_abc123xyz"));
    });

    it("detects rasokart_secret_ prefix", () => {
      assert.ok(looksLikeCredential("rasokart_secret_abc123xyz"));
    });

    it("detects key with leading whitespace", () => {
      assert.ok(looksLikeCredential("  rasokart_live_abc123xyz"));
    });
  });

  describe("JWTs", () => {
    const JWT =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
      ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlRlc3QiLCJpYXQiOjE1MTYyMzkwMjJ9" +
      ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

    it("detects a well-formed JWT (three ey-prefixed segments)", () => {
      assert.ok(looksLikeCredential(JWT));
    });

    it("does not flag a value with only two segments", () => {
      assert.ok(!looksLikeCredential("eyXxx.eyYyy"));
    });

    it("does not flag a value whose segments don't start with 'ey'", () => {
      assert.ok(!looksLikeCredential("abc.def.ghi"));
    });
  });

  describe("safe values that must pass through", () => {
    it("returns false for an empty string", () => {
      assert.ok(!looksLikeCredential(""));
    });

    it("returns false for whitespace-only", () => {
      assert.ok(!looksLikeCredential("   "));
    });

    it("returns false for a plain order ID", () => {
      assert.ok(!looksLikeCredential("ORDER_12345"));
    });

    it("returns false for a numeric string", () => {
      assert.ok(!looksLikeCredential("9999"));
    });

    it("returns false for a normal merchant name", () => {
      assert.ok(!looksLikeCredential("Acme Corp"));
    });

    it("returns false for a UUID", () => {
      assert.ok(!looksLikeCredential("550e8400-e29b-41d4-a716-446655440000"));
    });

    it("returns false for a URL", () => {
      assert.ok(!looksLikeCredential("https://example.com/callback"));
    });
  });
});

// ---------------------------------------------------------------------------
// scrubFields — core scrubbing logic
// ---------------------------------------------------------------------------

const LIVE_KEY = "rasokart_live_supersecret123";
const SECRET_KEY = "rasokart_secret_supersecret456";
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiIxMjM0NTY3ODkwIn0" +
  ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("scrubFields — path params", () => {
  it("replaces a credential-shaped path param value with [REDACTED]", () => {
    const result = scrubFields({ merchantId: "123", apiKey: LIVE_KEY }, [], "");
    assert.equal(result.pathValues["apiKey"], "[REDACTED]");
    assert.equal(result.pathValues["merchantId"], "123");
  });

  it("passes through a safe path param unchanged", () => {
    const result = scrubFields({ id: "42" }, [], "");
    assert.equal(result.pathValues["id"], "42");
  });

  it("calls onRedacted with the correct label for a path param", () => {
    const labels: string[] = [];
    scrubFields({ token: LIVE_KEY }, [], "", (l) => labels.push(l));
    assert.deepEqual(labels, ['path param "{token}"']);
  });

  it("does NOT call onRedacted for a safe path param", () => {
    const labels: string[] = [];
    scrubFields({ id: "99" }, [], "", (l) => labels.push(l));
    assert.equal(labels.length, 0);
  });
});

describe("scrubFields — query params", () => {
  it("replaces a credential-shaped query param value with [REDACTED]", () => {
    const params = [
      { key: "api_key", value: LIVE_KEY },
      { key: "page", value: "1" },
    ];
    const result = scrubFields({}, params, "");
    assert.equal(result.queryParams[0].value, "[REDACTED]");
    assert.equal(result.queryParams[1].value, "1");
  });

  it("preserves the key name when redacting a query param", () => {
    const result = scrubFields({}, [{ key: "secret", value: SECRET_KEY }], "");
    assert.equal(result.queryParams[0].key, "secret");
  });

  it("calls onRedacted with the correct label for a query param", () => {
    const labels: string[] = [];
    scrubFields({}, [{ key: "bearer", value: JWT }], "", (l) => labels.push(l));
    assert.deepEqual(labels, ['query param "bearer"']);
  });

  it("does NOT call onRedacted for a safe query param", () => {
    const labels: string[] = [];
    scrubFields({}, [{ key: "limit", value: "10" }], "", (l) => labels.push(l));
    assert.equal(labels.length, 0);
  });
});

describe("scrubFields — JSON body", () => {
  it("replaces a top-level JSON field whose value looks like a credential", () => {
    const body = JSON.stringify({ apiKey: LIVE_KEY, amount: 100 });
    const result = scrubFields({}, [], body);
    const parsed = JSON.parse(result.body) as Record<string, unknown>;
    assert.equal(parsed["apiKey"], "[REDACTED]");
    assert.equal(parsed["amount"], 100);
  });

  it("replaces a nested JSON field whose value looks like a credential", () => {
    const body = JSON.stringify({ config: { token: JWT, retries: 3 } });
    const result = scrubFields({}, [], body);
    const parsed = JSON.parse(result.body) as Record<string, unknown>;
    const config = parsed["config"] as Record<string, unknown>;
    assert.equal(config["token"], "[REDACTED]");
    assert.equal(config["retries"], 3);
  });

  it("calls onRedacted with 'body field \"<path>\"' for nested JSON credentials", () => {
    const body = JSON.stringify({ auth: { key: LIVE_KEY } });
    const labels: string[] = [];
    scrubFields({}, [], body, (l) => labels.push(l));
    assert.deepEqual(labels, ['body field "auth.key"']);
  });

  it("calls onRedacted with 'body field \"<key>\"' for top-level JSON credentials", () => {
    const body = JSON.stringify({ token: JWT });
    const labels: string[] = [];
    scrubFields({}, [], body, (l) => labels.push(l));
    assert.deepEqual(labels, ['body field "token"']);
  });

  it("handles credentials inside a JSON array element", () => {
    const body = JSON.stringify({ keys: [LIVE_KEY, "safe-value"] });
    const result = scrubFields({}, [], body);
    const parsed = JSON.parse(result.body) as Record<string, unknown>;
    const keys = parsed["keys"] as string[];
    assert.equal(keys[0], "[REDACTED]");
    assert.equal(keys[1], "safe-value");
  });

  it("passes a safe JSON body through unchanged", () => {
    const body = JSON.stringify({ amount: 500, currency: "INR" });
    const result = scrubFields({}, [], body);
    assert.deepEqual(JSON.parse(result.body), { amount: 500, currency: "INR" });
  });
});

describe("scrubFields — non-JSON body fallback", () => {
  it("replaces the entire body with [REDACTED] when it looks like a credential", () => {
    const result = scrubFields({}, [], LIVE_KEY);
    assert.equal(result.body, "[REDACTED]");
  });

  it("calls onRedacted with 'request body' for a non-JSON credential body", () => {
    const labels: string[] = [];
    scrubFields({}, [], SECRET_KEY, (l) => labels.push(l));
    assert.deepEqual(labels, ["request body"]);
  });

  it("passes a non-JSON safe body through unchanged", () => {
    const result = scrubFields({}, [], "plain text body");
    assert.equal(result.body, "plain text body");
  });

  it("passes an empty body through unchanged", () => {
    const result = scrubFields({}, [], "");
    assert.equal(result.body, "");
  });
});

// ---------------------------------------------------------------------------
// scrubCredentialsFromPreset — export path
// ---------------------------------------------------------------------------

describe("scrubCredentialsFromPreset (export adapter)", () => {
  it("scrubs credentials from pathValues, queryParams, and body", () => {
    const preset = {
      id: "p1",
      name: "My preset",
      pathValues: { id: "7", key: LIVE_KEY },
      queryParams: [{ key: "auth", value: SECRET_KEY }],
      body: JSON.stringify({ token: JWT }),
    };

    const result = scrubCredentialsFromPreset(preset);

    assert.equal(result.pathValues["key"], "[REDACTED]");
    assert.equal(result.pathValues["id"], "7");
    assert.equal(result.queryParams[0].value, "[REDACTED]");
    const parsedBody = JSON.parse(result.body) as Record<string, unknown>;
    assert.equal(parsedBody["token"], "[REDACTED]");
  });

  it("preserves non-credential preset metadata (id, name) unchanged", () => {
    const preset = {
      id: "abc",
      name: "Safe preset",
      pathValues: { id: "1" },
      queryParams: [],
      body: "",
    };
    const result = scrubCredentialsFromPreset(preset);
    assert.equal(result.id, "abc");
    assert.equal(result.name, "Safe preset");
  });

  it("does NOT return a redactedFields array (export path never collects labels)", () => {
    const preset = {
      id: "p2",
      name: "Preset with cred",
      pathValues: { token: LIVE_KEY },
      queryParams: [],
      body: "",
    };
    const result = scrubCredentialsFromPreset(preset) as Record<string, unknown>;
    assert.ok(!("redactedFields" in result), "Export path must not expose redactedFields");
  });

  it("passes through a preset with no credentials unchanged", () => {
    const preset = {
      id: "safe",
      name: "Safe",
      pathValues: { orderId: "ORD123" },
      queryParams: [{ key: "page", value: "2" }],
      body: JSON.stringify({ amount: 100 }),
    };
    const result = scrubCredentialsFromPreset(preset);
    assert.equal(result.pathValues["orderId"], "ORD123");
    assert.equal(result.queryParams[0].value, "2");
    assert.deepEqual(JSON.parse(result.body), { amount: 100 });
  });
});

// ---------------------------------------------------------------------------
// scrubCredentialsForShare — share-link path
// ---------------------------------------------------------------------------

describe("scrubCredentialsForShare (share-link adapter)", () => {
  it("returns redactedFields listing every field that was stripped", () => {
    const result = scrubCredentialsForShare(
      { token: LIVE_KEY },
      [{ key: "auth", value: SECRET_KEY }],
      JSON.stringify({ key: JWT })
    );

    assert.ok(
      result.redactedFields.some((f) => f.includes("token")),
      "redactedFields must include the path param label"
    );
    assert.ok(
      result.redactedFields.some((f) => f.includes("auth")),
      "redactedFields must include the query param label"
    );
    assert.ok(
      result.redactedFields.some((f) => f.includes("key")),
      "redactedFields must include the body field label"
    );
  });

  it("returns an empty redactedFields array when there are no credentials", () => {
    const result = scrubCredentialsForShare(
      { id: "5" },
      [{ key: "page", value: "1" }],
      JSON.stringify({ amount: 200 })
    );
    assert.deepEqual(result.redactedFields, []);
  });

  it("replaces credential values with [REDACTED] in the returned fields", () => {
    const result = scrubCredentialsForShare(
      { apiKey: LIVE_KEY },
      [],
      ""
    );
    assert.equal(result.pathValues["apiKey"], "[REDACTED]");
  });

  it("preserves safe values in the returned fields", () => {
    const result = scrubCredentialsForShare(
      { merchantId: "42" },
      [{ key: "limit", value: "10" }],
      JSON.stringify({ currency: "INR" })
    );
    assert.equal(result.pathValues["merchantId"], "42");
    assert.equal(result.queryParams[0].value, "10");
  });
});
