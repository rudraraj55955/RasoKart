import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { ShieldOff, ShieldCheck } from "lucide-react";

export default function MerchantSuspended() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-20 h-20 bg-orange-500/10 rounded-full flex items-center justify-center mx-auto border border-orange-500/20">
          <ShieldOff className="w-10 h-10 text-orange-500" />
        </div>
        <div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg tracking-wide">RasoKart</span>
          </div>
          <h1 className="text-2xl font-bold mt-4">Account Suspended</h1>
          <p className="text-muted-foreground mt-2 leading-relaxed">
            Your merchant account has been suspended. You cannot access the dashboard at this time.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/50 bg-card/50 text-left space-y-2">
          <p className="text-sm font-medium">What should I do?</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Contact our support team for assistance</li>
            <li>Reference your registered email address</li>
            <li>Our team will review and respond promptly</li>
          </ul>
        </div>
        <Button variant="outline" onClick={logout} className="w-full">Sign Out</Button>
      </div>
    </div>
  );
}
