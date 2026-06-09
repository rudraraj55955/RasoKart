import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, Plus, Pencil, Trash2, Download, Eye, Globe, Lock, CreditCard, Building2, QrCode, Smartphone } from "lucide-react";
import { format } from "date-fns";

const ACCOUNT_TYPES = [
  { value: "bank_account",        label: "Bank Account",          icon: Building2 },
  { value: "upi_id",              label: "UPI ID",                icon: Smartphone },
  { value: "qr_code",             label: "QR Code",               icon: QrCode },
  { value: "virtual_account",     label: "Virtual Account",       icon: CreditCard },
  { value: "static_qr",           label: "Static QR",             icon: QrCode },
  { value: "merchant_qr_provider",label: "QR Provider",           icon: CreditCard },
];

const PROVIDERS = ["phonepe", "paytm", "bharatpe", "yono_sbi", "hdfc_smarthub", "upi_id"];

function getToken() { return localStorage.getItem("rasokart_token") ?? ""; }
async function api(method: string, path: string, body?: object) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({ error: "Unknown error" })); throw new Error(e.error ?? "Request failed"); }
  return res.json();
}

function TypeBadge({ type }: { type: string }) {
  const t = ACCOUNT_TYPES.find(t => t.value === type);
  const Icon = t?.icon ?? Building2;
  const colors: Record<string, string> = {
    bank_account: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    upi_id: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    qr_code: "bg-primary/10 text-primary border-primary/20",
    virtual_account: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    static_qr: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    merchant_qr_provider: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${colors[type] ?? "bg-muted/50 text-muted-foreground"}`}>
      <Icon className="w-3 h-3" />
      {t?.label ?? type}
    </span>
  );
}

const EMPTY_FORM = {
  type: "bank_account", label: "", accountHolder: "", accountNumber: "", ifsc: "", bankName: "",
  upiId: "", qrPayload: "", provider: "", isGlobal: true, isActive: true, sortOrder: 0,
};

export default function AdminAccountDetails() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<"create" | "edit" | "delete" | "view" | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data, isLoading } = useQuery({
    queryKey: ["account-details", search, typeFilter, activeFilter, page],
    queryFn: () => api("GET", `/account-details?search=${encodeURIComponent(search)}&type=${typeFilter}&isActive=${activeFilter}&page=${page}&limit=20`),
  });

  const rows: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;

  const createMutation = useMutation({
    mutationFn: (body: object) => api("POST", "/account-details", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["account-details"] }); toast.success("Account detail created"); setDialog(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => api("PUT", `/account-details/${id}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["account-details"] }); toast.success("Account detail updated"); setDialog(null); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api("DELETE", `/account-details/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["account-details"] }); toast.success("Account detail deleted"); setDialog(null); setEditing(null); },
    onError: (e: any) => toast.error(e.message),
  });

  function openCreate() {
    setForm({ ...EMPTY_FORM }); setEditing(null); setDialog("create");
  }

  function openEdit(row: any) {
    setForm({
      type: row.type, label: row.label, accountHolder: row.accountHolder ?? "",
      accountNumber: row.accountNumber ?? "", ifsc: row.ifsc ?? "", bankName: row.bankName ?? "",
      upiId: row.upiId ?? "", qrPayload: row.qrPayload ?? "", provider: row.provider ?? "",
      isGlobal: row.isGlobal, isActive: row.isActive, sortOrder: row.sortOrder ?? 0,
    });
    setEditing(row); setDialog("edit");
  }

  function handleSubmit() {
    const body = {
      type: form.type, label: form.label,
      accountHolder: form.accountHolder || null,
      accountNumber: form.accountNumber || null,
      ifsc: form.ifsc || null, bankName: form.bankName || null,
      upiId: form.upiId || null, qrPayload: form.qrPayload || null,
      provider: form.provider || null,
      isGlobal: form.isGlobal, isActive: form.isActive, sortOrder: form.sortOrder,
    };
    if (dialog === "create") createMutation.mutate(body);
    else if (dialog === "edit" && editing) updateMutation.mutate({ id: editing.id, body });
  }

  function handleExport() {
    fetch(`/api/account-details/export/csv?type=${typeFilter}&isActive=${activeFilter}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    }).then(r => r.blob()).then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `account-details-${Date.now()}.csv`;
      a.click();
    });
  }

  const typeFields: Record<string, string[]> = {
    bank_account: ["accountHolder", "accountNumber", "ifsc", "bankName"],
    upi_id: ["accountHolder", "upiId"],
    qr_code: ["accountHolder", "qrPayload"],
    virtual_account: ["accountHolder", "accountNumber", "ifsc", "bankName"],
    static_qr: ["accountHolder", "qrPayload", "accountNumber"],
    merchant_qr_provider: ["provider"],
  };

  const visibleFields = typeFields[form.type] ?? [];
  const isSaving = createMutation.isPending || updateMutation.isPending;

  function field(key: string, label: string, placeholder?: string) {
    if (!visibleFields.includes(key)) return null;
    return (
      <div key={key}>
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Account Details</h1>
          <p className="text-muted-foreground mt-1">Manage payment collection accounts shown to merchants</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />Export CSV
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />Add Account
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by label..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {ACCOUNT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={activeFilter} onValueChange={v => { setActiveFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Account Info</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                ))
              ) : !rows.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Building2 className="w-8 h-8 opacity-30" />
                      <p className="text-sm">No account details yet</p>
                      <Button size="sm" variant="outline" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />Add one</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : rows.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <p className="text-sm font-medium">{row.label}</p>
                    {row.provider && <p className="text-xs text-muted-foreground capitalize">{row.provider}</p>}
                  </TableCell>
                  <TableCell><TypeBadge type={row.type} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {row.accountNumber ?? row.upiId ?? row.qrPayload?.slice(0, 30) ?? "—"}
                    {row.bankName && <div className="text-xs">{row.bankName}{row.ifsc ? ` · ${row.ifsc}` : ""}</div>}
                  </TableCell>
                  <TableCell>
                    {row.isGlobal
                      ? <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><Globe className="w-3 h-3" />All merchants</span>
                      : <span className="inline-flex items-center gap-1 text-xs text-amber-400"><Lock className="w-3 h-3" />Custom rules</span>
                    }
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${row.isActive ? "border-emerald-500/40 text-emerald-400" : "border-muted text-muted-foreground"}`}>
                      {row.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(row.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(row); setDialog("view"); }}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-rose-400 hover:text-rose-300" onClick={() => { setEditing(row); setDialog("delete"); }}>
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

      {total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>Next</Button>
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialog === "create" || dialog === "edit"} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialog === "create" ? "Add Account Detail" : "Edit Account Detail"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Label *</Label>
              <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Primary HDFC Collection" />
            </div>
            {field("accountHolder", "Account Holder Name", "e.g. RasoKart Technologies Pvt Ltd")}
            {field("accountNumber", "Account Number", "e.g. 50100123456789")}
            {field("ifsc", "IFSC Code", "e.g. HDFC0001234")}
            {field("bankName", "Bank Name", "e.g. HDFC Bank")}
            {field("upiId", "UPI ID", "e.g. rasokart@hdfc")}
            {field("qrPayload", "QR Payload / UPI Link", "upi://pay?pa=...")}
            {visibleFields.includes("provider") && (
              <div>
                <Label className="text-xs text-muted-foreground">Provider</Label>
                <Select value={form.provider} onValueChange={v => setForm(f => ({ ...f, provider: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select provider" /></SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map(p => <SelectItem key={p} value={p} className="capitalize">{p.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/10">
              <Switch checked={form.isGlobal} onCheckedChange={v => setForm(f => ({ ...f, isGlobal: v }))} />
              <div>
                <p className="text-sm">Visible to all merchants</p>
                <p className="text-xs text-muted-foreground">If off, use Visibility Rules to control access</p>
              </div>
            </div>
            {dialog === "edit" && (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/10">
                <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
                <p className="text-sm">Active</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSaving || !form.label}>
              {isSaving ? "Saving..." : dialog === "create" ? "Create" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={dialog === "delete"} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account Detail</DialogTitle>
            <DialogDescription>This will remove the account detail and all its visibility rules. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <p className="text-sm py-2">Are you sure you want to delete <strong>{editing?.label}</strong>?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => editing && deleteMutation.mutate(editing.id)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={dialog === "view"} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.label}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Type", editing.type?.replace(/_/g, " ")],
                  ["Status", editing.isActive ? "Active" : "Inactive"],
                  ["Visibility", editing.isGlobal ? "All merchants" : "Custom rules"],
                  ["Account Holder", editing.accountHolder],
                  ["Account Number", editing.accountNumber],
                  ["IFSC", editing.ifsc],
                  ["Bank Name", editing.bankName],
                  ["UPI ID", editing.upiId],
                  ["Provider", editing.provider],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k as string} className="rounded-lg bg-muted/20 p-2">
                    <p className="text-xs text-muted-foreground capitalize mb-0.5">{k}</p>
                    <p className="text-sm font-mono">{v}</p>
                  </div>
                ))}
              </div>
              {editing.qrPayload && (
                <div className="rounded-lg bg-muted/20 p-2">
                  <p className="text-xs text-muted-foreground mb-0.5">QR Payload</p>
                  <p className="text-xs font-mono break-all">{editing.qrPayload}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
