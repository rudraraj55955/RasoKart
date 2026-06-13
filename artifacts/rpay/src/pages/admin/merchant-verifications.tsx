import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminListVerifications,
  useAdminGetVerification,
  useAdminUpdateVerificationStatus,
  useAdminGetVerificationStats,
  getAdminListVerificationsQueryKey,
  getAdminGetVerificationQueryKey,
  getAdminGetVerificationStatsQueryKey,
  AdminListVerificationsStatus,
  AdminUpdateVerificationStatusInputStatus,
  type AdminVerificationListItem,
  type MerchantVerification,
  type MerchantDocument,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, Loader2, ShieldCheck, ShieldAlert, ShieldOff, Clock,
  AlertTriangle, FileText, Eye, Building2, User, Banknote,
  CheckCircle2, XCircle, Info, RotateCcw, ChevronRight, ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getApiErrorMessage } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "under_review", label: "Under Review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "needs_info", label: "Needs Info" },
  { value: "suspended", label: "Suspended" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  pan: "PAN Card",
  gst: "GST Certificate",
  bank_statement: "Bank Statement",
  address_proof: "Address Proof",
  business_registration: "Business Registration",
  cancelled_cheque: "Cancelled Cheque",
  other: "Other",
};

const BUSINESS_TYPES: Record<string, string> = {
  sole_proprietorship: "Sole Proprietorship",
  partnership: "Partnership",
  private_limited: "Private Limited",
  llp: "LLP",
  other: "Other",
};

const VOLUME_LABELS: Record<string, string> = {
  "<1L": "< ₹1 Lakh/mo",
  "1L-10L": "₹1L – ₹10L/mo",
  "10L-1Cr": "₹10L – ₹1Cr/mo",
  ">1Cr": "> ₹1 Crore/mo",
};

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; className: string; icon: typeof ShieldCheck }> = {
    approved: { label: "Approved", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: ShieldCheck },
    rejected: { label: "Rejected", className: "bg-rose-500/15 text-rose-400 border-rose-500/30", icon: XCircle },
    under_review: { label: "Under Review", className: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: Clock },
    needs_info: { label: "Needs Info", className: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: AlertTriangle },
    suspended: { label: "Suspended", className: "bg-red-500/15 text-red-400 border-red-500/30", icon: ShieldOff },
    pending: { label: "Pending", className: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: Clock },
  };
  const cfg = configs[status] ?? { label: status, className: "bg-muted/20 text-muted-foreground", icon: Info };
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.className}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </Badge>
  );
}

function StatCard({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number;
  variant?: "default" | "pending" | "review" | "approved" | "rejected" | "info" | "suspended";
}) {
  const styles: Record<string, string> = {
    default: "text-foreground",
    pending: "text-amber-400",
    review: "text-blue-400",
    approved: "text-emerald-400",
    rejected: "text-rose-400",
    info: "text-orange-400",
    suspended: "text-red-400",
  };
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${styles[variant]}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function DetailField({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm text-muted-foreground/50">—</p>
    </div>
  );
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

// ── Detail Sheet ──────────────────────────────────────────────────────────────

function VerificationDetailSheet({
  merchantId,
  open,
  onClose,
}: {
  merchantId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [newStatus, setNewStatus] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [updating, setUpdating] = useState(false);

  const { data, isLoading } = useAdminGetVerification(merchantId ?? 0, {
    query: {
      enabled: !!merchantId && open,
      queryKey: getAdminGetVerificationQueryKey(merchantId ?? 0),
    },
  });

  const updateStatus = useAdminUpdateVerificationStatus();

  const verification = data?.verification as MerchantVerification | undefined;
  const documents = (data?.documents ?? []) as MerchantDocument[];

  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  // Reset form when a new merchant is opened
  const [prevMerchantId, setPrevMerchantId] = useState<number | null>(null);
  if (merchantId !== prevMerchantId) {
    setPrevMerchantId(merchantId);
    setNewStatus(verification?.status ?? "");
    setAdminNote(verification?.adminNote ?? "");
  }

  async function handleUpdateStatus() {
    if (!merchantId || !newStatus) return;
    setUpdating(true);
    try {
      await updateStatus.mutateAsync({
        merchantId,
        data: {
          status: newStatus as AdminUpdateVerificationStatusInputStatus,
          adminNote: adminNote || undefined,
        },
      });
      toast.success(`Status updated to ${newStatus}`);
      qc.invalidateQueries({ queryKey: getAdminListVerificationsQueryKey() });
      qc.invalidateQueries({ queryKey: getAdminGetVerificationStatsQueryKey() });
      qc.invalidateQueries({ queryKey: getAdminGetVerificationQueryKey(merchantId) });
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to update status"));
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <SheetTitle className="flex items-center justify-between">
            <span>Verification Application</span>
            {verification && <StatusBadge status={verification.status} />}
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !verification ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            No verification found for this merchant.
          </div>
        ) : (
          <div className="px-6 py-4 space-y-6">
            <Tabs defaultValue="details">
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="banking">Banking</TabsTrigger>
                <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
              </TabsList>

              {/* Details Tab */}
              <TabsContent value="details" className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5" />
                    Business Information
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <DetailField label="Business Name" value={verification.businessName} />
                    <DetailField label="Business Type" value={BUSINESS_TYPES[verification.businessType ?? ""] ?? verification.businessType} />
                    <DetailField label="Address" value={verification.address} />
                    <DetailField label="Website" value={verification.websiteUrl} />
                    <DetailField label="Monthly Volume" value={VOLUME_LABELS[verification.expectedMonthlyVolume ?? ""] ?? verification.expectedMonthlyVolume} />
                    <DetailField label="Use Case" value={verification.useCase} />
                  </div>
                </div>

                <Separator />

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <User className="w-3.5 h-3.5" />
                    Owner Details
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <DetailField label="Owner Name" value={verification.ownerName} />
                    <DetailField label="Mobile" value={verification.mobile} />
                    <DetailField label="Email" value={verification.email} />
                  </div>
                </div>

                <Separator />

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5" />
                    Tax Details
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <DetailField label="PAN Number" value={verification.pan} mono />
                    <DetailField label="GST Number" value={verification.gst} mono />
                  </div>
                </div>

                <Separator />

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Timeline
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <DetailField
                      label="Submitted"
                      value={verification.submittedAt ? format(new Date(verification.submittedAt), "dd MMM yyyy, hh:mm a") : undefined}
                    />
                    <DetailField
                      label="Last Reviewed"
                      value={verification.reviewedAt ? format(new Date(verification.reviewedAt), "dd MMM yyyy, hh:mm a") : undefined}
                    />
                  </div>
                  {verification.adminNote && (
                    <div className="mt-3">
                      <p className="text-xs text-muted-foreground mb-0.5">Admin Note</p>
                      <p className="text-sm bg-muted/20 rounded p-2 border border-border/40">{verification.adminNote}</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Banking Tab */}
              <TabsContent value="banking" className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Banknote className="w-3.5 h-3.5" />
                    Bank Account
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <DetailField label="Account Holder" value={verification.bankAccountName} />
                    <DetailField label="Account Number" value={verification.bankAccountNumber} mono />
                    <DetailField label="IFSC Code" value={verification.ifscCode} mono />
                    <DetailField label="UPI ID" value={verification.upiId} />
                  </div>
                </div>
              </TabsContent>

              {/* Documents Tab */}
              <TabsContent value="documents" className="mt-4 space-y-3">
                {documents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No documents uploaded</p>
                  </div>
                ) : (
                  documents.map(doc => {
                    const fileUrl = doc.fileUrl.startsWith("/") ? `${base}/api/storage${doc.fileUrl}` : doc.fileUrl;
                    return (
                      <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/50">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</p>
                          {doc.fileName && <p className="text-xs text-muted-foreground truncate">{doc.fileName}</p>}
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(doc.createdAt), "dd MMM yyyy")}
                          </p>
                        </div>
                        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs">
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </Button>
                        </a>
                      </div>
                    );
                  })
                )}
              </TabsContent>
            </Tabs>

            {/* Status Update Form */}
            <Separator />
            <div className="space-y-3">
              <p className="text-sm font-semibold">Update Status</p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>New Status</Label>
                  <Select
                    value={newStatus}
                    onValueChange={setNewStatus}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status…" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.filter(s => s.value !== "all").map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Admin Note
                    {(newStatus === "rejected" || newStatus === "needs_info") && (
                      <span className="text-rose-400 ml-1">*</span>
                    )}
                  </Label>
                  <Textarea
                    placeholder={
                      newStatus === "rejected"
                        ? "Reason for rejection (required)…"
                        : newStatus === "needs_info"
                        ? "Specify what information is needed…"
                        : "Optional note for the merchant…"
                    }
                    value={adminNote}
                    onChange={e => setAdminNote(e.target.value)}
                    rows={3}
                  />
                </div>
                {newStatus === "approved" && (
                  <Alert className="border-emerald-500/30 bg-emerald-950/20 py-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <AlertDescription className="text-emerald-300 text-xs">
                      Approving will give the merchant full access to API, payouts, and all services.
                    </AlertDescription>
                  </Alert>
                )}
                {newStatus === "suspended" && (
                  <Alert className="border-red-500/30 bg-red-950/20 py-2">
                    <ShieldOff className="w-4 h-4 text-red-400" />
                    <AlertDescription className="text-red-300 text-xs">
                      Suspending will block all payment and payout operations for this merchant.
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  className="w-full gap-2"
                  onClick={handleUpdateStatus}
                  disabled={!newStatus || updating}
                >
                  {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Update Status
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminMerchantVerifications() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedMerchantId, setSelectedMerchantId] = useState<number | null>(null);

  const limit = 20;

  const statusParam = status !== "all" ? (status as AdminListVerificationsStatus) : undefined;

  const { data, isLoading } = useAdminListVerifications(
    {
      status: statusParam,
      search: search || undefined,
      page,
      limit,
    },
    {
      query: {
        queryKey: getAdminListVerificationsQueryKey({ status: statusParam, search, page, limit }),
      },
    }
  );

  const { data: statsData } = useAdminGetVerificationStats({
    query: { queryKey: getAdminGetVerificationStatsQueryKey(), refetchInterval: 60_000 },
  });

  const rows = (data?.data ?? []) as AdminVerificationListItem[];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const stats = statsData?.stats;

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
  }

  function handleStatusChange(v: string) {
    setStatus(v);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Merchant Verifications</h1>
        <p className="text-muted-foreground mt-1">Review and approve merchant KYC applications.</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Pending" value={stats.pending} variant="pending" />
          <StatCard label="Under Review" value={stats.under_review} variant="review" />
          <StatCard label="Approved" value={stats.approved} variant="approved" />
          <StatCard label="Rejected" value={stats.rejected} variant="rejected" />
          <StatCard label="Needs Info" value={stats.needs_info} variant="info" />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by business name or email…"
            className="pl-9"
            value={search}
            onChange={handleSearch}
          />
        </div>
        <Select value={status} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(s => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">No verifications found</p>
              {(search || status !== "all") && (
                <p className="text-xs mt-1">Try adjusting your search or filter</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50">
                  <TableHead>Merchant</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Business Type</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow
                    key={row.id}
                    className="border-border/50 cursor-pointer hover:bg-muted/10"
                    onClick={() => setSelectedMerchantId(row.merchantId)}
                  >
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{row.merchant.businessName}</p>
                        <p className="text-xs text-muted-foreground">{row.merchant.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{row.ownerName ?? "—"}</p>
                        {row.pan && (
                          <p className="text-xs text-muted-foreground font-mono">{row.pan}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {BUSINESS_TYPES[row.businessType ?? ""] ?? row.businessType ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {row.submittedAt
                          ? format(new Date(row.submittedAt), "dd MMM yyyy")
                          : row.createdAt
                          ? format(new Date(row.createdAt), "dd MMM yyyy")
                          : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="gap-1"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      <VerificationDetailSheet
        merchantId={selectedMerchantId}
        open={selectedMerchantId !== null}
        onClose={() => setSelectedMerchantId(null)}
      />
    </div>
  );
}
