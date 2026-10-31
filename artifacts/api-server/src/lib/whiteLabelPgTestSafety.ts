/** Hard stop against accidentally using a production DB during integration tests.
 * Requires explicit TEST_DATABASE_URL and test-only database naming.
 */
export function getIsolatedWhiteLabelTestDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const value = env.TEST_DATABASE_URL;
  if (!value) throw new Error("TEST_DATABASE_URL is required; production DB is forbidden");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid TEST_DATABASE_URL"); }
  if (!["postgresql:", "postgres:"].includes(url.protocol)) throw new Error("PostgreSQL URL required");
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!/^rasokart_wl_test(?:_[a-z0-9_]+)?$/.test(databaseName)) {
    throw new Error("Only rasokart_wl_test database names are permitted");
  }
  const forbidden = env.DATABASE_URL;
  if (forbidden && value === forbidden) throw new Error("TEST_DATABASE_URL matches application DATABASE_URL");
  if (env.NODE_ENV === "production") throw new Error("Integration tests cannot run in production");
  return value;
}
