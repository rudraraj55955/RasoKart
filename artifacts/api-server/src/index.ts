import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { seed } from "./seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  // DB health check — fail fast rather than serve a zombie
  try {
    await pool.query("SELECT 1");
    logger.info("Database connection verified");
  } catch (err) {
    logger.error({ err }, "Database health check failed — cannot start server");
    process.exit(1);
  }

  // Idempotent seed — safe to run on every boot
  try {
    await seed();
    logger.info("Database seed complete");
  } catch (err) {
    logger.warn({ err }, "Seed encountered an error (non-fatal)");
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });
}

main();
