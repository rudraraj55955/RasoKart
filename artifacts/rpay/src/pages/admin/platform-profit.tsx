import { useState } from "react";
import {
  useGetMe,
  useGetPlatformProfitSummary,
  useGetPlatformProfitLedger,
  useCreatePlatformProfitAdjustment,
  getGetPlatformProfitSummaryQueryKey,
  getGetPlatformProfitLedgerQueryKey,
} from "@workspace/api-client-react";
import type { PlatformProfitLedgerItem, PlatformProfitSummary } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Receipt,
  DollarSign,
  RefreshCw,
  Download,
  Plus,
  Minus,
  Search,
  ShieldAlert,
  Lock,
  ArrowDownLeft,
  ArrowUpRight,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const SOURCE_LABELS: Record<string, string> = {
  payin_fee:       "Payin Fee",
  payout_fee:      "Payout Fee",
  settlement_fee:  "Settlement Fee",
  manual_credit:   "Manual Credit",
  manual_debit:    "Manual Debit",
  adjustment:      "Adjustment",
  refund_reversal: "Refund Reversal",
};

function fmt(n: number | undefined) {
  return (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function SourceBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    payin_fee:       "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    payout_fee:      "bg-blue-500/15 text-blue-400 border-blue-500/30",
    settlement_fee:  "bg-violet-500/15 text-violet-400 border-violet-500/30",
    manual_credit:   "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    manual_debit:    "bg-rose-500/15 text-rose-400 border-rose-500/30",
    adjustment:      "bg-amber-500/15 text-amber-400 border-amber-500/30",
    refund_reversal: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  };
  return (
    <Badge className={`text-[10px] px-1.5 ${colors[type] ?? "bg-muted text-muted-foreground border-border"}`}>
      {SOURCE_LABELS[type] ?? type}
    </Badge>
  );
}

type SummaryCard = {
  title: string;
  key: keyof PlatformProfitSummary;
  icon: React.ElementType;
  color: string;
  description: string;
};

const SUMMARY_CARDS: SummaryCard[] = [
  { title: "Available Balance",  key: "availableBalance",  icon: Wallet,       color: "emerald", description: "Total platform wallet balance" },
  { title: "Today",             key: "todayProfit",        icon: TrendingUp,   color: "blue",    description: "Profit earned today" },
  { title: "Last 7 Days",       key: "last7DaysProfit",    icon: TrendingUp,   color: "violet",  description: "Profit over past 7 days" },
  { title: "Last 15 Days",      key: "last15DaysProfit",   icon: TrendingUp,   color: "indigo",  description: "Profit over past 15 days" },
  { title: "This Month",        key: "thisMonthProfit",    icon: BarChart3,    color: "cyan",    description: "Month-to-date profit" },
  { title: "GST Liability",     key: "gstLiabilityBalance",icon: Receipt,      color: "amber",   description: "Accumulated GST to remit" },
  { title: "Provider Cost (MTD)",key: "totalProviderCost", icon: TrendingDown, color: "rose",    description: "Month-to-date provider cost" },
  { title: "Net Margin",        key: "netMargin",          icon: DollarSign,   color: "emerald", description: "Balance minus GST liability and provider costs" },
];

const COLOR_MAP: Record<string, string> = {
  emerald: "text-emerald-400",
  blue:    "text-blue-400",
  violet:  "text-violet-400",
  indigo:  "text-indigo-400",
  cyan:    "text-cyan-400",
  amber:   "text-amber-400",
  rose:    "text-rose-400",
};
const BG_MAP: Record<string, string> = {
  emerald: "bg-emerald-500/10",
  blue:    "bg-blue-500/10",
  violet:  "bg-violet-500/10",
  indigo:  "bg-indigo-500/10",
  cyan:    "bg-cyan-500/10",
  amber:   "bg-amber-500/10",
  rose:    "bg-rose-500/10",
};

export default function AdminPlatformProfit() {
  const { data: me } = useGetMe();
  const isSuperAdmin = me?.isSuperAdmin === true;

  const qc = useQueryClient();

  // ── Filters ──────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [sourceTypeFilter, setSourceTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // ── Data ──────────────────────────────────────────────────────────────────
  const summaryParams = {};
  const ledgerParams = {
    page,
    limit: 50,
    sourceType: sourceTypeFilter !== "all" ? sourceTypeFilter : undefined,
    search: search || undefined,
    from: dateFrom || undefined,
    to: dateTo || undefined,
  };

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } =
    useGetPlatformProfitSummary(summaryParams);

  const { data: ledger, isLoading: ledgerLoading, refetch: refetchLedger } =
    useGetPlatformProfitLedger(ledgerParams);

  const items: PlatformProfitLedgerItem[] = ledger?.items ?? [];
  const total  = ledger?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  // ── Details sheet ─────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<PlatformProfitLedgerItem | null>(null);

  // ── Adjustment dialog ─────────────────────────────────────────────────────
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustType, setAdjustType] = useState<"manual_credit" | "manual_debit">("manual_credit");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getGetPlatformProfitSummaryQueryKey(summaryParams) });
    qc.invalidateQueries({ queryKey: getGetPlatformProfitLedgerQueryKey(ledgerParams) });
  };

  const adjustMut = useCreatePlatformProfitAdjustment({
    mutation: {
      onSuccess: (data) => {
        toast.success(`Adjustment applied — new balance ₹${fmt(data.newBalance)}`);
        setShowAdjust(false);
        setAdjustAmount("");
        setAdjustReason("");
        invalidateAll();
      },
      onError: (e: any) => toast.error(e?.response?.data?.error ?? "Failed to apply adjustment"),
    },
  });

  function handleAdjustSubmit() {
    const amt = parseFloat(adjustAmount);
    if (isNaN(amt) || amt <= 0) { toast.error("Enter a valid positive amount"); return; }
    if (!adjustReason.trim()) { toast.error("Reason is required"); return; }
    adjustMut.mutate({ data: { type: adjustType, amount: amt, reason: adjustReason.trim() } });
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  function handleExport() {
    const token = localStorage.getItem("rasokart_token");
    const params = new URLSearchParams();
    if (sourceTypeFilter !== "all") params.set("sourceType", sourceTypeFilter);
    if (search) params.set("search", search);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    const url = `/api/admin/platform-profit/ledger/export/csv${params.toString() ? `?${params}` : ""}`;
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", "");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── Access guard ──────────────────────────────────────────────────────────
  if (me && !isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="p-4 rounded-full bg-rose-500/10">
          <Lock className="w-8 h-8 text-rose-400" />
        </div>
        <h2 className="text-xl font-semibold">Super Admin Only</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          The Platform Profit Wallet is restricted to the Super Admin account.
          Contact your system administrator for access.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Platform Profit Wallet</h1>
            <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 text-[10px]">
              Super Admin
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time platform revenue, GST liability tracker, and adjustments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetchSummary(); refetchLedger(); }}
            className="gap-1.5"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="gap-1.5"
          >
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button
            size="sm"
            onClick={() => setShowAdjust(true)}
            className="gap-1.5 bg-violet-600 hover:bg-violet-700"
          >
            <Plus className="w-4 h-4" /> Adjustment
          </Button>
        </div>
      </div>

      {/* GST notice */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Accounting note:</span> GST collected is tracked separately in the
          Tax Liability balance and is <span className="font-semibold">never</span> counted as platform profit.
          Platform profit = payin fee only (before GST).
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {SUMMARY_CARDS.map(card => {
          const Icon = card.icon;
          const value = summary?.[card.key] as number | undefined;
          const isNeg = (value ?? 0) < 0;
          return (
            <Card key={card.key} className="border-border bg-card/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground font-medium">{card.title}</p>
                  <div className={`p-1.5 rounded-md ${BG_MAP[card.color]}`}>
                    <Icon className={`w-3.5 h-3.5 ${COLOR_MAP[card.color]}`} />
                  </div>
                </div>
                {summaryLoading ? (
                  <div className="h-7 w-24 bg-muted/40 animate-pulse rounded" />
                ) : (
                  <p className={`text-xl font-bold tabular-nums ${isNeg ? "text-rose-400" : COLOR_MAP[card.color]}`}>
                    ₹{fmt(value)}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{card.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Ledger table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-48">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search merchant, description…"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") { setSearch(searchInput); setPage(1); }
                  }}
                />
              </div>
            </div>
            <Select
              value={sourceTypeFilter}
              onValueChange={v => { setSourceTypeFilter(v); setPage(1); }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="payin_fee">Payin Fee</SelectItem>
                <SelectItem value="payout_fee">Payout Fee</SelectItem>
                <SelectItem value="settlement_fee">Settlement Fee</SelectItem>
                <SelectItem value="manual_credit">Manual Credit</SelectItem>
                <SelectItem value="manual_debit">Manual Debit</SelectItem>
                <SelectItem value="adjustment">Adjustment</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className="w-36"
              placeholder="From"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className="w-36"
              placeholder="To"
            />
            {(search || sourceTypeFilter !== "all" || dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch(""); setSearchInput("");
                  setSourceTypeFilter("all");
                  setDateFrom(""); setDateTo("");
                  setPage(1);
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {ledgerLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Wallet className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No ledger entries found</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Merchant</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Balance After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map(item => {
                      const isDebit = item.profitAmount < 0;
                      return (
                        <TableRow
                          key={item.id}
                          className="cursor-pointer hover:bg-muted/30"
                          onClick={() => setSelected(item)}
                        >
                          <TableCell className="text-muted-foreground text-xs">{item.id}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(item.createdAt), "d MMM, h:mm a")}
                          </TableCell>
                          <TableCell>
                            <SourceBadge type={item.sourceType} />
                          </TableCell>
                          <TableCell className="text-sm">
                            {item.merchantName ? (
                              <span className="text-muted-foreground">{item.merchantName}</span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {item.grossAmount > 0 ? `₹${fmt(item.grossAmount)}` : <span className="text-muted-foreground/40">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {item.feeAmount > 0 ? `₹${fmt(item.feeAmount)}` : <span className="text-muted-foreground/40">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {item.gstAmount > 0 ? (
                              <span className="text-amber-400">₹{fmt(item.gstAmount)}</span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            <span className={isDebit ? "text-rose-400" : "text-emerald-400"}>
                              {isDebit ? "-" : "+"}₹{fmt(Math.abs(item.profitAmount))}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-medium">
                            ₹{fmt(item.balanceAfter)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm text-muted-foreground">
                  <span>
                    Page {page} of {totalPages} · {total.toLocaleString()} entries
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page >= totalPages}
                      onClick={() => setPage(p => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Details sheet */}
      <Sheet open={!!selected} onOpenChange={v => { if (!v) setSelected(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-violet-400" />
              Ledger Entry #{selected?.id}
            </SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-5">
              <div className="flex items-center justify-between">
                <SourceBadge type={selected.sourceType} />
                <span className="text-xs text-muted-foreground">
                  {format(new Date(selected.createdAt), "d MMM yyyy, h:mm a")}
                </span>
              </div>

              <div className="rounded-lg bg-muted/30 border border-border px-3 py-3 space-y-2.5 text-sm">
                {selected.merchantName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Merchant</span>
                    <span className="font-medium">{selected.merchantName}</span>
                  </div>
                )}
                {selected.sourceId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reference ID</span>
                    <span className="font-mono">#{selected.sourceId}</span>
                  </div>
                )}
                {selected.description && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">Description</span>
                    <span className="text-right">{selected.description}</span>
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Financials
                </p>
                <div className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gross Amount</span>
                    <span className="tabular-nums">₹{fmt(selected.grossAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payin Fee</span>
                    <span className="tabular-nums text-emerald-400">₹{fmt(selected.feeAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GST (Tax Liability)</span>
                    <span className="tabular-nums text-amber-400">₹{fmt(selected.gstAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Provider Cost</span>
                    <span className="tabular-nums text-rose-400">₹{fmt(selected.providerCost)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Profit Amount</span>
                    <span className={`tabular-nums ${selected.profitAmount < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                      {selected.profitAmount < 0 ? "-" : "+"}₹{fmt(Math.abs(selected.profitAmount))}
                    </span>
                  </div>
                  <div className="flex justify-between font-medium text-base">
                    <span className="text-muted-foreground">Balance After</span>
                    <span className="tabular-nums">₹{fmt(selected.balanceAfter)}</span>
                  </div>
                </div>
              </div>

              {selected.createdByAdminEmail && (
                <>
                  <Separator />
                  <p className="text-xs text-muted-foreground">
                    Created by <span className="text-foreground">{selected.createdByAdminEmail}</span>
                  </p>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Adjustment dialog */}
      <Dialog open={showAdjust} onOpenChange={v => { if (!v) { setShowAdjust(false); } }}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {adjustType === "manual_credit"
                ? <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                : <ArrowUpRight className="w-4 h-4 text-rose-400" />}
              Manual Adjustment
            </DialogTitle>
            <DialogDescription>
              Add a credit or debit to the platform profit wallet. All adjustments are logged with the reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={adjustType === "manual_credit" ? "default" : "outline"}
                  className={adjustType === "manual_credit" ? "flex-1 bg-emerald-600 hover:bg-emerald-700" : "flex-1"}
                  onClick={() => setAdjustType("manual_credit")}
                >
                  <ArrowDownLeft className="w-3.5 h-3.5 mr-1" />Credit
                </Button>
                <Button
                  size="sm"
                  variant={adjustType === "manual_debit" ? "default" : "outline"}
                  className={adjustType === "manual_debit" ? "flex-1 bg-rose-600 hover:bg-rose-700" : "flex-1"}
                  onClick={() => setAdjustType("manual_debit")}
                >
                  <ArrowUpRight className="w-3.5 h-3.5 mr-1" />Debit
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Amount (₹)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={adjustAmount}
                onChange={e => setAdjustAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Reason (required)</Label>
              <Textarea
                rows={3}
                placeholder="Describe the reason for this adjustment…"
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjust(false)} disabled={adjustMut.isPending}>
              Cancel
            </Button>
            <Button
              className={adjustType === "manual_credit" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}
              onClick={handleAdjustSubmit}
              disabled={adjustMut.isPending}
            >
              {adjustMut.isPending ? "Applying…" : "Apply Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
