/**
 * Single source of truth for documented demo/test accounts.
 *
 * These must match the "Demo Credentials" table in replit.md.
 * To add, remove, or change a demo account:
 *   1. Update THIS file only.
 *   2. Update the "Demo Credentials" table in replit.md.
 *   3. Run codegen if the OpenAPI spec is affected (it isn't for credentials).
 *
 * All three consumers — seed.ts, routes/health.ts, and
 * scripts/src/verify-demo-credentials.ts — import from here, so a single
 * edit propagates everywhere automatically.
 */

export type DemoCredentialRole = "admin" | "merchant";

export interface DemoCredential {
  email: string;
  password: string;
  role: DemoCredentialRole;
}

export const DEMO_CREDENTIALS: DemoCredential[] = [
  { email: "admin@rasokart.com", password: "Admin@123456", role: "admin" },
  { email: "merchant@demo.com", password: "Merchant@123456", role: "merchant" },
  { email: "merchant2@demo.com", password: "Merchant@123456", role: "merchant" },
  { email: "merchant3@demo.com", password: "Merchant@123456", role: "merchant" },
];
