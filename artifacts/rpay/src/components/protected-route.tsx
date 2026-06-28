import { ReactNode, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { Spinner } from "@/components/ui/spinner";
import { UserRole } from "@workspace/api-client-react";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
}

/**
 * Shows a full-screen spinner while programmatically navigating.
 * Never returns null — this prevents the blank-screen flash that
 * wouter's <Redirect> component causes (it returns null and uses
 * useLayoutEffect, leaving a brief blank frame before navigation).
 */
function AuthRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to, { replace: true } as Parameters<typeof setLocation>[1]);
  }, [to]);
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Spinner className="w-8 h-8 text-primary" />
    </div>
  );
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  if (!user) {
    const loginPath = location.startsWith("/admin") ? "/admin" : "/merchant";
    return <AuthRedirect to={loginPath} />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const homePath = user.role === UserRole.admin ? "/admin/dashboard" : "/merchant/dashboard";
    return <AuthRedirect to={homePath} />;
  }

  return <>{children}</>;
}
