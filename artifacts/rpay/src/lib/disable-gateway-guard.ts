/**
 * Pure predicate that determines whether saving a gateway config panel would
 * disable an active gateway (i.e. the server-side state is enabled but the
 * local toggle has been flipped off).
 *
 * Returns true ONLY for the enable → disable transition.  All other
 * combinations — re-enabling a disabled gateway, or saving unrelated field
 * changes while the gateway is already disabled — return false so the
 * confirmation dialog is never shown spuriously.
 */
export function computeWillDisable(
  serverEnabled: boolean,
  localEnabled: boolean,
): boolean {
  return serverEnabled === true && localEnabled === false;
}
