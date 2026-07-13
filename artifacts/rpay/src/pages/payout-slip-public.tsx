import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Loader2, Download, CheckCircle2, XCircle, Clock, AlertTriangle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

type SlipData = {
  id: number;
  receiptId: string;
  generatedAt: string;
  merchantBusinessName: string | null;
  amount: number;
  currency: string;
  payoutMode: string;
  displayStatus: "SUCCESS" | "FAILED" | "REJECTED" | "PROCESSING";
  statusLabel: string;
  utrDisplay: string | null;
  safeFailureReason: string | null;
  rejectionReason: string | null;
  requestedAt: string;
  transactionDateTime: string | null;
  beneficiary: {
    name: string | null;
    bankName: string | null;
    maskedAccount: string | null;
    ifscCode: string | null;
    maskedUpi: string | null;
  };
  remarks: string | null;
  isNotFinal: boolean;
  walletRefunded: boolean;
};

function statusConfig(s: SlipData["displayStatus"]) {
  switch (s) {
    case "SUCCESS":
      return {
        icon: CheckCircle2,
        bg: "bg-emerald-500/10",
        border: "border-emerald-500/20",
        text: "text-emerald-400",
        label: "Payout Sent",
      };
    case "FAILED":
      return {
        icon: XCircle,
        bg: "bg-rose-500/10",
        border: "border-rose-500/20",
        text: "text-rose-400",
        label: "Payout Failed",
      };
    case "REJECTED":
      return {
        icon: AlertTriangle,
        bg: "bg-amber-500/10",
        border: "border-amber-500/20",
        text: "text-amber-400",
        label: "Payout Rejected",
      };
    default:
      return {
        icon: Clock,
        bg: "bg-sky-500/10",
        border: "border-sky-500/20",
        text: "text-sky-400",
        label: "Processing",
      };
  }
}

function SlipRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-medium mt-0.5 break-all text-slate-100 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

export default function PayoutSlipPublic() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [slip, setSlip] = useState<SlipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"expired" | "not_found" | "error" | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!token) { setError("not_found"); setLoading(false); return; }
    fetch(`/api/public/payout-slip/${token}`)
      .then(async res => {
        if (res.status === 401) { setError("expired"); return; }
        if (res.status === 404) { setError("not_found"); return; }
        if (!res.ok) { setError("error"); return; }
        setSlip(await res.json());
      })
      .catch(() => setError("error"))
      .finally(() => setLoading(false));
  }, [token]);

  const downloadPdf = async () => {
    if (!token) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/public/payout-slip/${token}/pdf`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = slip ? `rasokart-payout-slip-${slip.id}.pdf` : "rasokart-payout-slip.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      /* silent — button stays available */
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center py-12 px-4">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <FileText className="w-4 h-4 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">RasoKart</span>
        </div>
        <p className="text-sm text-slate-400">Payout Receipt</p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading receipt…</span>
        </div>
      )}

      {/* Error states */}
      {!loading && error === "expired" && (
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-amber-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Slip link expired</h2>
          <p className="text-sm text-slate-400">This payout receipt link has expired or is no longer valid. Please request a new share link from the merchant portal.</p>
        </div>
      )}
      {!loading && error === "not_found" && (
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-slate-500/10 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-7 h-7 text-slate-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Receipt not found</h2>
          <p className="text-sm text-slate-400">This payout receipt could not be found. The link may be incorrect.</p>
        </div>
      )}
      {!loading && error === "error" && (
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-7 h-7 text-rose-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Unable to load receipt</h2>
          <p className="text-sm text-slate-400">Something went wrong. Please try again later.</p>
        </div>
      )}

      {/* Receipt card */}
      {!loading && slip && (() => {
        const sc = statusConfig(slip.displayStatus);
        const StatusIcon = sc.icon;
        const amountFmt = slip.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        return (
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-slate-700/60 bg-slate-800/60 backdrop-blur overflow-hidden shadow-2xl">
              {/* Status banner */}
              <div className={`px-6 py-4 ${sc.bg} border-b ${sc.border} flex items-center gap-3`}>
                <StatusIcon className={`w-5 h-5 ${sc.text} shrink-0`} />
                <div className="flex-1">
                  <p className={`font-semibold ${sc.text}`}>{slip.statusLabel}</p>
                  {slip.isNotFinal && (
                    <p className="text-xs text-amber-400 mt-0.5">This receipt is not yet final — status may update.</p>
                  )}
                </div>
                <span className="text-xs font-mono text-slate-500">{slip.receiptId}</span>
              </div>

              {/* Amount hero */}
              <div className="px-6 py-5 border-b border-slate-700/40">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Amount</p>
                <p className="text-3xl font-bold font-mono text-white">₹{amountFmt}</p>
                <p className="text-xs text-slate-500 mt-1">{slip.currency} · {slip.payoutMode}</p>
              </div>

              {/* Details grid */}
              <div className="px-6 py-5 grid grid-cols-2 gap-x-6 gap-y-4">
                <div className="col-span-2 flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Payout Details</span>
                  <div className="flex-1 h-px bg-slate-700/50" />
                </div>
                <SlipRow label="Merchant" value={slip.merchantBusinessName} />
                <SlipRow label="Requested" value={slip.requestedAt} />
                {slip.transactionDateTime && <SlipRow label="Processed" value={slip.transactionDateTime} />}
                {slip.utrDisplay && <SlipRow label="UTR" value={slip.utrDisplay} mono />}
                {slip.remarks && <SlipRow label="Remarks" value={slip.remarks} />}

                {(slip.beneficiary.name || slip.beneficiary.maskedAccount || slip.beneficiary.maskedUpi) && (
                  <>
                    <div className="col-span-2 flex items-center gap-2 mt-2 mb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Beneficiary</span>
                      <div className="flex-1 h-px bg-slate-700/50" />
                    </div>
                    {slip.beneficiary.name && <SlipRow label="Name" value={slip.beneficiary.name} />}
                    {slip.beneficiary.maskedUpi
                      ? <SlipRow label="UPI ID" value={slip.beneficiary.maskedUpi} mono />
                      : <>
                          {slip.beneficiary.bankName && <SlipRow label="Bank" value={slip.beneficiary.bankName} />}
                          {slip.beneficiary.maskedAccount && <SlipRow label="Account" value={slip.beneficiary.maskedAccount} mono />}
                          {slip.beneficiary.ifscCode && <SlipRow label="IFSC" value={slip.beneficiary.ifscCode} mono />}
                        </>
                    }
                  </>
                )}
              </div>

              {/* Failure / rejection banners */}
              {slip.safeFailureReason && (
                <div className="mx-6 mb-4 rounded-md bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs">
                  <span className="font-semibold text-rose-400">Failure reason: </span>
                  <span className="text-rose-300">{slip.safeFailureReason}</span>
                  {slip.walletRefunded && (
                    <p className="mt-1 text-emerald-400">Amount has been released back to the merchant wallet.</p>
                  )}
                </div>
              )}
              {slip.rejectionReason && (
                <div className="mx-6 mb-4 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs">
                  <span className="font-semibold text-amber-400">Rejection reason: </span>
                  <span className="text-amber-300">{slip.rejectionReason}</span>
                </div>
              )}

              {/* Net debit bar */}
              <div className="mx-6 mb-5 rounded-md bg-slate-700/30 px-4 py-2.5 flex justify-between text-sm border border-slate-700/40">
                <span className="text-slate-400">Net Debit</span>
                <span className="font-semibold font-mono text-white">₹{amountFmt}</span>
              </div>

              {/* Download button */}
              <div className="px-6 pb-6">
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={downloadPdf}
                  disabled={downloading}
                >
                  {downloading
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <Download className="w-4 h-4 mr-2" />}
                  Download PDF
                </Button>
              </div>
            </div>

            {/* Footer */}
            <p className="text-center text-[11px] text-slate-600 mt-5">
              System-generated RasoKart payout receipt · {slip.generatedAt}
            </p>
            <p className="text-center text-[11px] text-slate-700 mt-1">
              This slip was shared with you. Powered by RasoKart.
            </p>
          </div>
        );
      })()}
    </div>
  );
}
