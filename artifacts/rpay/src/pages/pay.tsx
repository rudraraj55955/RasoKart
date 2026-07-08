import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { QRCodeCanvas } from "qrcode.react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Copy, CheckCircle2, Clock, XCircle, Smartphone, Send, AlertCircle, BadgeCheck, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { useCompanySettings } from "@/lib/company-settings";

const LS_KEY = (slug: string) => `rasokart_pay_${slug}`;

type SavedUtrState = {
  utr: string;
  txnId: number;
  amount: string;
  submittedAt: string;
};

type StaticUpi = {
  upiId: string;
  qrImageUrl: string | null;
  accountHolder: string | null;
  instructions: string | null;
};

type PublicLink = {
  id: number;
  title: string;
  description?: string | null;
  amount?: string | null;
  currency: string;
  slug: string;
  upiPayload?: string | null;
  staticUpi?: StaticUpi | null;
  merchantName?: string | null;
  logoUrl?: string | null;
  brandColor?: string | null;
  status: string;
  expiresAt?: string | null;
  maxPayments?: number | null;
};

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
}

function isValidColor(color: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(color) || /^(rgb|hsl)a?\(.+\)$/i.test(color);
}

type UtrState = "idle" | "submitting" | "success" | "error";

// ── Derived page state from link.status + localStorage ─────────────────────
type PageMode =
  | "active_pay"          // show UTR form / UPI QR
  | "my_pending"          // I submitted, awaiting admin verification
  | "my_approved"         // my UTR was approved (link completed)
  | "completed_other"     // link completed but not by me
  | "pending_other"       // someone else's UTR pending
  | "expired"
  | "inactive"
  | "unavailable";

function deriveMode(status: string, saved: SavedUtrState | null): PageMode {
  if (status === "expired") return "expired";
  if (status === "inactive") return "inactive";
  if (status === "completed") return saved ? "my_approved" : "completed_other";
  if (status === "pending_verification") return saved ? "my_pending" : "pending_other";
  if (status === "active") {
    if (saved) return "my_pending"; // submitted but link not yet marked pending_verification
    return "active_pay";
  }
  return "unavailable";
}

export default function PayPage() {
  const { companyName, supportPhone } = useCompanySettings();
  const [, params] = useRoute("/pay/:slug");
  const slug = params?.slug ?? "";

  const [link, setLink] = useState<PublicLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Persisted UTR state from a previous submission on this device
  const [savedUtr, setSavedUtr] = useState<SavedUtrState | null>(null);

  // UTR form
  const [utr, setUtr] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [payerName, setPayerName] = useState("");
  const [payerUpi, setPayerUpi] = useState("");
  const [utrState, setUtrState] = useState<UtrState>("idle");
  const [utrError, setUtrError] = useState<string | null>(null);
  const utrInputRef = useRef<HTMLInputElement>(null);

  // Load link + restore any saved UTR state from localStorage
  useEffect(() => {
    if (!slug) return;
    // Restore local state first so the first render is correct
    try {
      const raw = localStorage.getItem(LS_KEY(slug));
      if (raw) setSavedUtr(JSON.parse(raw));
    } catch { /* ignore */ }

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

  async function submitUtr() {
    if (!link || !slug) return;
    if (!utr.trim()) { setUtrError("UTR / reference number is required"); utrInputRef.current?.focus(); return; }
    if (!link.amount && !customAmount.trim()) { setUtrError("Please enter the amount you paid"); return; }
    setUtrError(null);
    setUtrState("submitting");
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    try {
      const r = await fetch(`${base}/api/payment-links/public/${slug}/utr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          utr: utr.trim(),
          amount: link.amount ? undefined : customAmount.trim(),
          payerName: payerName.trim() || undefined,
          payerUpi: payerUpi.trim() || undefined,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? "Submission failed");

      const finalAmount = link.amount ?? customAmount.trim();
      const saved: SavedUtrState = {
        utr: utr.trim().toUpperCase(),
        txnId: body.transactionId,
        amount: finalAmount,
        submittedAt: new Date().toISOString(),
      };
      try { localStorage.setItem(LS_KEY(slug), JSON.stringify(saved)); } catch { /* ignore */ }
      setSavedUtr(saved);
      setUtrState("success");
    } catch (err: any) {
      setUtrError(err.message);
      setUtrState("error");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading payment…</p>
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
            <h2 className="text-xl font-semibold">Not Found</h2>
            <p className="text-sm text-muted-foreground">{error ?? "This payment link does not exist or has been removed."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const mode = deriveMode(link.status, savedUtr);
  const staticUpi = link.staticUpi ?? null;
  const upiDeepLink = link.upiPayload ?? "";
  const accent = link.brandColor && isValidColor(link.brandColor) ? link.brandColor : null;
  const accentStyle = accent ? ({ "--brand-accent": accent } as React.CSSProperties) : {};

  const statusBadge = () => {
    if (mode === "completed_other" || mode === "my_approved") return <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/20">Completed</Badge>;
    if (mode === "my_pending" || mode === "pending_other") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">Pending</Badge>;
    if (mode === "expired") return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/20">Expired</Badge>;
    if (mode === "inactive") return <Badge className="bg-muted text-muted-foreground border-border">Inactive</Badge>;
    return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Active</Badge>;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" style={accentStyle}>
      <div className="w-full max-w-md space-y-4">
        {/* Header / Branding */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-3">
            {link.logoUrl ? (
              <img src={link.logoUrl} alt={link.merchantName ?? "Merchant logo"} className="h-10 max-w-[140px] object-contain rounded"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-8 h-8 rounded-lg flex items-center justify-center border"
                style={accent
                  ? { background: `color-mix(in srgb, ${accent} 20%, transparent)`, borderColor: `color-mix(in srgb, ${accent} 30%, transparent)` }
                  : { background: "hsl(var(--primary)/0.2)", borderColor: "hsl(var(--primary)/0.3)" }}>
                <CheckCircle2 className="w-4 h-4" style={accent ? { color: accent } : { color: "hsl(var(--primary))" }} />
              </div>
            )}
            {!link.logoUrl && <span className="font-bold text-lg">RasoKart</span>}
          </div>
          {link.merchantName && <p className="text-sm text-muted-foreground">{link.merchantName}</p>}
        </div>

        <Card className="overflow-hidden">
          {/* Title / amount header */}
          <div className="border-b border-border/50 px-6 py-5"
            style={accent
              ? { background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 12%, transparent), color-mix(in srgb, ${accent} 6%, transparent))` }
              : { background: "linear-gradient(135deg, hsl(var(--primary)/0.10), hsl(var(--primary)/0.05))" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold leading-tight">{link.title}</h1>
                {link.description && <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{link.description}</p>}
              </div>
              <div className="shrink-0">{statusBadge()}</div>
            </div>

            {link.amount && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Amount</p>
                <p className="text-3xl font-bold text-foreground">
                  ₹{parseFloat(link.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              </div>
            )}
          </div>

          <CardContent className="p-6 space-y-5">

            {/* ── COMPLETED: my payment was approved ── */}
            {mode === "my_approved" && savedUtr && (
              <div className="text-center space-y-4 py-2">
                <div className="w-16 h-16 rounded-full bg-sky-500/15 border border-sky-500/30 flex items-center justify-center mx-auto">
                  <BadgeCheck className="w-8 h-8 text-sky-400" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-foreground text-lg">Payment Successful</h3>
                  <p className="text-sm text-muted-foreground">Your payment has been verified and confirmed.</p>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border text-left space-y-2 p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">UTR / Reference</span>
                    <span className="font-mono font-medium">{savedUtr.utr}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold">₹{parseFloat(savedUtr.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Submitted</span>
                    <span>{new Date(savedUtr.submittedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── COMPLETED: someone else paid (no local record) ── */}
            {mode === "completed_other" && (
              <div className="text-center space-y-3 py-4">
                <BadgeCheck className="w-10 h-10 text-sky-400 mx-auto" />
                <h3 className="font-semibold text-foreground">Already Paid</h3>
                <p className="text-sm text-muted-foreground">This payment link has already been fulfilled and cannot accept new payments.</p>
              </div>
            )}

            {/* ── PENDING: my UTR is awaiting admin verification ── */}
            {mode === "my_pending" && savedUtr && (
              <div className="text-center space-y-4 py-2">
                <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto">
                  <Hourglass className="w-8 h-8 text-amber-400" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-foreground text-lg">Payment Submitted</h3>
                  <p className="text-sm text-muted-foreground">Your payment is pending verification. You'll be notified once confirmed.</p>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border text-left space-y-2 p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">UTR / Reference</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-medium">{savedUtr.utr}</span>
                      <button onClick={() => copyToClipboard(savedUtr.utr, "UTR")} className="text-muted-foreground hover:text-foreground">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold">₹{parseFloat(savedUtr.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Submitted</span>
                    <span>{new Date(savedUtr.submittedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground/70">Reference #{savedUtr.txnId} · Contact support if not confirmed within 24 hours</p>
              </div>
            )}

            {/* ── PENDING: someone else's UTR is awaiting verification ── */}
            {mode === "pending_other" && (
              <div className="text-center space-y-3 py-4">
                <Hourglass className="w-10 h-10 text-amber-400 mx-auto" />
                <h3 className="font-semibold text-foreground">Verification Pending</h3>
                <p className="text-sm text-muted-foreground">A payment for this link is currently awaiting verification. Please check back later.</p>
              </div>
            )}

            {/* ── EXPIRED ── */}
            {mode === "expired" && (
              <div className="text-center space-y-3 py-4">
                <XCircle className="w-10 h-10 text-rose-400 mx-auto" />
                <h3 className="font-semibold">Link Expired</h3>
                <p className="text-sm text-muted-foreground">This payment link has expired and can no longer accept payments.</p>
              </div>
            )}

            {/* ── INACTIVE ── */}
            {mode === "inactive" && (
              <div className="text-center space-y-3 py-4">
                <XCircle className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
                <h3 className="font-semibold">Link Inactive</h3>
                <p className="text-sm text-muted-foreground">This payment link has been deactivated by the merchant.</p>
              </div>
            )}

            {/* ── ACTIVE: Own Static UPI flow ── */}
            {mode === "active_pay" && staticUpi && (
              <div className="space-y-5">
                {staticUpi.instructions && (
                  <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-2">
                    <p className="text-xs text-muted-foreground">{staticUpi.instructions}</p>
                  </div>
                )}

                {/* QR */}
                <div className="flex flex-col items-center gap-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    {staticUpi.accountHolder ? `Pay to ${staticUpi.accountHolder}` : "Scan to Pay via UPI"}
                  </p>
                  {staticUpi.qrImageUrl ? (
                    <img src={staticUpi.qrImageUrl} alt="UPI QR Code"
                      className="w-52 h-52 object-contain bg-white rounded-xl shadow-sm p-2"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="bg-white p-4 rounded-xl shadow-sm">
                      <QRCodeCanvas
                        value={`upi://pay?pa=${encodeURIComponent(staticUpi.upiId)}${link.amount ? `&am=${link.amount}` : ""}${staticUpi.accountHolder ? `&pn=${encodeURIComponent(staticUpi.accountHolder)}` : ""}&cu=INR`}
                        size={200} level="H" includeMargin />
                    </div>
                  )}
                </div>

                {/* UPI ID row */}
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">UPI ID</p>
                    <p className="text-sm font-mono font-medium text-foreground truncate">{staticUpi.upiId}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0 h-7 px-2"
                    onClick={() => copyToClipboard(staticUpi.upiId, "UPI ID")}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">After paying, enter UTR below</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* UTR Form */}
                <div className="space-y-3">
                  {!link.amount && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Amount Paid (₹) <span className="text-rose-400">*</span></Label>
                      <Input type="number" placeholder="Enter amount" value={customAmount}
                        onChange={e => setCustomAmount(e.target.value)} min="1" />
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">UTR / Reference Number <span className="text-rose-400">*</span></Label>
                    <Input ref={utrInputRef} placeholder="e.g. 417810123456" value={utr}
                      onChange={e => { setUtr(e.target.value); setUtrError(null); }} className="font-mono" />
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">Find this in your UPI app under payment history</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Your Name (optional)</Label>
                    <Input placeholder="e.g. Rahul Sharma" value={payerName} onChange={e => setPayerName(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Your UPI ID (optional)</Label>
                    <Input placeholder="e.g. yourname@upi" value={payerUpi}
                      onChange={e => setPayerUpi(e.target.value)} className="font-mono" />
                  </div>

                  {utrError && (
                    <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-rose-300">{utrError}</p>
                    </div>
                  )}

                  <Button className="w-full" style={accent ? { background: accent, borderColor: accent, color: "#fff" } : {}}
                    onClick={submitUtr} disabled={utrState === "submitting"}>
                    {utrState === "submitting" ? (
                      <><div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />Submitting…</>
                    ) : (
                      <><Send className="w-4 h-4 mr-2" />Submit Payment</>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* ── ACTIVE: Standard UPI deep-link flow ── */}
            {mode === "active_pay" && !staticUpi && upiDeepLink && (
              <>
                <div className="flex flex-col items-center gap-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Scan to Pay via UPI</p>
                  <div className="bg-white p-4 rounded-xl shadow-sm">
                    <QRCodeCanvas value={upiDeepLink} size={200} level="H" includeMargin />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="space-y-2">
                  <Button className="w-full" style={accent ? { background: accent, borderColor: accent, color: "#fff" } : {}} asChild>
                    <a href={upiDeepLink}><Smartphone className="w-4 h-4 mr-2" />Open in UPI App</a>
                  </Button>
                  <Button variant="outline" className="w-full" size="sm"
                    onClick={() => copyToClipboard(upiDeepLink, "UPI payment string")}>
                    <Copy className="w-3.5 h-3.5 mr-2" />Copy UPI String
                  </Button>
                </div>
              </>
            )}

            {/* ── ACTIVE: No payment method configured ── */}
            {mode === "active_pay" && !staticUpi && !upiDeepLink && (
              <div className="text-center space-y-3 py-4">
                <Smartphone className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
                <p className="text-sm text-muted-foreground">
                  The merchant has not connected a UPI payment provider yet. Please contact them to arrange payment.
                </p>
              </div>
            )}

            {/* Expiry info (for active links with an expiry date) */}
            {mode === "active_pay" && link.expiresAt && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Expires {new Date(link.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground/60">Powered by RasoKart · Secure Payment Gateway</p>
        <p className="text-center text-[11px] text-muted-foreground/50">
          Operated by {companyName} · Need help? Call {supportPhone}
        </p>
      </div>
    </div>
  );
}
