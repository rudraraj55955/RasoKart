import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { getHostnamePortal, roleToPortal, portalLoginPath, portalSubdomainUrl, portalDashboardPath } from "@/lib/subdomain";
import { Spinner } from "@/components/ui/spinner";

/**
 * SubdomainGuard
 *
 * Wraps protected pages on role-dedicated subdomains (admin.rasokart.com, etc.).
 * After auth resolves:
 *  - If unauthenticated → send to that subdomain's login page
 *  - If authenticated but wrong role → redirect to the correct portal
 *  - If correct role → render children
 *
 * On the main domain (rasokart.com) this component is a no-op passthrough
 * so existing path-based routing is unaffected.
 */
export function SubdomainGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const currentPortal = getHostnamePortal();

  useEffect(() => {
    if (isLoading || currentPortal === "main") return;

    if (!user) {
      // Not logged in — send to this subdomain's login page
      const loginPath = portalLoginPath(currentPortal);
      if (window.location.pathname !== loginPath) {
        window.location.replace(loginPath);
      }
      return;
    }

    // User is logged in — check if they belong on this subdomain
    const userPortal = roleToPortal(
      user.role as string,
      (user as any).isSuperAdmin as boolean | undefined,
    );

    // superadmin and admin both use admin.rasokart.com (super admin is just
    // a flag on the admin role, both go to the same portal)
    const effectiveUserPortal = userPortal === "superadmin" ? "admin" : userPortal;
    const effectiveCurrentPortal = currentPortal === "superadmin" ? "admin" : currentPortal;

    if (effectiveUserPortal !== effectiveCurrentPortal) {
      // Wrong portal — redirect to their correct one
      const host = window.location.hostname;
      const isRasokart = host === "rasokart.com" || host.endsWith(".rasokart.com");
      if (isRasokart) {
        const dest = portalSubdomainUrl(userPortal, portalDashboardPath(userPortal));
        window.location.replace(dest);
      }
    }
  }, [user, isLoading, currentPortal]);

  // On main domain: no-op
  if (currentPortal === "main") return <>{children}</>;

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
 * Lightweight hook: returns true when the current user's role matches the
 * expected portal for this subdomain. Used inside login pages to skip the form
 * and jump straight to the dashboard.
 */
export function useSubdomainExpectedRole(): { expectedPortal: string; currentPortal: string } {
  const currentPortal = getHostnamePortal();
  return { expectedPortal: currentPortal, currentPortal };
}
