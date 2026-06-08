import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { QRCodeCanvas } from "qrcode.react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, CheckCircle2, Clock, XCircle, Smartphone } from "lucide-react";
import { toast } from "sonner";

type PublicLink = {
  id: number;
  title: string;
  description?: string | null;
  amount?: string | null;
  currency: string;
  slug: string;
  upiPayload?: string | null;
  merchantName?: string | null;
  status: string;
  expiresAt?: string | null;
};

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
}

export default function PayPage() {
  const [, params] = useRoute("/pay/:slug");
  const slug = params?.slug ?? "";

  const [link, setLink] = useState<PublicLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${base}/api/payment-links/public/${slug}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "Payment link not found");
        }
        return r.json();
      })
      .then(data => { setLink(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading payment link…</p>
        </div>
      </div>
    );
  }

  if (error || !link) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <XCircle className="w-12 h-12 text-rose-400 mx-auto" />
            <h2 className="text-xl font-semibold">Link Not Found</h2>
            <p className="text-sm text-muted-foreground">{error ?? "This payment link does not exist or has been removed."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isExpired = link.expiresAt ? new Date(link.expiresAt) < new Date() : false;
  const isInactive = link.status === "inactive";
  const isExpiredStatus = link.status === "expired" || isExpired;
  const isUnavailable = isInactive || isExpiredStatus;

  const upiDeepLink = link.upiPayload ?? "";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-8 h-8 bg-primary/20 rounded-lg flex items-center justify-center border border-primary/30">
              <CheckCircle2 className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold text-lg">RPay</span>
          </div>
          {link.merchantName && (
            <p className="text-sm text-muted-foreground">{link.merchantName}</p>
          )}
        </div>

        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-primary/10 to-primary/5 border-b border-border/50 px-6 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold leading-tight">{link.title}</h1>
                {link.description && (
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{link.description}</p>
                )}
              </div>
              <div className="shrink-0">
                {isExpiredStatus ? (
                  <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/20">Expired</Badge>
                ) : isInactive ? (
                  <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">Inactive</Badge>
                ) : (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Active</Badge>
                )}
              </div>
            </div>

            {link.amount && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Amount</p>
                <p className="text-3xl font-bold text-foreground">
                  ₹{parseFloat(link.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}

            {!link.amount && !isUnavailable && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground">Open amount — enter the amount in your UPI app</p>
              </div>
            )}
          </div>

          <CardContent className="p-6 space-y-5">
            {isUnavailable ? (
              <div className="text-center space-y-3 py-4">
                <XCircle className="w-10 h-10 text-rose-400 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  {isExpiredStatus
                    ? "This payment link has expired and can no longer accept payments."
                    : "This payment link has been deactivated by the merchant."}
                </p>
              </div>
            ) : upiDeepLink ? (
              <>
                {/* QR Code */}
                <div className="flex flex-col items-center gap-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Scan to Pay via UPI</p>
                  <div className="bg-white p-4 rounded-xl shadow-sm">
                    <QRCodeCanvas value={upiDeepLink} size={200} level="H" includeMargin />
                  </div>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Pay Now button */}
                <div className="space-y-2">
                  <Button className="w-full" asChild>
                    <a href={upiDeepLink}>
                      <Smartphone className="w-4 h-4 mr-2" />
                      Open in UPI App
                    </a>
                  </Button>
                  <Button variant="outline" className="w-full" size="sm"
                    onClick={() => copyToClipboard(upiDeepLink, "UPI payment string")}>
                    <Copy className="w-3.5 h-3.5 mr-2" />
                    Copy UPI String
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center space-y-3 py-4">
                <Smartphone className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
                <p className="text-sm text-muted-foreground">
                  The merchant has not connected a UPI payment provider yet.
                  Please contact them directly to arrange payment.
                </p>
              </div>
            )}

            {/* Expiry info */}
            {link.expiresAt && !isUnavailable && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Expires {new Date(link.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground/60">Powered by RPay · Secure Payment Gateway</p>
      </div>
    </div>
  );
}
