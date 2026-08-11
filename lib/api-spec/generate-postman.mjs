#!/usr/bin/env node
/**
 * generate-postman.mjs
 *
 * Generates a Postman v2.1 collection from lib/api-spec/openapi.yaml.
 * Uses only verified, existing API routes from the RasoKart backend.
 *
 * Output: lib/api-spec/rasokart.postman_collection.json
 *
 * Usage:
 *   node lib/api-spec/generate-postman.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load js-yaml ──────────────────────────────────────────────────────────────
// js-yaml 4.x is a CJS module; load via createRequire.
// In a pnpm workspace the package may not be at the workspace root node_modules;
// fall back to the pnpm content-addressed store path.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
let jsYaml;
try {
  jsYaml = require("js-yaml");
} catch {
  // pnpm store path (works when run from workspace root)
  const storePath = "/home/runner/workspace/node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml/index.js";
  jsYaml = require(storePath);
}

const SPEC_PATH = resolve(__dirname, "openapi.yaml");
const OUT_PATH = resolve(__dirname, "rasokart.postman_collection.json");

const specRaw = readFileSync(SPEC_PATH, "utf-8");
const spec = jsYaml.load(specRaw);

const BASE_URL = "{{base_url}}";

// ── Postman variable definitions ──────────────────────────────────────────────
const variables = [
  { key: "base_url",     value: "https://rasokart.com/api", type: "string" },
  { key: "merchant_token", value: "",                       type: "string", description: "JWT from POST /auth/login" },
  { key: "admin_token",    value: "",                       type: "string", description: "Admin JWT from POST /auth/login" },
  { key: "api_key",        value: "",                       type: "string", description: "API key from merchant dashboard" },
  { key: "api_secret",     value: "",                       type: "string", description: "API secret from merchant dashboard" },
  { key: "merchant_id",    value: "",                       type: "string" },
  { key: "transaction_id", value: "",                       type: "string" },
  { key: "withdrawal_id",  value: "",                       type: "string" },
  { key: "qr_code_id",     value: "",                       type: "string" },
  { key: "va_id",          value: "",                       type: "string" },
  { key: "payment_link_id", value: "",                      type: "string" },
  { key: "beneficiary_id",  value: "",                      type: "string" },
  { key: "order_id",        value: "",                      type: "string" },
];

// ── Tag → folder mapping (curated subset for public collection) ───────────────
const INCLUDED_TAGS = new Set([
  "health", "auth", "merchants", "transactions", "withdrawals",
  "payout-beneficiaries", "api-keys", "webhooks", "callbacks",
  "settlements", "qr-codes", "virtual-accounts", "payment-links",
  "ledger", "notifications", "account-details", "invoices",
  "kyc", "reports", "support", "verification",
]);

// Tag display names for Postman folders
const TAG_LABELS = {
  health: "🏥 Health",
  auth: "🔑 Authentication",
  merchants: "🏪 Merchants",
  transactions: "💳 Transactions",
  withdrawals: "💸 Withdrawals / Payouts",
  "payout-beneficiaries": "👤 Payout Beneficiaries",
  "api-keys": "🔐 API Keys",
  webhooks: "🔔 Webhooks",
  callbacks: "📨 Callback Logs",
  settlements: "📊 Settlements",
  "qr-codes": "📱 QR Codes",
  "virtual-accounts": "🏦 Virtual Accounts",
  "payment-links": "🔗 Payment Links",
  ledger: "📖 Ledger",
  notifications: "🔔 Notifications",
  "account-details": "🏦 Account Details",
  invoices: "🧾 Invoices",
  kyc: "🪪 KYC",
  reports: "📈 Reports",
  support: "💬 Support",
  verification: "✅ Verification",
};

// ── Build tag → operations map ────────────────────────────────────────────────
const tagFolders = {};
for (const tag of INCLUDED_TAGS) {
  tagFolders[tag] = [];
}

const paths = spec.paths || {};

for (const [pathStr, pathObj] of Object.entries(paths)) {
  const methods = ["get", "post", "put", "patch", "delete", "options"];
  for (const method of methods) {
    const op = pathObj[method];
    if (!op) continue;

    // Use first matching included tag
    const opTags = op.tags || ["misc"];
    const matchedTag = opTags.find(t => INCLUDED_TAGS.has(t));
    if (!matchedTag) continue;

    // Build Postman request URL
    // Replace {param} → :param for Postman path variables
    const cleanPath = pathStr.replace(/\{([^}]+)\}/g, ":$1");
    const url = {
      raw: `${BASE_URL}${cleanPath}`,
      host: [`${BASE_URL}`],
      path: cleanPath.replace(/^\//, "").split("/"),
    };

    // Extract path params
    const pathParams = [...pathStr.matchAll(/\{([^}]+)\}/g)].map(m => ({
      key: m[1],
      value: `{{${m[1]}}}`,
      description: "",
    }));

    // Auth header (skip for public endpoints)
    const isPublic = (op["x-public"] === true) ||
      (matchedTag === "health") ||
      (pathStr.includes("/auth/login") || pathStr.includes("/auth/merchant/otp") ||
       pathStr.includes("/auth/merchant/password") || pathStr.includes("/auth/social"));

    const headers = [];
    if (!isPublic) {
      headers.push({
        key: "Authorization",
        value: "Bearer {{merchant_token}}",
        description: "JWT from POST /auth/login",
      });
    }
    headers.push({ key: "Content-Type", value: "application/json" });

    // Build request body for POST/PUT/PATCH
    let body = null;
    if (["post", "put", "patch"].includes(method)) {
      const reqBody = op.requestBody;
      if (reqBody?.content?.["application/json"]?.schema) {
        const schema = reqBody.content["application/json"].schema;
        const example = buildExampleFromSchema(schema, spec.components);
        body = {
          mode: "raw",
          raw: JSON.stringify(example, null, 2),
          options: { raw: { language: "json" } },
        };
      } else {
        body = {
          mode: "raw",
          raw: "{}",
          options: { raw: { language: "json" } },
        };
      }
    }

    // Query params from spec
    const queryParams = [];
    for (const param of (op.parameters || [])) {
      if (param.in === "query") {
        queryParams.push({
          key: param.name,
          value: param.example ? String(param.example) : "",
          description: param.description || "",
          disabled: !param.required,
        });
      }
    }

    const request = {
      method: method.toUpperCase(),
      header: headers,
      url: queryParams.length > 0 ? { ...url, query: queryParams } : url,
      description: op.summary || op.description || "",
    };
    if (body) request.body = body;
    if (pathParams.length > 0) request.url.variable = pathParams;

    tagFolders[matchedTag].push({
      name: op.summary || `${method.toUpperCase()} ${pathStr}`,
      request,
      response: [],
    });
  }
}

// ── Build Postman collection ──────────────────────────────────────────────────
const items = [];
for (const [tag, ops] of Object.entries(tagFolders)) {
  if (ops.length === 0) continue;
  items.push({
    name: TAG_LABELS[tag] || tag,
    item: ops,
    description: spec.tags?.find(t => t.name === tag)?.description || "",
  });
}

const collection = {
  info: {
    name: "RasoKart Payment Gateway API",
    description: `RasoKart Payment Gateway REST API — Public Collection

Base URL: https://rasokart.com/api
OpenAPI Spec: https://rasokart.com/api/openapi.yaml
Interactive Docs: https://rasokart.com/api/swagger

AUTHENTICATION:
1. POST {{base_url}}/auth/login with {"email":"...","password":"..."}
2. Copy token from response
3. Set {{merchant_token}} variable to the token

All protected endpoints use: Authorization: Bearer {{merchant_token}}

SANDBOX NOTE:
Provider sandbox mode is configured per-credential (Cashfree/PayU/Razorpay).
There is no global sandbox toggle — contact your RasoKart account manager for sandbox credentials.

NOT IMPLEMENTED (separate future tasks):
- Refunds API
- API versioning (/v1, /v2)

Last generated: ${new Date().toISOString().split("T")[0]}
OpenAPI version: ${spec.info?.version || "0.1.0"}`,
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    version: spec.info?.version || "0.1.0",
  },
  item: items,
  variable: variables,
  auth: {
    type: "bearer",
    bearer: [{ key: "token", value: "{{merchant_token}}", type: "string" }],
  },
};

writeFileSync(OUT_PATH, JSON.stringify(collection, null, 2), "utf-8");
console.log(`✓ Postman collection written to ${OUT_PATH}`);
console.log(`  Folders: ${items.length}`);
console.log(`  Total requests: ${items.reduce((n, f) => n + f.item.length, 0)}`);

// ── Helper: build example from JSON Schema ────────────────────────────────────
function buildExampleFromSchema(schema, components, depth = 0) {
  if (!schema || depth > 4) return {};
  if (schema.$ref) {
    const refName = schema.$ref.replace("#/components/schemas/", "");
    const refSchema = components?.schemas?.[refName];
    return refSchema ? buildExampleFromSchema(refSchema, components, depth + 1) : {};
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.type === "object" || schema.properties) {
    const obj = {};
    for (const [k, v] of Object.entries(schema.properties || {})) {
      obj[k] = buildExampleFromSchema(v, components, depth + 1);
    }
    return obj;
  }
  if (schema.type === "array") {
    return [buildExampleFromSchema(schema.items, components, depth + 1)];
  }
  if (schema.type === "string") return schema.enum?.[0] ?? "string";
  if (schema.type === "number" || schema.type === "integer") return 0;
  if (schema.type === "boolean") return false;
  return null;
}
