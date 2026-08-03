import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  getPortal,
  getPortalLoginPath,
  getPortalAllowedRoles,
  getSubdomainForRole,
} from "@/lib/subdomain";
import { Spinner } from "@/components/ui/spinner";

function getPortalDashboardPath(role: string): string {
  switch (role) {
    case "admin":           return "/admin/dashboard";
    case "merchant":        return "/merchant/dashboard";
    case "payout_merchant": return "/payout-merchant/dashboard";
    case "payout_admin":
    case "payout_super_admin": return "/payout-admin/dashboard";
    case "agent":           return "/agent/dashboard";
    default:                return "/";
  }
}

/**
 * SubdomainGuard
 *
 * Wraps protected pages on role-dedicated subdomains (admin.rasokart.com, etc.).
 * After auth resolves:
 *  - If unauthenticated → send to that subdomain's login page
 *  - If authenticated but wrong role → redirect to the correct portal subdomain
 *  - If correct role → render children
 *
 * On the main domain (rasokart.com / public portal) this component is a
 * no-op passthrough so existing path-based routing is unaffected.
 */
export function SubdomainGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const currentPortal = getPortal();

  useEffect(() => {
    if (isLoading || currentPortal === "public") return;

    if (!user) {
      // Not logged in — send to this subdomain's login page
      const loginPath = getPortalLoginPath(currentPortal);
      if (window.location.pathname !== loginPath) {
        window.location.replace(loginPath);
      }
      return;
    }

    // User is logged in — check if their role is allowed on this subdomain
    const allowedRoles = getPortalAllowedRoles(currentPortal);
    if (!allowedRoles) return; // public portal — no restriction

    const role = user.role as string;
    const isSuperAdmin = (user as any).isSuperAdmin as boolean | undefined;

    if (!allowedRoles.includes(role)) {
      // Wrong portal — redirect to the correct subdomain
      const host = window.location.hostname;
      const isRasokart = host === "rasokart.com" || host.endsWith(".rasokart.com");
      if (isRasokart) {
        const dest = getSubdomainForRole(role, isSuperAdmin);
        const dashPath = getPortalDashboardPath(role);
        window.location.replace(dest + dashPath);
      }
    }

    // superadmin subdomain: regular admins without is_super_admin → redirect to admin subdomain
    if (currentPortal === "superadmin" && role === "admin" && !isSuperAdmin) {
      window.location.replace("https://admin.rasokart.com/admin/dashboard");
    }
  }, [user, isLoading, currentPortal]);

  // On main domain: no-op passthrough
  if (currentPortal === "public") return <>{children}</>;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Lightweight hook: returns the detected portal for the current hostname.
 * Used inside login pages to skip the form and jump straight to the dashboard.
 */
export function useSubdomainExpectedRole(): { expectedPortal: string; currentPortal: string } {
  const currentPortal = getPortal();
  return { expectedPortal: currentPortal, currentPortal };
}
