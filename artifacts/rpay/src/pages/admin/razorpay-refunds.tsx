import { useState } from "react";
import { format } from "date-fns";
import { useListRazorpayRefunds } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, RefreshCw, RotateCcw, AlertCircle } from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

function statusColor(status?: string) {
  if (!status) return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  switch (status.toUpperCase()) {
    case "PROCESSED": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "FAILED":    return "bg-rose-500/10 text-rose-400 border-rose-500/30";
    case "PENDING":   return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    case "CANCELLED": return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
    default:          return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  }
}

interface InitiateForm {
  razorpayPaymentId: string;
  orderId: string;
  amount: string;
  speed: "normal" | "optimum";
  notes: string;
}

const EMPTY_FORM: InitiateForm = {
  razorpayPaymentId: "",
  orderId: "",
  amount: "",
  speed: "normal",
  notes: "",
};

export default function AdminRazorpayRefunds() {
  const [page, setPage] = useState(1);
  const [showInitiate, setShowInitiate] = useState(false);
  const [form, setForm] = useState<InitiateForm>(EMPTY_FORM);
  const [initiating, setInitiating] = useState(false);
  const [initiateError, setInitiateError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [statusResults, setStatusResults] = useState<Record<string, string>>({});

  const { data, isLoading, isError, refetch } = useListRazorpayRefunds(
    { page, limit: 20 },
    { request: { headers: authHeader() } },
  );

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const handleInitiate = async () => {
    setInitiateError(null);
    if (!form.razorpayPaymentId.trim()) {
      setInitiateError("Razorpay Payment ID is required");
      return;
    }
    const orderIdNum = parseInt(form.orderId, 10);
    if (!form.orderId || isNaN(orderIdNum) || orderIdNum <= 0) {
      setInitiateError("A valid Order ID (number) is required");
      return;
    }

    const body: Record<string, unknown> = {
      razorpayPaymentId: form.razorpayPaymentId.trim(),
      orderId: orderIdNum,
      speed: form.speed,
    };
    if (form.amount) {
      const paise = Math.round(parseFloat(form.amount) * 100);
      if (isNaN(paise) || paise <= 0) {
        setInitiateError("Amount must be a positive number in INR");
        return;
      }
      body.amount = paise;
    }
    if (form.notes.trim()) body.notes = form.notes.trim();

    setInitiating(true);
    try {
      const resp = await fetch("/api/admin/razorpay/refunds", {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setInitiateError(json.error ?? `Error ${resp.status}`);
        return;
      }
      setShowInitiate(false);
      setForm(EMPTY_FORM);
      refetch();
    } catch {
      setInitiateError("Network error — please try again");
    } finally {
      setInitiating(false);
    }
  };

  const handleRefreshStatus = async (razorpayRefundId: string) => {
    setRefreshingId(razorpayRefundId);
    try {
      const resp = await fetch(`/api/admin/razorpay/refunds/${razorpayRefundId}/status`, {
        headers: authHeader(),
      });
      const json = await resp.json();
      setStatusResults(prev => ({ ...prev, [razorpayRefundId]: json.status ?? "unknown" }));
      refetch();
    } catch {
      setStatusResults(prev => ({ ...prev, [razorpayRefundId]: "error" }));
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-indigo-400" />
            Razorpay Refunds
          </h1>
          <p className="text-sm text-muted-foreground mt-1">View and initiate Razorpay payment refunds</p>
        </div>
        <Button size="sm" onClick={() => { setShowInitiate(true); setInitiateError(null); setForm(EMPTY_FORM); }}>
          Initiate Refund
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {isLoading ? "Loading…" : `${total.toLocaleString()} refund${total !== 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-sm text-destructive">Failed to load refunds</div>
          ) : !rows.length ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No refunds found</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Refund ID</TableHead>
                    <TableHead className="text-xs">Payment ID</TableHead>
                    <TableHead className="text-xs">Order ID</TableHead>
                    <TableHead className="text-xs">Amount</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Speed</TableHead>
                    <TableHead className="text-xs">Initiated By</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                    <TableHead className="text-xs">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => {
                    const liveStatus = statusResults[row.razorpayRefundId ?? ""];
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs max-w-[130px] truncate" title={row.razorpayRefundId ?? undefined}>
                          {row.razorpayRefundId ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[130px] truncate" title={row.razorpayPaymentId ?? undefined}>
                          {row.razorpayPaymentId ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">{row.orderId ?? "—"}</TableCell>
                        <TableCell className="text-xs font-mono">
                          ₹{Number(row.amount ?? 0).toLocaleString()} {row.currency ?? "INR"}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] h-5 ${statusColor(liveStatus ?? row.status)}`}>
                            {liveStatus ?? row.status ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs capitalize">{row.speed ?? "normal"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.initiatedByEmail ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.createdAt ? format(new Date(row.createdAt), "MMM d, yyyy HH:mm") : "—"}
                        </TableCell>
                        <TableCell>
                          {row.razorpayRefundId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              disabled={refreshingId === row.razorpayRefundId}
                              onClick={() => handleRefreshStatus(row.razorpayRefundId!)}
                            >
                              {refreshingId === row.razorpayRefundId
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <RefreshCw className="w-3 h-3" />}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog open={showInitiate} onOpenChange={open => { if (!initiating) setShowInitiate(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Initiate Razorpay Refund</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {initiateError && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {initiateError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Razorpay Payment ID <span className="text-destructive">*</span></Label>
              <Input
                placeholder="pay_XXXXXXXXXXXXXXXX"
                className="h-8 text-sm font-mono"
                value={form.razorpayPaymentId}
                onChange={e => setForm(f => ({ ...f, razorpayPaymentId: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Internal Order ID <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. 42"
                className="h-8 text-sm"
                type="number"
                value={form.orderId}
                onChange={e => setForm(f => ({ ...f, orderId: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Amount in INR (leave blank for full refund)</Label>
              <Input
                placeholder="e.g. 250.00"
                className="h-8 text-sm"
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Speed</Label>
              <Select value={form.speed} onValueChange={v => setForm(f => ({ ...f, speed: v as "normal" | "optimum" }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="optimum">Optimum (instant if supported)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                placeholder="Reason for refund…"
                className="text-sm resize-none"
                rows={2}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowInitiate(false)} disabled={initiating}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleInitiate} disabled={initiating}>
              {initiating ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Initiating…</> : "Initiate Refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
