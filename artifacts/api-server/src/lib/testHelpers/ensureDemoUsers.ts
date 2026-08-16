/**
 * Test helper: make /api/healthz/deep-style checks runnable on a fresh
 * (migrated but unseeded) database, e.g. the throwaway CI DB used by the
 * Production Deploy validate job, where unit tests run BEFORE the API server
 * (and therefore seed()) has ever started.
 *
 * - ensureDemoUsers(): inserts any missing documented demo accounts from
 *   DEMO_CREDENTIALS with a valid bcrypt hash. Existing rows are never
 *   modified (ON CONFLICT DO NOTHING keyed on users.email), so running this
 *   against an already-seeded dev database is a no-op.
 *
 * This file is a helper, not a test — it must NOT match *.test.ts.
 */

import bcrypt from "bcryptjs";
import { inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { DEMO_CREDENTIALS } from "@workspace/demo-credentials";
import { ensureSchemaGuard } from "../schemaGuard";
import { markServerInitialized } from "../startupState";

/**
 * One-stop prerequisite setup for tests that hit /api/healthz/deep:
 *   1. markServerInitialized() — the route returns 503 "starting" otherwise
 *      (index.ts normally sets this; unit tests never run index.ts).
 *   2. ensureSchemaGuard() — the route requires guard status "pass"; running
 *      the real guard is idempotent and also patches any columns a fresh
 *      CI database is missing.
 *   3. ensureDemoUsers() — the demo-credential check needs the documented
 *      demo accounts to exist (fresh CI DBs are migrated but unseeded).
 */
export async function prepareHealthzDeepTestEnv(): Promise<void> {
  markServerInitialized();
  await ensureSchemaGuard();
  await ensureDemoUsers();
}

export async function ensureDemoUsers(): Promise<void> {
  const emails = DEMO_CREDENTIALS.map((c) => c.email);
  const existing = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(inArray(usersTable.email, emails));
  const present = new Set(existing.map((r) => r.email.toLowerCase()));

  for (const cred of DEMO_CREDENTIALS) {
    if (present.has(cred.email.toLowerCase())) continue;
    const passwordHash = await bcrypt.hash(cred.password, 10);
    await db
      .insert(usersTable)
      .values({
        email: cred.email,
        passwordHash,
        name: cred.email.split("@")[0] ?? cred.email,
        role: cred.role,
        isActive: true,
      })
      .onConflictDoNothing();
  }
}
