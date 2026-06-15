import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { ShieldCheck, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    Cashfree?: (opts: { mode: string }) => {
      checkout: (opts: { paymentSessionId: string; redirectTarget?: string }) => void;
    };
  }
}

export default function CheckoutPage() {
  const search = useSearch();
  const params  = new URLSearchParams(search);
  const token   = params.get("token")  ?? "";
  const env     = params.get("env")    ?? "sandbox";
  const amount  = params.get("amount") ?? "";

  const [phase, setPhase] = useState<"loading" | "redirecting" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const launched = useRef(false);

  function launchPayment() {
    if (launched.current) return;
    if (!window.Cashfree) { setErrorMsg("Payment SDK not available. Please try again."); setPhase("error"); return; }
    launched.current = true;
    setPhase("redirecting");
    try {
      const mode = env === "prod" ? "production" : "sandbox";
      const cf = window.Cashfree({ mode });
      cf.checkout({ paymentSessionId: token, redirectTarget: "_self" });
    } catch {
      launched.current = false;
      setErrorMsg("Could not start payment. Please click the button below.");
      setPhase("error");
    }
  }

  useEffect(() => {
    if (!token) { setErrorMsg("Invalid checkout link. Please go back and try again."); setPhase("error"); return; }

    if (window.Cashfree) { launchPayment(); return; }

    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload  = () => launchPayment();
    script.onerror = () => { setErrorMsg("Failed to load payment module. Check your connection and try again."); setPhase("error"); };
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch {} };
  }, []);

  const formattedAmount = amount && !isNaN(Number(amount))
    ? `₹${Number(amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 gap-6">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-foreground">RasoKart</span>
        </div>
        <p className="text-sm text-muted-foreground">Secure Checkout</p>
      </div>

      <Card className="w-full max-w-sm border-border/60 bg-card shadow-lg">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-5">
          {(phase === "loading" || phase === "redirecting") && (
            <>
              <Loader2 className="w-10 h-10 animate-spin text-emerald-400" />
              {formattedAmount && (
                <p className="text-3xl font-bold text-foreground tabular-nums">{formattedAmount}</p>
              )}
              <p className="text-sm text-muted-foreground text-center">
                {phase === "loading" ? "Initialising secure payment…" : "Redirecting to payment page…"}
              </p>
            </>
          )}

          {phase === "error" && (
            <>
              <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-rose-400" />
              </div>
              {formattedAmount && (
                <p className="text-3xl font-bold text-foreground tabular-nums">{formattedAmount}</p>
              )}
              <p className="text-sm text-rose-400 text-center">{errorMsg}</p>
              <div className="flex gap-3 w-full">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={() => window.history.back()}
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </Button>
                {token && (
                  <Button
                    className="flex-1"
                    onClick={() => { launched.current = false; launchPayment(); }}
                  >
                    Retry
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/70" />
        <span>256-bit encrypted · Secured by RasoKart</span>
      </div>
    </div>
  );
}
