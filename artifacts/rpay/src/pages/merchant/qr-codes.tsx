import { useState, useCallback } from "react";
import {
  useListQrCodes,
  useCreateQrCode,
  useDeleteQrCode,
  useBulkDeleteQrCodes,
  useListMerchantConnections,
  useGetQrCodeActivity,
  useGetQrCodeStats,
  useGetPayinStatus,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, Plus, Trash2, Download, QrCode, Eye, AlertTriangle, CheckCircle2, Link2, ChevronDown, ChevronRight, ScanLine, Zap, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { RasoConfirmModal } from "@/components/ui/raso-confirm-modal";
import { getApiErrorMessage } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { QRCodeCanvas } from "qrcode.react";

type QrRow = {
  id: number;
  type: string;
  label?: string | null;
  payload: string;
  amount?: string | null;
  orderId?: string | null;
  callbackUrl?: string | null;
  merchantReference?: string | null;
  expiresAt?: string | null;
  status: string;
  scanCount: number;
  createdAt: string;
  ekqrOrderId?: string | null;
  ekqrPaymentUrl?: string | null;
};

const PROVIDER_LABELS: Record<string, string> = {
  upi_id:        "UPI Direct",
  google_pay:    "RasoKart UPI",
  phonepe:       "RasoKart Collect",
  paytm:         "RasoKart Wallet",
  bharatpe:      "RasoKart Merchant",
  freecharge:    "RasoKart Pay",
  amazon_pay:    "RasoKart Digital",
  yono_sbi:      "Bank UPI",
  sbi_yono:      "Bank UPI",
  hdfc_smarthub: "Bank SmartQR",
  icici_eazypay: "Bank QR",
  axis_pay:      "Bank QR",
  kotak_smart:   "Bank Smart Collect",
  razorpay:      "RasoKart Gateway",
  cashfree:      "RasoKart Payments",
  payu:          "RasoKart Gateway Plus",
  ekqr:          "RasoKart QR Gateway",
};

const PROVIDER_VPA_SUFFIX: Record<string, string> = {
  phonepe: "ybl",
  paytm: "paytm",
  bharatpe: "bharatpe",
  yono_sbi: "sbi",
  hdfc_smarthub: "hdfcbank",
};

function deriveVpaFromConn(provider: string, credentials: string | null): string | null {
  let creds: Record<string, string> = {};
  let isJson = false;
  try { if (credentials) { creds = JSON.parse(credentials); isJson = true; } } catch {}
  if (creds["vpa"]) return creds["vpa"];
  if (provider === "upi_id") {
    return creds["UPI ID"] ?? (!isJson && credentials ? credentials : null);
  }
  const suffix = PROVIDER_VPA_SUFFIX[provider];
  const mid = creds["Merchant ID"] ?? creds["MID"] ?? null;
  if (mid && suffix) return `${mid}@${suffix}`;
  return null;
}

function statusBadge(status: string) {
  if (status === "active") return <Badge className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">Active</Badge>;
  if (status === "expired") return <Badge className="text-xs bg-rose-500/15 text-rose-400 border-rose-500/20 hover:bg-rose-500/20">Expired</Badge>;
  if (status === "used") return <Badge className="text-xs bg-blue-500/15 text-blue-400 border-blue-500/20 hover:bg-blue-500/20">Used</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

function PaymentActivity({ qrId }: { qrId: number }) {
  const { data, isLoading } = useGetQrCodeActivity(qrId);

  if (isLoading) {
    return (
      <div className="mt-4 border-t border-border/50 pt-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payment Activity</p>
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-10 bg-muted/40 rounded-md animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const events = data?.data ?? [];

  return (
    <div className="mt-4 border-t border-border/50 pt-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payment Activity</p>
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No payments received yet</p>
      ) : (
        <div className="space-y-2">
          {events.map(ev => (
            <div key={ev.id} className="flex items-start gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5">
              <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-emerald-400">Payment received</span>
                  {ev.status === "failed" && (
                    <Badge className="text-xs bg-rose-500/15 text-rose-400 border-rose-500/20 py-0 px-1.5">webhook failed</Badge>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {format(new Date(ev.receivedAt), "MMM d, yyyy · HH:mm:ss")}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1 flex-wrap">
                  {ev.amount && (
                    <span className="text-xs text-foreground font-mono">
                      ₹{parseFloat(ev.amount).toLocaleString("en-IN")}
                    </span>
                  )}
                  {ev.orderId && (
                    <span className="text-xs text-muted-foreground font-mono">
                      Order: {ev.orderId}
                    </span>
                  )}
                  {ev.merchantReference && (
                    <span className="text-xs text-muted-foreground font-mono">
                      Ref: {ev.merchantReference}
                    </span>
                  )}
                  {ev.transactionId && (
                    <span className="text-xs text-blue-400 font-mono">
                      Txn #{ev.transactionId}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InlineQrRow({ qr }: { qr: QrRow }) {
  const [copied, setCopied] = useState(false);
  const [syncResult, setSyncResult] = useState<{ qrStatus: string; parsed: Record<string, unknown> } | null>(null);
  const qc = useQueryClient();

  const syncMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/qr-codes/${id}/ekqr-sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Sync failed" }));
        throw new Error(err.error ?? "Sync failed");
      }
      return res.json() as Promise<{ raw: string; parsed: Record<string, unknown>; qrStatus: string }>;
    },
    onSuccess: (data) => {
      setSyncResult({ qrStatus: data.qrStatus, parsed: data.parsed });
      toast.success(`QR sync complete — status: ${data.qrStatus}`);
      qc.invalidateQueries({ queryKey: ["/api/qr-codes"] });
    },
    onError: (err: Error) => {
      toast.error(err.message ?? "QR sync failed");
    },
  });

  const handleDownload = useCallback(() => {
    const canvas = document.querySelector(`#qr-inline-${qr.id} canvas`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${qr.id}-${qr.orderId ?? qr.merchantReference ?? "code"}.png`;
    a.click();
    toast.success("QR code downloaded");
  }, [qr]);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(qr.payload).then(() => {
      setCopied(true);
      toast.success("Payment link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  }, [qr.payload]);

  const isExpired = qr.expiresAt ? new Date(qr.expiresAt) < new Date() : false;

  const [copiedEkqr, setCopiedEkqr] = useState(false);

  const handleCopyEkqrLink = useCallback(() => {
    if (!qr.ekqrPaymentUrl) return;
    navigator.clipboard.writeText(qr.ekqrPaymentUrl).then(() => {
      setCopiedEkqr(true);
      toast.success("Payment link copied to clipboard");
      setTimeout(() => setCopiedEkqr(false), 2000);
    });
  }, [qr.ekqrPaymentUrl]);

  return (
    <TableRow className="bg-muted/30 border-t-0">
      <TableCell colSpan={9} className="py-4 px-6">
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">
          <div className="flex flex-col sm:flex-row gap-4 items-start shrink-0 mx-auto sm:mx-0">
            <div className="flex flex-col items-center gap-1.5">
              <div id={`qr-inline-${qr.id}`} className="bg-white p-3 rounded-xl">
                <QRCodeCanvas value={qr.payload} size={120} level="H" includeMargin />
              </div>
              <span className="text-xs text-muted-foreground">UPI QR</span>
            </div>
            {qr.ekqrPaymentUrl && (
              <div className="flex flex-col items-center gap-1.5">
                <div className="bg-white p-3 rounded-xl border-2 border-teal-500/40">
                  <QRCodeCanvas value={qr.ekqrPaymentUrl} size={120} level="H" includeMargin />
                </div>
                <span className="text-xs text-teal-400 font-medium">Payment Collection Link</span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 w-full">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm mb-3">
              {qr.amount && (
                <div>
                  <span className="text-xs text-muted-foreground block">Amount</span>
                  <span className="font-semibold">₹{parseFloat(qr.amount).toLocaleString("en-IN")}</span>
                </div>
              )}
              {qr.orderId && (
                <div>
                  <span className="text-xs text-muted-foreground block">Order ID</span>
                  <span className="font-mono text-xs">{qr.orderId}</span>
                </div>
              )}
              {qr.merchantReference && (
                <div>
                  <span className="text-xs text-muted-foreground block">Reference</span>
                  <span className="font-mono text-xs">{qr.merchantReference}</span>
                </div>
              )}
              {qr.callbackUrl && (
                <div className="col-span-2">
                  <span className="text-xs text-muted-foreground block">Callback URL</span>
                  <span className="font-mono text-xs truncate block">{qr.callbackUrl}</span>
                </div>
              )}
              {qr.expiresAt && (
                <div>
                  <span className="text-xs text-muted-foreground block">Expires</span>
                  <span className={`text-xs ${isExpired ? "text-rose-400" : "text-amber-400"}`}>
                    {isExpired ? "Expired" : formatDistanceToNow(new Date(qr.expiresAt), { addSuffix: true })}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={qr.status === "expired"} className="h-7 text-xs px-3 flex-1 sm:flex-none">
                <Download className="w-3.5 h-3.5 mr-1.5" />Download PNG
              </Button>
              <Button size="sm" variant="outline" onClick={handleCopyLink} className="h-7 text-xs px-3 flex-1 sm:flex-none">
                <Link2 className="w-3.5 h-3.5 mr-1.5" />{copied ? "Copied!" : "Copy Link"}
              </Button>
              {qr.ekqrPaymentUrl && (
                <Button size="sm" variant="outline" onClick={handleCopyEkqrLink} className="h-7 text-xs px-3 flex-1 sm:flex-none border-teal-500/40 text-teal-400 hover:bg-teal-500/10 hover:text-teal-300">
                  <Link2 className="w-3.5 h-3.5 mr-1.5" />{copiedEkqr ? "Copied!" : "Copy UPI Link"}
                </Button>
              )}
              {qr.ekqrOrderId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncMutation.mutate(qr.id)}
                  disabled={syncMutation.isPending}
                  className="h-7 text-xs px-3 flex-1 sm:flex-none border-teal-500/40 text-teal-400 hover:bg-teal-500/10 hover:text-teal-300"
                >
                  <RotateCw className={`w-3.5 h-3.5 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  {syncMutation.isPending ? "Syncing…" : "Sync Status"}
                </Button>
              )}
            </div>

            {syncResult && (
              <div className="mt-2 rounded-md border border-teal-500/25 bg-teal-500/8 px-3 py-2.5 space-y-1">
                <p className="text-xs font-semibold text-teal-400 uppercase tracking-wide">Payment Status</p>
                <p className="text-xs text-muted-foreground">
                  Payment status: <span className="font-mono text-foreground">{syncResult.qrStatus}</span>
                </p>
              </div>
            )}

            {qr.ekqrOrderId && !syncResult && (
              <p className="text-xs text-muted-foreground mt-1">
                Payment Ref: <span className="font-mono text-teal-400">{qr.ekqrOrderId}</span>
              </p>
            )}

            <PaymentActivity qrId={qr.id} />
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

function DownloadModal({ qr, onClose }: { qr: QrRow; onClose: () => void }) {
  const handleDownload = useCallback(() => {
    const canvas = document.querySelector("#qr-modal-canvas canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${qr.id}-${qr.orderId ?? qr.merchantReference ?? "code"}.png`;
    a.click();
    toast.success("QR code downloaded");
  }, [qr]);

  const { data: activityData } = useGetQrCodeActivity(qr.id);
  const events = activityData?.data ?? [];

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>QR Code #{qr.id}</DialogTitle>
          <p className="text-sm text-muted-foreground">{qr.orderId ?? qr.merchantReference ?? qr.type}</p>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div id="qr-modal-canvas" className="bg-white p-4 rounded-xl">
            <QRCodeCanvas value={qr.payload} size={200} level="H" includeMargin />
          </div>
          {events.length > 0 && (
            <div className="w-full space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Payment Activity</p>
              {events.map(ev => (
                <div key={ev.id} className="flex items-start gap-2.5 rounded-md border border-emerald-500/20 bg-emerald-500/8 px-3 py-2">
                  <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-emerald-400">Payment received</span>
                      <span className="text-xs text-muted-foreground">{format(new Date(ev.receivedAt), "MMM d · HH:mm")}</span>
                    </div>
                    <div className="flex gap-3 mt-0.5 flex-wrap">
                      {ev.amount && <span className="text-xs font-mono text-foreground">₹{parseFloat(ev.amount).toLocaleString("en-IN")}</span>}
                      {ev.orderId && <span className="text-xs font-mono text-muted-foreground">Order: {ev.orderId}</span>}
                      {ev.transactionId && <span className="text-xs font-mono text-blue-400">Txn #{ev.transactionId}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">Close</Button>
          <Button onClick={handleDownload} disabled={qr.status === "expired"} className="w-full sm:w-auto">
            <Download className="w-4 h-4 mr-1.5" />Download PNG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type BulkConfirmDialogProps = {
  count: number;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
};

function BulkConfirmDialog({ count, label, onConfirm, onCancel, isPending }: BulkConfirmDialogProps) {
  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {count} QR {count === 1 ? "code" : "codes"}?</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            This will permanently delete {label}. This action cannot be undone.
          </p>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            <Trash2 className="w-4 h-4 mr-1.5" />
            {isPending ? "Deleting…" : `Delete ${count} ${count === 1 ? "code" : "codes"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LAST_STATUS_KEY_QR = "rasokart_last_status_qr";

function loadLastStatusQr(): string {
  try {
    return localStorage.getItem(LAST_STATUS_KEY_QR) ?? "all";
  } catch {
    return "all";
  }
}

export default function MerchantQrCodes() {
  const qc = useQueryClient();
  const [status, setStatus] = useState(() => loadLastStatusQr());
  const setStatusAndPersist = (v: string) => {
    setStatus(v);
    try { localStorage.setItem(LAST_STATUS_KEY_QR, v); } catch {}
  };
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [downloadQr, setDownloadQr] = useState<QrRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<{ ids?: number[]; statusFilter?: string; count: number; label: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const [form, setForm] = useState({
    amount: "",
    orderId: "",
    expiresAt: "",
    callbackUrl: "",
    merchantReference: "",
  });

  const { data, isLoading } = useListQrCodes({ type: "dynamic" as any, status: status as any, search, page, limit: 20 });
  const { data: stats } = useGetQrCodeStats();
  const { data: connections } = useListMerchantConnections();
  const { data: payinStatus } = useGetPayinStatus();
  const createMutation = useCreateQrCode();
  const deleteMutation = useDeleteQrCode();
  const bulkDeleteMutation = useBulkDeleteQrCodes();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/qr-codes"] });
    qc.invalidateQueries({ queryKey: ["/api/qr-codes/stats"] });
    setSelectedIds(new Set());
  };

  const activeConnections = (connections ?? []).filter((c: any) => c.isActive);
  const sortedConns = [...activeConnections].sort((a: any) => a.provider === "upi_id" ? -1 : 1);
  let activeVpa: string | null = null;
  let activeProvider: string | null = null;
  for (const conn of sortedConns as any[]) {
    const vpa = deriveVpaFromConn(conn.provider, conn.credentials ?? null);
    if (vpa) { activeVpa = vpa; activeProvider = conn.provider; break; }
  }
  const hasProvider = !!activeVpa;

  const rows = data?.data ?? [];
  const rowIds = rows.map((r: any) => r.id as number);
  const allSelected = rowIds.length > 0 && rowIds.every(id => selectedIds.has(id));
  const someSelected = rowIds.some(id => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        rowIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        rowIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (!hasProvider) {
      toast.error("Please connect a payment provider first");
      return;
    }
    createMutation.mutate(
      {
        data: {
          type: "dynamic",
          amount: form.amount || null,
          orderId: form.orderId || null,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
          callbackUrl: form.callbackUrl || null,
          merchantReference: form.merchantReference || null,
        } as any,
      },
      {
        onSuccess: () => {
          toast.success("QR code created");
          setShowCreate(false);
          setForm({ amount: "", orderId: "", expiresAt: "", callbackUrl: "", merchantReference: "" });
          invalidate();
        },
        onError: (err: unknown) => {
          toast.error(getApiErrorMessage(err, "Failed to create QR code"));
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    setConfirmDeleteId(id);
  };

  const doDelete = () => {
    if (confirmDeleteId === null) return;
    deleteMutation.mutate({ id: confirmDeleteId }, {
      onSuccess: () => { toast.success("QR code deleted"); invalidate(); setConfirmDeleteId(null); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const openBulkDeleteSelected = () => {
    const ids = Array.from(selectedIds);
    setBulkConfirm({ ids, count: ids.length, label: `${ids.length} selected QR ${ids.length === 1 ? "code" : "codes"}` });
  };

  const openBulkDeleteByStatus = (statusFilter: string) => {
    const count = statusFilter === "expired" ? (stats?.expired ?? 0) : (stats?.used ?? 0);
    const label = `all ${statusFilter} QR codes`;
    setBulkConfirm({ statusFilter, count, label });
  };

  const executeBulkDelete = () => {
    if (!bulkConfirm) return;
    const payload = bulkConfirm.ids
      ? { ids: bulkConfirm.ids }
      : { status: bulkConfirm.statusFilter as "expired" | "used" };

    bulkDeleteMutation.mutate({ data: payload }, {
      onSuccess: (res) => {
        toast.success(`${res.deleted} QR ${res.deleted === 1 ? "code" : "codes"} deleted`);
        setBulkConfirm(null);
        invalidate();
      },
      onError: () => {
        toast.error("Bulk delete failed");
        setBulkConfirm(null);
      },
    });
  };

  const toggleExpand = (id: number) => setExpandedId(prev => prev === id ? null : id);

  const statCards = [
    { label: "Total", value: stats?.total ?? 0, filter: "all", color: "text-primary", bg: "bg-primary/10", ring: "ring-primary/40" },
    { label: "Active", value: stats?.active ?? 0, filter: "active", color: "text-emerald-400", bg: "bg-emerald-500/10", ring: "ring-emerald-500/40" },
    { label: "Expired", value: stats?.expired ?? 0, filter: "expired", color: "text-rose-400", bg: "bg-rose-500/10", ring: "ring-rose-500/40" },
    { label: "Used", value: stats?.used ?? 0, filter: "used", color: "text-blue-400", bg: "bg-blue-500/10", ring: "ring-blue-500/40" },
  ];

  const showDeleteAllExpired = status === "expired" && (stats?.expired ?? 0) > 0;
  const showDeleteAllUsed = status === "used" && (stats?.used ?? 0) > 0;
  const selectedCount = selectedIds.size;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dynamic QR</h1>
          <p className="text-muted-foreground mt-1">Generate and manage dynamic payment QR codes</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} className="w-full sm:w-auto">
          <Plus className="w-4 h-4 mr-1.5" />Create QR
        </Button>
      </div>

      {/* Provider banner */}
      {hasProvider ? (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-4 py-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="text-sm">
            <span className="text-muted-foreground">QR codes will use </span>
            <span className="font-semibold text-foreground">{PROVIDER_LABELS[activeProvider!] ?? activeProvider}</span>
            <span className="text-muted-foreground"> · VPA: </span>
            <span className="font-mono text-emerald-400">{activeVpa}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="text-sm text-amber-300 flex-1">
            No active payment provider connected.{" "}
            <a href="/merchant/connect" className="underline underline-offset-2 font-medium hover:text-amber-200">
              Connect a provider
            </a>{" "}
            to generate QR codes.
          </div>
        </div>
      )}

      {/* Stats — clickable to filter */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statCards.map(stat => {
          const isActive = status === stat.filter;
          return (
            <button
              key={stat.label}
              type="button"
              onClick={() => { setStatusAndPersist(stat.filter); setPage(1); setSelectedIds(new Set()); }}
              className={`text-left rounded-xl border bg-card transition-all hover:ring-2 focus-visible:outline-none focus-visible:ring-2 ${isActive ? `ring-2 ${stat.ring}` : "hover:ring-border"}`}
            >
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                  </div>
                  <div className={`w-10 h-10 ${stat.bg} rounded-lg flex items-center justify-center`}>
                    <QrCode className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
            <div className="relative flex-1 min-w-[160px] w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search order ID or reference..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <Select value={status} onValueChange={v => { setStatusAndPersist(v); setPage(1); setSelectedIds(new Set()); }}>
                <SelectTrigger className="w-full sm:w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="used">Used</SelectItem>
                </SelectContent>
              </Select>

              {/* Bulk action buttons */}
              {selectedCount > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={openBulkDeleteSelected}
                  className="shrink-0 flex-1 sm:flex-none"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Delete selected ({selectedCount})
                </Button>
              )}
              {showDeleteAllExpired && selectedCount === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openBulkDeleteByStatus("expired")}
                  className="shrink-0 border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 flex-1 sm:flex-none"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Delete all expired ({stats?.expired})
                </Button>
              )}
              {showDeleteAllUsed && selectedCount === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openBulkDeleteByStatus("used")}
                  className="shrink-0 border-blue-500/40 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 flex-1 sm:flex-none"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Delete all used ({stats?.used})
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 pl-4">
                  <Checkbox
                    checked={allSelected}
                    data-state={someSelected && !allSelected ? "indeterminate" : undefined}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                    disabled={rowIds.length === 0}
                  />
                </TableHead>
                <TableHead className="w-8"></TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Expiry Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scans</TableHead>
                <TableHead>Merchant Reference</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !rows.length ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-14">
                    <QrCode className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No QR codes yet</p>
                    <p className="text-xs mt-1 opacity-60">Create your first QR code to accept payments</p>
                  </TableCell>
                </TableRow>
              ) : rows.flatMap((qr: any) => {
                const isExpiredRow = qr.expiresAt ? new Date(qr.expiresAt as string) < new Date() : false;
                const isExpanded = expandedId === qr.id;
                const isChecked = selectedIds.has(qr.id);
                return [
                  <TableRow key={qr.id} className={`cursor-pointer hover:bg-muted/30 ${isChecked ? "bg-muted/20" : ""}`}
                    onClick={() => toggleExpand(qr.id)}>
                    <TableCell className="pl-4 pr-0" onClick={e => toggleSelect(qr.id, e)}>
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => {}}
                        aria-label={`Select QR code ${qr.id}`}
                      />
                    </TableCell>
                    <TableCell className="pl-2 pr-0">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{qr.orderId ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {qr.amount ? `₹${parseFloat(qr.amount).toLocaleString("en-IN")}` : <span className="text-muted-foreground text-xs">Open</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {qr.expiresAt ? (
                        <div>
                          <span className={isExpiredRow ? "text-rose-400" : "text-amber-400"}>
                            {format(new Date(qr.expiresAt as string), "MMM d, HH:mm")}
                          </span>
                        </div>
                      ) : <span className="text-muted-foreground">Never</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {statusBadge(qr.status)}
                        {(qr as any).ekqrOrderId && (
                          <Badge className="text-xs bg-teal-500/15 text-teal-400 border-teal-500/20 hover:bg-teal-500/20 py-0 px-1.5">QR Gateway</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <ScanLine className="w-3.5 h-3.5" />
                        {qr.scanCount ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {(qr as any).merchantReference ?? <span>—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center justify-between gap-2">
                        <span>{format(new Date(qr.createdAt), "MMM d, yyyy HH:mm")}</span>
                        <div className="flex items-center gap-1">
                          <button className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/50"
                            onClick={e => { e.stopPropagation(); setDownloadQr(qr as any); }}
                            title="Full detail view">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button className="text-rose-500 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10"
                            onClick={e => { e.stopPropagation(); handleDelete(qr.id); }}
                            title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>,
                  ...(isExpanded ? [<InlineQrRow key={`expand-${qr.id}`} qr={qr as any} />] : []),
                ];
              })}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Dynamic QR</DialogTitle>
            <p className="text-sm text-muted-foreground">
              UPI payload is auto-generated from your connected provider.
            </p>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {hasProvider ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-3 py-2.5">
                <Link2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="text-xs">
                  <span className="text-muted-foreground">Provider: </span>
                  <span className="font-semibold text-foreground">{PROVIDER_LABELS[activeProvider!] ?? activeProvider}</span>
                  <span className="mx-1 text-muted-foreground">·</span>
                  <span className="font-mono text-emerald-400">{activeVpa}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <p className="text-xs text-rose-300">
                  No provider connected. <a href="/merchant/connect" className="underline">Connect one</a> to create QR codes.
                </p>
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Amount (₹) <span className="text-muted-foreground text-xs">(optional — leave blank for open amount)</span></Label>
                <Input type="number" step="0.01" placeholder="e.g. 999.00" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                {payinStatus?.upigatewayMinAmount != null && payinStatus?.upigatewayMaxAmount != null && (
                  <p className="text-xs text-muted-foreground">
                    Min ₹{payinStatus.upigatewayMinAmount.toLocaleString()} · Max ₹{payinStatus.upigatewayMaxAmount.toLocaleString()}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Order ID <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input placeholder="e.g. ORD-20240001" value={form.orderId}
                  onChange={e => setForm(f => ({ ...f, orderId: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry Time <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input type="datetime-local" value={form.expiresAt}
                  onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Callback URL <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input type="url" placeholder="https://your-site.com/webhook" value={form.callbackUrl}
                  onChange={e => setForm(f => ({ ...f, callbackUrl: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Merchant Reference <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input placeholder="Your internal reference ID" value={form.merchantReference}
                  onChange={e => setForm(f => ({ ...f, merchantReference: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending || !hasProvider}>
              {createMutation.isPending ? "Creating..." : "Generate QR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {downloadQr && <DownloadModal qr={downloadQr} onClose={() => setDownloadQr(null)} />}

      {/* Bulk delete confirmation dialog */}
      {bulkConfirm && (
        <BulkConfirmDialog
          count={bulkConfirm.count}
          label={bulkConfirm.label}
          onConfirm={executeBulkDelete}
          onCancel={() => setBulkConfirm(null)}
          isPending={bulkDeleteMutation.isPending}
        />
      )}

      <RasoConfirmModal
        open={confirmDeleteId !== null}
        onOpenChange={open => { if (!open) setConfirmDeleteId(null); }}
        variant="destructive"
        title="Delete QR Code"
        description="This QR code will be permanently deleted and will stop accepting payments."
        confirmLabel="Delete QR Code"
        onConfirm={doDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
