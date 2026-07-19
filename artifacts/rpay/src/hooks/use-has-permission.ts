import { useAuth } from "@/lib/auth-context";

/**
 * Returns true if the current user has the given permission key.
 *
 * Resolution order:
 * 1. No authenticated user               → false
 * 2. Super Admin (isSuperAdmin flag)      → always true
 * 3. effectivePermissions == null/missing → soft-mode / transient init state;
 *    fail-OPEN → true (preserves legacy access, consistent with backend
 *    checkPermission(null) = true and ROLE_DEFAULT_PERMISSIONS fallback)
 * 4. effectivePermissions.__all__         → Super Admin marker → true
 * 5. effectivePermissions[key]===true     → true, otherwise false
 */
export function useHasPermission(permissionKey: string): boolean {
  const { user } = useAuth();
  if (!user) return false;
  if (user.isSuperAdmin) return true;

  const ep = (user as any).effectivePermissions as Record<string, boolean> | { __all__: true } | null | undefined;
  // null/undefined = migration not yet run or resolver error.
  // Fail-OPEN: return true so pre-migration users keep their existing UI access.
  // Consistent with backend: resolveUserPermissions() falls back to
  // ROLE_DEFAULT_PERMISSIONS in soft-mode; checkPermission(null, ...) = true.
  if (ep == null) return true;
  if ("__all__" in ep && (ep as any).__all__ === true) return true;
  return (ep as Record<string, boolean>)[permissionKey] === true;
}
