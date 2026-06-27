import { useState, useRef } from "react";
import {
  useGetCashfreePayoutConfig,
  useUpdateCashfreePayoutConfig,
  useListCashfreePayouts,
  useCreateCashfreePayout,
  useBulkCreateCashfreePayouts,
  useRetryCashfreePayout,
  useSyncCashfreePayoutStatus,
  getGetCashfreePayoutConfigQueryKey,
  getListCashfreePayoutsQueryKey,
  type CashfreePayoutRow,
  type CashfreePayoutCsvRow,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Save, Eye, EyeOff, RefreshCw, Upload, Plus, RotateCcw, ChevronLeft, ChevronRight,
  Loader2, AlertCircle, CheckCircle2, Clock, XCircle, Banknote, Settings2, List,
} from "lucide-react";

const AUTH_HEADERS = { Authorization: `Bearer ${getToken()}` };
const PAGE_LIMIT = 25;

type Status = "PENDING" | "SUCCESS" | "FAILED" | "REVERSED";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    PENDING:  { label: "Pending",  cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",  icon: <Clock className="w-3 h-3 mr-1" /> },
    SUCCESS:  { label: "Success",  cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle2 className="w-3 h-3 mr-1" /> },
    FAILED:   { label: "Failed",   cls: "bg-red-500/15 text-red-400 border-red-500/30",        icon: <XCircle className="w-3 h-3 mr-1" /> },
    REVERSED: { label: "Reversed", cls: "bg-muted/50 text-muted-foreground border-border/50",  icon: <RotateCcw className="w-3 h-3 mr-1" /> },
  };
  const s = map[status] ?? { label: status, cls: "bg-muted/30 text-muted-foreground border-border/40", icon: null };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${s.cls}`}>
      {s.icon}{s.label}
    </span>
  );
}

function EnvBadge({ env }: { env: string }) {
  return env === "live"
    ? <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs">Live</Badge>
    : <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-xs">Test / Sandbox</Badge>;
}

function fmt(iso: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function fmtAmt(amount: string) {
  return `₹${parseFloat(amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

// ── CSV parser (no external lib) ──────────────────────────────────────────────
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0]!.split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const vals = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] ?? ""; });
    rows.push(obj);
  }
  return { headers, rows };
}

const REQUIRED_COLS = ["beneficiary_name", "amount"];
const ALL_COLS = ["beneficiary_name", "account_number", "ifsc", "upi_id", "amount", "remark"];

function validateCsvRow(row: Record<string, string>, idx: number): string | null {
  if (!row["beneficiary_name"]?.trim()) return `Row ${idx + 1}: missing beneficiary_name`;
  const amt = Number(row["amount"]);
  if (isNaN(amt) || amt <= 0) return `Row ${idx + 1}: invalid amount "${row["amount"]}"`;
  const hasBank = row["account_number"]?.trim() && row["ifsc"]?.trim();
  const hasUpi = !!row["upi_id"]?.trim();
  if (!hasBank && !hasUpi) return `Row ${idx + 1}: needs account_number+ifsc or upi_id`;
  return null;
}

// ── Settings Tab ───────────────────────────────────────────────────────────────
function SettingsTab() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useGetCashfreePayoutConfig({ request: { headers: AUTH_HEADERS } });

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [env, setEnv] = useState<"test" | "live" | null>(null);
  const [showId, setShowId] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const { mutateAsync: updateConfig } = useUpdateCashfreePayoutConfig({
    request: { headers: AUTH_HEADERS },
    mutation: {},
  });

  const currentEnabled = enabled !== null ? enabled : (config?.enabled ?? false);
  const currentEnv: "test" | "live" = env !== null ? env : (config?.env ?? "test");

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { enabled: currentEnabled, env: currentEnv };
      if (clientId.trim()) body.clientId = clientId.trim();
      // Only send clientSecret if user explicitly typed a new value.
      // An empty field means "keep existing" — never send empty string.
      if (clientSecret.trim()) body.clientSecret = clientSecret.trim();
      await updateConfig({ data: body as any });
      qc.invalidateQueries({ queryKey: getGetCashfreePayoutConfigQueryKey() });
      setClientId("");
      setClientSecret("");
      toast.success("Payout gateway settings saved");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Status card */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Banknote className="w-4 h-4 text-muted-foreground" />
              Payout Gateway
            </CardTitle>
            {!isLoading && config && <EnvBadge env={config.env} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <Switch
              checked={currentEnabled}
              onCheckedChange={v => setEnabled(v)}
              id="payout-enabled"
            />
            <Label htmlFor="payout-enabled" className="cursor-pointer">
              {currentEnabled ? "Gateway enabled" : "Gateway disabled"}
            </Label>
            {currentEnabled
              ? <span className="text-xs text-emerald-400">Payouts will be submitted to the gateway</span>
              : <span className="text-xs text-muted-foreground">Enable to submit real payouts</span>}
          </div>

          <div className="space-y-2">
            <Label>Environment</Label>
            <Select value={currentEnv} onValueChange={v => setEnv(v as "test" | "live")}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Sandbox / Test</SelectItem>
                <SelectItem value="live">Live / Production</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Sandbox mode uses the test payout environment; Live mode processes real bank transfers.
            </p>
          </div>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Payout Client ID</Label>
              {!isLoading && config?.clientIdSet && (
                <p className="text-xs text-muted-foreground">
                  Current: <code className="font-mono">{config.clientIdMasked}</code>
                </p>
              )}
              <div className="relative">
                <Input
                  type={showId ? "text" : "password"}
                  placeholder={config?.clientIdSet ? "Enter new Client ID to replace" : "Enter Payout Client ID"}
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowId(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showId ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Payout Client Secret</Label>
              {!isLoading && config?.clientSecretSet && (
                <p className="text-xs text-muted-foreground">A secret is currently configured.</p>
              )}
              <div className="relative">
                <Input
                  type={showSecret ? "text" : "password"}
                  placeholder={config?.clientSecretSet ? "Enter new secret to replace" : "Enter Payout Client Secret"}
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Leave blank to keep existing secret.</p>
            </div>
          </div>

          <div className="rounded-md bg-muted/30 border border-border/40 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground/70">How to get credentials</p>
            <p>1. Log into your payout provider dashboard and go to API Keys.</p>
            <p>2. Generate a Client ID and Client Secret for the Payout product.</p>
            <p>3. These credentials are separate from the Payment Collection credentials.</p>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : <><Save className="w-4 h-4 mr-2" />Save Settings</>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Add Payout Dialog ──────────────────────────────────────────────────────────
function AddPayoutDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [upiId, setUpiId] = useState("");
  const [amount, setAmount] = useState("");
  const [remark, setRemark] = useState("");
  const [mode, setMode] = useState<"bank" | "upi">("bank");
  const [creating, setCreating] = useState(false);

  const { mutateAsync: createPayout } = useCreateCashfreePayout({ request: { headers: AUTH_HEADERS }, mutation: {} });

  async function handleSubmit() {
    if (!beneficiaryName.trim()) { toast.error("Beneficiary name is required"); return; }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { toast.error("Valid amount is required"); return; }
    if (mode === "bank" && (!accountNumber.trim() || !ifsc.trim())) {
      toast.error("Account number and IFSC are required for bank transfer"); return;
    }
    if (mode === "upi" && !upiId.trim()) {
      toast.error("UPI ID is required for UPI transfer"); return;
    }

    setCreating(true);
    try {
      await createPayout({
        data: {
          beneficiaryName: beneficiaryName.trim(),
          accountNumber: mode === "bank" ? accountNumber.trim() : undefined,
          ifsc: mode === "bank" ? ifsc.trim() : undefined,
          upiId: mode === "upi" ? upiId.trim() : undefined,
          amount: amt,
          remark: remark.trim() || undefined,
        },
      });
      toast.success("Payout created successfully");
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to create payout");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="w-4 h-4 text-emerald-400" />
            Create Payout
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Beneficiary Name <span className="text-destructive">*</span></Label>
            <Input placeholder="e.g. John Doe" value={beneficiaryName} onChange={e => setBeneficiaryName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Transfer Mode</Label>
            <div className="flex gap-2">
              <Button size="sm" variant={mode === "bank" ? "default" : "outline"} onClick={() => setMode("bank")}>Bank Account</Button>
              <Button size="sm" variant={mode === "upi" ? "default" : "outline"} onClick={() => setMode("upi")}>UPI</Button>
            </div>
          </div>

          {mode === "bank" ? (
            <>
              <div className="space-y-2">
                <Label>Account Number <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. 1234567890" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>IFSC Code <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. SBIN0001234" value={ifsc} onChange={e => setIfsc(e.target.value.toUpperCase())} />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label>UPI ID <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. merchant@upi" value={upiId} onChange={e => setUpiId(e.target.value)} />
            </div>
          )}

          <div className="space-y-2">
            <Label>Amount (₹) <span className="text-destructive">*</span></Label>
            <Input type="number" min="1" placeholder="e.g. 10000" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Remark <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input placeholder="e.g. Settlement for July" value={remark} onChange={e => setRemark(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={creating}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={creating}>
            {creating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : "Create Payout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk Upload Dialog ─────────────────────────────────────────────────────────
function BulkUploadDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ total: number; successCount: number; failedCount: number } | null>(null);

  const { mutateAsync: bulkCreate } = useBulkCreateCashfreePayouts({ request: { headers: AUTH_HEADERS }, mutation: {} });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const { headers, rows } = parseCsv(text);
      const missingCols = REQUIRED_COLS.filter(c => !headers.includes(c));
      if (missingCols.length > 0) {
        setParseErrors([`Missing required columns: ${missingCols.join(", ")}`]);
        setCsvRows([]);
        return;
      }
      const errors: string[] = [];
      rows.forEach((row, idx) => {
        const err = validateCsvRow(row, idx);
        if (err) errors.push(err);
      });
      setCsvRows(rows);
      setParseErrors(errors);
      setResult(null);
    };
    reader.readAsText(file);
  }

  async function handleSubmit() {
    if (csvRows.length === 0 || parseErrors.length > 0) return;
    setSubmitting(true);
    try {
      const apiRows: CashfreePayoutCsvRow[] = csvRows.map(r => ({
        beneficiary_name: r["beneficiary_name"] ?? "",
        account_number: r["account_number"] ?? "",
        ifsc: r["ifsc"] ?? "",
        upi_id: r["upi_id"] ?? "",
        amount: r["amount"] ?? "",
        remark: r["remark"] ?? "",
      }));
      const res = await bulkCreate({ data: { rows: apiRows } });
      setResult({ total: res.total, successCount: res.successCount, failedCount: res.failedCount });
      toast.success(`Bulk upload complete: ${res.successCount}/${res.total} succeeded`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message ?? "Bulk upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setCsvRows([]);
    setParseErrors([]);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-emerald-400" />
            Bulk Payout Upload
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted/30 border border-border/40 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground/70">CSV Format</p>
            <p>Required columns: <code>beneficiary_name, amount</code></p>
            <p>For bank transfers: also include <code>account_number, ifsc</code></p>
            <p>For UPI: include <code>upi_id</code></p>
            <p>Optional: <code>remark</code></p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" />
              Choose CSV File
            </Button>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
            {csvRows.length > 0 && (
              <span className="text-sm text-muted-foreground">{csvRows.length} rows parsed</span>
            )}
          </div>

          {parseErrors.length > 0 && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 space-y-1">
              {parseErrors.map((e, i) => (
                <p key={i} className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 shrink-0" />{e}
                </p>
              ))}
            </div>
          )}

          {csvRows.length > 0 && parseErrors.length === 0 && (
            <div className="overflow-auto max-h-64 rounded border border-border/50">
              <Table>
                <TableHeader>
                  <TableRow>
                    {ALL_COLS.map(c => <TableHead key={c} className="text-xs whitespace-nowrap">{c}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {csvRows.slice(0, 50).map((row, i) => (
                    <TableRow key={i}>
                      {ALL_COLS.map(c => (
                        <TableCell key={c} className="text-xs max-w-[120px] truncate">{row[c] ?? "—"}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {csvRows.length > 50 && (
                <p className="text-xs text-muted-foreground px-3 py-2">…and {csvRows.length - 50} more rows</p>
              )}
            </div>
          )}

          {result && (
            <div className={`rounded-md p-3 border text-sm ${result.failedCount === 0 ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"}`}>
              <CheckCircle2 className="w-4 h-4 inline mr-1.5" />
              {result.successCount} of {result.total} payouts submitted successfully.
              {result.failedCount > 0 && ` ${result.failedCount} failed.`}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>Close</Button>
          {!result && (
            <Button
              onClick={handleSubmit}
              disabled={submitting || csvRows.length === 0 || parseErrors.length > 0}
            >
              {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</> : `Submit ${csvRows.length} Payouts`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Payouts Tab ────────────────────────────────────────────────────────────────
function PayoutsTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<Status | "ALL">("ALL");
  const [merchantIdFilter, setMerchantIdFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const params = {
    page,
    limit: PAGE_LIMIT,
    ...(statusFilter !== "ALL" ? { status: statusFilter } : {}),
    ...(merchantIdFilter.trim() ? { merchantId: parseInt(merchantIdFilter) } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };

  const { data, isLoading, refetch } = useListCashfreePayouts(params, { request: { headers: AUTH_HEADERS } });
  const { mutateAsync: syncStatus } = useSyncCashfreePayoutStatus({ request: { headers: AUTH_HEADERS }, mutation: {} });
  const { mutateAsync: retryPayout } = useRetryCashfreePayout({ request: { headers: AUTH_HEADERS }, mutation: {} });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_LIMIT);

  function resetFilters() {
    setStatusFilter("ALL");
    setMerchantIdFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const hasActiveFilters = statusFilter !== "ALL" || merchantIdFilter.trim() || dateFrom || dateTo;

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await syncStatus({ data: {} });
      toast.success(`Status sync complete — ${res.updatedCount} updated`);
      qc.invalidateQueries({ queryKey: getListCashfreePayoutsQueryKey(params) });
    } catch (err: any) {
      toast.error(err.message ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRetry(row: CashfreePayoutRow) {
    setRetryingId(row.id);
    try {
      await retryPayout({ id: row.id });
      toast.success(`Payout ${row.transferId} retried`);
      refetch();
    } catch (err: any) {
      toast.error(err.message ?? "Retry failed");
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="border-border/40">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-end gap-3">
            {/* Status pills */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium">Status</p>
              <div className="flex flex-wrap gap-1.5">
                {(["ALL", "PENDING", "SUCCESS", "FAILED", "REVERSED"] as const).map(s => (
                  <Button
                    key={s}
                    size="sm"
                    variant={statusFilter === s ? "default" : "outline"}
                    className="text-xs h-7 px-2.5"
                    onClick={() => { setStatusFilter(s); setPage(1); }}
                  >
                    {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
                  </Button>
                ))}
              </div>
            </div>

            {/* Merchant ID */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium">Merchant ID</p>
              <Input
                className="h-8 w-32 text-xs"
                placeholder="e.g. 42"
                type="number"
                min="1"
                value={merchantIdFilter}
                onChange={e => { setMerchantIdFilter(e.target.value); setPage(1); }}
              />
            </div>

            {/* Date range */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium">Date From</p>
              <Input
                className="h-8 w-36 text-xs"
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium">Date To</p>
              <Input
                className="h-8 w-36 text-xs"
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setPage(1); }}
              />
            </div>

            {hasActiveFilters && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={resetFilters}>
                Clear filters
              </Button>
            )}

            {/* Actions */}
            <div className="ml-auto flex gap-2 items-end">
              <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
                {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Sync Status
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowBulk(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Bulk Upload
              </Button>
              <Button size="sm" onClick={() => setShowAdd(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Payout
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer ID</TableHead>
                <TableHead>Beneficiary</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Initiated By</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/40 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    No payout records found.
                  </TableCell>
                </TableRow>
              ) : rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs max-w-[140px] truncate" title={row.transferId}>
                    {row.transferId}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate" title={row.beneficiaryName}>
                    {row.beneficiaryName}
                  </TableCell>
                  <TableCell className="font-medium">{fmtAmt(row.amount)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.upiId ? `UPI: ${row.upiId}` : row.accountNumber ? `Bank: ••${row.accountNumber.slice(-4)}` : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <StatusBadge status={row.status} />
                      {row.errorMessage && (
                        <p className="text-xs text-red-400 max-w-[200px] truncate" title={row.errorMessage}>
                          {row.errorMessage}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                    {row.initiatedByEmail}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {fmt(row.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.status === "FAILED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7"
                        onClick={() => handleRetry(row)}
                        disabled={retryingId === row.id}
                      >
                        {retryingId === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3 mr-1" />}
                        Retry
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} total records</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span>Page {page} of {totalPages}</span>
            <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <AddPayoutDialog open={showAdd} onClose={() => setShowAdd(false)} onSuccess={() => { refetch(); }} />
      <BulkUploadDialog open={showBulk} onClose={() => setShowBulk(false)} onSuccess={() => { refetch(); }} />
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AdminCashfreePayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Payout Gateway</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Initiate bank transfers and UPI payouts to beneficiaries.
        </p>
      </div>

      <Tabs defaultValue="payouts">
        <TabsList>
          <TabsTrigger value="payouts" className="flex items-center gap-1.5">
            <List className="w-3.5 h-3.5" />
            Payouts
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="payouts" className="mt-6">
          <PayoutsTab />
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
