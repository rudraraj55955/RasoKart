import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { QRCodeCanvas } from "qrcode.react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type TxnStatusResp = {
  txnId: number;
  status: string;
  amount: string | null;
  utr: string | null;
  updatedAt: string | null;
  linkStatus: string;
  linkMaxPayments: number | null;
};

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
}

// Guards against accidentally surfacing raw SQL or stack traces from server errors.
function looksLikeSql(s: string | undefined | null): boolean {
  if (!s) return false;
  const lower = s.toLowerCase();
  return (
    lower.includes("insert into") ||
    lower.includes("select ") ||
    lower.includes("update ") ||
    lower.includes("delete from") ||
    lower.includes("failed query") ||
    lower.includes("syntax error") ||
    lower.includes("column ") && lower.includes("does not exist") ||
    lower.includes("relation \"") ||
    lower.includes("at object.") ||
    lower.includes("at process.")
  );
}

function isValidColor(color: string): boolean {
  return /^#[0-9a-f]{3,8}$/i.test(color) || /^(rgb|hsl)a?\(.+\)$/i.test(color);
}

type UtrState = "idle" | "submitting" | "success" | "error";

// ── Derived page state from link.status + localStorage + DB txn status ───────
type PageMode =
  | "active_pay"          // show UTR form / UPI QR
  | "my_pending"          // I submitted, awaiting admin verification
  | "my_approved"         // my UTR was approved
  | "my_rejected"         // my UTR was rejected — can resubmit
  | "completed_other"     // link completed but not by me
  | "pending_other"       // someone else's UTR pending
  | "expired"
  | "inactive"
  | "unavailable";

function deriveMode(
  linkStatus: string,
  saved: SavedUtrState | null,
  txnStatus: string | null,
): PageMode {
  if (linkStatus === "expired") return "expired";
  if (linkStatus === "inactive") return "inactive";

  // If we have a real DB txn status, it wins over link-level guessing
  if (saved && txnStatus !== null) {
    if (txnStatus === "success")                           return "my_approved";
    if (txnStatus === "pending_verification")              return "my_pending";
    if (txnStatus === "rejected" || txnStatus === "failed") return "my_rejected";
  }

  if (linkStatus === "completed") return saved ? "my_approved" : "completed_other";
  if (linkStatus === "pending_verification") return saved ? "my_pending" : "pending_other";
  if (linkStatus === "active") {
    if (saved) return "my_pending"; // submitted but txn status not yet loaded
    return "active_pay";
  }
  return "unavailable";
}

// Poll interval while a submission is pending verification
const POLL_INTERVAL_MS = 12_000;

export default function PayPage() {
  const { companyName, supportPhone } = useCompanySettings();
  const [, params] = useRoute("/pay/:slug");
  const slug = params?.slug ?? "";

  const [link, setLink] = useState<PublicLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Persisted UTR state from a previous submission on this device
  const [savedUtr, setSavedUtr] = useState<SavedUtrState | null>(null);

  // Live DB transaction status (null = not yet fetched / no saved submission)
  const [txnStatus, setTxnStatus] = useState<string | null>(null);
  const [txnUpdatedAt, setTxnUpdatedAt] = useState<string | null>(null);
  // Track whether we're loading the txn status for the first time
  const [txnStatusLoading, setTxnStatusLoading] = useState(false);

  // UTR form
  const [utr, setUtr] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [payerName, setPayerName] = useState("");
  const [payerUpi, setPayerUpi] = useState("");
  const [utrState, setUtrState] = useState<UtrState>("idle");
  const [utrError, setUtrError] = useState<string | null>(null);
  const [utrErrorTitle, setUtrErrorTitle] = useState<string | null>(null);
  const utrInputRef = useRef<HTMLInputElement>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch real-time txn status from DB ────────────────────────────────────
  async function fetchTxnStatus(
    currentSlug: string,
    txnId: number,
    isFirstFetch = false,
  ): Promise<string | null> {
    if (isFirstFetch) setTxnStatusLoading(true);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const r = await fetch(`${base}/api/payment-links/public/${currentSlug}/txn/${txnId}`, {
        cache: "no-store",
      });
      if (!r.ok) return null;
      const data: TxnStatusResp = await r.json();
      setTxnStatus(data.status);
      setTxnUpdatedAt(data.updatedAt);
      return data.status;
    } catch {
      return null;
    } finally {
      if (isFirstFetch) setTxnStatusLoading(false);
    }
  }

  // ── Stop polling ──────────────────────────────────────────────────────────
  function stopPolling() {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  // ── Start polling (fires every POLL_INTERVAL_MS while pending) ───────────
  function startPolling(currentSlug: string, txnId: number) {
    stopPolling();
    pollTimerRef.current = setInterval(async () => {
      const status = await fetchTxnStatus(currentSlug, txnId, false);
      if (status && status !== "pending_verification") {
        stopPolling();
        // If approved, clear stale pending localStorage
        if (status === "success") {
          try { localStorage.removeItem(LS_KEY(currentSlug)); } catch { /* ignore */ }
        }
        // If rejected, clear localStorage so the form is re-enabled
        if (status === "rejected" || status === "failed") {
          try { localStorage.removeItem(LS_KEY(currentSlug)); } catch { /* ignore */ }
        }
      }
    }, POLL_INTERVAL_MS);
  }

  // ── Load link + restore saved UTR state + fetch initial txn status ────────
  useEffect(() => {
    if (!slug) return;

    let savedUtrLocal: SavedUtrState | null = null;
    try {
      const raw = localStorage.getItem(LS_KEY(slug));
      if (raw) {
        savedUtrLocal = JSON.parse(raw);
        setSavedUtr(savedUtrLocal);
      }
    } catch { /* ignore */ }

    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${base}/api/payment-links/public/${slug}`, { cache: "no-store" })
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ?? "Payment link not found");
        }
        return r.json();
      })
      .then(async (data: PublicLink) => {
        setLink(data);
        setLoading(false);

        // If there's a saved submission, fetch its real status immediately
        if (savedUtrLocal?.txnId) {
          const status = await fetchTxnStatus(slug, savedUtrLocal.txnId, true);

          if (status === "success") {
            // Clear stale pending localStorage — DB is the truth now
            try { localStorage.removeItem(LS_KEY(slug)); } catch { /* ignore */ }
          } else if (status === "rejected" || status === "failed") {
            // Rejected: clear so they can submit again
            try { localStorage.removeItem(LS_KEY(slug)); } catch { /* ignore */ }
          } else if (status === "pending_verification") {
            // Still pending — start background polling
            startPolling(slug, savedUtrLocal.txnId);
          }
        }
      })
      .catch(err => { setError(err.message); setLoading(false); });

    return () => { stopPolling(); };
  }, [slug]);

  async function submitUtr() {
    if (!link || !slug) return;
    const utrTrimmed = utr.trim();
    if (!utrTrimmed) { setUtrError("UTR / reference number is required"); utrInputRef.current?.focus(); return; }
    if (utrTrimmed.length < 8 || utrTrimmed.length > 30) { setUtrError("UTR must be between 8 and 30 characters"); utrInputRef.current?.focus(); return; }
    if (!link.amount && !customAmount.trim()) { setUtrError("Please enter the amount you paid"); return; }
    setUtrError(null);
    setUtrState("submitting");
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    try {
      const r = await fetch(`${base}/api/payment-links/public/${slug}/utr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          utr: utrTrimmed,
          amount: link.amount ? undefined : customAmount.trim(),
          payerName: payerName.trim() || undefined,
          payerUpi: payerUpi.trim() || undefined,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const code = body?.code as string | undefined;
        const title = body?.title as string | undefined;
        const fieldUtrError = body?.fieldErrors?.utr as string | undefined;
        const structuredMsg = body?.message as string | undefined;
        const legacyError = body?.error as string | undefined;

        const KNOWN_CODES = new Set([
          "DUPLICATE_UTR", "PAYMENT_LINK_EXPIRED", "PAYMENT_LINK_COMPLETED",
          "PAYMENT_UNAVAILABLE", "INVALID_AMOUNT",
        ]);

        if (code && KNOWN_CODES.has(code) && structuredMsg) {
          setUtrErrorTitle(title ?? null);
          setUtrError(structuredMsg);
        } else {
          const raw = fieldUtrError ?? structuredMsg ?? legacyError ?? "We could not submit your payment right now. Please try again.";
          const safe = looksLikeSql(raw)
            ? "We could not submit your payment right now. Please try again."
            : raw;
          setUtrErrorTitle(null);
          setUtrError(safe);
        }
        setUtrState("error");
        return;
      }

      const finalAmount = link.amount ?? customAmount.trim();
      const saved: SavedUtrState = {
        utr: utr.trim().toUpperCase(),
        txnId: body.transactionId,
        amount: finalAmount,
        submittedAt: new Date().toISOString(),
      };
      try { localStorage.setItem(LS_KEY(slug), JSON.stringify(saved)); } catch { /* ignore */ }
      setSavedUtr(saved);
      setTxnStatus("pending_verification");
      setTxnUpdatedAt(null);
      setUtrState("success");

      // Begin polling for this new submission
      startPolling(slug, saved.txnId);
    } catch (err: any) {
      setUtrErrorTitle(null);
      setUtrError(err.message ?? "We could not submit your payment right now. Please try again.");
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

  // While the first txn-status fetch is in-flight, don't flip to "active_pay"
  // prematurely — show a brief spinner overlay instead.
  const effectiveSaved = (txnStatus === null && txnStatusLoading) ? savedUtr : savedUtr;
  const mode = deriveMode(link.status, effectiveSaved, txnStatus);

  const staticUpi = link.staticUpi ?? null;
  const upiDeepLink = link.upiPayload ?? "";
  const accent = link.brandColor && isValidColor(link.brandColor) ? link.brandColor : null;
  const accentStyle = accent ? ({ "--brand-accent": accent } as React.CSSProperties) : {};

  // For multi-use links: after my payment succeeds, the link stays active
  const isMultiUseStillActive = mode === "my_approved" && link.status === "active" && link.maxPayments != null;

  const statusBadge = () => {
    if (mode === "my_approved")                          return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Paid</Badge>;
    if (mode === "completed_other")                      return <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/20">Completed</Badge>;
    if (mode === "my_pending" || mode === "pending_other") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">Pending</Badge>;
    if (mode === "my_rejected")                          return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/20">Rejected</Badge>;
    if (mode === "expired")                              return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/20">Expired</Badge>;
    if (mode === "inactive")                             return <Badge className="bg-muted text-muted-foreground border-border">Inactive</Badge>;
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

            {/* ── Loading txn status spinner (first fetch, savedUtr present) ── */}
            {txnStatusLoading && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Checking payment status…
              </div>
            )}

            {/* ── APPROVED: my payment was verified ── */}
            {!txnStatusLoading && mode === "my_approved" && (
              <div className="text-center space-y-4 py-2">
                <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
                  <BadgeCheck className="w-8 h-8 text-emerald-400" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-foreground text-lg">Payment Successful</h3>
                  <p className="text-sm text-muted-foreground">Your payment has been verified and confirmed.</p>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border text-left space-y-2 p-4">
                  {(savedUtr?.utr || txnUpdatedAt) && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">UTR / Reference</span>
                      <span className="font-mono font-medium">{savedUtr?.utr ?? "—"}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-semibold">
                      ₹{parseFloat(savedUtr?.amount ?? link.amount ?? "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {txnUpdatedAt && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Approved</span>
                      <span>{new Date(txnUpdatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  )}
                  {!txnUpdatedAt && savedUtr?.submittedAt && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Submitted</span>
                      <span>{new Date(savedUtr.submittedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  )}
                </div>

                {/* Multi-use link — this link can still accept more payments */}
                {isMultiUseStillActive && (
                  <div className="flex items-start gap-2 rounded-lg bg-sky-500/8 border border-sky-500/20 px-3 py-2 text-left">
                    <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-sky-300">
                      This payment was successful. This link can still accept more payments.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── COMPLETED: someone else paid (no local record) ── */}
            {!txnStatusLoading && mode === "completed_other" && (
              <div className="text-center space-y-3 py-4">
                <BadgeCheck className="w-10 h-10 text-sky-400 mx-auto" />
                <h3 className="font-semibold text-foreground">Already Paid</h3>
                <p className="text-sm text-muted-foreground">This payment link has already been fulfilled and cannot accept new payments.</p>
              </div>
            )}

            {/* ── PENDING: my UTR is awaiting admin verification ── */}
            {!txnStatusLoading && mode === "my_pending" && savedUtr && (
              <div className="text-center space-y-4 py-2">
                <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto">
                  <Hourglass className="w-8 h-8 text-amber-400" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-foreground text-lg">Verification Pending</h3>
                  <p className="text-sm text-muted-foreground">Your payment is awaiting verification. You'll be notified once confirmed.</p>
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
                <p className="text-xs text-muted-foreground/70">
                  Reference #{savedUtr.txnId} · This page refreshes automatically · Contact support if not confirmed within 24 hours
                </p>
              </div>
            )}

            {/* ── REJECTED: my UTR was rejected — allow fresh submission ── */}
            {!txnStatusLoading && mode === "my_rejected" && (
              <div className="space-y-4">
                <div className="text-center space-y-3 py-2">
                  <div className="w-14 h-14 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center mx-auto">
                    <XCircle className="w-7 h-7 text-rose-400" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-foreground text-lg">Payment Rejected</h3>
                    <p className="text-sm text-muted-foreground">
                      Your previous submission could not be verified. Please check the UTR and try again, or contact support.
                    </p>
                  </div>
                </div>

                {/* Re-show the static UPI form so they can resubmit */}
                {staticUpi && link.status === "active" && (
                  <div className="space-y-3 border-t border-border pt-4">
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
                    <Button variant="outline" className="w-full" onClick={() => {
                      setTxnStatus(null);
                      setSavedUtr(null);
                      setUtr("");
                      setUtrState("idle");
                    }}>
                      Submit a new UTR
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* ── PENDING: someone else's UTR is awaiting verification ── */}
            {!txnStatusLoading && mode === "pending_other" && (
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
                      onChange={e => { setUtr(e.target.value); setUtrError(null); setUtrErrorTitle(null); }} className="font-mono" />
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
                    <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2.5">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="text-xs text-rose-300 space-y-0.5">
                        {utrErrorTitle && <p className="font-semibold">{utrErrorTitle}</p>}
                        <p>{utrError}</p>
                      </div>
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
