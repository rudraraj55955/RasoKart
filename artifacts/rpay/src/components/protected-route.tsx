import { ReactNode, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { getToken, getStoredUser } from "@/lib/auth";
import { useLocation } from "wouter";
import { Spinner } from "@/components/ui/spinner";
import { UserRole } from "@workspace/api-client-react";
import { toast } from "sonner";
import { getPortal, getPortalAllowedRoles, getPortalLoginPath } from "@/lib/subdomain";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: string[];
}

function AuthRedirect({ to, reason }: { to: string; reason: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("GUARD_REDIRECT_DEBUG", { to, reason, marker: "live-login-debug-hardredirect-v4" });
    setLocation(to, { replace: true } as Parameters<typeof setLocation>[1]);
  }, [to]);
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Spinner className="w-8 h-8 text-primary" />
    </div>
  );
}

function getHomePath(role: string): string {
  switch (role) {
    case UserRole.admin:             return "/admin/dashboard";
    case UserRole.merchant:          return "/merchant/dashboard";
    case UserRole.payout_merchant:   return "/payout-merchant/dashboard";
    case UserRole.payout_admin:
    case UserRole.payout_super_admin: return "/payout-admin/dashboard";
    case UserRole.agent:             return "/agent/dashboard";
    default:                         return "/";
  }
}

function getLoginPath(location: string): string {
  if (location.startsWith("/payout-admin"))    return "/payout-admin/login";
  if (location.startsWith("/payout-merchant")) return "/payout-merchant/login";
  if (location.startsWith("/agent"))           return "/agent";
  if (location.startsWith("/admin"))           return "/admin";
  return "/merchant";
}

/**
 * Checks whether the current user is allowed on the current subdomain portal.
 * Returns null if there is no restriction (public portal, or roles match).
 * Returns a redirect path string if the user should be denied.
 *
 * Rules:
 *  - superadmin.rasokart.com  → role must be "admin" AND is_super_admin === true
 *  - admin.rasokart.com       → role must be "admin"
 *  - merchant.rasokart.com    → role must be "merchant"
 *  - payoutmerchant.rasokart.com → role must be "payout_merchant" or "merchant"
 *  - agent.rasokart.com       → role must be "agent"
 *  - public (rasokart.com)    → no restriction
 */
function checkSubdomainRoleViolation(
  user: { role: string; isSuperAdmin?: boolean } | null
): string | null {
  if (!user) return null; // not authenticated — handled by the no-user guard below
  const portal = getPortal();
  const allowedRoles = getPortalAllowedRoles(portal);
  if (!allowedRoles) return null; // public portal — no restriction

  if (!allowedRoles.includes(user.role)) {
    return getPortalLoginPath(portal);
  }

  // superadmin subdomain additionally requires isSuperAdmin flag
  if (portal === "superadmin" && !(user as any).isSuperAdmin) {
    // Regular admin on superadmin portal → send to admin subdomain (cross-origin)
    if (typeof window !== "undefined" && window.location.hostname === "superadmin.rasokart.com") {
      window.location.replace("https://admin.rasokart.com/");
      return "__redirecting__"; // non-null sentinel — component will not render
    }
    return "/admin";
  }

  return null; // all checks pass
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  // Fallback for the moment right after a hard redirect from a login page:
  // the AuthProvider's /api/auth/me query may not have resolved yet, but the
  // token + user JSON were already written to storage before navigating.
  // Trust that immediately so a valid session is never bounced back to
  // login while the context is still catching up.
  const fallbackToken = getToken();
  const fallbackUser = getStoredUser() as { role: string; is_super_admin?: boolean } | null;
  const effectiveUser = user ?? (fallbackToken && fallbackUser ? fallbackUser : null);
  const effectiveIsLoading = isLoading && !effectiveUser;

  const allowedRoleResult = !allowedRoles || (!!effectiveUser && allowedRoles.includes(effectiveUser.role));

  // eslint-disable-next-line no-console
  console.log("PROTECTED_ROUTE_GUARD_DEBUG", {
    marker: "live-login-debug-hardredirect-v4",
    location,
    tokenFound: !!fallbackToken,
    userFound: !!fallbackUser,
    contextUserPresent: !!user,
    effectiveUserPresent: !!effectiveUser,
    effectiveUserRole: effectiveUser?.role ?? null,
    allowedRoles: allowedRoles ?? null,
    allowedRoleResult,
    isLoading,
    effectiveIsLoading,
  });

  if (effectiveIsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  if (!effectiveUser) {
    return (
      <AuthRedirect
        to={getLoginPath(location)}
        reason={`no effective user (tokenFound=${!!fallbackToken}, userFound=${!!fallbackUser}, contextUser=${!!user})`}
      />
    );
  }

  if (allowedRoles && !allowedRoles.includes(effectiveUser.role)) {
    return (
      <AuthRedirect
        to={getHomePath(effectiveUser.role)}
        reason={`role "${effectiveUser.role}" not in allowedRoles [${(allowedRoles ?? []).join(", ")}]`}
      />
    );
  }

  // ── Subdomain role isolation ──────────────────────────────────────────────
  // After confirming the user holds a valid token for this route, also verify
  // their role is appropriate for the current subdomain portal. This prevents
  // e.g. an admin token from accessing merchant.rasokart.com.
  const subdomainViolationRedirect = checkSubdomainRoleViolation(effectiveUser as any);
  if (subdomainViolationRedirect !== null) {
    // Show a toast on the next render cycle so it appears after the redirect
    setTimeout(() => {
      toast.error("You don't have access to this portal. Please log in with the correct account.");
    }, 100);
    return (
      <AuthRedirect
        to={subdomainViolationRedirect}
        reason={`subdomain portal mismatch: role "${effectiveUser.role}" on portal "${getPortal()}"`}
      />
    );
  }

  return <>{children}</>;
}
