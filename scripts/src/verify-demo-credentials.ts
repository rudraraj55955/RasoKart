/**
 * verify-demo-credentials.ts
 *
 * Read-only health check for CI / manual use.
 *
 * Asserts that every account documented in replit.md's "Demo Credentials"
 * table actually exists, is active, has the right role, and authenticates
 * with its documented password. Does NOT modify any data — use
 * `fix-credentials.ts` if you need to repair a broken account.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run verify-demo-credentials
 *
 * Exit code is 0 when every documented account checks out, 1 otherwise —
 * safe to wire into a CI step or a post-deploy smoke test so a missing or
 * broken demo/test account fails loudly instead of surfacing later as a
 * silent 401.
 */

import bcrypt from "bcryptjs";
import { inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// Keep in sync with the "Demo Credentials" table in replit.md and with
// DEMO_CREDENTIALS in artifacts/api-server/src/seed.ts.
const DEMO_CREDENTIALS = [
  { email: "admin@rasokart.com", password: "Admin@123456", role: "admin" as const },
  { email: "merchant@demo.com", password: "Merchant@123456", role: "merchant" as const },
  { email: "merchant2@demo.com", password: "Merchant@123456", role: "merchant" as const },
];

async function run() {
  console.log("=== RasoKart Demo Credential Verification ===\n");

  const emails = DEMO_CREDENTIALS.map((c) => c.email);
  const rows = await db
    .select({
      email: usersTable.email,
      passwordHash: usersTable.passwordHash,
      role: usersTable.role,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(inArray(usersTable.email, emails));

  const byEmail = new Map(rows.map((r) => [r.email, r]));
  let allOk = true;

  for (const cred of DEMO_CREDENTIALS) {
    const row = byEmail.get(cred.email);

    if (!row) {
      allOk = false;
      console.error(`✗ FAIL | ${cred.email} | account does not exist in the database`);
      continue;
    }

    const passwordOk = await bcrypt.compare(cred.password, row.passwordHash);
    const roleOk = row.role === cred.role;
    const ok = passwordOk && roleOk && row.isActive;

    console.log(
      `${ok ? "✓ PASS" : "✗ FAIL"} | ${cred.email} | password=${passwordOk ? "ok" : "MISMATCH"} | role=${row.role}${roleOk ? "" : ` (expected ${cred.role})`} | isActive=${row.isActive}`,
    );

    if (!ok) allOk = false;
  }

  console.log(
    `\n${allOk ? "✅ All documented demo accounts can authenticate." : "❌ One or more documented demo accounts are broken — see replit.md 'Demo Credentials' and seed.ts."}`,
  );
  process.exit(allOk ? 0 : 1);
}

run().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
