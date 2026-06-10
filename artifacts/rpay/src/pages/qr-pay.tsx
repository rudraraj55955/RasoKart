import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { QRCodeCanvas } from "qrcode.react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, XCircle, Clock, Smartphone, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type PublicQr = {
  id: number;
  type: string;
  label?: string | null;
  payload: string;
  amount?: string | null;
  status: string;
  expiresAt?: string | null;
  merchantName?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
};

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
}

function isValidColor(color: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(color) || /^(rgb|hsl)a?\(.+\)$/i.test(color);
}

export default function QrPayPage() {
  const [, params] = useRoute("/qr/:id");
  const id = params?.id ?? "";

  const [qr, setQr] = useState<PublicQr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${base}/api/qr-codes/public/${id}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "QR code not found");
        }
        return r.json();
      })
      .then(data => { setQr(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading payment details…</p>
        </div>
      </div>
    );
  }

  if (error || !qr) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <XCircle className="w-12 h-12 text-rose-400 mx-auto" />
            <h2 className="text-xl font-semibold">QR Code Not Found</h2>
            <p className="text-sm text-muted-foreground">{error ?? "This QR code does not exist or has been removed."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isExpired = qr.expiresAt ? new Date(qr.expiresAt) < new Date() : false;
  const isInactive = qr.status === "inactive";
  const isExpiredStatus = qr.status === "expired" || isExpired;
  const isUnavailable = isInactive || isExpiredStatus;

  const accent = qr.brandColor && isValidColor(qr.brandColor) ? qr.brandColor : null;
  const accentStyle = accent ? ({ "--brand-accent": accent } as React.CSSProperties) : {};

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" style={accentStyle}>
      <div className="w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-3">
            {qr.logoUrl ? (
              <img
                src={qr.logoUrl}
                alt={qr.merchantName ?? "Merchant logo"}
                className="h-10 max-w-[140px] object-contain rounded"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center border"
                style={accent
                  ? { background: `color-mix(in srgb, ${accent} 20%, transparent)`, borderColor: `color-mix(in srgb, ${accent} 30%, transparent)` }
                  : { background: "hsl(var(--primary)/0.2)", borderColor: "hsl(var(--primary)/0.3)" }
                }
              >
                <CheckCircle2
                  className="w-4 h-4"
                  style={accent ? { color: accent } : { color: "hsl(var(--primary))" }}
                />
              </div>
            )}
            {!qr.logoUrl && <span className="font-bold text-lg">RasoKart</span>}
          </div>
          {qr.merchantName && (
            <p className="text-sm text-muted-foreground">{qr.merchantName}</p>
          )}
        </div>

        <Card className="overflow-hidden">
          <div
            className="border-b border-border/50 px-6 py-5"
            style={accent
              ? { background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 12%, transparent), color-mix(in srgb, ${accent} 6%, transparent))` }
              : { background: "linear-gradient(135deg, hsl(var(--primary)/0.10), hsl(var(--primary)/0.05))" }
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold leading-tight">
                  {qr.label ?? (qr.type === "static" ? "Static QR Payment" : "Dynamic QR Payment")}
                </h1>
                <p className="text-xs text-muted-foreground mt-1 capitalize">{qr.type} QR Code</p>
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

            {qr.amount && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Amount</p>
                <p className="text-3xl font-bold text-foreground">
                  ₹{parseFloat(qr.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}

            {!qr.amount && !isUnavailable && (
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
                    ? "This QR code has expired and can no longer accept payments."
                    : "This QR code has been deactivated by the merchant."}
                </p>
              </div>
            ) : (
              <>
                {/* QR Code */}
                <div className="flex flex-col items-center gap-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Scan to Pay via UPI</p>
                  <div className="bg-white p-4 rounded-xl shadow-sm">
                    <QRCodeCanvas value={qr.payload} size={200} level="H" includeMargin />
                  </div>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Open in UPI App */}
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    style={accent ? { background: accent, borderColor: accent, color: "#fff" } : {}}
                    asChild
                  >
                    <a href={qr.payload}>
                      <Smartphone className="w-4 h-4 mr-2" />
                      Open in UPI App
                    </a>
                  </Button>
                  <Button variant="outline" className="w-full" size="sm"
                    onClick={() => copyToClipboard(qr.payload, "UPI payment string")}>
                    <Copy className="w-3.5 h-3.5 mr-2" />
                    Copy UPI String
                  </Button>
                </div>
              </>
            )}

            {/* Expiry info */}
            {qr.expiresAt && !isUnavailable && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Expires {new Date(qr.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground/60">Powered by RasoKart · Secure Payment Gateway</p>
      </div>
    </div>
  );
}
