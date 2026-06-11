import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useListTransactions, useSearchByUtr, useGetTransaction, useAdminCreateTransaction, useAdminUpdateTransaction, useListPaymentLinks, useListMerchants, useGetPaymentLink, useListSavedFilters, useCreateSavedFilter, useDeleteSavedFilter } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ExportCsvButton, downloadCsvFromUrl } from "@/components/ui/export-csv-button";
import { useMonitoringRefresh } from "@/hooks/use-monitoring-refresh";
import { Search, X, ArrowDownLeft, ArrowUpRight, CheckCircle, XCircle, Hash, RefreshCw, Loader2, Building2, CreditCard, FileText, Info, Plus, Link2, Zap, Pencil, AlertTriangle, Sparkles, Bookmark, BookmarkCheck, Trash2, TrendingUp, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, startOfDay, endOfDay } from "date-fns";
import { toast } from "sonner";

interface SmartFilter {
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
  txType?: "deposit" | "withdrawal";
  txStatus?: "pending" | "success" | "failed";
}

const TYPE_KEYWORDS: Record<string, "deposit" | "withdrawal"> = {
  deposit: "deposit",
  deposits: "deposit",
  withdrawal: "withdrawal",
  withdrawals: "withdrawal",
};

const STATUS_KEYWORDS: Record<string, "pending" | "success" | "failed"> = {
  pending: "pending",
  success: "success",
  successful: "success",
  failed: "failed",
  failure: "failed",
};

function parseDateToken(token: string, now: Date): Pick<SmartFilter, "dateFrom" | "dateTo"> | null {
  if (token === "today") {
    return { dateFrom: format(startOfDay(now), "yyyy-MM-dd"), dateTo: format(endOfDay(now), "yyyy-MM-dd") };
  }
  if (token === "this week") {
    return {
      dateFrom: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      dateTo: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  if (token === "this month") {
    return { dateFrom: format(startOfMonth(now), "yyyy-MM-dd"), dateTo: format(endOfMonth(now), "yyyy-MM-dd") };
  }
  if (token === "last month") {
    const prev = subMonths(now, 1);
    return { dateFrom: format(startOfMonth(prev), "yyyy-MM-dd"), dateTo: format(endOfMonth(prev), "yyyy-MM-dd") };
  }
  if (token === "last week") {
    const prevWeekStart = startOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    const prevWeekEnd = endOfWeek(subDays(now, 7), { weekStartsOn: 1 });
    return { dateFrom: format(prevWeekStart, "yyyy-MM-dd"), dateTo: format(prevWeekEnd, "yyyy-MM-dd") };
  }
  return null;
}

function parseAmountToken(token: string): Pick<SmartFilter, "amountMin" | "amountMax"> | null {
  const gtMatch = token.match(/^(>=?)(\d+(?:\.\d+)?)$/);
  if (gtMatch) {
    const inclusive = gtMatch[1] === ">=";
    const val = parseFloat(gtMatch[2]!);
    return { amountMin: inclusive ? val : val + 0.01 };
  }
  const ltMatch = token.match(/^(<=?)(\d+(?:\.\d+)?)$/);
  if (ltMatch) {
    const inclusive = ltMatch[1] === "<=";
    const val = parseFloat(ltMatch[2]!);
    return { amountMax: inclusive ? val : val - 0.01 };
  }
  const rangeMatch = token.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]!);
    const max = parseFloat(rangeMatch[2]!);
    if (min <= max) return { amountMin: min, amountMax: max };
  }
  return null;
}

function parseSmartQuery(raw: string): SmartFilter | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;

  const filter: SmartFilter = {};
  const now = new Date();

  for (const phrase of ["this week", "this month", "last month", "last week"]) {
    if (q.includes(phrase)) {
      const dateResult = parseDateToken(phrase, now);
      if (dateResult) { Object.assign(filter, dateResult); break; }
    }
  }

  let remaining = q;
  if (filter.dateFrom) {
    for (const phrase of ["this week", "this month", "last month", "last week"]) {
      remaining = remaining.replace(phrase, "").trim();
    }
  }

  const tokens = remaining.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    if (token in TYPE_KEYWORDS) { filter.txType = TYPE_KEYWORDS[token]!; continue; }
    if (token in STATUS_KEYWORDS) { filter.txStatus = STATUS_KEYWORDS[token]!; continue; }
    if (!filter.dateFrom) {
      const dateResult = parseDateToken(token, now);
      if (dateResult) { Object.assign(filter, dateResult); continue; }
    }
    if (filter.amountMin == null && filter.amountMax == null) {
      const amtResult = parseAmountToken(token);
      if (amtResult) { Object.assign(filter, amtResult); continue; }
    }
  }

  const hasContent =
    filter.txType != null || filter.txStatus != null ||
    filter.dateFrom != null || filter.amountMin != null || filter.amountMax != null;

  return hasContent ? filter : null;
}

interface SmartFilterShape {
  amountMin?: number;
  amountMax?: number;
  dateFrom?: string;
  dateTo?: string;
  txType?: "deposit" | "withdrawal";
  txStatus?: "pending" | "success" | "failed";
}

interface SavedFilterItem {
  id: number;
  name: string;
  rawInput: string;
  filterData: SmartFilterShape;
  createdAt: string;
}

function TransactionDetailPanel({ id, open, onClose }: { id: number | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: tx, isLoading } = useGetTransaction(id ?? 0, {
    query: { enabled: open && id != null } as any,
  });

  const [isEditMode, setIsEditMode] = useState(false);
  const [editLinkId, setEditLinkId] = useState<string>("");
  const [linkSearch, setLinkSearch] = useState("");

  const { mutateAsync: updateTx, isPending: isSaving } = useAdminUpdateTransaction();

  const { data: linksData } = useListPaymentLinks(
    { merchantId: tx?.merchantId ?? 0, limit: 200 },
    { query: { enabled: isEditMode && tx != null } as any }
  );

  const filteredLinks = (linksData?.data ?? []).filter(l => {
    if (!linkSearch) return true;
    const q = linkSearch.toLowerCase();
    return l.title.toLowerCase().includes(q) || l.slug.toLowerCase().includes(q);
  });

  const selectedEditLink = editLinkId
    ? (linksData?.data ?? []).find(l => String(l.id) === editLinkId) ?? null
    : null;

  const enterEditMode = () => {
    setEditLinkId((tx as any)?.paymentLinkId != null ? String((tx as any).paymentLinkId) : "");
    setLinkSearch("");
    setIsEditMode(true);
  };

  const cancelEdit = () => {
    setIsEditMode(false);
    setEditLinkId("");
    setLinkSearch("");
  };

  const handleSave = async () => {
    if (!tx) return;
    try {
      await updateTx({
        id: tx.id,
        data: { paymentLinkId: editLinkId ? parseInt(editLinkId) : null },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/api/transactions"] }),
        qc.invalidateQueries({ queryKey: [`/api/transactions/${tx.id}`] }),
        qc.invalidateQueries({ queryKey: ["/api/payment-links"] }),
      ]);
      toast.success("Payment link attribution updated");
      cancelEdit();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update attribution");
    }
  };

  const handleClose = () => {
    cancelEdit();
    onClose();
  };

  const paymentLinkId = (tx as any)?.paymentLinkId as number | null | undefined;
  const { data: paymentLink, isLoading: linkLoading } = useGetPaymentLink(paymentLinkId ?? 0, {
    query: { enabled: open && !isEditMode && paymentLinkId != null } as any,
  });


  const metadataParsed = (() => {
    if (!tx?.metadata) return null;
    try { return JSON.parse(tx.metadata); } catch { return tx.metadata; }
  })();

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="mb-6">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2 text-base">
              <CreditCard className="w-4 h-4 text-primary" />
              Transaction Details
            </SheetTitle>
            {!isLoading && tx && !isEditMode && (
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={enterEditMode}>
                <Pencil className="w-3.5 h-3.5" />
                Edit Attribution
              </Button>
            )}
          </div>
        </SheetHeader>

        {isLoading || !tx ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading transaction…</span>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Status & Amount Hero */}
            <div className="rounded-xl border bg-card/60 p-5 flex items-center gap-5">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${tx.type === "deposit" ? "bg-primary/10" : "bg-violet-500/10"}`}>
                {tx.type === "deposit"
                  ? <ArrowDownLeft className="w-5 h-5 text-primary" />
                  : <ArrowUpRight className="w-5 h-5 text-violet-500" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-2xl font-bold font-mono">₹{Number(tx.amount).toLocaleString()}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant="outline" className="text-xs capitalize">{tx.type}</Badge>
                  <StatusBadge status={tx.status} />
                  <span className="text-xs text-muted-foreground font-mono">{tx.currency}</span>
                </div>
              </div>
            </div>

            {/* Transaction Fields */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Transaction Info
              </p>
              <div className="space-y-0 rounded-lg border divide-y divide-border bg-card/40">
                <DetailRow label="ID" value={`#${tx.id}`} mono />
                <DetailRow label="UTR" value={tx.utr} mono />
                {tx.referenceId && <DetailRow label="Reference ID" value={tx.referenceId} mono />}
                {tx.description && <DetailRow label="Description" value={tx.description} />}

                {/* Payment Link row — read or edit */}
                {!isEditMode ? (
                  paymentLinkId != null ? (
                    linkLoading ? (
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground shrink-0">Payment Link</span>
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground font-mono">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> #{paymentLinkId}
                        </span>
                      </div>
                    ) : paymentLink ? (
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground shrink-0">Payment Link</span>
                        <div className="text-right min-w-0">
                          <p className="text-sm font-medium truncate">{paymentLink.title}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{paymentLink.slug} · #{paymentLinkId}</p>
                        </div>
                      </div>
                    ) : (
                      <DetailRow label="Payment Link" value={`#${paymentLinkId}`} mono />
                    )
                  ) : null
                ) : (
                  <div className="px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <Link2 className="w-3.5 h-3.5" /> Payment Link
                      </span>
                      <span className="text-xs text-muted-foreground">(optional)</span>
                    </div>

                    {selectedEditLink ? (
                      <div className="flex items-center gap-2 p-2.5 rounded-lg border bg-primary/5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{selectedEditLink.title}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">
                            {selectedEditLink.slug}
                            {selectedEditLink.amount ? ` · ₹${Number(selectedEditLink.amount).toLocaleString()}` : ""}
                            {selectedEditLink.maxPayments != null
                              ? ` · ${selectedEditLink.paymentCount}/${selectedEditLink.maxPayments} payments`
                              : ` · ${selectedEditLink.paymentCount} payments`}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs shrink-0"
                          onClick={() => { setEditLinkId(""); setLinkSearch(""); }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                          <Input
                            className="pl-8 text-sm"
                            placeholder="Search payment links…"
                            value={linkSearch}
                            onChange={e => setLinkSearch(e.target.value)}
                          />
                        </div>
                        {(linksData?.data?.length ?? 0) === 0 && !linkSearch && (
                          <p className="text-xs text-muted-foreground px-1">No payment links found for this merchant</p>
                        )}
                        {filteredLinks.length > 0 && (
                          <div className="max-h-40 overflow-y-auto rounded-lg border divide-y divide-border bg-card/50">
                            {filteredLinks.map(link => (
                              <button
                                key={link.id}
                                type="button"
                                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                                onClick={() => { setEditLinkId(String(link.id)); setLinkSearch(""); }}
                              >
                                <p className="text-sm font-medium">{link.title}</p>
                                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                  {link.slug}
                                  {link.amount ? ` · ₹${Number(link.amount).toLocaleString()}` : ""}
                                  {link.maxPayments != null
                                    ? ` · ${link.paymentCount}/${link.maxPayments} payments`
                                    : ` · ${link.paymentCount} payments`}
                                </p>
                              </button>
                            ))}
                          </div>
                        )}
                        {linkSearch && filteredLinks.length === 0 && (
                          <p className="text-xs text-muted-foreground px-1">No matching payment links</p>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Saving…</> : "Save"}
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={cancelEdit} disabled={isSaving}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Link Details */}
            {paymentLinkId != null && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5" /> Payment Link
                </p>
                <div className="space-y-0 rounded-lg border divide-y divide-border bg-card/40">
                  {linkLoading ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading link details…
                    </div>
                  ) : paymentLink ? (
                    <>
                      <DetailRow label="Title" value={paymentLink.title} />
                      <DetailRow label="Slug" value={paymentLink.slug} mono />
                      <DetailRow
                        label="Amount"
                        value={paymentLink.amount != null ? `₹${Number(paymentLink.amount).toLocaleString()}` : "Any"}
                      />
                      <DetailRow
                        label="Payments"
                        value={
                          paymentLink.maxPayments != null
                            ? `${paymentLink.paymentCount} / ${paymentLink.maxPayments}`
                            : `${paymentLink.paymentCount} (no limit)`
                        }
                      />
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground shrink-0">Status</span>
                        <Badge
                          variant="outline"
                          className={`text-xs capitalize ${paymentLink.status === "active" ? "border-green-500/40 text-green-400" : paymentLink.status === "expired" ? "border-orange-500/40 text-orange-400" : "border-zinc-500/40 text-zinc-400"}`}
                        >
                          {paymentLink.status}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <span className="text-sm text-muted-foreground shrink-0">Admin page</span>
                        <a
                          href={`/admin/payment-links`}
                          className="text-sm text-primary hover:underline font-mono flex items-center gap-1"
                          onClick={(e) => { e.preventDefault(); window.location.href = "/admin/payment-links"; }}
                        >
                          <Link2 className="w-3 h-3" /> View all links
                        </a>
                      </div>
                    </>
                  ) : (
                    <DetailRow label="Payment Link" value={`#${paymentLinkId}`} mono />
                  )}
                </div>
              </div>
            )}

            {/* Merchant Info */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> Merchant
              </p>
              <div className="space-y-0 rounded-lg border divide-y divide-border bg-card/40">
                <DetailRow label="Business Name" value={tx.merchantName ?? "—"} />
                <DetailRow label="Merchant ID" value={`#${tx.merchantId}`} mono />
              </div>
            </div>

            {/* Provider Connection — only shown when a provider is linked */}
            {tx.connectionProvider != null && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5" /> Provider Connection
                </p>
                <div className="space-y-0 rounded-lg border divide-y divide-border bg-card/40">
                  <div className="flex items-start justify-between gap-4 px-4 py-3">
                    <span className="text-sm text-muted-foreground shrink-0">Provider</span>
                    <ProviderBadge provider={tx.connectionProvider} />
                  </div>
                  {(tx as any).connectionId != null && (
                    <DetailRow label="Connection ID" value={`#${(tx as any).connectionId}`} mono />
                  )}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" /> Timestamps
              </p>
              <div className="space-y-0 rounded-lg border divide-y divide-border bg-card/40">
                <DetailRow label="Created" value={format(new Date(tx.createdAt), "MMM d, yyyy HH:mm:ss")} />
                {tx.updatedAt && <DetailRow label="Updated" value={format(new Date(tx.updatedAt), "MMM d, yyyy HH:mm:ss")} />}
              </div>
            </div>

            {/* Metadata */}
            {metadataParsed != null && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Metadata</p>
                <pre className="text-xs rounded-lg border bg-muted/30 p-4 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                  {typeof metadataParsed === "string"
                    ? metadataParsed
                    : JSON.stringify(metadataParsed, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  phonepe: "PhonePe",
  paytm: "Paytm",
  bharatpe: "BharatPe",
  yono_sbi: "YONO SBI",
  hdfc_smarthub: "HDFC SmartHub",
  upi_id: "UPI",
};

function formatProvider(p: string | null | undefined): string {
  if (!p) return "—";
  return PROVIDER_LABELS[p] ?? p.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function ProviderBadge({ provider }: { provider: string | null | undefined }) {
  if (!provider) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <Badge variant="outline" className="text-xs gap-1 border-violet-500/30 text-violet-300 bg-violet-500/10">
      <Zap className="w-3 h-3" />
      {formatProvider(provider)}
    </Badge>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className={`text-sm text-right break-all ${mono ? "font-mono" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function RecordPaymentDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [merchantId, setMerchantId] = useState("");
  const [type, setType] = useState<"deposit" | "withdrawal">("deposit");
  const [status, setStatus] = useState<"success" | "pending" | "failed">("success");
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [description, setDescription] = useState("");
  const [paymentLinkId, setPaymentLinkId] = useState<string>("");
  const [linkSearch, setLinkSearch] = useState("");
  const [showExpired, setShowExpired] = useState(false);

  const { mutateAsync: createTx, isPending } = useAdminCreateTransaction();

  // Load merchants for selector
  const { data: merchantsData } = useListMerchants({ limit: 200 }, {
    query: { enabled: open } as any,
  });

  // Load payment links for selected merchant; include expired when toggled for correction workflows
  const { data: linksData } = useListPaymentLinks(
    { merchantId: merchantId ? parseInt(merchantId) : undefined, status: showExpired ? "all" : "active", limit: 100 },
    { query: { enabled: open && !!merchantId } as any }
  );

  const filteredLinks = (linksData?.data ?? []).filter(l => {
    if (!linkSearch) return true;
    const q = linkSearch.toLowerCase();
    return l.title.toLowerCase().includes(q) || l.slug.toLowerCase().includes(q);
  });

  function isLinkExpiredOrMaxed(link: NonNullable<typeof linksData>["data"][number]): { expired: boolean; reason: string } {
    if (link.status !== "active") return { expired: true, reason: "This link is no longer active" };
    const now = new Date();
    if (link.expiresAt && new Date(link.expiresAt) < now) return { expired: true, reason: `Expired ${format(new Date(link.expiresAt), "dd MMM yyyy, HH:mm")}` };
    if (link.maxPayments != null && link.paymentCount >= link.maxPayments) return { expired: true, reason: `Reached max payment count (${link.paymentCount}/${link.maxPayments})` };
    return { expired: false, reason: "" };
  }

  const handleMerchantChange = (val: string) => {
    setMerchantId(val);
    setPaymentLinkId("");
    setLinkSearch("");
  };

  const handleClose = () => {
    setMerchantId("");
    setType("deposit");
    setStatus("success");
    setAmount("");
    setUtr("");
    setReferenceId("");
    setDescription("");
    setPaymentLinkId("");
    setLinkSearch("");
    setShowExpired(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!merchantId || !amount) return;
    if (isNaN(Number(amount)) || Number(amount) <= 0) {
      toast.error("Amount must be a positive number");
      return;
    }
    try {
      await createTx({
        data: {
          merchantId: parseInt(merchantId),
          type,
          status,
          amount: Number(amount),
          utr: utr || undefined,
          referenceId: referenceId || null,
          description: description || null,
          paymentLinkId: paymentLinkId ? parseInt(paymentLinkId) : null,
        },
      });
      toast.success("Transaction recorded successfully");
      onSuccess();
      handleClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to record transaction");
    }
  };

  const selectedLink = paymentLinkId ? filteredLinks.find(l => String(l.id) === paymentLinkId) ?? linksData?.data?.find(l => String(l.id) === paymentLinkId) : null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" />
            Record Payment
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Merchant */}
          <div className="space-y-1.5">
            <Label>Merchant <span className="text-rose-500">*</span></Label>
            <Select value={merchantId} onValueChange={handleMerchantChange} required>
              <SelectTrigger>
                <SelectValue placeholder="Select merchant…" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {(merchantsData?.data ?? []).map(m => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.businessName} <span className="text-muted-foreground text-xs ml-1">#{m.id}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Type & Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type <span className="text-rose-500">*</span></Label>
              <Select value={type} onValueChange={v => setType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deposit">Deposit</SelectItem>
                  <SelectItem value="withdrawal">Withdrawal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status <span className="text-rose-500">*</span></Label>
              <Select value={status} onValueChange={v => setStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label>Amount (₹) <span className="text-rose-500">*</span></Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
            />
          </div>

          {/* Payment Link (deposit only, merchant required) */}
          {type === "deposit" && merchantId && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                  Payment Link <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                </Label>
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <Checkbox
                    id="show-expired-links"
                    checked={showExpired}
                    onCheckedChange={v => { setShowExpired(!!v); setPaymentLinkId(""); setLinkSearch(""); }}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs text-muted-foreground">Include expired</span>
                </label>
              </div>
              {selectedLink ? (
                <>
                  <div className={`flex items-center gap-2 p-2.5 rounded-lg border ${isLinkExpiredOrMaxed(selectedLink).expired ? "border-amber-500/40 bg-amber-500/5" : "bg-primary/5"}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{selectedLink.title}</p>
                      <p className="text-xs text-muted-foreground font-mono">{selectedLink.slug}{selectedLink.amount ? ` · ₹${Number(selectedLink.amount).toLocaleString()}` : ""}</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={() => { setPaymentLinkId(""); setLinkSearch(""); }}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {isLinkExpiredOrMaxed(selectedLink).expired && (
                    <Alert className="border-amber-500/40 bg-amber-500/10 py-2.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <AlertDescription className="text-xs text-amber-600 dark:text-amber-400">
                        <span className="font-semibold">Warning:</span> {isLinkExpiredOrMaxed(selectedLink).reason}. Recording this payment will be rejected by the server unless the link is reactivated first.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              ) : (
                <div className="space-y-1.5">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      className="pl-8 text-sm"
                      placeholder={showExpired ? "Search all payment links…" : "Search active payment links…"}
                      value={linkSearch}
                      onChange={e => setLinkSearch(e.target.value)}
                    />
                  </div>
                  {(linksData?.data?.length ?? 0) === 0 && !linkSearch && (
                    <p className="text-xs text-muted-foreground px-1">{showExpired ? "No payment links for this merchant" : "No active payment links for this merchant"}</p>
                  )}
                  {filteredLinks.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-lg border divide-y divide-border bg-card/50">
                      {filteredLinks.map(link => {
                        const { expired, reason } = isLinkExpiredOrMaxed(link);
                        return (
                          <button
                            key={link.id}
                            type="button"
                            className={`w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors ${expired ? "opacity-70" : ""}`}
                            onClick={() => { setPaymentLinkId(String(link.id)); setLinkSearch(""); }}
                          >
                            <div className="flex items-center gap-1.5">
                              {expired && <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />}
                              <p className="text-sm font-medium truncate">{link.title}</p>
                            </div>
                            <p className="text-xs text-muted-foreground font-mono mt-0.5">
                              {link.slug}
                              {link.amount ? ` · ₹${Number(link.amount).toLocaleString()}` : ""}
                              {link.maxPayments != null ? ` · ${link.paymentCount}/${link.maxPayments} payments` : ` · ${link.paymentCount} payments`}
                              {expired ? ` · ${reason}` : ""}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* Optional fields */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Optional Fields</p>
            <div className="space-y-1.5">
              <Label className="text-sm">UTR</Label>
              <Input
                className="font-mono text-sm"
                placeholder="Auto-generated if empty"
                value={utr}
                onChange={e => setUtr(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Reference ID</Label>
              <Input
                className="text-sm"
                placeholder="External reference…"
                value={referenceId}
                onChange={e => setReferenceId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Description</Label>
              <Input
                className="text-sm"
                placeholder="Payment description…"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" disabled={isPending || !merchantId || !amount}>
              {isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Recording…</> : "Record Payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PROVIDERS = [
  { value: "google_pay", label: "Google Pay" },
  { value: "phonepe", label: "PhonePe" },
  { value: "paytm", label: "Paytm" },
  { value: "bharat_pe", label: "BharatPe" },
  { value: "bharatpe", label: "BharatPe (legacy)" },
  { value: "yono_sbi", label: "YONO SBI" },
  { value: "hdfc_smarthub", label: "HDFC SmartHub" },
  { value: "upi_id", label: "UPI" },
] as const;

export default function AdminTransactions() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [utrSearch, setUtrSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [provider, setProvider] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedTxId, setSelectedTxId] = useState<number | null>(null);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);

  const [paymentLinkId, setPaymentLinkId] = useState<number | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkDropdownOpen, setLinkDropdownOpen] = useState(false);

  // Smart search state
  const [smartInput, setSmartInput] = useState("");
  const [smartFilter, setSmartFilter] = useState<SmartFilter | null>(null);
  const [smartError, setSmartError] = useState("");
  const smartInputRef = useRef<HTMLInputElement>(null);

  // Saved filters state
  const { data: savedFiltersData } = useListSavedFilters();
  const savedFilters: SavedFilterItem[] = (savedFiltersData?.data ?? []) as SavedFilterItem[];
  const { mutateAsync: createSavedFilterMutation, isPending: isSavingFilter } = useCreateSavedFilter();
  const { mutateAsync: deleteSavedFilterMutation } = useDeleteSavedFilter();
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [saveFilterNameError, setSaveFilterNameError] = useState("");
  const saveNameInputRef = useRef<HTMLInputElement>(null);

  // Read ?provider= URL query param on mount and pre-fill the provider filter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const providerParam = params.get("provider");
    if (providerParam && providerParam !== "all") {
      setProvider(providerParam);
      setPage(1);
    }
  }, []);

  useEffect(() => {
    if (showSaveInput) setTimeout(() => saveNameInputRef.current?.focus(), 50);
  }, [showSaveInput]);

  // Smart filter derived values
  const amountMin = smartFilter?.amountMin;
  const amountMax = smartFilter?.amountMax;
  const smartDateFrom = smartFilter?.dateFrom;
  const smartDateTo = smartFilter?.dateTo;
  const activeDateFrom = smartDateFrom ?? dateFrom;
  const activeDateTo = smartDateTo ?? dateTo;
  const activeType = smartFilter?.txType ?? type;
  const activeStatus = smartFilter?.txStatus ?? status;

  const { data: allLinksData } = useListPaymentLinks(
    { search: linkSearch || undefined, status: "all", limit: 50 },
    { query: { enabled: linkDropdownOpen } as any }
  );
  const linkOptions = allLinksData?.data ?? [];

  const selectedLink = paymentLinkId != null
    ? (allLinksData?.data?.find(l => l.id === paymentLinkId) ?? null)
    : null;

  const { lastRefreshed, isRefreshing, handleRefresh } = useMonitoringRefresh(
    () => qc.invalidateQueries({ queryKey: ["/api/transactions"] })
  );

  const { data, isLoading } = useListTransactions({
    type: activeType as any,
    status: activeStatus as any,
    search,
    dateFrom: activeDateFrom || undefined,
    dateTo: activeDateTo || undefined,
    connectionProvider: provider !== "all" ? provider as any : undefined,
    paymentLinkId: paymentLinkId ?? undefined,
    ...(amountMin != null ? { amountMin } : {}),
    ...(amountMax != null ? { amountMax } : {}),
    page,
    limit: 20,
  });
  const { data: utrResult, isLoading: utrLoading, error: utrError } = useSearchByUtr(
    { utr: utrSearch || "" },
    { query: { enabled: !!utrSearch } as any }
  );

  // Smart search handlers
  const applySmartSearch = () => {
    setSmartError("");
    const filter = parseSmartQuery(smartInput);
    if (!filter) {
      setSmartError("Try: failed deposits, pending >500, deposits this week, >500, today");
      return;
    }
    setSmartFilter(filter);
    if (filter.dateFrom || filter.dateTo) { setDateFrom(""); setDateTo(""); }
    setPage(1);
    setShowSaveInput(false);
    setSaveFilterName("");
  };

  const clearSmartFilter = () => {
    setSmartFilter(null);
    setSmartInput("");
    setSmartError("");
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
    setPage(1);
    smartInputRef.current?.focus();
  };

  const applySavedFilter = (saved: SavedFilterItem) => {
    const f = saved.filterData;
    setSmartFilter(f as SmartFilter);
    setSmartInput(saved.rawInput);
    setSmartError("");
    setShowSaveInput(false);
    setSaveFilterName("");
    setSaveFilterNameError("");
    if (f.dateFrom != null) { setDateFrom(""); setDateTo(""); }
    setPage(1);
  };

  const confirmSaveFilter = async () => {
    const trimmed = saveFilterName.trim();
    if (!trimmed) { setSaveFilterNameError("Please enter a name for this filter."); saveNameInputRef.current?.focus(); return; }
    if (!smartFilter) return;
    if (savedFilters.some(f => f.name.toLowerCase() === trimmed.toLowerCase())) {
      setSaveFilterNameError("A filter with this name already exists."); saveNameInputRef.current?.focus(); return;
    }
    try {
      await createSavedFilterMutation({ data: { name: trimmed, rawInput: smartInput, filterData: smartFilter as Record<string, unknown> } });
      await qc.invalidateQueries({ queryKey: ["/api/saved-filters"] });
      setShowSaveInput(false);
      setSaveFilterName("");
      setSaveFilterNameError("");
    } catch (err: any) {
      if (err?.status === 409 || err?.message?.includes("already exists")) {
        setSaveFilterNameError("A filter with this name already exists.");
        saveNameInputRef.current?.focus();
      } else {
        toast.error("Failed to save filter");
      }
    }
  };

  const cancelSaveFilter = () => { setShowSaveInput(false); setSaveFilterName(""); setSaveFilterNameError(""); };

  const deleteSavedFilter = async (id: number) => {
    try {
      await deleteSavedFilterMutation({ id });
      await qc.invalidateQueries({ queryKey: ["/api/saved-filters"] });
    } catch {
      toast.error("Failed to delete filter");
    }
  };

  const hasSmartFilter = smartFilter !== null;
  const isCurrentFilterSaved = hasSmartFilter && savedFilters.some(
    f => f.rawInput === smartInput && JSON.stringify(f.filterData) === JSON.stringify(smartFilter)
  );
  const anyFilterActive = hasSmartFilter || !!search || !!utrSearch || type !== "all" || status !== "all" || provider !== "all" || !!(activeDateFrom || activeDateTo);

  const exportCsv = () => downloadCsvFromUrl("/api/transactions/export/csv", "transactions.csv", {
    type: activeType !== "all" ? activeType : undefined,
    status: activeStatus !== "all" ? activeStatus : undefined,
    search: search || undefined,
    dateFrom: activeDateFrom || undefined,
    dateTo: activeDateTo || undefined,
    connectionProvider: provider !== "all" ? provider : undefined,
    paymentLinkId: paymentLinkId != null ? String(paymentLinkId) : undefined,
    ...(amountMin != null ? { amountMin: String(amountMin) } : {}),
    ...(amountMax != null ? { amountMax: String(amountMax) } : {}),
  });

  const stats = data?.stats;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground mt-1">Complete transaction history · refreshed {format(lastRefreshed, "HH:mm:ss")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <ExportCsvButton onExport={exportCsv} />
          <Button size="sm" onClick={() => setRecordDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Record Payment
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <ArrowDownLeft className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Deposit Volume</p>
                <p className="text-lg font-bold font-mono truncate">₹{(stats?.depositVolume ?? 0).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                <ArrowUpRight className="w-4 h-4 text-violet-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Withdrawal Volume</p>
                <p className="text-lg font-bold font-mono truncate">₹{(stats?.withdrawalVolume ?? 0).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Successful</p>
                <p className="text-lg font-bold">{stats?.successCount ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-500/10 flex items-center justify-center flex-shrink-0">
                <Hash className="w-4 h-4 text-sky-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Count</p>
                <p className="text-lg font-bold">{data?.total ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-500/10 flex items-center justify-center flex-shrink-0">
                <XCircle className="w-4 h-4 text-rose-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="text-lg font-bold">{stats?.failedCount ?? 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Smart Search Bar */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Smart Search</p>

          {savedFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground font-medium">Saved:</span>
              {savedFilters.map(saved => (
                <span
                  key={saved.id}
                  className="group inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/8 px-2.5 py-0.5 text-xs font-medium text-violet-300 hover:border-violet-500/60 transition-colors"
                >
                  <button
                    onClick={() => applySavedFilter(saved)}
                    className="flex items-center gap-1 hover:text-violet-100 transition-colors"
                    title={`Apply: ${saved.rawInput}`}
                  >
                    <BookmarkCheck className="w-3 h-3 shrink-0" />
                    {saved.name}
                  </button>
                  <button
                    onClick={() => deleteSavedFilter(saved.id)}
                    className="ml-0.5 rounded-full p-0.5 text-violet-400/50 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                    aria-label={`Delete saved filter "${saved.name}"`}
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400" />
              <Input
                ref={smartInputRef}
                className="pl-9"
                placeholder="Try: failed deposits  ·  pending >500  ·  deposits this week  ·  >500  ·  today"
                value={smartInput}
                onChange={e => { setSmartInput(e.target.value); setSmartError(""); }}
                onKeyDown={e => { if (e.key === "Enter") applySmartSearch(); }}
              />
            </div>
            <Button onClick={applySmartSearch} disabled={!smartInput.trim()}>
              <Search className="w-4 h-4 mr-2" />Apply
            </Button>
            {hasSmartFilter && !isCurrentFilterSaved && !showSaveInput && (
              <Button
                variant="outline"
                onClick={() => { setSaveFilterName(""); setSaveFilterNameError(""); setShowSaveInput(true); }}
                className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
              >
                <Bookmark className="w-4 h-4 mr-2" />Save filter
              </Button>
            )}
            {hasSmartFilter && isCurrentFilterSaved && (
              <Button variant="outline" disabled className="border-violet-500/20 text-violet-400/50 cursor-default">
                <BookmarkCheck className="w-4 h-4 mr-2" />Saved
              </Button>
            )}
          </div>

          {showSaveInput && (
            <div className="mt-3 flex items-start gap-2">
              <div className="flex-1">
                <Input
                  ref={saveNameInputRef}
                  className="h-8 text-sm"
                  placeholder="Name this filter (e.g. Large deposits)"
                  value={saveFilterName}
                  onChange={e => { setSaveFilterName(e.target.value); setSaveFilterNameError(""); }}
                  onKeyDown={e => { if (e.key === "Enter") confirmSaveFilter(); if (e.key === "Escape") cancelSaveFilter(); }}
                  maxLength={40}
                />
                {saveFilterNameError && <p className="mt-1 text-xs text-rose-400">{saveFilterNameError}</p>}
              </div>
              <Button size="sm" onClick={confirmSaveFilter} disabled={isSavingFilter} className="h-8 shrink-0">
                {isSavingFilter ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Saving…</> : "Save"}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelSaveFilter} className="h-8 shrink-0 px-2"><X className="w-4 h-4" /></Button>
            </div>
          )}

          {smartError && <p className="mt-2 text-xs text-amber-400">{smartError}</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            Type: <span className="font-mono text-foreground/60">deposit</span>, <span className="font-mono text-foreground/60">withdrawal</span> — Status: <span className="font-mono text-foreground/60">pending</span>, <span className="font-mono text-foreground/60">success</span>, <span className="font-mono text-foreground/60">failed</span> — Amount: <span className="font-mono text-foreground/60">{">500"}</span>, <span className="font-mono text-foreground/60">{"200-999"}</span> — Date: <span className="font-mono text-foreground/60">today</span>, <span className="font-mono text-foreground/60">this week</span>, <span className="font-mono text-foreground/60">this month</span> — Combine: <span className="font-mono text-foreground/60">failed deposits this week</span>
          </p>
        </CardContent>
      </Card>

      {/* Active filter chips */}
      {hasSmartFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Smart filter:</span>
          {(() => {
            const sf = smartFilter!;
            const chips: { label: string; key: string }[] = [];
            if (sf.txType) chips.push({ key: "type", label: sf.txType === "deposit" ? "Deposits" : "Withdrawals" });
            if (sf.txStatus) chips.push({ key: "status", label: sf.txStatus.charAt(0).toUpperCase() + sf.txStatus.slice(1) });
            if (sf.dateFrom || sf.dateTo) {
              const d = sf.dateFrom && sf.dateTo
                ? `${sf.dateFrom} – ${sf.dateTo}`
                : sf.dateFrom ? `From ${sf.dateFrom}` : `Until ${sf.dateTo}`;
              chips.push({ key: "date", label: d });
            }
            if (sf.amountMin != null && sf.amountMax != null) {
              chips.push({ key: "amount", label: `₹${sf.amountMin.toLocaleString()} – ₹${sf.amountMax.toLocaleString()}` });
            } else if (sf.amountMin != null) {
              chips.push({ key: "amount", label: `≥ ₹${sf.amountMin.toLocaleString()}` });
            } else if (sf.amountMax != null) {
              chips.push({ key: "amount", label: `≤ ₹${sf.amountMax.toLocaleString()}` });
            }
            return chips.map((chip, i) => (
              <span key={chip.key} className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
                <Sparkles className="w-3 h-3" />
                {chip.label}
                {i === chips.length - 1 && (
                  <button
                    onClick={clearSmartFilter}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
                    aria-label="Remove smart filter"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ));
          })()}
        </div>
      )}

      {/* Filter summary bar */}
      {anyFilterActive && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider mr-1">Filter results</span>
            <div className="flex items-center gap-1.5 text-sm">
              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-semibold text-foreground">
                {isLoading ? <span className="inline-block w-8 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.total ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">transactions</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-semibold text-emerald-400">
                {isLoading ? <span className="inline-block w-16 h-3.5 bg-muted/60 rounded animate-pulse" /> : `₹${(data?.stats?.depositVolume ?? 0).toLocaleString()}`}
              </span>
              <span className="text-muted-foreground">deposit volume</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
              <span className="font-semibold text-green-400">
                {isLoading ? <span className="inline-block w-6 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.stats?.successCount ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">success</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-semibold text-rose-400">
                {isLoading ? <span className="inline-block w-6 h-3.5 bg-muted/60 rounded animate-pulse" /> : (data?.stats?.failedCount ?? 0).toLocaleString()}
              </span>
              <span className="text-muted-foreground">failed</span>
            </div>
          </div>
        </div>
      )}

      {/* UTR Search */}
      <Card>
        <CardHeader className="pb-3 pt-4">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">UTR / Reference Search</p>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 font-mono" placeholder="Enter UTR number..." value={utrSearch} onChange={e => setUtrSearch(e.target.value)} />
            </div>
            {utrSearch && <Button variant="ghost" size="icon" onClick={() => setUtrSearch("")}><X className="w-4 h-4" /></Button>}
          </div>
          {utrSearch && (
            <div className="mt-3 p-3 rounded-lg border bg-card/50">
              {utrLoading && <p className="text-sm text-muted-foreground">Searching...</p>}
              {utrError && <p className="text-sm text-rose-500">Transaction not found for UTR: {utrSearch}</p>}
              {utrResult && (
                <div className="flex flex-wrap gap-4 text-sm items-center">
                  <div><span className="text-muted-foreground">UTR:</span> <span className="font-mono font-medium">{utrResult.utr}</span></div>
                  <div><span className="text-muted-foreground">Amount:</span> <span className="font-semibold">₹{Number(utrResult.amount).toLocaleString()}</span></div>
                  <div><span className="text-muted-foreground">Type:</span> <Badge variant="outline">{utrResult.type}</Badge></div>
                  <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={utrResult.status} /></div>
                  <div><span className="text-muted-foreground">Date:</span> {format(new Date(utrResult.createdAt), "MMM d, yyyy HH:mm")}</div>
                  <Button variant="outline" size="sm" onClick={() => setSelectedTxId(utrResult.id)}>View Details</Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search UTR or reference..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
              </div>
              <Select value={type} onValueChange={v => { setType(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="deposit">Deposit</SelectItem>
                  <SelectItem value="withdrawal">Withdrawal</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={provider} onValueChange={v => { setProvider(v); setPage(1); }}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Providers" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Providers</SelectItem>
                  {PROVIDERS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">From</span>
                <Input type="date" className="w-40" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">To</span>
                <Input type="date" className="w-40" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
              </div>
              {(dateFrom || dateTo) && (
                <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                  <X className="w-3.5 h-3.5 mr-1" /> Clear dates
                </Button>
              )}
              <div className="relative">
                {paymentLinkId != null && selectedLink ? (
                  <div className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-primary/50 bg-primary/5 text-sm">
                    <Link2 className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="max-w-[160px] truncate font-medium">{selectedLink.title}</span>
                    <button
                      type="button"
                      className="ml-1 text-muted-foreground hover:text-foreground"
                      onClick={() => { setPaymentLinkId(null); setLinkSearch(""); setPage(1); }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      className="pl-8 w-[200px] text-sm"
                      placeholder="Filter by payment link…"
                      value={linkSearch}
                      onFocus={() => setLinkDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setLinkDropdownOpen(false), 150)}
                      onChange={e => { setLinkSearch(e.target.value); setLinkDropdownOpen(true); }}
                    />
                    {linkDropdownOpen && (
                      <div className="absolute top-full mt-1 left-0 z-50 w-72 rounded-lg border bg-popover shadow-lg overflow-hidden">
                        {linkOptions.length === 0 ? (
                          <p className="px-3 py-2.5 text-xs text-muted-foreground">
                            {linkSearch ? "No matching payment links" : "No payment links found"}
                          </p>
                        ) : (
                          <div className="max-h-48 overflow-y-auto divide-y divide-border">
                            {linkOptions.map(link => (
                              <button
                                key={link.id}
                                type="button"
                                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => { setPaymentLinkId(link.id); setLinkSearch(""); setLinkDropdownOpen(false); setPage(1); }}
                              >
                                <p className="text-sm font-medium truncate">{link.title}</p>
                                <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                                  {link.slug}{link.amount ? ` · ₹${Number(link.amount).toLocaleString()}` : ""}
                                </p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>UTR</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                ))
              ) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">No transactions found</TableCell></TableRow>
              ) : data?.data?.map(tx => (
                <TableRow
                  key={tx.id}
                  className="cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => setSelectedTxId(tx.id)}
                >
                  <TableCell className="font-mono text-xs">{tx.utr}</TableCell>
                  <TableCell className="text-sm">{tx.merchantName || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{tx.type}</Badge></TableCell>
                  <TableCell><StatusBadge status={tx.status} /></TableCell>
                  <TableCell><ProviderBadge provider={tx.connectionProvider} /></TableCell>
                  <TableCell className="text-right font-mono font-medium">₹{Number(tx.amount).toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {tx.referenceId || ((tx as any).paymentLinkId ? (
                      <Link
                        href="/admin/payment-links"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        <Link2 className="w-3 h-3" />Link #{(tx as any).paymentLinkId}
                      </Link>
                    ) : "—")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(tx.createdAt), "MMM d, HH:mm")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total transactions</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}

      <TransactionDetailPanel
        id={selectedTxId}
        open={selectedTxId != null}
        onClose={() => setSelectedTxId(null)}
      />

      <RecordPaymentDialog
        open={recordDialogOpen}
        onClose={() => setRecordDialogOpen(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["/api/transactions"] })}
      />
    </div>
  );
}
