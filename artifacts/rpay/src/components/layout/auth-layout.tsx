import { ReactNode } from "react";
import { useLocation, Link } from "wouter";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { InstallAppBanner } from "@/components/ui/install-app-banner";
import { useCompanySettings } from "@/lib/company-settings";

function usePortalAppName() {
  const [location] = useLocation();
  if (location.startsWith("/admin")) return "RasoKart Admin";
  if (location.startsWith("/merchant")) return "RasoKart Merchant";
  if (location.startsWith("/agent")) return "RasoKart Agent";
  return "RasoKart";
}

export function AuthLayout({ children, title, subtitle }: { children: ReactNode, title: string, subtitle?: string }) {
  const appName = usePortalAppName();
  const { companyName, supportPhone } = useCompanySettings();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      
      <div className="w-full max-w-md z-10">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4">
            <RasoKartLogo size={52} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-2">{subtitle}</p>}
        </div>
        
        <div className="bg-card/50 backdrop-blur-xl border border-border/50 rounded-2xl p-6 shadow-2xl shadow-black/50">
          {children}
        </div>

        <InstallAppBanner appName={appName} />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Operated by {companyName} · Support: {supportPhone}
        </p>
        <p className="mt-2 text-center text-xs text-muted-foreground/60">
          <Link href="/privacy-policy" className="hover:text-muted-foreground transition-colors underline underline-offset-2">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
