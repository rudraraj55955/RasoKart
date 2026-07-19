import { ReactNode } from "react";
import { useHasPermission } from "@/hooks/use-has-permission";

interface PermissionGateProps {
  permission: string;
  /** Rendered when the user lacks the permission. Defaults to null. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Conditionally renders children based on the user's effective permissions.
 *
 * Usage:
 *   <PermissionGate permission="admin_merchants">
 *     <AdminMerchantsPage />
 *   </PermissionGate>
 *
 * Before IAM migration runs (effectivePermissions === null), always renders children.
 * After migration, checks the effective permission map.
 * Super Admin always sees children.
 */
export function PermissionGate({ permission, fallback = null, children }: PermissionGateProps) {
  const allowed = useHasPermission(permission);
  return allowed ? <>{children}</> : <>{fallback}</>;
}
