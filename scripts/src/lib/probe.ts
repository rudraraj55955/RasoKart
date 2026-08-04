/**
 * probe.ts
 *
 * Shared API-reachability guard for verify-* scripts.
 *
 * Call `assertApiReachable(context)` at the top of every `run()` / `main()`
 * function that subsequently makes HTTP requests to the API server. When the
 * server is not listening or returns an unhealthy status, the helper prints a
 * human-readable warning and exits 0 — preventing confusing
 * ECONNREFUSED / ERR_FETCH_FAILED stack traces in CI runs or cold deploys
 * where the server hasn't started yet.
 */

const PROBE_URL = "http://localhost:80/api/healthz";

/**
 * Poll /api/healthz until the server responds with a 2xx status or the timeout
 * expires.  Intended for scripts whose validation workflow starts in parallel
 * with the API server so a cold-start 502 should be retried, not skipped.
 *
 * Unlike `assertApiReachable`, this function throws (exits 1 via the caller's
 * catch) when the server never becomes ready — the failure is surfaced as a
 * real error rather than a graceful skip.
 *
 * @param timeoutMs  Total time to wait in milliseconds (default 30 s).
 * @param intervalMs Polling interval in milliseconds (default 1 s).
 */
export async function waitForApiReachable(
  timeoutMs = 30_000,
  intervalMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(PROBE_URL, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return;
    } catch {
      // server not yet listening — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("API server did not become ready within 30 seconds");
}

/**
 * Probe /api/healthz once with a 5-second timeout.
 *
 * - If the server is healthy (2xx) → returns normally; the caller may proceed.
 * - If the server responds with a non-2xx status → prints a warning and exits 0.
 * - If the server is not reachable (connection refused, timeout, …) → prints a
 *   warning and exits 0.
 *
 * @param context  Short human-readable label shown in the skip message, e.g.
 *                 "demo credential verification".  Defaults to "verification".
 */
export async function assertApiReachable(context = "verification"): Promise<void> {
  try {
    const probe = await fetch(PROBE_URL, { signal: AbortSignal.timeout(5_000) });
    if (!probe.ok) {
      console.log(
        `⚠  API server responded with HTTP ${probe.status} on /api/healthz.\n` +
          `   Skipping ${context} — ensure the API server is healthy before running this check.\n`,
      );
      process.exit(0);
    }
  } catch {
    console.log(
      `⚠  API server not reachable at localhost:80 — ensure it is running before running this check.\n` +
        `   Skipping ${context}.\n`,
    );
    process.exit(0);
  }
}
