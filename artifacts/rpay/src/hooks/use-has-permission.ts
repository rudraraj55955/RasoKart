import { useAuth } from "@/lib/auth-context";

/**
 * Returns true if the current user has the given permission key.
 *
 * Resolution order:
 * 1. Super Admin (isSuperAdmin flag)  → always true
 * 2. effectivePermissions == null     → seed/init error; fail-CLOSED → false
 *    (seed auto-activates IAM on every startup so null is a transient error state)
 * 3. effectivePermissions.__all__     → Super Admin marker → true
 * 4. effectivePermissions[key]===true → true, otherwise false
 */
export function useHasPermission(permissionKey: string): boolean {
  const { user } = useAuth();
  if (!user) return false;
  if (user.isSuperAdmin) return true;

  const ep = (user as any).effectivePermissions as Record<string, boolean> | { __all__: true } | null | undefined;
  // null = iam_migration_log absent (seed failed). Fail-CLOSED: deny rather than
  // allow. Consistent with backend checkPermission(null, ...) = false.
  if (ep == null) return false;
  if ("__all__" in ep && (ep as any).__all__ === true) return true;
  return (ep as Record<string, boolean>)[permissionKey] === true;
}
