import { useState } from "react";
import {
  useListVirtualAccounts,
  useCreateVirtualAccount,
  useUpdateVirtualAccount,
  useDeleteVirtualAccount,
  useGetVirtualAccountTransactions,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, Plus, XCircle, CheckCircle2, Trash2, Eye, Download, Building2, TrendingUp, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type VaRow = {
  id: number;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  accountHolder: string;
  label?: string | null;
  balance: string;
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
  const [selectedVa, setSelectedVa] = useState<VaRow | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [form, setForm] = useState({
    accountNumber: "", ifsc: "", bankName: "", accountHolder: "", label: "", balance: "0.00",
  });

  const { data, isLoading } = useListVirtualAccounts({ status: status as any, search, page, limit: 20 });
  const createMutation = useCreateVirtualAccount();
  const updateMutation = useUpdateVirtualAccount();
  const deleteMutation = useDeleteVirtualAccount();

  const { data: historyData, isLoading: historyLoading } = useGetVirtualAccountTransactions(
    selectedVa?.id ?? 0,
    { query: { enabled: showHistory && !!selectedVa } as any }
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/virtual-accounts"] });

  const handleCreate = () => {
    if (!form.accountNumber || !form.ifsc || !form.bankName || !form.accountHolder) {
      toast.error("Fill in all required fields"); return;
    }
    createMutation.mutate(
      { data: { accountNumber: form.accountNumber, ifsc: form.ifsc, bankName: form.bankName, accountHolder: form.accountHolder, label: form.label || null, balance: form.balance } },
      {
        onSuccess: () => {
          toast.success("Virtual account created"); setShowCreate(false);
          setForm({ accountNumber: "", ifsc: "", bankName: "", accountHolder: "", label: "", balance: "0.00" });
          invalidate();
        },
        onError: () => toast.error("Failed to create virtual account"),
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

  const exportCsv = () => {
    const rows = data?.data;
    if (!rows?.length) return;
    const headers = ["ID", "Account Number", "Bank", "IFSC", "Account Holder", "Label", "Balance", "Status", "Created"];
    const lines = rows.map(va => [
      String(va.id), va.accountNumber, va.bankName, va.ifsc, va.accountHolder,
      va.label ?? "", `₹${va.balance}`, va.status, va.createdAt,
    ]);
    const csv = [headers, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "virtual-accounts.csv"; a.click();
  };

  const total = data?.data?.length ?? 0;
  const activeCount = data?.data?.filter(v => v.status === "active").length ?? 0;
  const totalBalance = data?.data?.reduce((s, v) => s + parseFloat(v.balance || "0"), 0) ?? 0;

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
          <Button size="sm" onClick={() => setShowCreate(true)}>
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
                <TableHead>Account Number</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>IFSC</TableHead>
                <TableHead>Account Holder</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
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
                <TableRow key={va.id}>
                  <TableCell className="font-mono text-xs">{va.accountNumber}</TableCell>
                  <TableCell className="text-sm font-medium">{va.bankName}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{va.ifsc}</TableCell>
                  <TableCell className="text-sm">{va.accountHolder}</TableCell>
                  <TableCell className="font-mono text-sm font-semibold text-emerald-400">
                    ₹{parseFloat(va.balance || "0").toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={va.status === "active" ? "default" : "secondary"} className="text-xs">
                      {va.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(va.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Transaction History"
                        onClick={() => { setSelectedVa(va as any); setShowHistory(true); }}>
                        <Eye className="w-4 h-4" />
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
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Virtual Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Account Number <span className="text-rose-400">*</span></Label>
                <Input placeholder="e.g. 9876543210001234" value={form.accountNumber}
                  onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} />
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
                <Label>Account Holder <span className="text-rose-400">*</span></Label>
                <Input placeholder="e.g. TechMart Pvt Ltd" value={form.accountHolder}
                  onChange={e => setForm(f => ({ ...f, accountHolder: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Label</Label>
                <Input placeholder="Optional label" value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Initial Balance (₹)</Label>
                <Input type="number" step="0.01" placeholder="0.00" value={form.balance}
                  onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} />
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

      {/* Transaction History Dialog */}
      <Dialog open={showHistory} onOpenChange={v => { setShowHistory(v); if (!v) setSelectedVa(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transaction History</DialogTitle>
            {selectedVa && (
              <p className="text-sm text-muted-foreground mt-1">
                {selectedVa.accountNumber} · {selectedVa.bankName}
              </p>
            )}
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {historyLoading ? (
              <div className="space-y-2 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
                ))}
              </div>
            ) : !historyData?.data?.length ? (
              <div className="text-center text-muted-foreground py-10">
                <p className="text-sm">No transactions found</p>
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
                  {historyData.data.map(tx => (
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
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
