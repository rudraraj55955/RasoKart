import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Clock, ShieldCheck } from "lucide-react";

export default function MerchantPending() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto border border-amber-500/20">
          <Clock className="w-10 h-10 text-amber-500" />
        </div>
        <div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg tracking-wide">RasoKart</span>
          </div>
          <h1 className="text-2xl font-bold mt-4">Account Pending Approval</h1>
          <p className="text-muted-foreground mt-2 leading-relaxed">Your merchant account is currently under review. Our team will verify your details and approve your account within 1-2 business days.</p>
        </div>
        <div className="p-4 rounded-lg border border-border/50 bg-card/50 text-left space-y-2">
          <p className="text-sm font-medium">What happens next?</p>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
            <li>Our team reviews your application</li>
            <li>You will receive an email notification</li>
            <li>Once approved, full access is granted</li>
          </ul>
        </div>
        <Button variant="outline" onClick={logout} className="w-full">Sign Out</Button>
      </div>
    </div>
  );
}
