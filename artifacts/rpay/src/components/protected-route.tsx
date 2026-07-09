import { ReactNode, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { getToken, getStoredUser } from "@/lib/auth";
import { useLocation } from "wouter";
import { Spinner } from "@/components/ui/spinner";
import { UserRole } from "@workspace/api-client-react";

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

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  // Fallback for the moment right after a hard redirect from a login page:
  // the AuthProvider's /api/auth/me query may not have resolved yet, but the
  // token + user JSON were already written to storage before navigating.
  // Trust that immediately so a valid session is never bounced back to
  // login while the context is still catching up.
  const fallbackToken = getToken();
  const fallbackUser = getStoredUser() as { role: string } | null;
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

  return <>{children}</>;
}
