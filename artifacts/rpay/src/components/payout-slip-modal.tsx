import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Download, Printer, Share2, Copy, ExternalLink,
  CheckCircle2, XCircle, Clock, AlertTriangle, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

// ── Types mirroring backend PayoutSlipData ───────────────────────────────────
interface SlipBeneficiary {
  name: string | null;
  bankName: string | null;
  maskedAccount: string | null;
  ifscCode: string | null;
  maskedUpi: string | null;
}

interface SlipData {
  id: number;
  receiptId: string;
  merchantId: number;
  merchantBusinessName: string;
  generatedAt: string;
  amount: number;
  currency: string;
  payoutFee: number;
  gstAmount: number;
  totalDebit: number;
  payoutMode: string;
  displayStatus: "SUCCESS" | "FAILED" | "REJECTED" | "PROCESSING";
  statusLabel: string;
  isNotFinal: boolean;
  walletRefunded: boolean;
  utrDisplay: string;
  transferDate: string | null;
  transactionDateTime: string | null;
  requestedAt: string;
  safeFailureReason: string | null;
  rejectionReason: string | null;
  beneficiary: SlipBeneficiary;
  remarks: string | null;
  isUpi: boolean;
  verificationCode: string | null;
  verificationToken: string | null;
  verificationUrl: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
}

// ── Utilities ────────────────────────────────────────────────────────────────
function fmtInr(n: number): string {
  if (n === 0) return "Nil";
  return "INR " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInrForced(n: number): string {
  return "INR " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function safe(v: string | null | undefined): string {
  return v ?? "—";
}
function getToken(): string {
  return localStorage.getItem("rasokart_token") ?? "";
}

function StatusBadgeSlip({ status, label }: { status: SlipData["displayStatus"]; label: string }) {
  const variants = {
    SUCCESS:    { icon: CheckCircle2, cls: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    FAILED:     { icon: XCircle,      cls: "text-rose-700 bg-rose-50 border-rose-200"         },
    REJECTED:   { icon: XCircle,      cls: "text-red-700 bg-red-50 border-red-200"            },
    PROCESSING: { icon: Clock,        cls: "text-amber-700 bg-amber-50 border-amber-200"      },
  } as const;
  const v = variants[status] ?? variants.PROCESSING;
  const Icon = v.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-sm font-semibold ${v.cls}`}>
      <Icon className="w-4 h-4" />
      {label}
    </span>
  );
}

function KVRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="grid grid-cols-[1fr_1fr] sm:grid-cols-[200px_1fr] gap-2 py-2 border-b border-border/30 last:border-b-0">
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <span className={`text-sm font-semibold break-all ${valueClass ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="bg-muted/30 rounded px-3 py-1.5 mt-4 mb-2">
      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{title}</p>
    </div>
  );
}

// ── Slip Web Preview ──────────────────────────────────────────────────────────
function SlipPreview({ slip }: { slip: SlipData }) {
  return (
    <div className="space-y-1 text-sm print:text-[10pt]">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xl font-bold text-foreground">Payout Transaction Details</p>
          <p className="text-xs text-muted-foreground">RasoKart Payment Gateway</p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold text-primary">RasoKart</p>
          <p className="text-xs text-muted-foreground">{slip.generatedAt}</p>
        </div>
      </div>

      <Separator />

      {/* Merchant info */}
      <div className="py-2">
        <p className="font-semibold text-foreground">Dear, {safe(slip.merchantBusinessName)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Merchant ID: RK-M-{slip.merchantId}  ·  Transfer Ref: {slip.receiptId}
        </p>
      </div>

      {/* Status */}
      <div className="py-2">
        <StatusBadgeSlip status={slip.displayStatus} label={slip.statusLabel} />
        {slip.isNotFinal && (
          <span className="ml-2 text-xs text-amber-600 font-medium">Not Final — may update</span>
        )}
      </div>

      {/* Transaction details */}
      <SectionHeader title="Transaction Details" />
      <div className="space-y-0">
        <KVRow label="RasoKart Transfer ID" value={slip.receiptId} />
        <KVRow label="UTR / Bank Reference" value={slip.utrDisplay} />
        <KVRow label="Transaction Type" value="DOMESTIC PAYOUT" />
        <KVRow label="From" value="RasoKart Payout Account" />
        {slip.isUpi && slip.beneficiary.maskedUpi
          ? <KVRow label="UPI / VPA" value={safe(slip.beneficiary.maskedUpi)} />
          : (
            <>
              <KVRow label="To Account Number" value={safe(slip.beneficiary.maskedAccount)} />
              <KVRow label="Bank Name" value={safe(slip.beneficiary.bankName)} />
              <KVRow label="IFSC Code" value={safe(slip.beneficiary.ifscCode)} />
            </>
          )
        }
        <KVRow label="Beneficiary Name" value={safe(slip.beneficiary.name)} />
      </div>

      <SectionHeader title="Amount Summary" />
      <div className="space-y-0">
        <KVRow label="Amount" value={fmtInrForced(slip.amount)} />
        <KVRow label="Payout Fee" value={fmtInr(slip.payoutFee)} />
        <KVRow label="GST" value={fmtInr(slip.gstAmount)} />
        <div className="grid grid-cols-[1fr_1fr] sm:grid-cols-[200px_1fr] gap-2 py-2 bg-muted/20 rounded px-2 mt-1">
          <span className="text-xs text-foreground font-bold">Total Debit</span>
          <span className="text-sm font-bold text-foreground">{fmtInrForced(slip.totalDebit)}</span>
        </div>
      </div>

      <SectionHeader title="Transfer Info" />
      <div className="space-y-0">
        <KVRow label="Mode" value={slip.payoutMode} />
        <KVRow label="Transfer Type" value="One Time" />
        <KVRow label="Transfer Date" value={safe(slip.transferDate)} />
        <KVRow label="Transaction Date" value={safe(slip.transactionDateTime)} />
        <KVRow label="Requested On" value={slip.requestedAt} />
        {slip.remarks && <KVRow label="Description" value={slip.remarks} />}
      </div>

      {(slip.safeFailureReason || slip.rejectionReason) && (
        <>
          <SectionHeader title="Status Details" />
          {slip.safeFailureReason && (
            <KVRow label="Failure Reason" value={slip.safeFailureReason} valueClass="text-rose-600" />
          )}
          {slip.rejectionReason && (
            <KVRow label="Rejection Reason" value={slip.rejectionReason} valueClass="text-red-600" />
          )}
          {slip.walletRefunded && (
            <KVRow label="Wallet Reversal" value="Amount released back to wallet" valueClass="text-emerald-600" />
          )}
        </>
      )}

      {slip.verificationCode && (
        <>
          <Separator className="my-3" />
          <div className="bg-muted/20 rounded p-3 space-y-1">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Verification</p>
            <p className="font-mono text-sm font-bold text-foreground">{slip.verificationCode}</p>
            {slip.verificationUrl && (
              <a
                href={slip.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Verify this payout <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </>
      )}

      <Separator className="my-3" />
      <div className="text-center space-y-1">
        <p className="text-xs text-muted-foreground font-medium">
          This is a system-generated RasoKart Payout transaction slip. No signature is required.
        </p>
        {(slip.supportEmail || slip.supportPhone) && (
          <p className="text-xs text-muted-foreground">
            {[slip.supportEmail, slip.supportPhone].filter(Boolean).join("  |  ")}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
interface PayoutSlipModalProps {
  payoutId: number | null;
  open: boolean;
  onClose: () => void;
  isAdmin?: boolean;
}

export function PayoutSlipModal({ payoutId, open, onClose, isAdmin = false }: PayoutSlipModalProps) {
  const [slip, setSlip] = useState<SlipData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = payoutId != null
    ? (isAdmin ? `/api/withdrawals/${payoutId}` : `/api/withdrawals/${payoutId}`)
    : null;

  const fetchSlip = async (id: number) => {
    setLoading(true);
    setError(null);
    setSlip(null);
    try {
      const resp = await fetch(`/api/withdrawals/${id}/slip`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setSlip(data);
    } catch {
      setError("Failed to load slip. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      setTimeout(() => {
        setSlip(null);
        setError(null);
      }, 300);
    } else if (payoutId != null) {
      fetchSlip(payoutId);
    }
  };

  if (open && payoutId != null && slip === null && !loading && !error) {
    fetchSlip(payoutId);
  }

  const handleDownloadPdf = async () => {
    if (!payoutId) return;
    setPdfLoading(true);
    try {
      const resp = await fetch(`/api/withdrawals/${payoutId}/slip.pdf`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RasoKart-Payout-${slip?.receiptId ?? payoutId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success("PDF downloaded");
    } catch {
      toast.error("Failed to download PDF");
    } finally {
      setPdfLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!payoutId) return;
    try {
      const resp = await fetch(`/api/withdrawals/${payoutId}/slip.pdf`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = url;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(url);
        }, 30000);
      };
    } catch {
      toast.error("Failed to open print dialog");
    }
  };

  const handleShare = async () => {
    if (!payoutId) return;
    setShareLoading(true);
    try {
      const resp = await fetch(`/api/withdrawals/${payoutId}/slip/share-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { url } = await resp.json();
      const fullUrl = `${window.location.origin}${url}`;

      if (navigator.share) {
        try {
          await navigator.share({
            title: `RasoKart Payout — ${slip?.receiptId ?? ""}`,
            text: `View payout transaction details: ${slip?.receiptId ?? ""}`,
            url: fullUrl,
          });
          return;
        } catch (e: any) {
          if (e?.name === "AbortError") return;
        }
      }

      await navigator.clipboard.writeText(fullUrl);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Failed to generate share link");
    } finally {
      setShareLoading(false);
    }
  };

  const handleWhatsApp = async () => {
    if (!payoutId) return;
    try {
      const resp = await fetch(`/api/withdrawals/${payoutId}/slip/share-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { url } = await resp.json();
      const fullUrl = `${window.location.origin}${url}`;
      const text = encodeURIComponent(
        `RasoKart Payout Transaction Details\n${slip?.receiptId ?? ""}\n${slip?.merchantBusinessName ?? ""}\n${fullUrl}`
      );
      window.open(`https://wa.me/?text=${text}`, "_blank");
    } catch {
      toast.error("Failed to generate share link");
    }
  };

  const handleCopyLink = async () => {
    if (!payoutId) return;
    try {
      const resp = await fetch(`/api/withdrawals/${payoutId}/slip/share-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const { url } = await resp.json();
      await navigator.clipboard.writeText(`${window.location.origin}${url}`);
      toast.success("Slip link copied");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl w-full max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            Payout Transaction Slip
            {slip && (
              <span className="text-sm font-normal text-muted-foreground">— {slip.receiptId}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Slip content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading slip...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-destructive">
              <AlertTriangle className="w-7 h-7" />
              <p className="text-sm font-medium">{error}</p>
              <Button variant="outline" size="sm" onClick={() => payoutId && fetchSlip(payoutId)}>
                Retry
              </Button>
            </div>
          ) : slip ? (
            <SlipPreview slip={slip} />
          ) : null}
        </div>

        {/* Action bar */}
        <div className="shrink-0 border-t border-border/50 px-5 py-3 bg-muted/20">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={handleDownloadPdf}
              disabled={!slip || pdfLoading}
              className="flex items-center gap-1.5"
            >
              {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Download PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrint}
              disabled={!slip}
              className="flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              Print
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleShare}
              disabled={!slip || shareLoading}
              className="flex items-center gap-1.5"
            >
              {shareLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
              Share
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleCopyLink}
              disabled={!slip}
              className="flex items-center gap-1.5"
            >
              <Copy className="w-4 h-4" />
              Copy Link
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleWhatsApp}
              disabled={!slip}
              className="flex items-center gap-1.5 text-green-600 hover:text-green-500 hover:bg-green-500/10"
            >
              <Share2 className="w-4 h-4" />
              WhatsApp
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
