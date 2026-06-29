import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ArrowLeft, Lock, Unlock, Plus, Minus, AlertCircle, Receipt, Wallet } from "lucide-react";
import { format } from "date-fns";

function getToken() { return localStorage.getItem("rasokart_token") ?? ""; }
const H = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` });
async function apiGet(path: string) {
  const r = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiPost(path: string, body: object) {
  const r = await fetch(`/api${path}`, { method: "POST", headers: H(), body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: "Request failed" })); throw new Error(e.error ?? "Request failed"); }
  return r.json();
}
async function apiPut(path: string, body: object = {}) {
  const r = await fetch(`/api${path}`, { method: "PUT", headers: H(), body: JSON.stringify(body) });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: "Request failed" })); throw new Error(e.error ?? "Request failed"); }
  return r.json();
}

const INR = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(v);
const fmtDate = (s: string) => format(new Date(s), "dd MMM yyyy, HH:mm");

type WalletDetail = {
  merchant: { id: number; businessName: string; email: string; status: string };
  wallet: {
    availableBalance: number; pendingBalance: number; holdBalance: number;
    settlementBalance: number; payoutBalance: number;
    totalCollection: number; totalPayout: number;
    totalCharges: number; totalRefunds: number; totalReversals: number;
    currency: string; updatedAt: string;
  };
  activeHolds: Array<{ id: number; amount: number; reason: string; status: string; createdAt: string; expiresAt: string | null }>;
};

type LedgerEntry = {
  id: number; txnType: string; bucket: string; amount: number;
  availableBefore: number; availableAfter: number; pendingBefore: number; pendingAfter: number;
  referenceType: string | null; referenceId: number | null;
  description: string; createdBy: number | null; createdAt: string;
};

const TXN_LABELS: Record<string, { label: string; color: string }> = {
  pending_credit:      { label: "Payment Credit",    color: "text-emerald-400" },
  settlement_transfer: { label: "Settlement",        color: "text-sky-400" },
  withdrawal_debit:    { label: "Payout",            color: "text-rose-400" },
  reversal:            { label: "Reversal",          color: "text-amber-400" },
  hold_created:        { label: "Hold Created",      color: "text-orange-400" },
  hold_released:       { label: "Hold Released",     color: "text-teal-400" },
  charge:              { label: "Charge",            color: "text-rose-400" },
  refund:              { label: "Refund",            color: "text-sky-400" },
  manual_credit:       { label: "Manual Credit",     color: "text-emerald-400" },
  manual_debit:        { label: "Manual Debit",      color: "text-rose-400" },
};

const BUCKETS = ["available", "pending", "hold", "settlement", "payout"];

export default function AdminWalletDetail() {
  const params = useParams<{ merchantId: string }>();
  const merchantId = parseInt(params.merchantId ?? "0");
  const qc = useQueryClient();

  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerType, setLedgerType] = useState("all");
  const LIMIT = 50;

  // Dialogs
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ bucket: "available", amount: "", description: "" });
  const [holdForm, setHoldForm] = useState({ amount: "", reason: "", expiresAt: "" });
  const [chargeForm, setChargeForm] = useState({ amount: "", chargeType: "fee", description: "" });
  const [loadForm, setLoadForm] = useState({ amount: "", note: "" });

  const { data, isLoading } = useQuery<WalletDetail>({
    queryKey: ["admin-wallet-detail", merchantId],
    queryFn: () => apiGet(`/wallets/${merchantId}`),
    enabled: !!merchantId,
  });

  const { data: ledgerData, isLoading: ledgerLoading } = useQuery<{ data: LedgerEntry[]; total: number }>({
    queryKey: ["admin-wallet-ledger", merchantId, ledgerPage, ledgerType],
    queryFn: () => apiGet(`/wallets/${merchantId}/ledger?page=${ledgerPage}&limit=${LIMIT}&txnType=${ledgerType}`),
    enabled: !!merchantId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-wallet-detail", merchantId] });
    qc.invalidateQueries({ queryKey: ["admin-wallet-ledger", merchantId] });
  };

  const adjustMutation = useMutation({
    mutationFn: () => apiPost(`/wallets/${merchantId}/adjust`, {
      bucket: adjustForm.bucket,
      amount: Number(adjustForm.amount),
      description: adjustForm.description,
    }),
    onSuccess: () => { invalidate(); setAdjustOpen(false); setAdjustForm({ bucket: "available", amount: "", description: "" }); toast.success("Adjustment applied"); },
    onError: (e: any) => toast.error(e.message),
  });

  const holdMutation = useMutation({
    mutationFn: () => apiPost(`/wallets/${merchantId}/hold`, {
      amount: Number(holdForm.amount),
      reason: holdForm.reason,
      expiresAt: holdForm.expiresAt || undefined,
    }),
    onSuccess: () => { invalidate(); setHoldOpen(false); setHoldForm({ amount: "", reason: "", expiresAt: "" }); toast.success("Hold created"); },
    onError: (e: any) => toast.error(e.message),
  });

  const chargeMutation = useMutation({
    mutationFn: () => apiPost(`/wallets/${merchantId}/charge`, {
      amount: Number(chargeForm.amount),
      chargeType: chargeForm.chargeType,
      description: chargeForm.description,
    }),
    onSuccess: () => { invalidate(); setChargeOpen(false); setChargeForm({ amount: "", chargeType: "fee", description: "" }); toast.success("Charge applied"); },
    onError: (e: any) => toast.error(e.message),
  });

  const releaseMutation = useMutation({
    mutationFn: (holdId: number) => apiPut(`/wallets/holds/${holdId}/release`),
    onSuccess: () => { invalidate(); toast.success("Hold released"); },
    onError: (e: any) => toast.error(e.message),
  });

  const loadMutation = useMutation({
    mutationFn: () => apiPost(`/wallets/${merchantId}/load`, {
      amount: Number(loadForm.amount),
      note: loadForm.note.trim(),
    }),
    onSuccess: () => {
      invalidate();
      setLoadOpen(false);
      setLoadForm({ amount: "", note: "" });
      toast.success("Wallet loaded successfully");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-muted-foreground text-sm py-10 text-center">Loading wallet…</div>;
  if (!data) return <div className="text-muted-foreground text-sm py-10 text-center">Wallet not found</div>;

  const { merchant, wallet, activeHolds } = data;
  const ledgerRows = ledgerData?.data ?? [];
  const ledgerTotal = ledgerData?.total ?? 0;
  const ledgerTotalPages = Math.max(1, Math.ceil(ledgerTotal / LIMIT));

  const balanceCards = [
    { label: "Available",   value: wallet.availableBalance,  color: "text-emerald-400", bg: "bg-emerald-500/8" },
    { label: "Pending",     value: wallet.pendingBalance,    color: "text-amber-400",   bg: "bg-amber-500/8" },
    { label: "On Hold",     value: wallet.holdBalance,       color: "text-orange-400",  bg: "bg-orange-500/8" },
    { label: "Settlement",  value: wallet.settlementBalance, color: "text-sky-400",     bg: "bg-sky-500/8" },
    { label: "Payout",      value: wallet.payoutBalance,     color: "text-violet-400",  bg: "bg-violet-500/8" },
  ];
  const statCards = [
    { label: "Total Collection", value: wallet.totalCollection, color: "text-emerald-300" },
    { label: "Total Payout",     value: wallet.totalPayout,     color: "text-rose-300" },
    { label: "Total Charges",    value: wallet.totalCharges,    color: "text-orange-300" },
    { label: "Total Refunds",    value: wallet.totalRefunds,    color: "text-sky-300" },
    { label: "Total Reversals",  value: wallet.totalReversals,  color: "text-violet-300" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/admin/wallets">
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground mt-1">
            <ArrowLeft className="w-3.5 h-3.5" />Back
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">{merchant.businessName}</h1>
          <p className="text-muted-foreground text-sm">{merchant.email} · Wallet ID #{wallet.availableBalance !== undefined ? merchantId : "—"}</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button size="sm" variant="outline" className="gap-1.5 border-border/60" onClick={() => setAdjustOpen(true)}>
            <Plus className="w-3.5 h-3.5" />Manual Adjust
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 border-border/60" onClick={() => setHoldOpen(true)}>
            <Lock className="w-3.5 h-3.5" />Create Hold
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 border-border/60 text-orange-400 hover:text-orange-300" onClick={() => setChargeOpen(true)}>
            <Receipt className="w-3.5 h-3.5" />Apply Charge
          </Button>
          <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setLoadOpen(true)}>
            <Wallet className="w-3.5 h-3.5" />Load Wallet
          </Button>
        </div>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {balanceCards.map(c => (
          <Card key={c.label} className="border-border/60 bg-card">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
              <p className={`text-base font-bold ${c.color}`}>{INR(c.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statCards.map(c => (
          <Card key={c.label} className="border-border/60 bg-card/60">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{c.label}</p>
              <p className={`text-base font-bold ${c.color}`}>{INR(c.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Active Holds */}
      {activeHolds.length > 0 && (
        <Card className="border-orange-500/20 bg-card">
          <CardHeader className="py-3 px-4 border-b border-border/40">
            <span className="text-sm font-medium text-orange-400 flex items-center gap-1.5">
              <Lock className="w-4 h-4" />Active Holds ({activeHolds.length})
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border/40">
                  {["ID", "Amount", "Reason", "Expires", "Created", ""].map(h => (
                    <TableHead key={h} className="text-xs text-muted-foreground py-2">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeHolds.map(hold => (
                  <TableRow key={hold.id} className="hover:bg-muted/20 border-border/30">
                    <TableCell className="py-2.5 text-xs text-muted-foreground">#{hold.id}</TableCell>
                    <TableCell className="py-2.5 font-medium text-sm text-orange-400">{INR(hold.amount)}</TableCell>
                    <TableCell className="py-2.5 text-sm text-foreground">{hold.reason}</TableCell>
                    <TableCell className="py-2.5 text-xs text-muted-foreground">
                      {hold.expiresAt ? fmtDate(hold.expiresAt) : <span className="italic opacity-50">Never</span>}
                    </TableCell>
                    <TableCell className="py-2.5 text-xs text-muted-foreground">{fmtDate(hold.createdAt)}</TableCell>
                    <TableCell className="py-2.5">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-border/60 hover:bg-emerald-500/10 hover:text-emerald-400"
                        disabled={releaseMutation.isPending}
                        onClick={() => releaseMutation.mutate(hold.id)}>
                        <Unlock className="w-3 h-3" />Release
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Wallet Ledger */}
      <Card className="border-border/60 bg-card">
        <CardHeader className="py-3 px-4 border-b border-border/40 flex flex-row items-center justify-between">
          <span className="text-sm font-medium text-foreground">Wallet Ledger</span>
          <Select value={ledgerType} onValueChange={v => { setLedgerType(v); setLedgerPage(1); }}>
            <SelectTrigger className="h-8 w-[180px] border-border/60 bg-background text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(TXN_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b border-border/40">
                {["#", "Type", "Description", "Amount", "Available After", "Pending After", "Date"].map(h => (
                  <TableHead key={h} className="text-xs text-muted-foreground py-2">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
              ) : ledgerRows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">No ledger entries</TableCell></TableRow>
              ) : ledgerRows.map(e => {
                const tl = TXN_LABELS[e.txnType] ?? { label: e.txnType, color: "text-muted-foreground" };
                return (
                  <TableRow key={e.id} className="hover:bg-muted/20 border-border/30">
                    <TableCell className="py-2.5 text-xs text-muted-foreground">{e.id}</TableCell>
                    <TableCell className="py-2.5 text-xs font-medium">
                      <span className={tl.color}>{tl.label}</span>
                    </TableCell>
                    <TableCell className="py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">{e.description}</TableCell>
                    <TableCell className={`py-2.5 text-sm font-medium ${e.amount >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {e.amount >= 0 ? "+" : ""}{INR(e.amount)}
                    </TableCell>
                    <TableCell className="py-2.5 text-sm text-foreground">{INR(e.availableAfter)}</TableCell>
                    <TableCell className="py-2.5 text-sm text-foreground">{INR(e.pendingAfter)}</TableCell>
                    <TableCell className="py-2.5 text-xs text-muted-foreground">{fmtDate(e.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {ledgerTotal > LIMIT && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <span className="text-xs text-muted-foreground">{ledgerTotal} entries</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={ledgerPage <= 1} onClick={() => setLedgerPage(p => p - 1)}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground">{ledgerPage} / {ledgerTotalPages}</span>
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={ledgerPage >= ledgerTotalPages} onClick={() => setLedgerPage(p => p + 1)}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Manual Adjust Dialog ── */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Manual Wallet Adjustment</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Bucket</Label>
              <Select value={adjustForm.bucket} onValueChange={v => setAdjustForm(f => ({ ...f, bucket: v }))}>
                <SelectTrigger className="border-border/60 bg-background text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{BUCKETS.map(b => <SelectItem key={b} value={b} className="capitalize">{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Amount <span className="text-muted-foreground">(positive = credit, negative = debit)</span></Label>
              <Input type="number" step="0.01" placeholder="e.g. 500 or -200"
                value={adjustForm.amount} onChange={e => setAdjustForm(f => ({ ...f, amount: e.target.value }))}
                className="border-border/60 bg-background text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Description</Label>
              <Textarea placeholder="Reason for adjustment…" rows={2}
                value={adjustForm.description} onChange={e => setAdjustForm(f => ({ ...f, description: e.target.value }))}
                className="border-border/60 bg-background text-sm resize-none" />
            </div>
            {adjustForm.amount && Number(adjustForm.amount) !== 0 && (
              <div className={`text-xs flex items-center gap-1.5 px-3 py-2 rounded-lg border ${Number(adjustForm.amount) > 0 ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/8" : "border-rose-500/30 text-rose-400 bg-rose-500/8"}`}>
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {Number(adjustForm.amount) > 0 ? "Credit" : "Debit"} of {INR(Math.abs(Number(adjustForm.amount)))} to {adjustForm.bucket} balance
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button disabled={adjustMutation.isPending || !adjustForm.amount || !adjustForm.description}
              onClick={() => adjustMutation.mutate()}>
              {adjustMutation.isPending ? "Applying…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Hold Dialog ── */}
      <Dialog open={holdOpen} onOpenChange={setHoldOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Create Wallet Hold</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Amount (deducted from Available)</Label>
              <Input type="number" step="0.01" min="0.01" placeholder="e.g. 1000"
                value={holdForm.amount} onChange={e => setHoldForm(f => ({ ...f, amount: e.target.value }))}
                className="border-border/60 bg-background text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Reason</Label>
              <Textarea placeholder="Reason for hold…" rows={2}
                value={holdForm.reason} onChange={e => setHoldForm(f => ({ ...f, reason: e.target.value }))}
                className="border-border/60 bg-background text-sm resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Expires At <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="datetime-local" value={holdForm.expiresAt}
                onChange={e => setHoldForm(f => ({ ...f, expiresAt: e.target.value }))}
                className="border-border/60 bg-background text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoldOpen(false)}>Cancel</Button>
            <Button disabled={holdMutation.isPending || !holdForm.amount || !holdForm.reason}
              className="bg-orange-600 hover:bg-orange-700"
              onClick={() => holdMutation.mutate()}>
              {holdMutation.isPending ? "Creating…" : "Create Hold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Apply Charge Dialog ── */}
      <Dialog open={chargeOpen} onOpenChange={setChargeOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Apply Charge</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Charge Type</Label>
              <Select value={chargeForm.chargeType} onValueChange={v => setChargeForm(f => ({ ...f, chargeType: v }))}>
                <SelectTrigger className="border-border/60 bg-background text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["fee", "platform", "gst", "other"].map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Amount</Label>
              <Input type="number" step="0.01" min="0.01" placeholder="e.g. 250"
                value={chargeForm.amount} onChange={e => setChargeForm(f => ({ ...f, amount: e.target.value }))}
                className="border-border/60 bg-background text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Description</Label>
              <Textarea placeholder="Charge description…" rows={2}
                value={chargeForm.description} onChange={e => setChargeForm(f => ({ ...f, description: e.target.value }))}
                className="border-border/60 bg-background text-sm resize-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChargeOpen(false)}>Cancel</Button>
            <Button disabled={chargeMutation.isPending || !chargeForm.amount || !chargeForm.description}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => chargeMutation.mutate()}>
              {chargeMutation.isPending ? "Applying…" : "Apply Charge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Wallet Dialog */}
      <Dialog open={loadOpen} onOpenChange={v => { setLoadOpen(v); if (!v) setLoadForm({ amount: "", note: "" }); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Load Wallet</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Credit funds directly to <span className="font-medium text-foreground">{merchant.businessName}</span>'s available balance.
            </p>
            <div className="space-y-1.5">
              <Label className="text-sm">Amount (INR)</Label>
              <Input
                type="number"
                step="0.01"
                min="1"
                placeholder="e.g. 10000"
                value={loadForm.amount}
                onChange={e => setLoadForm(f => ({ ...f, amount: e.target.value }))}
                className="border-border/60 bg-background text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Note / Reason <span className="text-rose-400">*</span></Label>
              <Textarea
                placeholder="Reason for wallet load…"
                rows={2}
                value={loadForm.note}
                onChange={e => setLoadForm(f => ({ ...f, note: e.target.value }))}
                className="border-border/60 bg-background text-sm resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadOpen(false)}>Cancel</Button>
            <Button
              disabled={loadMutation.isPending || !loadForm.amount || Number(loadForm.amount) <= 0 || !loadForm.note.trim()}
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => loadMutation.mutate()}
            >
              {loadMutation.isPending ? "Loading…" : "Load Wallet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
