import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";
import {
  Loader2, ShieldCheck, Search, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, ChevronLeft, FileText, User,
  Building2, CreditCard, Eye
} from "lucide-react";

interface Application {
  merchantId: number;
  fullName?: string | null;
  businessName?: string | null;
  panStatus?: string | null;
  gstStatus?: string | null;
  bankStatus?: string | null;
  riskScore?: number | null;
  mismatchFlags?: string[];
  adminDecision: string;
  rejectionReason?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  kycUpdatedAt?: string | null;
  sessionStatus?: string | null;
  verificationId?: string | null;
  mobileMasked?: string | null;
  merchantEmail?: string | null;
}

interface KycDetail {
  id: number;
  merchantId: number;
  fullName?: string | null;
  dob?: string | null;
  gender?: string | null;
  email?: string | null;
  panMasked?: string | null;
  aadhaarLast4?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateName?: string | null;
  pincode?: string | null;
  businessName?: string | null;
  gstinMasked?: string | null;
  cinNumber?: string | null;
  bankAccountMasked?: string | null;
  bankIfsc?: string | null;
  bankName?: string | null;
  panStatus?: string | null;
  gstStatus?: string | null;
  cinStatus?: string | null;
  bankStatus?: string | null;
  riskScore?: number | null;
  mismatchFlags?: string[];
  adminDecision: string;
  rejectionReason?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
}

interface Log {
  id: number;
  verificationType: string;
  status: string;
  requestId?: string | null;
  createdAt: string;
  rawResponse?: any;
  error?: string | null;
}

function DecisionBadge({ decision }: { decision: string }) {
  const map: Record<string, string> = {
    PENDING: "bg-amber-600",
    APPROVED: "bg-emerald-600",
    REJECTED: "bg-red-600",
    RE_UPLOAD_REQUIRED: "bg-blue-600",
  };
  const labels: Record<string, string> = {
    PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", RE_UPLOAD_REQUIRED: "Re-Upload Required",
  };
  return <Badge className={`${map[decision] ?? "bg-neutral-600"} text-white text-xs`}>{labels[decision] ?? decision}</Badge>;
}

function VerifyBadge({ status }: { status?: string | null }) {
  if (!status || status === "PENDING") return <Badge variant="secondary" className="text-xs">Pending</Badge>;
  if (status === "VERIFIED") return <Badge className="bg-emerald-600 text-white text-xs">Verified</Badge>;
  if (status === "MISMATCH") return <Badge className="bg-amber-600 text-white text-xs">Mismatch</Badge>;
  if (status === "SKIPPED") return <Badge variant="outline" className="text-xs">Skipped</Badge>;
  return <Badge className="bg-red-600 text-white text-xs">Failed</Badge>;
}

function RiskBadge({ score }: { score?: number | null }) {
  if (!score || score === 0) return <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-700">Low Risk</Badge>;
  if (score < 60) return <Badge className="bg-amber-600 text-white text-xs">Med Risk ({score})</Badge>;
  return <Badge className="bg-red-600 text-white text-xs">High Risk ({score})</Badge>;
}

export default function AdminMerchantOnboarding() {
  const { data: meData } = useGetMe();
  const isSuperAdmin = !!(meData as any)?.isSuperAdmin;

  const [applications, setApplications] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState("");
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [kycDetail, setKycDetail] = useState<KycDetail | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const [decisionDialog, setDecisionDialog] = useState(false);
  const [pendingDecision, setPendingDecision] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const token = () => localStorage.getItem("rasokart_token");
  const LIMIT = 25;

  async function loadList(pg = 1) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(pg), limit: String(LIMIT) });
      if (decision) params.set("decision", decision);
      const r = await fetch(`/api/admin/onboarding?${params}`, { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      setApplications(d.applications ?? []);
      setTotal(d.total ?? 0);
      setPage(pg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadList(); }, [decision]);

  async function loadDetail(merchantId: number) {
    setSelectedId(merchantId);
    setDetailLoading(true);
    setShowLogs(false);
    try {
      const [detailResp, logsResp] = await Promise.all([
        fetch(`/api/admin/onboarding/${merchantId}`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`/api/admin/onboarding/${merchantId}/logs`, { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const [detail, logsData] = await Promise.all([detailResp.json(), logsResp.json()]);
      setKycDetail(detail.kyc ?? null);
      setLogs(logsData.logs ?? []);
    } finally {
      setDetailLoading(false);
    }
  }

  function openDecisionDialog(d: string) {
    setPendingDecision(d);
    setRejectionReason("");
    setDecisionDialog(true);
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
      toast.success(`Decision submitted: ${pendingDecision}`);
      setDecisionDialog(false);
      setKycDetail((prev) => prev ? { ...prev, adminDecision: pendingDecision, rejectionReason } : prev);
      loadList(page);
    } finally {
      setSubmitting(false);
    }
  }

  // Render detail panel
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
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-xl font-bold text-white">{kycDetail.fullName ?? "Unknown Merchant"}</h2>
                  <p className="text-sm text-neutral-400">{kycDetail.businessName ?? "—"} · Merchant #{kycDetail.merchantId}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <DecisionBadge decision={kycDetail.adminDecision} />
                  <RiskBadge score={kycDetail.riskScore} />
                </div>
              </div>

              {kycDetail.mismatchFlags && kycDetail.mismatchFlags.length > 0 && (
                <Alert className="border-amber-700 bg-amber-950/30">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <AlertDescription className="text-amber-300 text-sm">
                    Mismatch flags: {kycDetail.mismatchFlags.map((f) => f.replace(/_/g, " ")).join(", ")}
                  </AlertDescription>
                </Alert>
              )}

              {/* Identity */}
              <Card className="bg-neutral-900 border-neutral-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-neutral-300 flex items-center gap-2"><User className="w-4 h-4" />Identity</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  {kycDetail.fullName && <div><p className="text-xs text-neutral-500">Full Name</p><p className="text-white">{kycDetail.fullName}</p></div>}
                  {kycDetail.dob && <div><p className="text-xs text-neutral-500">DOB</p><p className="text-white">{kycDetail.dob}</p></div>}
                  {kycDetail.gender && <div><p className="text-xs text-neutral-500">Gender</p><p className="text-white">{kycDetail.gender}</p></div>}
                  {kycDetail.email && <div><p className="text-xs text-neutral-500">Email</p><p className="text-white">{kycDetail.email}</p></div>}
                  {kycDetail.panMasked && <div><p className="text-xs text-neutral-500">PAN</p><p className="text-white font-mono">{kycDetail.panMasked}</p></div>}
                  {kycDetail.aadhaarLast4 && <div><p className="text-xs text-neutral-500">Aadhaar</p><p className="text-white font-mono">****{kycDetail.aadhaarLast4}</p></div>}
                </CardContent>
              </Card>

              {/* Business */}
              <Card className="bg-neutral-900 border-neutral-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-neutral-300 flex items-center gap-2"><Building2 className="w-4 h-4" />Business</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  {kycDetail.businessName && <div><p className="text-xs text-neutral-500">Business Name</p><p className="text-white">{kycDetail.businessName}</p></div>}
                  {kycDetail.gstinMasked && <div><p className="text-xs text-neutral-500">GSTIN</p><p className="text-white font-mono">{kycDetail.gstinMasked}</p></div>}
                  {kycDetail.cinNumber && <div><p className="text-xs text-neutral-500">CIN</p><p className="text-white font-mono">{kycDetail.cinNumber}</p></div>}
                  {kycDetail.addressLine1 && <div className="col-span-2"><p className="text-xs text-neutral-500">Address</p><p className="text-white">{[kycDetail.addressLine1, kycDetail.addressLine2, kycDetail.city, kycDetail.stateName, kycDetail.pincode].filter(Boolean).join(", ")}</p></div>}
                </CardContent>
              </Card>

              {/* Bank & Verification */}
              <Card className="bg-neutral-900 border-neutral-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-neutral-300 flex items-center gap-2"><CreditCard className="w-4 h-4" />Bank & Verification</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    {kycDetail.bankAccountMasked && <div><p className="text-xs text-neutral-500">Account</p><p className="text-white font-mono">{kycDetail.bankAccountMasked}</p></div>}
                    {kycDetail.bankIfsc && <div><p className="text-xs text-neutral-500">IFSC</p><p className="text-white font-mono">{kycDetail.bankIfsc}</p></div>}
                    {kycDetail.bankName && <div><p className="text-xs text-neutral-500">Bank</p><p className="text-white">{kycDetail.bankName}</p></div>}
                  </div>
                  <Separator className="bg-neutral-800" />
                  <div className="flex gap-4 flex-wrap text-sm">
                    <div className="flex items-center gap-2"><span className="text-neutral-500">PAN</span><VerifyBadge status={kycDetail.panStatus} /></div>
                    <div className="flex items-center gap-2"><span className="text-neutral-500">GST</span><VerifyBadge status={kycDetail.gstStatus} /></div>
                    <div className="flex items-center gap-2"><span className="text-neutral-500">CIN</span><VerifyBadge status={kycDetail.cinStatus} /></div>
                    <div className="flex items-center gap-2"><span className="text-neutral-500">Bank</span><VerifyBadge status={kycDetail.bankStatus} /></div>
                  </div>
                </CardContent>
              </Card>

              {/* Decision */}
              {kycDetail.adminDecision === "PENDING" && (
                <Card className="bg-neutral-900 border-neutral-800">
                  <CardHeader><CardTitle className="text-white text-sm">Admin Decision</CardTitle></CardHeader>
                  <CardContent className="flex gap-3 flex-wrap">
                    <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => openDecisionDialog("APPROVED")}>
                      <CheckCircle2 className="w-4 h-4 mr-2" />Approve
                    </Button>
                    <Button variant="outline" className="border-blue-600 text-blue-400 hover:bg-blue-950/30" onClick={() => openDecisionDialog("RE_UPLOAD_REQUIRED")}>
                      <RefreshCw className="w-4 h-4 mr-2" />Request Re-Upload
                    </Button>
                    <Button variant="destructive" onClick={() => openDecisionDialog("REJECTED")}>
                      <XCircle className="w-4 h-4 mr-2" />Reject
                    </Button>
                  </CardContent>
                </Card>
              )}

              {kycDetail.adminDecision !== "PENDING" && (
                <Alert className={kycDetail.adminDecision === "APPROVED" ? "border-emerald-700 bg-emerald-950/30" : "border-neutral-700"}>
                  <AlertDescription className="text-sm">
                    <strong className="text-white">Decision: <DecisionBadge decision={kycDetail.adminDecision} /></strong>
                    {kycDetail.approvedBy && <span className="text-neutral-400"> by {kycDetail.approvedBy}</span>}
                    {kycDetail.rejectionReason && <p className="mt-1 text-neutral-400">Reason: {kycDetail.rejectionReason}</p>}
                  </AlertDescription>
                </Alert>
              )}

              {/* Logs toggle */}
              <div className="pt-2">
                <Button variant="ghost" className="text-neutral-400 hover:text-white text-sm" onClick={() => setShowLogs((v) => !v)}>
                  <Eye className="w-4 h-4 mr-2" />{showLogs ? "Hide" : "Show"} Verification Logs ({logs.length})
                </Button>
                {showLogs && logs.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {logs.map((log) => (
                      <div key={log.id} className="rounded-lg bg-neutral-800 border border-neutral-700 p-3 text-xs font-mono">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-neutral-300">{log.verificationType}</span>
                          <VerifyBadge status={log.status} />
                        </div>
                        {log.requestId && <p className="text-neutral-500">req: {log.requestId}</p>}
                        <p className="text-neutral-500">{new Date(log.createdAt).toLocaleString("en-IN")}</p>
                        {log.error && <p className="text-red-400 mt-1">{log.error}</p>}
                        {isSuperAdmin && log.rawResponse && (
                          <pre className="mt-2 text-neutral-400 overflow-x-auto text-[10px] max-h-28">{JSON.stringify(log.rawResponse, null, 2)}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {showLogs && logs.length === 0 && <p className="text-sm text-neutral-500 mt-2">No verification logs found.</p>}
              </div>
            </>
          ) : (
            <Alert><AlertDescription>KYC data not found for this merchant.</AlertDescription></Alert>
          )}
        </div>

        {/* Decision dialog */}
        <Dialog open={decisionDialog} onOpenChange={setDecisionDialog}>
          <DialogContent className="bg-neutral-900 border-neutral-700 text-white max-w-md">
            <DialogHeader>
              <DialogTitle>Confirm Decision: {pendingDecision.replace(/_/g, " ")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {(pendingDecision === "REJECTED" || pendingDecision === "RE_UPLOAD_REQUIRED") && (
                <div className="space-y-1.5">
                  <Label>Reason (required)</Label>
                  <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Explain why the application is being rejected or needs re-upload…"
                    className="bg-neutral-800 border-neutral-700 text-white resize-none" rows={3} />
                </div>
              )}
              {pendingDecision === "APPROVED" && (
                <Alert className="border-emerald-700 bg-emerald-950/30">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <AlertDescription className="text-emerald-300 text-sm">This will approve the merchant's KYC application.</AlertDescription>
                </Alert>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setDecisionDialog(false)}>Cancel</Button>
              <Button
                className={pendingDecision === "APPROVED" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
                onClick={submitDecision} disabled={submitting || ((pendingDecision === "REJECTED" || pendingDecision === "RE_UPLOAD_REQUIRED") && !rejectionReason.trim())}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-5 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-7 h-7 text-indigo-400" />
              Merchant Onboarding
            </h1>
            <p className="text-neutral-400 text-sm mt-1">Review and approve merchant KYC applications from secure onboarding.</p>
          </div>
          <Button variant="outline" className="border-neutral-700 text-neutral-300" onClick={() => loadList(1)} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex gap-3 flex-wrap">
          <Select value={decision || "all"} onValueChange={(v) => setDecision(v === "all" ? "" : v)}>
            <SelectTrigger className="w-48 bg-neutral-800 border-neutral-700 text-white">
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
            <CardContent className="py-12 text-center">
              <FileText className="w-10 h-10 text-neutral-600 mx-auto mb-3" />
              <p className="text-neutral-400">No onboarding applications found.</p>
              <p className="text-xs text-neutral-500 mt-1">Applications appear here once merchants complete the secure onboarding flow.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              {applications.map((app) => (
                <Card key={app.merchantId} className="bg-neutral-900 border-neutral-800 hover:border-neutral-600 transition-colors cursor-pointer" onClick={() => loadDetail(app.merchantId)}>
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-white">{app.fullName ?? "—"}</p>
                          <DecisionBadge decision={app.adminDecision} />
                          {app.riskScore != null && app.riskScore > 0 && <RiskBadge score={app.riskScore} />}
                        </div>
                        <p className="text-xs text-neutral-500 mt-0.5">{app.businessName ?? "—"} · {app.merchantEmail ?? `#${app.merchantId}`}</p>
                        {app.mobileMasked && <p className="text-xs text-neutral-500">Mobile: {app.mobileMasked}</p>}
                        {app.mismatchFlags && app.mismatchFlags.length > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            <AlertTriangle className="w-3 h-3 text-amber-400" />
                            <span className="text-xs text-amber-400">{app.mismatchFlags.length} mismatch flag{app.mismatchFlags.length > 1 ? "s" : ""}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 text-right">
                        <div className="flex gap-2">
                          <VerifyBadge status={app.panStatus} />
                          <VerifyBadge status={app.bankStatus} />
                        </div>
                        {app.kycUpdatedAt && <p className="text-xs text-neutral-500">{new Date(app.kycUpdatedAt).toLocaleDateString("en-IN")}</p>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {total > LIMIT && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button variant="outline" className="border-neutral-700" size="sm" onClick={() => loadList(page - 1)} disabled={page <= 1}>← Prev</Button>
                <span className="text-sm text-neutral-400">Page {page} of {Math.ceil(total / LIMIT)}</span>
                <Button variant="outline" className="border-neutral-700" size="sm" onClick={() => loadList(page + 1)} disabled={page >= Math.ceil(total / LIMIT)}>Next →</Button>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
