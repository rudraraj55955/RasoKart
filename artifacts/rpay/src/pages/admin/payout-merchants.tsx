import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Plus, ChevronLeft, ChevronRight, Wallet, Eye, ToggleLeft, ToggleRight } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { toast } from "sonner";

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Request failed"); }
  return res.json();
}

function fmtAmount(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    suspended: "bg-red-500/15 text-red-400 border-red-500/30",
    rejected: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return <Badge variant="outline" className={`text-[10px] border ${map[status] ?? "bg-muted/30 text-muted-foreground border-border"}`}>{status}</Badge>;
}

export default function AdminPayoutMerchants() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ businessName: "", contactName: "", email: "", phone: "", password: "" });

  const { data: selfRegData } = useQuery({
    queryKey: ["payout-self-registration"],
    queryFn: () => apiFetch<{ enabled: boolean }>("/api/admin/payout-settings/self-registration"),
  });

  const toggleSelfReg = useMutation({
    mutationFn: (enabled: boolean) => apiFetch<{ ok: boolean; enabled: boolean }>("/api/admin/payout-settings/self-registration", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
    onSuccess: (data) => {
      toast.success(data.enabled ? "Self-registration enabled" : "Self-registration disabled");
      qc.invalidateQueries({ queryKey: ["payout-self-registration"] });
    },
    onError: (err: any) => toast.error(err.message ?? "Failed to update setting"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-payout-merchants", page, statusFilter],
    queryFn: () => apiFetch<any>(`/api/admin/payout-merchants?page=${page}&limit=25${statusFilter !== "all" ? `&status=${statusFilter}` : ""}`),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, string>) => apiFetch<any>("/api/admin/payout-merchants", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Payout merchant created successfully");
      setShowCreate(false);
      setForm({ businessName: "", contactName: "", email: "", phone: "", password: "" });
      qc.invalidateQueries({ queryKey: ["admin-payout-merchants"] });
    },
    onError: (err: any) => toast.error(err.message ?? "Failed to create merchant"),
  });

  const handleCreate = () => {
    if (!form.businessName || !form.contactName || !form.email || !form.phone || !form.password) {
      toast.error("All fields are required"); return;
    }
    createMutation.mutate(form);
  };

  const merchants = data?.merchants ?? [];
  const totalPages = data?.totalPages ?? 1;

  const selfRegEnabled = selfRegData?.enabled ?? true;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payout Merchants</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage merchants with payout access</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="w-4 h-4" /> New Payout Merchant
        </Button>
      </div>

      {/* Self-registration toggle */}
      <div className="flex items-center justify-between rounded-xl border border-border/40 bg-card/40 px-5 py-3">
        <div className="flex items-center gap-3">
          {selfRegEnabled
            ? <ToggleRight className="h-5 w-5 text-emerald-400" />
            : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
          <div>
            <p className="text-sm font-medium">Public Self-Registration</p>
            <p className="text-xs text-muted-foreground">
              {selfRegEnabled
                ? "Merchants can register at /payout-merchant/signup"
                : "Public registration is disabled — admin-only creation"}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant={selfRegEnabled ? "outline" : "default"}
          className="min-w-[90px] text-xs"
          disabled={toggleSelfReg.isPending}
          onClick={() => toggleSelfReg.mutate(!selfRegEnabled)}
        >
          {selfRegEnabled ? "Disable" : "Enable"}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {["all", "pending", "approved", "suspended"].map(s => (
          <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => { setStatusFilter(s); setPage(1); }} className="capitalize text-xs h-8">
            {s}
          </Button>
        ))}
      </div>

      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Spinner className="w-6 h-6 text-muted-foreground" /></div>
          ) : merchants.length === 0 ? (
            <div className="py-14 text-center">
              <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No payout merchants yet</p>
              <Button className="mt-4" onClick={() => setShowCreate(true)}>Create First</Button>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="hidden md:grid grid-cols-[1fr_140px_120px_140px_80px] gap-4 px-4 py-2 text-xs text-muted-foreground font-medium border-b border-border/40">
                <span>Business</span>
                <span>Wallet Balance</span>
                <span>Payouts</span>
                <span>Created</span>
                <span></span>
              </div>
              <div className="divide-y divide-border/40">
                {merchants.map((m: any) => (
                  <div key={m.id} className="flex md:grid md:grid-cols-[1fr_140px_120px_140px_80px] gap-4 px-4 py-3 items-center hover:bg-muted/10 transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground">{m.businessName}</p>
                        <StatusBadge status={m.status} />
                        {m.payoutServiceEnabled && (
                          <Badge variant="outline" className="text-[10px] border bg-blue-500/15 text-blue-400 border-blue-500/30">Payout ON</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{m.email} · {m.phone}</p>
                    </div>
                    <div className="hidden md:block">
                      <p className="text-sm font-semibold text-foreground">{fmtAmount(m.wallet?.availableBalance)}</p>
                      {Number(m.wallet?.holdBalance ?? 0) > 0 && (
                        <p className="text-xs text-muted-foreground">{fmtAmount(m.wallet?.holdBalance)} hold</p>
                      )}
                    </div>
                    <div className="hidden md:block">
                      <p className="text-sm text-foreground">{m.payoutStats?.total ?? 0} total</p>
                      <p className="text-xs text-muted-foreground">{fmtAmount(m.payoutStats?.totalAmount)} sent</p>
                    </div>
                    <p className="hidden md:block text-xs text-muted-foreground">{format(new Date(m.createdAt), "dd MMM yyyy")}</p>
                    <Link href={`/admin/payout-merchants/${m.id}`}>
                      <Button size="sm" variant="outline" className="gap-1 text-xs h-7">
                        <Eye className="w-3 h-3" /> View
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
                  <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}><ChevronRight className="w-4 h-4" /></Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Payout Merchant</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {[
              { key: "businessName", label: "Business Name", placeholder: "e.g. Acme Payments Pvt Ltd" },
              { key: "contactName", label: "Contact Name", placeholder: "Full name" },
              { key: "email", label: "Email", placeholder: "merchant@example.com", type: "email" },
              { key: "phone", label: "Phone", placeholder: "+91 9876543210" },
              { key: "password", label: "Initial Password", placeholder: "Min 8 characters", type: "password" },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <Label className="text-xs text-muted-foreground mb-1.5">{label}</Label>
                <Input type={type ?? "text"} placeholder={placeholder} value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Spinner className="w-4 h-4 mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
