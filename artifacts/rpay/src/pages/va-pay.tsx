import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, XCircle, CheckCircle2, Building2, User, Hash, Landmark } from "lucide-react";
import { toast } from "sonner";

type PublicVa = {
  id: number;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  label?: string | null;
  status: string;
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

function DetailRow({
  icon: Icon,
  label,
  value,
  copyLabel,
  accent,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  copyLabel?: string;
  accent?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
          style={accent
            ? { background: `color-mix(in srgb, ${accent} 15%, transparent)` }
            : { background: "hsl(var(--primary)/0.12)" }
          }
        >
          <Icon
            className="w-4 h-4"
            style={accent ? { color: accent } : { color: "hsl(var(--primary))" }}
          />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-medium text-sm truncate">{value}</p>
        </div>
      </div>
      {copyLabel && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 shrink-0 text-xs"
          onClick={() => copyToClipboard(value, copyLabel)}
        >
          <Copy className="w-3 h-3 mr-1" />
          Copy
        </Button>
      )}
    </div>
  );
}

export default function VaPayPage() {
  const [, params] = useRoute("/va/:id");
  const id = params?.id ?? "";

  const [va, setVa] = useState<PublicVa | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${base}/api/virtual-accounts/public/${id}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "Virtual account not found");
        }
        return r.json();
      })
      .then(data => { setVa(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading account details…</p>
        </div>
      </div>
    );
  }

  if (error || !va) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <XCircle className="w-12 h-12 text-rose-400 mx-auto" />
            <h2 className="text-xl font-semibold">Account Not Found</h2>
            <p className="text-sm text-muted-foreground">{error ?? "This virtual account does not exist or has been removed."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isInactive = va.status === "inactive" || va.status === "closed";

  const accent = va.brandColor && isValidColor(va.brandColor) ? va.brandColor : null;
  const accentStyle = accent ? ({ "--brand-accent": accent } as React.CSSProperties) : {};

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" style={accentStyle}>
      <div className="w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-3">
            {va.logoUrl ? (
              <img
                src={va.logoUrl}
                alt={va.merchantName ?? "Merchant logo"}
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
            {!va.logoUrl && <span className="font-bold text-lg">RasoKart</span>}
          </div>
          {va.merchantName && (
            <p className="text-sm text-muted-foreground">{va.merchantName}</p>
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
                  {va.label ?? "Bank Transfer Details"}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Transfer funds directly to this virtual account
                </p>
              </div>
              <div className="shrink-0">
                {isInactive ? (
                  <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/20">Inactive</Badge>
                ) : (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Active</Badge>
                )}
              </div>
            </div>
          </div>

          <CardContent className="p-6">
            {isInactive ? (
              <div className="text-center space-y-3 py-4">
                <XCircle className="w-10 h-10 text-rose-400 mx-auto" />
                <p className="text-sm text-muted-foreground">
                  This virtual account is no longer active and cannot receive payments.
                </p>
              </div>
            ) : (
              <div>
                <DetailRow
                  icon={User}
                  label="Account Holder"
                  value={va.accountHolder}
                  copyLabel="Account holder name"
                  accent={accent}
                />
                <DetailRow
                  icon={Hash}
                  label="Account Number"
                  value={va.accountNumber}
                  copyLabel="Account number"
                  accent={accent}
                />
                <DetailRow
                  icon={Building2}
                  label="IFSC Code"
                  value={va.ifsc}
                  copyLabel="IFSC code"
                  accent={accent}
                />
                <DetailRow
                  icon={Landmark}
                  label="Bank Name"
                  value={va.bankName}
                  accent={accent}
                />

                <div className="mt-5 p-3 rounded-lg bg-muted/40 border border-border/40">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Use the account details above to make an NEFT / IMPS / RTGS transfer from your bank. Payments are typically credited within minutes.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground/60">Powered by RasoKart · Secure Payment Gateway</p>
      </div>
    </div>
  );
}
