import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";
import {
  Loader2, ShieldCheck, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, ChevronLeft, FileText, User, Building2, CreditCard,
  Info, Eye,
} from "lucide-react";

interface InfoFlag { type: "error" | "warning" | "info"; message: string }

interface Application {
  merchantId: number;
  fullName?: string | null;
  businessName?: string | null;
  panStatus?: string | null;
  aadhaarStatus?: string | null;
  bankStatus?: string | null;
  gstinMasked?: string | null;
  cinNumber?: string | null;
  udyamNumber?: string | null;
  riskScore?: number | null;
  mismatchFlags?: string[];
  adminDecision: string;
  rejectionReason?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  kycUpdatedAt?: string | null;
  mobileMasked?: string | null;
  merchantEmail?: string | null;
  mandatoryChecksPassed: boolean;
  infoFlags: InfoFlag[];
}

interface KycDetail extends Application {
  id: number;
  dob?: string | null;
  gender?: string | null;
  email?: string | null;
  panMasked?: string | null;
  aadhaarLast4?: string | null;
  bankAccountMasked?: string | null;
  bankIfsc?: string | null;
  bankHolderName?: string | null;
  udyamStatus?: string | null;
  cinStatus?: string | null;
  gstStatus?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateName?: string | null;
  pincode?: string | null;
}

interface Log { id: number; verificationType: string; status: string; requestId?: string | null; createdAt: string; error?: string | null; rawResponse?: any }

function DecisionBadge({ d }: { d: string }) {
  const cfg: Record<string, [string, string]> = {
    PENDING: ["bg-amber-600", "Pending"],
    APPROVED: ["bg-emerald-600", "Approved"],
    REJECTED: ["bg-red-600", "Rejected"],
    RE_UPLOAD_REQUIRED: ["bg-blue-600", "Re-Upload Required"],
  };
  const [cls, label] = cfg[d] ?? ["bg-neutral-600", d];
  return <Badge className={`${cls} text-white text-xs`}>{label}</Badge>;
}

function VerifyChip({ status, label }: { status?: string | null; label: string }) {
  const isVerified = status === "VERIFIED";
  const isPending = status === "PENDING";
  const isSkipped = status === "SKIPPED" || !status;
  const isFailed = status === "FAILED";
  return (
    <div className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border ${
      isVerified ? "border-emerald-700 bg-emerald-950/40 text-emerald-300" :
      isPending  ? "border-amber-700 bg-amber-950/30 text-amber-300" :
      isFailed   ? "border-red-700 bg-red-950/30 text-red-300" :
                   "border-neutral-700 bg-neutral-800/50 text-neutral-500"
    }`}>
      {isVerified ? <CheckCircle2 className="w-3 h-3" /> :
       isFailed   ? <XCircle className="w-3 h-3" /> :
       isPending  ? <AlertTriangle className="w-3 h-3" /> :
                    <Info className="w-3 h-3" />}
      {label}: {isSkipped ? "Not Provided (Optional)" : status}
    </div>
  );
}

function InfoFlagRow({ flag }: { flag: InfoFlag }) {
  const cfg = {
    error:   { cls: "border-red-700 bg-red-950/20 text-red-300", Icon: XCircle },
    warning: { cls: "border-amber-700 bg-amber-950/20 text-amber-300", Icon: AlertTriangle },
    info:    { cls: "border-neutral-700 bg-neutral-800/30 text-neutral-400", Icon: Info },
  }[flag.type];
  return (
    <div className={`flex items-center gap-2 rounded px-3 py-2 border text-xs ${cfg.cls}`}>
      <cfg.Icon className="w-3.5 h-3.5 shrink-0" />
      {flag.message}
    </div>
  );
}

export default function AdminMerchantOnboarding() {
  const { data: meData } = useGetMe();
  const isSuperAdmin = !!(meData as any)?.isSuperAdmin;

  const [applications, setApplications] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [decisionFilter, setDecisionFilter] = useState("");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [kycDetail, setKycDetail] = useState<KycDetail | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const [decisionDialog, setDecisionDialog] = useState(false);
  const [pendingDecision, setPendingDecision] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const LIMIT = 25;
  const token = () => localStorage.getItem("rasokart_token");

  async function loadList(pg = 1) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(LIMIT) });
      if (decisionFilter) params.set("decision", decisionFilter);
      const r = await fetch(`/api/admin/onboarding?${params}`, { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      setApplications(d.applications ?? []);
      setTotal(d.total ?? 0);
      setPage(pg);
    } finally { setLoading(false); }
  }

  useEffect(() => { loadList(); }, [decisionFilter]);

  async function loadDetail(merchantId: number) {
    setSelectedId(merchantId);
    setDetailLoading(true);
    setShowLogs(false);
    try {
      const [detailR, logsR] = await Promise.all([
        fetch(`/api/admin/onboarding/${merchantId}`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`/api/admin/onboarding/${merchantId}/logs`, { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const [detail, logsData] = await Promise.all([detailR.json(), logsR.json()]);
      setKycDetail({ ...detail.kyc, mandatoryChecksPassed: detail.mandatoryChecksPassed, infoFlags: detail.infoFlags, merchantEmail: detail.merchantEmail });
      setLogs(logsData.logs ?? []);
    } finally { setDetailLoading(false); }
  }

  async function submitDecision() {
    if (!selectedId) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/admin/onboarding/${selectedId}/decision`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ decision: pendingDecision, rejectionReason }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error ?? "Failed"); return; }
      toast.success(`Decision: ${pendingDecision}`);
      setDecisionDialog(false);
      setKycDetail((p) => p ? { ...p, adminDecision: pendingDecision, rejectionReason, mandatoryChecksPassed: p.mandatoryChecksPassed, infoFlags: p.infoFlags } : p);
      loadList(page);
    } finally { setSubmitting(false); }
  }

  // ── Detail View ────────────────────────────────────────────────────────────
  if (selectedId !== null) {
    return (
      <DashboardLayout>
        <div className="max-w-3xl mx-auto space-y-5 p-4">
          <Button variant="ghost" className="text-neutral-400 hover:text-white -ml-2" onClick={() => { setSelectedId(null); setKycDetail(null); }}>
            <ChevronLeft className="w-4 h-4 mr-1" /> Back to list
          </Button>

          {detailLoading ? (
            <div className="flex items-center justify-center h-40"><Loader2 className="w-8 h-8 animate-spin text-indigo-400" /></div>
          ) : kycDetail ? (
            <>
              {/* Header */}
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-bold text-white">{kycDetail.fullName ?? "Unknown Merchant"}</h2>
                  <p className="text-sm text-neutral-400">{kycDetail.businessName ?? "—"} · {kycDetail.merchantEmail ?? `#${kycDetail.merchantId}`}</p>
                  {kycDetail.mobileMasked && <p className="text-xs text-neutral-500 mt-0.5">Mobile: {kycDetail.mobileMasked}</p>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <DecisionBadge d={kycDetail.adminDecision} />
                  {kycDetail.mandatoryChecksPassed
                    ? <Badge className="bg-emerald-700 text-white text-xs">✓ Eligible for Approval</Badge>
                    : <Badge className="bg-red-800 text-white text-xs">⚠ Mandatory Checks Incomplete</Badge>}
                </div>
              </div>

              {/* Info flags */}
              {kycDetail.infoFlags && kycDetail.infoFlags.length > 0 && (
                <div className="space-y-1.5">
                  {kycDetail.infoFlags.map((f, i) => <InfoFlagRow key={i} flag={f} />)}
                </div>
              )}

              {/* Mandatory verification status */}
              <Card className="bg-neutral-900 border-neutral-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-neutral-300 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" />Mandatory Verification Checks
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <VerifyChip status={kycDetail.panStatus} label="PAN" />
                  <VerifyChip status={kycDetail.aadhaarStatus} label="Aadhaar" />
                  <VerifyChip status={kycDetail.bankStatus} label="Bank" />
                </CardContent>
              </Card>

              {/* Identity */}
              <Card className="bg-neutral-900 border-neutral-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-neutral-300 flex items-center gap-2"><User className="w-4 h-4" />Identity Details</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  {kycDetail.fullName && <div><p className="text-xs text-neutral-500">Full Name</p><p className="text-white">{kycDetail.fullName}</p></div>}
                  {kycDetail.dob && <div><p className="text-xs text-neutral-500">DOB</p><p className="text-white">{kycDetail.dob}</p></div>}
                  {kycDetail.gender && <div><p className="text-xs text-neutral-500">Gender</p><p className="text-white">{kycDetail.gender}</p></div>}
                  {kycDetail.panMasked && <div><p className="text-xs text-neutral-500">PAN</p><p className="text-white font-mono">{kycDetail.panMasked}</p></div>}
                  {kycDetail.aadhaarLast4 && (
                    <div>
                      <p className="text-xs text-neutral-500">Aadhaar</p>
                      <p className="text-white font-mono">XXXX XXXX {kycDetail.aadhaarLast4}</p>
                      <p className="text-[10px] text-neutral-600 mt-0.5">Full number not stored</p>
                    </div>
                  )}
                  {kycDetail.city && <div><p className="text-xs text-neutral-500">Address</p><p className="text-white text-xs">{[kycDetail.addressLine1, kycDetail.city, kycDetail.stateName, kycDetail.pincode].filter(Boolean).join(", ")}</p></div>}
                </CardContent>
              </Card>

              {/* Bank */}
              <Card className="bg-neutral-900 border-neutral-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-neutral-300 flex items-center gap-2"><CreditCard className="w-4 h-4" />Bank Account</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  {kycDetail.bankHolderName && <div><p className="text-xs text-neutral-500">Account Holder</p><p className="text-white">{kycDetail.bankHolderName}</p></div>}
                  {kycDetail.bankAccountMasked && <div><p className="text-xs text-neutral-500">Account</p><p className="text-white font-mono">{kycDetail.bankAccountMasked}</p></div>}
                  {kycDetail.bankIfsc && <div><p className="text-xs text-neutral-500">IFSC</p><p className="text-white font-mono">{kycDetail.bankIfsc}</p></div>}
                </CardContent>
              </Card>

              {/* Optional / Business */}
              <Card className="bg-neutral-900 border-neutral-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-neutral-300 flex items-center gap-2"><Building2 className="w-4 h-4" />Optional Business Details</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div><p className="text-xs text-neutral-500">GSTIN</p><p className={kycDetail.gstinMasked ? "text-white font-mono" : "text-neutral-600 italic text-xs"}>{kycDetail.gstinMasked ?? "Not provided (optional)"}</p></div>
                  <div><p className="text-xs text-neutral-500">CIN</p><p className={kycDetail.cinNumber ? "text-white font-mono" : "text-neutral-600 italic text-xs"}>{kycDetail.cinNumber ?? "Not provided (optional)"}</p></div>
                  <div><p className="text-xs text-neutral-500">Udyam</p><p className={kycDetail.udyamNumber ? "text-white font-mono" : "text-neutral-600 italic text-xs"}>{kycDetail.udyamNumber ?? "Not provided (optional)"}</p></div>
                  <div>
                    <p className="text-xs text-neutral-500">GST Verification</p>
                    <VerifyChip status={kycDetail.gstStatus} label="GST" />
                  </div>
                </CardContent>
              </Card>

              {/* Decision panel */}
              {kycDetail.adminDecision === "PENDING" && (
                <Card className="bg-neutral-900 border-neutral-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white">Admin Decision</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {!kycDetail.mandatoryChecksPassed && !isSuperAdmin && (
                      <Alert className="border-red-700 bg-red-950/30">
                        <XCircle className="h-4 w-4 text-red-400" />
                        <AlertDescription className="text-red-300 text-sm">
                          Cannot approve — mandatory verifications (PAN, Aadhaar, Bank) are incomplete.
                          Super Admin can override.
                        </AlertDescription>
                      </Alert>
                    )}
                    {!kycDetail.mandatoryChecksPassed && isSuperAdmin && (
                      <Alert className="border-amber-700 bg-amber-950/30">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                        <AlertDescription className="text-amber-300 text-sm">
                          Mandatory checks incomplete — you are approving as Super Admin override.
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="flex gap-3 flex-wrap">
                      <Button className="bg-emerald-600 hover:bg-emerald-700"
                        disabled={!kycDetail.mandatoryChecksPassed && !isSuperAdmin}
                        onClick={() => { setPendingDecision("APPROVED"); setRejectionReason(""); setDecisionDialog(true); }}>
                        <CheckCircle2 className="w-4 h-4 mr-2" />Approve
                      </Button>
                      <Button variant="outline" className="border-blue-600 text-blue-400 hover:bg-blue-950/30"
                        onClick={() => { setPendingDecision("RE_UPLOAD_REQUIRED"); setRejectionReason(""); setDecisionDialog(true); }}>
                        <RefreshCw className="w-4 h-4 mr-2" />Request Re-Upload
                      </Button>
                      <Button variant="destructive"
                        onClick={() => { setPendingDecision("REJECTED"); setRejectionReason(""); setDecisionDialog(true); }}>
                        <XCircle className="w-4 h-4 mr-2" />Reject
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {kycDetail.adminDecision !== "PENDING" && (
                <Alert className={kycDetail.adminDecision === "APPROVED" ? "border-emerald-700 bg-emerald-950/30" : "border-neutral-700"}>
                  <AlertDescription className="text-sm space-y-1">
                    <div className="flex items-center gap-2"><strong className="text-white">Decision:</strong> <DecisionBadge d={kycDetail.adminDecision} /></div>
                    {kycDetail.approvedBy && <p className="text-neutral-400">By: {kycDetail.approvedBy}</p>}
                    {kycDetail.rejectionReason && <p className="text-neutral-400">Reason: {kycDetail.rejectionReason}</p>}
                  </AlertDescription>
                </Alert>
              )}

              {/* Verification logs */}
              <div className="pt-1">
                <Button variant="ghost" className="text-neutral-400 hover:text-white text-sm" onClick={() => setShowLogs((v) => !v)}>
                  <Eye className="w-4 h-4 mr-2" />{showLogs ? "Hide" : "View"} Verification Logs ({logs.length})
                </Button>
                {showLogs && (
                  <div className="mt-3 space-y-2">
                    {logs.length === 0 && <p className="text-sm text-neutral-500 ml-1">No verification logs found.</p>}
                    {logs.map((log) => (
                      <div key={log.id} className="rounded-lg bg-neutral-800 border border-neutral-700 p-3 text-xs font-mono">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-neutral-300 font-semibold">{log.verificationType}</span>
                          <Badge className={`text-xs ${log.status === "VERIFIED" ? "bg-emerald-600" : log.status === "FAILED" ? "bg-red-600" : "bg-neutral-600"} text-white`}>{log.status}</Badge>
                        </div>
                        {log.requestId && <p className="text-neutral-500">req_id: {log.requestId}</p>}
                        <p className="text-neutral-500">{new Date(log.createdAt).toLocaleString("en-IN")}</p>
                        {log.error && <p className="text-red-400 mt-1">{log.error}</p>}
                        {isSuperAdmin && log.rawResponse && (
                          <pre className="mt-2 text-neutral-400 overflow-x-auto text-[10px] max-h-32">{JSON.stringify(log.rawResponse, null, 2)}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <Alert><AlertDescription>KYC data not found.</AlertDescription></Alert>
          )}
        </div>

        {/* Decision dialog */}
        <Dialog open={decisionDialog} onOpenChange={setDecisionDialog}>
          <DialogContent className="bg-neutral-900 border-neutral-700 text-white max-w-md">
            <DialogHeader>
              <DialogTitle>Confirm: {pendingDecision.replace(/_/g, " ")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {(pendingDecision === "REJECTED" || pendingDecision === "RE_UPLOAD_REQUIRED") && (
                <div className="space-y-1.5">
                  <Label>Reason (required)</Label>
                  <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Explain the rejection or what document is needed…"
                    className="bg-neutral-800 border-neutral-700 text-white resize-none" rows={3} />
                </div>
              )}
              {pendingDecision === "APPROVED" && (
                <Alert className="border-emerald-700 bg-emerald-950/30">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <AlertDescription className="text-emerald-300 text-sm">
                    This will approve the merchant's KYC and enable their account.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setDecisionDialog(false)}>Cancel</Button>
              <Button
                className={pendingDecision === "APPROVED" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
                onClick={submitDecision}
                disabled={submitting || ((pendingDecision === "REJECTED" || pendingDecision === "RE_UPLOAD_REQUIRED") && !rejectionReason.trim())}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DashboardLayout>
    );
  }

  // ── List View ──────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-5 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-7 h-7 text-indigo-400" />Merchant Onboarding
            </h1>
            <p className="text-neutral-400 text-sm mt-1">Review KYC applications. Approved when PAN + Aadhaar + Bank verified.</p>
          </div>
          <Button variant="outline" className="border-neutral-700 text-neutral-300" onClick={() => loadList(1)} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>

        <div className="flex gap-3">
          <Select value={decisionFilter || "all"} onValueChange={(v) => setDecisionFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-52 bg-neutral-800 border-neutral-700 text-white">
              <SelectValue placeholder="All decisions" />
            </SelectTrigger>
            <SelectContent className="bg-neutral-800 border-neutral-700">
              <SelectItem value="all">All decisions</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="RE_UPLOAD_REQUIRED">Re-Upload Required</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="w-8 h-8 animate-spin text-indigo-400" /></div>
        ) : applications.length === 0 ? (
          <Card className="bg-neutral-900 border-neutral-800">
            <CardContent className="py-14 text-center">
              <FileText className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
              <p className="text-neutral-400">No onboarding applications found.</p>
              <p className="text-xs text-neutral-600 mt-1">Applications appear after merchants complete the secure onboarding flow.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-2.5">
              {applications.map((app) => (
                <Card key={app.merchantId} className="bg-neutral-900 border-neutral-800 hover:border-neutral-600 transition-colors cursor-pointer"
                  onClick={() => loadDetail(app.merchantId)}>
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-white">{app.fullName ?? "—"}</p>
                          <DecisionBadge d={app.adminDecision} />
                          {app.mandatoryChecksPassed
                            ? <span className="text-[10px] text-emerald-400 font-medium">✓ Eligible</span>
                            : <span className="text-[10px] text-red-400 font-medium">⚠ Incomplete</span>}
                        </div>
                        <p className="text-xs text-neutral-500 mt-0.5 truncate">{app.businessName ?? "—"} · {app.merchantEmail ?? `#${app.merchantId}`}</p>
                        {/* Info flags summary */}
                        {app.infoFlags.filter((f) => f.type === "error").length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5">
                            {app.infoFlags.filter((f) => f.type === "error").map((f, i) => (
                              <span key={i} className="text-[10px] border border-red-700 text-red-400 rounded px-1.5 py-0.5">{f.message}</span>
                            ))}
                          </div>
                        )}
                        {app.infoFlags.filter((f) => f.type === "info").length > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            {app.infoFlags.filter((f) => f.type === "info").map((f, i) => (
                              <span key={i} className="text-[10px] border border-neutral-700 text-neutral-500 rounded px-1.5 py-0.5">{f.message}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <div className="flex gap-1.5">
                          {[
                            { label: "PAN", status: app.panStatus },
                            { label: "Aadhaar", status: app.aadhaarStatus },
                            { label: "Bank", status: app.bankStatus },
                          ].map(({ label, status }) => (
                            <span key={label} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                              status === "VERIFIED" ? "bg-emerald-900 text-emerald-300" :
                              status === "PENDING"  ? "bg-amber-900 text-amber-300" :
                              status === "FAILED"   ? "bg-red-900 text-red-300" :
                                                     "bg-neutral-800 text-neutral-500"
                            }`}>{label}</span>
                          ))}
                        </div>
                        {app.kycUpdatedAt && (
                          <p className="text-[10px] text-neutral-600">{new Date(app.kycUpdatedAt).toLocaleDateString("en-IN")}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {total > LIMIT && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button variant="outline" size="sm" className="border-neutral-700" onClick={() => loadList(page - 1)} disabled={page <= 1}>← Prev</Button>
                <span className="text-sm text-neutral-400">Page {page} of {Math.ceil(total / LIMIT)}</span>
                <Button variant="outline" size="sm" className="border-neutral-700" onClick={() => loadList(page + 1)} disabled={page >= Math.ceil(total / LIMIT)}>Next →</Button>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
