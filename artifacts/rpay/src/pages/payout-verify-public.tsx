import { useEffect, useState } from "react";
import { useParams } from "wouter";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ShieldCheck,
  FileText,
} from "lucide-react";

type VerifyResult = {
  verified: boolean;
  transferId: string;
  amount: string;
  destination: string | null;
  payoutMode: string;
  requestedAt: string | null;
  processedAt: string | null;
  status: "SUCCESS" | "FAILED" | "REJECTED" | "PROCESSING";
  utr: string;
};

type ErrorResult = {
  verified: false;
  error: string;
};

function statusConfig(s: VerifyResult["status"]) {
  switch (s) {
    case "SUCCESS":
      return { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", label: "Payout Sent" };
    case "FAILED":
      return { icon: XCircle, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", label: "Payout Failed" };
    case "REJECTED":
      return { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", label: "Payout Rejected" };
    default:
      return { icon: Clock, color: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/20", label: "Processing" };
  }
}

function Row({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-start gap-4 py-2.5 border-b border-slate-700/40 last:border-0">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={`text-xs text-slate-200 text-right break-all ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

export default function PayoutVerifyPublic() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [result, setResult] = useState<VerifyResult | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState(false);

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }
    fetch(`/api/public/payout-slip/verify/${token}`)
      .then(async res => {
        const data: VerifyResult | ErrorResult = await res.json();
        if (!res.ok || !data.verified) { setNotFound(true); return; }
        setResult(data as VerifyResult);
      })
      .catch(() => setServerError(true))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center py-12 px-4">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">RasoKart</span>
        </div>
        <p className="text-sm text-slate-400">Payout Verification</p>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Verifying payout…</span>
        </div>
      )}

      {!loading && serverError && (
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-7 h-7 text-rose-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Verification unavailable</h2>
          <p className="text-sm text-slate-400">Unable to verify at this time. Please try again shortly.</p>
        </div>
      )}

      {!loading && notFound && (
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-slate-500/10 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-7 h-7 text-slate-400" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Payout not found</h2>
          <p className="text-sm text-slate-400">The verification code may be incorrect or this payout does not exist in our records.</p>
        </div>
      )}

      {!loading && result && (() => {
        const sc = statusConfig(result.status);
        const StatusIcon = sc.icon;
        return (
          <div className="w-full max-w-sm">
            {/* Verified badge */}
            <div className="flex items-center justify-center gap-2 mb-6">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-400">Verified Payout</p>
                <p className="text-[11px] text-slate-500">Issued by RasoKart Payment Gateway</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700/60 bg-slate-800/60 backdrop-blur overflow-hidden shadow-2xl">
              {/* Status banner */}
              <div className={`px-5 py-3.5 ${sc.bg} border-b ${sc.border} flex items-center gap-2.5`}>
                <StatusIcon className={`w-4 h-4 ${sc.color} shrink-0`} />
                <span className={`text-sm font-semibold ${sc.color}`}>{sc.label}</span>
                <span className="ml-auto text-[11px] font-mono text-slate-500">{result.transferId}</span>
              </div>

              {/* Amount */}
              <div className="px-5 py-4 border-b border-slate-700/40">
                <p className="text-[11px] text-slate-500 uppercase tracking-wide mb-0.5">Amount</p>
                <p className="text-2xl font-bold font-mono text-white">{result.amount}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{result.payoutMode}</p>
              </div>

              {/* Details */}
              <div className="px-5 py-1">
                <Row label="UTR / Reference" value={result.utr} mono />
                <Row label="Destination" value={result.destination} mono />
                <Row label="Requested" value={result.requestedAt} />
                <Row label="Processed" value={result.processedAt} />
              </div>

              {/* Disclaimer */}
              <div className="px-5 pb-5 pt-2">
                <p className="text-[10px] text-slate-600 text-center">
                  This verification is provided by RasoKart Payment Gateway.
                  Account details are partially masked for privacy.
                </p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
