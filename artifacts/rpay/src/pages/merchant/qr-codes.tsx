import { useState, useRef, useCallback } from "react";
import {
  useListQrCodes,
  useCreateQrCode,
  useUpdateQrCode,
  useDeleteQrCode,
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
import { Search, Plus, Trash2, ToggleLeft, ToggleRight, Download, QrCode, Eye } from "lucide-react";
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
  expiresAt?: string | null;
  status: string;
  createdAt: string;
};

function QrPreviewModal({ qr, onClose }: { qr: QrRow; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleDownload = useCallback(() => {
    const canvas = document.querySelector("#qr-download-canvas canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `qr-${qr.id}-${qr.label ?? "code"}.png`;
    a.click();
    toast.success("QR code downloaded");
  }, [qr]);

  const isExpired = qr.expiresAt ? new Date(qr.expiresAt) < new Date() : false;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>QR Code #{qr.id}</DialogTitle>
          <p className="text-sm text-muted-foreground">{qr.label ?? qr.type}</p>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div
            id="qr-download-canvas"
            className="bg-white p-4 rounded-xl"
          >
            <QRCodeCanvas
              value={qr.payload}
              size={200}
              level="H"
              includeMargin
            />
          </div>
          <div className="w-full space-y-2 text-sm">
            {qr.amount && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">₹{parseFloat(qr.amount).toLocaleString("en-IN")}</span>
              </div>
            )}
            {qr.orderId && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order ID</span>
                <span className="font-mono text-xs">{qr.orderId}</span>
              </div>
            )}
            {qr.expiresAt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expires</span>
                <span className={isExpired ? "text-rose-400" : "text-amber-400"}>
                  {isExpired ? "Expired" : formatDistanceToNow(new Date(qr.expiresAt), { addSuffix: true })}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={qr.status === "active" ? "default" : "secondary"} className="text-xs">
                {qr.status}
              </Badge>
            </div>
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
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [showCreate, setShowCreate] = useState(false);
  const [previewQr, setPreviewQr] = useState<QrRow | null>(null);

  const [form, setForm] = useState({
    type: "dynamic" as "dynamic" | "static",
    label: "",
    payload: "",
    amount: "",
    orderId: "",
    expiresAt: "",
  });

  const { data, isLoading } = useListQrCodes({ type: type as any, status: status as any, search, page, limit: 20 });
  const createMutation = useCreateQrCode();
  const updateMutation = useUpdateQrCode();
  const deleteMutation = useDeleteQrCode();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["list-qr-codes"] });

  const handleCreate = () => {
    if (!form.payload) { toast.error("Payload / UPI ID is required"); return; }
    createMutation.mutate(
      {
        data: {
          type: form.type,
          label: form.label || null,
          payload: form.payload,
          amount: form.type === "static" && form.amount ? form.amount : null,
          orderId: form.orderId || null,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        },
      },
      {
        onSuccess: () => {
          toast.success("QR code created"); setShowCreate(false);
          setForm({ type: "dynamic", label: "", payload: "", amount: "", orderId: "", expiresAt: "" });
          invalidate();
        },
        onError: () => toast.error("Failed to create QR code"),
      }
    );
  };

  const handleToggle = (id: number, currentStatus: string) => {
    if (currentStatus === "expired") { toast.error("Cannot toggle an expired QR code"); return; }
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    updateMutation.mutate({ id, data: { status: newStatus as any } }, {
      onSuccess: () => { toast.success(`QR ${newStatus}`); invalidate(); },
      onError: () => toast.error("Failed to update"),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this QR code?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("QR code deleted"); invalidate(); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const exportCsv = () => {
    if (!data?.data?.length) return;
    const headers = ["ID", "Type", "Label", "Amount", "Order ID", "Expires At", "Status", "Created"];
    const lines = data.data.map(qr => [
      String(qr.id), qr.type, qr.label ?? "", qr.amount ?? "", qr.orderId ?? "",
      qr.expiresAt ? format(new Date(qr.expiresAt), "yyyy-MM-dd HH:mm") : "",
      qr.status, qr.createdAt,
    ]);
    const csv = [headers, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "qr-codes.csv"; a.click();
  };

  const activeCount = data?.data?.filter(q => q.status === "active").length ?? 0;
  const expiredCount = data?.data?.filter(q => q.status === "expired").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dynamic QR</h1>
          <p className="text-muted-foreground mt-1">Generate and manage payment QR codes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="w-4 h-4 mr-1.5" />Export CSV
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1.5" />Create QR
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total QR Codes", value: data?.total ?? 0, color: "text-primary", bg: "bg-primary/10" },
          { label: "Active", value: activeCount, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          { label: "Expired", value: expiredCount, color: "text-rose-400", bg: "bg-rose-500/10" },
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
              <Input className="pl-9" placeholder="Search label, order ID..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={type} onValueChange={v => { setType(v); setPage(1); }}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="dynamic">Dynamic</SelectItem>
                <SelectItem value="static">Static</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Order ID</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data?.data?.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-14">
                    <QrCode className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No QR codes yet</p>
                    <p className="text-xs mt-1 opacity-60">Create your first QR code to accept payments</p>
                  </TableCell>
                </TableRow>
              ) : data.data.map(qr => {
                const isExpired = qr.expiresAt ? new Date(qr.expiresAt) < new Date() : false;
                return (
                  <TableRow key={qr.id}>
                    <TableCell className="font-mono text-xs">#{qr.id}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">{qr.type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{qr.label ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {qr.amount ? `₹${parseFloat(qr.amount).toLocaleString("en-IN")}` : <span className="text-muted-foreground text-xs">Dynamic</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{qr.orderId ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {qr.expiresAt ? (
                        <span className={isExpired ? "text-rose-400" : "text-amber-400"}>
                          {isExpired ? "Expired" : formatDistanceToNow(new Date(qr.expiresAt), { addSuffix: true })}
                        </span>
                      ) : <span className="text-muted-foreground">Never</span>}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={qr.status === "active" ? "default" : "secondary"}
                        className={`text-xs ${qr.status === "expired" ? "bg-rose-500/15 text-rose-400 border-rose-500/20" : ""}`}
                      >
                        {qr.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Preview & Download"
                          onClick={() => setPreviewQr(qr as any)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Toggle status"
                          onClick={() => handleToggle(qr.id, qr.status)}
                          disabled={qr.status === "expired"}>
                          {qr.status === "active"
                            ? <ToggleRight className="w-4 h-4 text-emerald-500" />
                            : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:text-rose-400"
                          onClick={() => handleDelete(qr.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
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
            <DialogTitle>Create QR Code</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>QR Type</Label>
                <Select value={form.type} onValueChange={(v: any) => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dynamic">Dynamic (variable amount)</SelectItem>
                    <SelectItem value="static">Static (fixed amount)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>UPI / Payload <span className="text-rose-400">*</span></Label>
                <Input placeholder="e.g. upi://pay?pa=merchant@upi&pn=Name" value={form.payload}
                  onChange={e => setForm(f => ({ ...f, payload: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Label</Label>
                <Input placeholder="e.g. Checkout QR, Order #123" value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
              </div>
              {form.type === "static" && (
                <div className="space-y-1.5">
                  <Label>Fixed Amount (₹)</Label>
                  <Input type="number" step="0.01" placeholder="e.g. 999.00" value={form.amount}
                    onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Order ID</Label>
                <Input placeholder="Optional order ref" value={form.orderId}
                  onChange={e => setForm(f => ({ ...f, orderId: e.target.value }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Expiry Date & Time</Label>
                <Input type="datetime-local" value={form.expiresAt}
                  onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Leave blank for no expiry</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create QR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Preview + Download */}
      {previewQr && <QrPreviewModal qr={previewQr} onClose={() => setPreviewQr(null)} />}
    </div>
  );
}
