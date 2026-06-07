import { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { Redirect, useLocation } from "wouter";
import { Spinner } from "@/components/ui/spinner";
import { UserRole } from "@workspace/api-client-react";

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
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
    // Determine where to redirect based on current path
    const loginPath = location.startsWith("/admin") ? "/admin/login" : "/merchant/login";
    return <Redirect to={loginPath} />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // User doesn't have required role
    const homePath = user.role === UserRole.admin ? "/admin/dashboard" : "/merchant/dashboard";
    return <Redirect to={homePath} />;
  }

  return <>{children}</>;
}
