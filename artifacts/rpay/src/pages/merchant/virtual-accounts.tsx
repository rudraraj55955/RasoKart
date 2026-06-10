import { useState } from "react";
import {
  useListVirtualAccounts,
  useCreateVirtualAccount,
  useUpdateVirtualAccount,
  useDeleteVirtualAccount,
  useGetVirtualAccountTransactions,
  useGetVirtualAccountBalanceHistory,
} from "@workspace/api-client-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Search, Plus, XCircle, CheckCircle2, Trash2, Eye, Download, Building2, TrendingUp, ArrowUpDown, AlertCircle, Pencil, Copy, QrCode, History } from "lucide-react";
import { ExportCsvButton, downloadCsvFromUrl } from "@/components/ui/export-csv-button";
import { toast } from "sonner";
import { format } from "date-fns";
import { QRCodeCanvas } from "qrcode.react";
import { buildUpiId, buildUpiUrl } from "@/lib/upi";

type VaRow = {
  id: number;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  accountHolder: string;
  label?: string | null;
  balance: string;
  totalCollection: string;
  status: string;
  createdAt: string;
  merchantName?: string | null;
};

export default function MerchantVirtualAccounts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);
  const [drawerTab, setDrawerTab] = useState<"transactions" | "history">("transactions");
  const [editVa, setEditVa] = useState<VaRow | null>(null);
  const [editMode, setEditMode] = useState<"balance" | "collection">("balance");
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [form, setForm] = useState({
    accountNumber: "", ifsc: "", bankName: "", accountHolder: "",
  });

  const { data, isLoading } = useListVirtualAccounts({ status: status as any, search, page, limit: 20 });
  const createMutation = useCreateVirtualAccount();
  const updateMutation = useUpdateVirtualAccount();
  const deleteMutation = useDeleteVirtualAccount();

  const { data: historyData, isLoading: historyLoading } = useGetVirtualAccountTransactions(
    selectedVa?.id ?? 0,
    { query: { enabled: !!selectedVa } as any }
  );

  const { data: balHistoryData, isLoading: balHistoryLoading } = useGetVirtualAccountBalanceHistory(
    selectedVa?.id ?? 0,
    undefined,
    { query: { enabled: !!selectedVa } as any }
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/virtual-accounts"] });

  const handleCreate = () => {
    setCreateError(null);
    if (!form.accountNumber || !form.ifsc || !form.bankName || !form.accountHolder) {
      setCreateError("Please fill in all required fields."); return;
    }
    createMutation.mutate(
      { data: { accountNumber: form.accountNumber, ifsc: form.ifsc, bankName: form.bankName, accountHolder: form.accountHolder } },
      {
        onSuccess: () => {
          toast.success("Virtual account created");
          setShowCreate(false);
          setCreateError(null);
          setForm({ accountNumber: "", ifsc: "", bankName: "", accountHolder: "" });
          invalidate();
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? err?.response?.data?.message ?? null;
          if (msg) setCreateError(msg);
          else setCreateError("Failed to create virtual account.");
        },
      }
    );
  };

  const handleToggleStatus = (id: number, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "closed" : "active";
    updateMutation.mutate({ id, data: { status: newStatus as any } }, {
      onSuccess: () => { toast.success(newStatus === "active" ? "Account re-activated" : "Account closed"); invalidate(); },
      onError: () => toast.error("Failed to update account status"),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this virtual account?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Virtual account deleted"); invalidate(); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const openAdjustBalance = (va: VaRow) => {
    setEditVa(va);
    setEditMode("balance");
    setEditValue(va.balance ?? "0.00");
    setEditError(null);
  };

  const openRecordCollection = (va: VaRow) => {
    setEditVa(va);
    setEditMode("collection");
    setEditValue(va.totalCollection ?? "0.00");
    setEditError(null);
  };

  const handleEditSave = () => {
    setEditError(null);
    const val = parseFloat(editValue);
    if (isNaN(val) || val < 0) {
      setEditError(`${editMode === "balance" ? "Balance" : "Total collection"} must be a non-negative number.`);
      return;
    }
    const vaId = editVa!.id;
    let payload: Record<string, string>;
    if (editMode === "balance") {
      const currentTc = parseFloat(editVa!.totalCollection);
      if (val > currentTc) {
        setEditError(`Balance cannot exceed total collection (₹${currentTc.toFixed(2)}).`);
        return;
      }
      payload = { balance: val.toFixed(2) };
    } else {
      const currentBal = parseFloat(editVa!.balance);
      if (val < currentBal) {
        setEditError(`Total collection cannot be set below the current balance (₹${currentBal.toFixed(2)}).`);
        return;
      }
      payload = { totalCollection: val.toFixed(2) };
    }
    updateMutation.mutate(
      { id: vaId, data: payload as any },
      {
        onSuccess: () => {
          toast.success(editMode === "balance" ? "Balance adjusted" : "Collection recorded");
          setEditVa(null);
          invalidate();
          qc.invalidateQueries({ queryKey: [`/api/virtual-accounts/${vaId}/balance-history`] });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? err?.response?.data?.message ?? null;
          setEditError(msg ?? "Failed to update.");
        },
      }
    );
  };

  const exportCsv = () => {
    const rows = data?.data;
    if (!rows?.length) return;
    const headers = ["ID", "Account Number", "Bank", "IFSC", "Account Holder", "Balance", "Total Collection", "Status", "Created"];
    const lines = rows.map(va => [
      String(va.id), va.accountNumber, va.bankName, va.ifsc, va.accountHolder,
      `₹${va.balance}`, `₹${va.totalCollection}`, va.status, va.createdAt,
    ]);
    const csv = [headers, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "virtual-accounts.csv"; a.click();
  };

  const totalBalance = data?.data?.reduce((s, v) => s + parseFloat(v.balance || "0"), 0) ?? 0;
  const totalCollectionSum = data?.data?.reduce((s, v) => s + parseFloat((v as any).totalCollection || "0"), 0) ?? 0;
  const activeCount = data?.data?.filter(v => v.status === "active").length ?? 0;

  const txList = historyData?.data ?? [];
  const txTotalIn = txList.filter(t => t.status === "success").reduce((s, t) => s + parseFloat(t.amount), 0);
  const txCount = txList.length;

  const balList = balHistoryData?.data ?? [];

  const exportBalanceHistoryCsv = async () => {
    if (!selectedVa) return;
    await downloadCsvFromUrl(
      `/api/virtual-accounts/${selectedVa.id}/balance-history/export`,
      `balance-history-va-${selectedVa.id}.csv`
    );
  };

  const handleCopyUpiId = (va: VaRow) => {
    const upiId = buildUpiId(va.accountNumber, va.ifsc);
    navigator.clipboard.writeText(upiId).then(() => toast.success("UPI ID copied to clipboard"));
  };

  const handleDownloadQr = (va: VaRow) => {
    const canvas = document.getElementById(`va-qr-${va.id}`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `va-qr-${va.accountNumber}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Virtual Accounts</h1>
          <p className="text-muted-foreground mt-1">Manage your virtual bank accounts and track payments</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="w-4 h-4 mr-1.5" />Export CSV
          </Button>
          <Button size="sm" onClick={() => { setCreateError(null); setShowCreate(true); }}>
            <Plus className="w-4 h-4 mr-1.5" />Create Account
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Accounts</p>
                <p className="text-2xl font-bold mt-1">{data?.total ?? 0}</p>
              </div>
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Active</p>
                <p className="text-2xl font-bold mt-1 text-emerald-400">{activeCount}</p>
              </div>
              <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Balance</p>
                <p className="text-2xl font-bold mt-1">₹{totalBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                <ArrowUpDown className="w-5 h-5 text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search account number, holder..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Holder</TableHead>
                <TableHead>Bank Name</TableHead>
                <TableHead>Account Number</TableHead>
                <TableHead>IFSC</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Current Balance</TableHead>
                <TableHead>Total Collection</TableHead>
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
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No virtual accounts yet</p>
                    <p className="text-xs mt-1 opacity-60">Create your first virtual account to get started</p>
                  </TableCell>
                </TableRow>
              ) : data.data.map(va => (
                <TableRow key={va.id} className="cursor-pointer hover:bg-muted/30" onClick={() => { setSelectedVa(va as any); setDrawerTab("transactions"); }}>
                  <TableCell className="text-sm font-medium">{va.accountHolder}</TableCell>
                  <TableCell className="text-sm">{va.bankName}</TableCell>
                  <TableCell className="font-mono text-xs">{va.accountNumber}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{va.ifsc}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <Badge variant={va.status === "active" ? "default" : "secondary"} className="text-xs">
                      {va.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm font-semibold text-emerald-400">
                    ₹{parseFloat(va.balance || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-blue-400">
                    ₹{parseFloat((va as any).totalCollection || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="View Transactions"
                        onClick={() => { setSelectedVa(va as any); setDrawerTab("transactions"); }}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                        title="Balance History" onClick={() => { setSelectedVa(va as any); setDrawerTab("history"); }}>
                        <History className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
                        title="Adjust Balance" onClick={() => openAdjustBalance(va as any)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                        title="Record Manual Collection" onClick={() => openRecordCollection(va as any)}>
                        <TrendingUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost"
                        className={va.status === "active"
                          ? "text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 h-8 text-xs"
                          : "text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 h-8 text-xs"}
                        onClick={() => handleToggleStatus(va.id, va.status)}
                        title={va.status === "active" ? "Close account" : "Re-activate account"}>
                        {va.status === "active"
                          ? <><XCircle className="w-3.5 h-3.5 mr-1" />Close</>
                          : <><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Activate</>}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:text-rose-400"
                        onClick={() => handleDelete(va.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
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
      <Dialog open={showCreate} onOpenChange={v => { setShowCreate(v); if (!v) setCreateError(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Virtual Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {createError && (
              <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-400">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{createError}</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Account Holder Name <span className="text-rose-400">*</span></Label>
                <Input placeholder="e.g. TechMart Pvt Ltd" value={form.accountHolder}
                  onChange={e => setForm(f => ({ ...f, accountHolder: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Bank Name <span className="text-rose-400">*</span></Label>
                <Input placeholder="e.g. HDFC Bank" value={form.bankName}
                  onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>IFSC Code <span className="text-rose-400">*</span></Label>
                <Input placeholder="e.g. HDFC0001234" value={form.ifsc}
                  onChange={e => setForm(f => ({ ...f, ifsc: e.target.value.toUpperCase() }))} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Account Number <span className="text-rose-400">*</span></Label>
                <Input placeholder="e.g. 9876543210001234" value={form.accountNumber}
                  onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust Balance / Record Collection Dialog */}
      <Dialog open={!!editVa} onOpenChange={v => { if (!v) setEditVa(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editMode === "balance" ? "Adjust Current Balance" : "Record Manual Collection"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editError && (
              <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-400">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{editError}</span>
              </div>
            )}
            {editVa && (
              <p className="text-sm text-muted-foreground">
                {editVa.accountHolder} · <span className="font-mono">{editVa.accountNumber}</span>
              </p>
            )}
            {editVa && editMode === "balance" && (
              <div className="rounded-md bg-violet-500/10 border border-violet-500/20 px-3 py-2 text-xs text-violet-300">
                Sets the available balance. Must be between ₹0.00 and the total collection of{" "}
                <span className="font-semibold font-mono">₹{parseFloat(editVa.totalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>.
              </div>
            )}
            {editVa && editMode === "collection" && (
              <div className="rounded-md bg-blue-500/10 border border-blue-500/20 px-3 py-2 text-xs text-blue-300">
                Records cumulative funds received. Must be ≥ the current balance of{" "}
                <span className="font-semibold font-mono">₹{parseFloat(editVa.balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>.
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{editMode === "balance" ? "New Balance (₹)" : "New Total Collection (₹)"}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                autoFocus
              />
              {editMode === "collection" && editVa && editValue !== "" && !isNaN(parseFloat(editValue)) && parseFloat(editValue) < parseFloat(editVa.balance) && (
                <p className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  New total (₹{parseFloat(editValue).toLocaleString("en-IN", { minimumFractionDigits: 2 })}) is below the current balance of ₹{parseFloat(editVa.balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })} — this will be rejected.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditVa(null)}>Cancel</Button>
            {(() => {
              const val = parseFloat(editValue);
              const invalid = isNaN(val) || val < 0;
              const balanceExceedsTotal = editMode === "balance" && !invalid && !!editVa && val > parseFloat(editVa.totalCollection);
              const collectionBelowBalance = editMode === "collection" && !invalid && !!editVa && val < parseFloat(editVa.balance);
              const saveDisabled = updateMutation.isPending || balanceExceedsTotal || collectionBelowBalance;
              const saveTitle = balanceExceedsTotal
                ? `Balance cannot exceed total collection (₹${parseFloat(editVa!.totalCollection).toFixed(2)})`
                : collectionBelowBalance
                ? `Total collection cannot be below current balance (₹${parseFloat(editVa!.balance).toFixed(2)})`
                : undefined;
              return (
                <Button onClick={handleEditSave} disabled={saveDisabled} title={saveTitle} aria-label={saveTitle}>
                  {updateMutation.isPending ? "Saving..." : editMode === "balance" ? "Adjust Balance" : "Record Collection"}
                </Button>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Drawer */}
      <Sheet open={!!selectedVa} onOpenChange={v => { if (!v) setSelectedVa(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Virtual Account Detail</SheetTitle>
            {selectedVa && (
              <div className="text-sm text-muted-foreground space-y-0.5">
                <p className="font-medium text-foreground">{selectedVa.accountHolder}</p>
                <p>{selectedVa.accountNumber} · {selectedVa.bankName} · {selectedVa.ifsc}</p>
              </div>
            )}
          </SheetHeader>

          {/* Mini stats */}
          {selectedVa && (
            <div className="grid grid-cols-3 gap-3 mb-5">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Current Balance</p>
                  <p className="text-lg font-bold text-emerald-400 mt-1">
                    ₹{parseFloat(selectedVa.balance || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Collected</p>
                  <p className="text-lg font-bold text-blue-400 mt-1">
                    ₹{parseFloat(selectedVa.totalCollection || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Transactions</p>
                  <p className="text-lg font-bold mt-1">{historyLoading ? "—" : txCount}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* UPI QR Code */}
          {selectedVa && (
            <Card className="mb-5 border-primary/20 bg-primary/5">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-5">
                  <div className="shrink-0 p-2 bg-white rounded-lg">
                    <QRCodeCanvas
                      id={`va-qr-${selectedVa.id}`}
                      value={buildUpiUrl(selectedVa.accountNumber, selectedVa.ifsc, selectedVa.accountHolder)}
                      size={120}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <QrCode className="w-4 h-4 text-primary" />
                      <p className="text-sm font-semibold">UPI Payment QR</p>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Scan with any UPI app to pay directly into this virtual account.
                    </p>
                    <div className="bg-muted/60 rounded-md px-3 py-2 mb-3">
                      <p className="text-xs text-muted-foreground mb-0.5">UPI ID</p>
                      <p className="font-mono text-sm font-medium break-all">
                        {buildUpiId(selectedVa.accountNumber, selectedVa.ifsc)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                        onClick={() => handleCopyUpiId(selectedVa)}>
                        <Copy className="w-3.5 h-3.5" />
                        Copy UPI ID
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                        onClick={() => handleDownloadQr(selectedVa)}>
                        <Download className="w-3.5 h-3.5" />
                        Download QR
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabs */}
          <div className="flex gap-1 mb-4 border-b border-border">
            <button
              onClick={() => setDrawerTab("transactions")}
              className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors ${
                drawerTab === "transactions"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Transaction History
            </button>
            <button
              onClick={() => setDrawerTab("history")}
              className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors flex items-center gap-1.5 ${
                drawerTab === "history"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <History className="w-3 h-3" />
              Balance Changes
              {balList.length > 0 && (
                <span className="ml-1 bg-amber-500/20 text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {balHistoryData?.total ?? balList.length}
                </span>
              )}
            </button>
          </div>

          {drawerTab === "transactions" ? (
            historyLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
                ))}
              </div>
            ) : !txList.length ? (
              <div className="text-center text-muted-foreground py-12">
                <p className="text-sm">No transactions found for this account</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>UTR</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txList.map(tx => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-mono text-xs">#{tx.id}</TableCell>
                      <TableCell className="font-mono text-sm font-semibold">
                        ₹{parseFloat(tx.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{tx.type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{tx.utr ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={tx.status === "success" ? "default" : tx.status === "failed" ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {tx.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(tx.createdAt), "MMM d, yyyy HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : (
            balHistoryLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted/50 rounded animate-pulse" />
                ))}
              </div>
            ) : !balList.length ? (
              <div className="text-center text-muted-foreground py-12">
                <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No balance changes recorded yet</p>
                <p className="text-xs mt-1 opacity-60">Manual balance edits will appear here</p>
              </div>
            ) : (() => {
              const chartData = [...balList]
                .filter(e => e.newBalance != null || e.newTotalCollection != null)
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                .map(e => ({
                  time: format(new Date(e.createdAt), "MMM d HH:mm"),
                  balance: e.newBalance != null ? parseFloat(e.newBalance) : undefined,
                  totalCollection: e.newTotalCollection != null ? parseFloat(e.newTotalCollection) : undefined,
                }));
              return (
                <div className="space-y-4">
                  <div className="flex justify-end">
                    <ExportCsvButton label="Export CSV" onExport={exportBalanceHistoryCsv} />
                  </div>
                  {chartData.length >= 2 && (
                    <Card className="border-border bg-muted/10">
                      <CardContent className="pt-4 pb-3 px-3">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">Balance &amp; Collection Over Time</p>
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="inline-block w-3 h-0.5 rounded bg-emerald-400" />
                              Balance
                            </span>
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="inline-block w-3 h-0.5 rounded bg-blue-400" />
                              Total Collection
                            </span>
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={160}>
                          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis
                              dataKey="time"
                              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                              tickLine={false}
                              axisLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={v => `₹${v.toLocaleString("en-IN")}`}
                              width={72}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "8px",
                                fontSize: "12px",
                              }}
                              formatter={(value: number, name: string) => [
                                `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
                                name === "balance" ? "Balance" : "Total Collection",
                              ]}
                              labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}
                            />
                            <Line
                              type="monotone"
                              dataKey="balance"
                              stroke="#34d399"
                              strokeWidth={2}
                              dot={{ fill: "#34d399", r: 3, strokeWidth: 0 }}
                              activeDot={{ r: 5, fill: "#34d399" }}
                              connectNulls
                            />
                            <Line
                              type="monotone"
                              dataKey="totalCollection"
                              stroke="#60a5fa"
                              strokeWidth={2}
                              dot={{ fill: "#60a5fa", r: 3, strokeWidth: 0 }}
                              activeDot={{ r: 5, fill: "#60a5fa" }}
                              connectNulls
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}
                  {(() => {
                    const lastBalance = [...chartData].reverse().find(p => p.balance !== undefined)?.balance
                      ?? parseFloat(selectedVa?.balance ?? "0");
                    const lastCollection = [...chartData].reverse().find(p => p.totalCollection !== undefined)?.totalCollection
                      ?? parseFloat(selectedVa?.totalCollection ?? "0");
                    const totalCollected = isNaN(lastCollection) ? 0 : lastCollection;
                    const netBalance = isNaN(lastBalance) ? 0 : lastBalance;
                    const impliedSettlements = totalCollected - netBalance;
                    const fmt = (v: number) =>
                      `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                    return (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-center">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Total Collected</p>
                          <p className="text-sm font-semibold font-mono text-blue-400">{fmt(totalCollected)}</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-center">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Net Balance</p>
                          <p className="text-sm font-semibold font-mono text-emerald-400">{fmt(netBalance)}</p>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-center">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Implied Settlements</p>
                          <p className={`text-sm font-semibold font-mono ${impliedSettlements > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                            {fmt(impliedSettlements)}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="space-y-2">
                    {balList.map((entry: (typeof balList)[number]) => (
                      <div key={entry.id} className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${entry.changedByRole === "admin" ? "bg-violet-400" : "bg-blue-400"}`} />
                            <span className="text-sm font-medium">{entry.changedByName}</span>
                            <Badge variant="outline" className="text-[10px] capitalize px-1.5">
                              {entry.changedByRole}
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(entry.createdAt), "MMM d, yyyy HH:mm")}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          {entry.oldBalance != null && entry.newBalance != null && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground w-28 shrink-0">Balance</span>
                              <span className="font-mono text-rose-400">
                                ₹{parseFloat(entry.oldBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="font-mono text-emerald-400">
                                ₹{parseFloat(entry.newBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          )}
                          {entry.oldTotalCollection != null && entry.newTotalCollection != null && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground w-28 shrink-0">Total Collection</span>
                              <span className="font-mono text-rose-400">
                                ₹{parseFloat(entry.oldTotalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="font-mono text-emerald-400">
                                ₹{parseFloat(entry.newTotalCollection).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
