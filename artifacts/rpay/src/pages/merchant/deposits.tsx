import { useState } from "react";
import {
  useListTransactions,
  useSimulatePayment,
  useListQrCodes,
  useListVirtualAccounts,
  useGetDashboardStats,
  useListMerchantConnections,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  ArrowDownLeft,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  Plus,
  QrCode,
  Building2,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { ExportCsvButton } from "@/components/ui/export-csv-button";

function buildAndDownloadCsv(data: any[]) {
  if (!data.length) return;
  const rows = [["ID", "Amount", "Currency", "UTR", "Reference", "Status", "Description", "Source", "Date"]];
  data.forEach(t => rows.push([
    String(t.id),
    String(t.amount),
    t.currency,
    t.utr,
    t.referenceId ?? "",
    t.status,
    t.description ?? "",
    t.metadata ? (() => { try { const m = JSON.parse(t.metadata); return `${m.sourceType?.toUpperCase() ?? ""} #${m.sourceId ?? ""}`; } catch { return ""; } })() : "",
    t.createdAt,
  ]));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `deposits-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

export default function MerchantDeposits() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  // Simulate payment dialog state
  const [showSimulate, setShowSimulate] = useState(false);
  const [simSourceType, setSimSourceType] = useState<"qr" | "va">("qr");
  const [simSourceId, setSimSourceId] = useState("");
  const [simAmount, setSimAmount] = useState("");
  const [simUtr, setSimUtr] = useState("");
  const [simExpected, setSimExpected] = useState<"success" | "failed" | "pending">("success");
  const [simProvider, setSimProvider] = useState("");

  const { data, isLoading } = useListTransactions({
    type: "deposit",
    status: status === "all" ? undefined : (status as any),
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: 20,
  });

  const { data: stats } = useGetDashboardStats();
  const { data: qrList } = useListQrCodes({ status: "active", limit: 100 });
  const { data: vaList } = useListVirtualAccounts({ status: "active", limit: 100 });
  const { data: connectionsRaw } = useListMerchantConnections();
  const activeConnections = Array.isArray(connectionsRaw) ? connectionsRaw.filter(c => c.isActive) : [];

  const { mutate: simulate, isPending: simulating } = useSimulatePayment({
    mutation: {
      onSuccess: () => {
        toast.success("Payment simulated successfully");
        setShowSimulate(false);
        setSimAmount("");
        setSimUtr("");
        setSimSourceId("");
        queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      },
      onError: (err: any) => {
        toast.error(err?.message ?? "Failed to simulate payment");
      },
    },
  });

  const handleSimulate = () => {
    if (!simSourceId) { toast.error("Select a source"); return; }
    if (!simAmount || Number(simAmount) <= 0) { toast.error("Enter a valid amount"); return; }
    simulate({
      data: {
        sourceType: simSourceType,
        sourceId: parseInt(simSourceId),
        amount: Number(simAmount),
        utr: simUtr || undefined,
        provider: simProvider || undefined,
        expectedStatus: simExpected,
      },
    });
  };

  // Stats derived from all data
  const successCount = data?.data?.filter(t => t.status === "success").length ?? 0;
  const pendingCount = data?.data?.filter(t => t.status === "pending").length ?? 0;
  const failedCount = data?.data?.filter(t => t.status === "failed").length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deposits</h1>
          <p className="text-muted-foreground mt-1">All incoming payments via QR and Virtual Accounts</p>
        </div>
        <div className="flex gap-2">
          <ExportCsvButton
            onExport={() => buildAndDownloadCsv(data?.data ?? [])}
            disabled={!data?.data?.length}
          />
          <Button size="sm" onClick={() => setShowSimulate(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Simulate Payment
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Today's Deposits</p>
                <p className="text-lg font-bold font-mono">₹{(stats?.todayDepositAmount ?? 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{stats?.todayDeposits ?? 0} payments</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Deposits</p>
                <p className="text-lg font-bold font-mono">₹{(stats?.totalDeposits ?? 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{data?.total ?? 0} transactions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-lg font-bold">{pendingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Successful</p>
                <p className="text-lg font-bold">{successCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by UTR or reference..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              className="w-[160px]"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              placeholder="From date"
            />
            <Input
              type="date"
              className="w-[160px]"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
              placeholder="To date"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>UTR</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data?.data?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    <div className="flex flex-col items-center gap-3">
                      <ArrowDownLeft className="w-8 h-8 text-muted-foreground/40" />
                      <p>No deposit transactions found</p>
                      <Button size="sm" variant="outline" onClick={() => setShowSimulate(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Simulate your first payment
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : data.data.map(t => {
                let sourceInfo = "";
                try {
                  const m = JSON.parse(t.metadata ?? "{}");
                  if (m.sourceType) sourceInfo = `${m.sourceType === "qr" ? "QR" : "VA"} #${m.sourceId}`;
                } catch {}
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">#{t.id}</TableCell>
                    <TableCell className="font-mono font-semibold text-emerald-400">
                      ₹{Number(t.amount).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.utr}</TableCell>
                    <TableCell>
                      {sourceInfo ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          {sourceInfo.startsWith("QR") ? <QrCode className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
                          {sourceInfo}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {t.description ?? "—"}
                    </TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(t.createdAt), "MMM d, yyyy HH:mm")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{data.total} total deposits</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Simulate Payment Dialog */}
      <Dialog open={showSimulate} onOpenChange={setShowSimulate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Simulate Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Payment Source</Label>
              <Select value={simSourceType} onValueChange={v => { setSimSourceType(v as "qr" | "va"); setSimSourceId(""); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qr">
                    <span className="flex items-center gap-2"><QrCode className="w-4 h-4" /> QR Code</span>
                  </SelectItem>
                  <SelectItem value="va">
                    <span className="flex items-center gap-2"><Building2 className="w-4 h-4" /> Virtual Account</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{simSourceType === "qr" ? "QR Code" : "Virtual Account"}</Label>
              <Select value={simSourceId} onValueChange={setSimSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder={`Select ${simSourceType === "qr" ? "QR code" : "virtual account"}`} />
                </SelectTrigger>
                <SelectContent>
                  {simSourceType === "qr" ? (
                    qrList?.data?.length ? (
                      qrList.data.map(qr => (
                        <SelectItem key={qr.id} value={String(qr.id)}>
                          {qr.label ?? `QR #${qr.id}`} — {qr.type}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>No active QR codes</SelectItem>
                    )
                  ) : (
                    vaList?.data?.length ? (
                      vaList.data.map(va => (
                        <SelectItem key={va.id} value={String(va.id)}>
                          {va.label ?? va.accountNumber} — {va.bankName}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>No active virtual accounts</SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Amount (₹)</Label>
              <Input
                type="number"
                placeholder="e.g. 5000"
                min="1"
                value={simAmount}
                onChange={e => setSimAmount(e.target.value)}
              />
            </div>

            {activeConnections.length > 0 && (
              <div className="space-y-2">
                <Label>Provider <span className="text-muted-foreground text-xs">(optional — tracks usage toward monthly limit)</span></Label>
                <Select value={simProvider} onValueChange={setSimProvider}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {activeConnections.map(c => (
                      <SelectItem key={c.id} value={c.provider}>{c.provider}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>UTR <span className="text-muted-foreground text-xs">(optional — auto-generated if blank)</span></Label>
              <Input
                placeholder="e.g. HDFC000123456789"
                value={simUtr}
                onChange={e => setSimUtr(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Expected Outcome <span className="text-muted-foreground text-xs">(demo only)</span></Label>
              <Select value={simExpected} onValueChange={v => setSimExpected(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="success">
                    <span className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /> Success</span>
                  </SelectItem>
                  <SelectItem value="failed">
                    <span className="flex items-center gap-2"><XCircle className="w-4 h-4 text-rose-500" /> Failed</span>
                  </SelectItem>
                  <SelectItem value="pending">
                    <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" /> Pending</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSimulate(false)}>Cancel</Button>
            <Button onClick={handleSimulate} disabled={simulating || !simSourceId || !simAmount}>
              {simulating ? "Simulating..." : "Simulate Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
