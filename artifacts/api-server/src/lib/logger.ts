import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// Use pino-pretty transport only when running interactively (TTY stdout).
// In CI and when piped, process.stdout.isTTY is undefined/false, so the
// transport is skipped — this prevents pino from spawning a worker_thread
// that would keep the Node.js process alive after all tests complete.
const usePretty = !isProduction && process.stdout.isTTY === true;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(usePretty
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});
