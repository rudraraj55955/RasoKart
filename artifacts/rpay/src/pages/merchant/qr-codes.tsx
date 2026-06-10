import { useState, useCallback } from "react";
import {
  useListQrCodes,
  useCreateQrCode,
  useDeleteQrCode,
  useListMerchantConnections,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, Plus, Trash2, Download, QrCode, Eye, AlertTriangle, CheckCircle2, Link2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
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
  createdAt: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  phonepe: "PhonePe Business",
  paytm: "Paytm Business",
  bharatpe: "BharatPe",
  yono_sbi: "YONO SBI",
  hdfc_smarthub: "HDFC SmartHub",
  upi_id: "UPI ID",
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
  // Any provider may store a pre-formed VPA directly under the "vpa" key
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

function InlineQrRow({ qr }: { qr: QrRow }) {
  const [copied, setCopied] = useState(false);

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

  return (
    <TableRow className="bg-muted/30 border-t-0">
      <TableCell colSpan={7} className="py-4 px-6">
        <div className="flex gap-6 items-start">
          <div id={`qr-inline-${qr.id}`} className="bg-white p-3 rounded-xl shrink-0">
            <QRCodeCanvas value={qr.payload} size={120} level="H" includeMargin />
          </div>
          <div className="flex-1 min-w-0">
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
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={qr.status === "expired"} className="h-7 text-xs px-3">
                <Download className="w-3.5 h-3.5 mr-1.5" />Download PNG
              </Button>
              <Button size="sm" variant="outline" onClick={handleCopyLink} className="h-7 text-xs px-3">
                <Link2 className="w-3.5 h-3.5 mr-1.5" />{copied ? "Copied!" : "Copy Link"}
              </Button>
            </div>
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

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>QR Code #{qr.id}</DialogTitle>
          <p className="text-sm text-muted-foreground">{qr.orderId ?? qr.merchantReference ?? qr.type}</p>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div id="qr-modal-canvas" className="bg-white p-4 rounded-xl">
            <QRCodeCanvas value={qr.payload} size={200} level="H" includeMargin />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handleDownload} disabled={qr.status === "expired"}>
            <Download className="w-4 h-4 mr-1.5" />Download PNG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MerchantQrCodes() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [downloadQr, setDownloadQr] = useState<QrRow | null>(null);

  const [form, setForm] = useState({
    amount: "",
    orderId: "",
    expiresAt: "",
    callbackUrl: "",
    merchantReference: "",
  });

  const { data, isLoading } = useListQrCodes({ type: "dynamic" as any, status: status as any, search, page, limit: 20 });
  const { data: connections } = useListMerchantConnections();
  const createMutation = useCreateQrCode();
  const deleteMutation = useDeleteQrCode();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/qr-codes"] });

  const activeConnections = (connections ?? []).filter((c: any) => c.isActive);
  const sortedConns = [...activeConnections].sort((a: any) => a.provider === "upi_id" ? -1 : 1);
  let activeVpa: string | null = null;
  let activeProvider: string | null = null;
  for (const conn of sortedConns as any[]) {
    const vpa = deriveVpaFromConn(conn.provider, conn.credentials ?? null);
    if (vpa) { activeVpa = vpa; activeProvider = conn.provider; break; }
  }
  const hasProvider = !!activeVpa;

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
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? "Failed to create QR code";
          toast.error(msg);
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this QR code?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("QR code deleted"); invalidate(); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const toggleExpand = (id: number) => setExpandedId(prev => prev === id ? null : id);

  const activeCount = data?.data?.filter(q => q.status === "active").length ?? 0;
  const expiredCount = data?.data?.filter(q => q.status === "expired").length ?? 0;
  const usedCount = data?.data?.filter(q => q.status === "used").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dynamic QR</h1>
          <p className="text-muted-foreground mt-1">Generate and manage dynamic payment QR codes</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
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

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total", value: data?.total ?? 0, color: "text-primary", bg: "bg-primary/10" },
          { label: "Active", value: activeCount, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Expired", value: expiredCount, color: "text-rose-400", bg: "bg-rose-500/10" },
          { label: "Used", value: usedCount, color: "text-blue-400", bg: "bg-blue-500/10" },
        ].map(stat => (
          <Card key={stat.label}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                </div>
                <div className={`w-10 h-10 ${stat.bg} rounded-lg flex items-center justify-center`}>
                  <QrCode className={`w-5 h-5 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search order ID or reference..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="used">Used</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Expiry Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Merchant Reference</TableHead>
                <TableHead>Created At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data?.data?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-14">
                    <QrCode className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No QR codes yet</p>
                    <p className="text-xs mt-1 opacity-60">Create your first QR code to accept payments</p>
                  </TableCell>
                </TableRow>
              ) : data.data.flatMap(qr => {
                const isExpired = qr.expiresAt ? new Date(qr.expiresAt as string) < new Date() : false;
                const isExpanded = expandedId === qr.id;
                return [
                  <TableRow key={qr.id} className="cursor-pointer hover:bg-muted/30"
                    onClick={() => toggleExpand(qr.id)}>
                    <TableCell className="pl-4 pr-0">
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
                          <span className={isExpired ? "text-rose-400" : "text-amber-400"}>
                            {format(new Date(qr.expiresAt as string), "MMM d, HH:mm")}
                          </span>
                        </div>
                      ) : <span className="text-muted-foreground">Never</span>}
                    </TableCell>
                    <TableCell>{statusBadge(qr.status)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {(qr as any).merchantReference ?? <span>—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center justify-between gap-2">
                        <span>{format(new Date(qr.createdAt), "MMM d, yyyy HH:mm")}</span>
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
                    </TableCell>
                  </TableRow>,
                  ...(isExpanded ? [<InlineQrRow key={`expand-${qr.id}`} qr={qr as any} />] : []),
                ];
              })}
            </TableBody>
          </Table>
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
    </div>
  );
}
