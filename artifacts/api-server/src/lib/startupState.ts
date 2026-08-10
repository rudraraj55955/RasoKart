/**
 * Shared startup-readiness flag.
 *
 * The server binds to its port before schemaGuard and seed complete so that the
 * autoscale startup probe can connect immediately. While those long-running init
 * steps execute, `isServerInitialized()` returns false and /api/healthz/deep
 * returns 503 { status: "starting" }. The probe retries until init is done and
 * the full deep-check passes, at which point traffic is routed to the instance.
 */

let initialized = false;

export function isServerInitialized(): boolean {
  return initialized;
}

export function markServerInitialized(): void {
  initialized = true;
}
