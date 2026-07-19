import { useAuth } from "@/lib/auth-context";

/**
 * Returns true if the current user has the given permission key.
 *
 * Resolution order:
 * 1. Super Admin  → always true (isSuperAdmin flag)
 * 2. effectivePermissions == null → IAM migration not run; soft-mode → true
 * 3. effectivePermissions.__all__ == true → Super Admin marker → true
 * 4. effectivePermissions[key] === true → true, otherwise false
 */
export function useHasPermission(permissionKey: string): boolean {
  const { user } = useAuth();
  if (!user) return false;
  if (user.isSuperAdmin) return true;

  const ep = (user as any).effectivePermissions as Record<string, boolean> | { __all__: true } | null | undefined;
  if (ep == null) return true;
  if ("__all__" in ep && (ep as any).__all__ === true) return true;
  return (ep as Record<string, boolean>)[permissionKey] === true;
}
