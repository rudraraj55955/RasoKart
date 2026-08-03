import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Download, TrendingUp, Wallet, ArrowDownToLine, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { getToken } from "@/lib/auth";
import { apiUrl } from "@/lib/api-url";

interface LedgerEntry {
  id: number;
  agentId: number;
  type: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  description: string;
  referenceId: string | null;
  createdAt: string;
}

interface LedgerResponse {
  data: LedgerEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  summary: { walletBalance: number; totalCommissionEarned: number; totalCommissionPaid: number };
}

const TYPE_META: Record<string, { label: string; className: string; sign: string }> = {
  earned:     { label: "Earned",     className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", sign: "+" },
  paid:       { label: "Paid Out",   className: "bg-sky-500/10 text-sky-400 border-sky-500/20",            sign: "−" },
  adjustment: { label: "Adjustment", className: "bg-amber-500/10 text-amber-400 border-amber-500/20",      sign: "±" },
};

function fmt(amount: string | number): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

async function fetchLedger(page: number): Promise<LedgerResponse> {
  const token = getToken();
  const res = await fetch(apiUrl(`/api/agent/commission/ledger?page=${page}&limit=20`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load commission ledger");
  return res.json();
}

function exportCsv(entries: LedgerEntry[]) {
  const header = "Date,Type,Amount,Balance Before,Balance After,Description,Reference";
  const rows = entries.map((e) => {
    const typeMeta = TYPE_META[e.type];
    const sign = typeMeta?.sign === "−" ? "-" : "+";
    return [
      fmtDate(e.createdAt),
      typeMeta?.label ?? e.type,
      `${sign}${parseFloat(e.amount).toFixed(2)}`,
      parseFloat(e.balanceBefore).toFixed(2),
      parseFloat(e.balanceAfter).toFixed(2),
      `"${e.description.replace(/"/g, '""')}"`,
      e.referenceId ?? "",
    ].join(",");
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `commission-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AgentCommission() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((p: number) => {
    setLoading(true);
    setError(null);
    fetchLedger(p)
      .then((d) => { setData(d); setPage(p); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(1); }, [load]);

  const summary = data?.summary;
  const pagination = data?.pagination;
  const entries = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Commission Ledger</h1>
        <p className="text-muted-foreground">Your commission history and wallet balance</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-border/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <TrendingUp className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Earned</p>
                {loading ? (
                  <Skeleton className="h-5 w-24 mt-1" />
                ) : (
                  <p className="text-lg font-bold">{summary ? fmt(summary.totalCommissionEarned) : "—"}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10">
                <ArrowDownToLine className="h-5 w-5 text-sky-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Paid Out</p>
                {loading ? (
                  <Skeleton className="h-5 w-24 mt-1" />
                ) : (
                  <p className="text-lg font-bold">{summary ? fmt(summary.totalCommissionPaid) : "—"}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                <Wallet className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Wallet Balance</p>
                {loading ? (
                  <Skeleton className="h-5 w-24 mt-1" />
                ) : (
                  <p className="text-lg font-bold">{summary ? fmt(summary.walletBalance) : "—"}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ledger table */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <BookOpen className="h-4 w-4 text-cyan-400" />
            Transaction History
            {pagination && pagination.total > 0 && (
              <Badge variant="outline" className="ml-1 text-xs border-border/40">
                {pagination.total}
              </Badge>
            )}
          </CardTitle>
          {entries.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => exportCsv(entries)}
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <AlertCircle className="h-8 w-8 text-rose-400/60" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="ghost" size="sm" onClick={() => load(page)}>Retry</Button>
            </div>
          ) : loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <BookOpen className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No commission entries yet.</p>
              <p className="text-xs text-muted-foreground/60">
                Commission is credited when your referred merchants' transactions settle.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/30 text-xs text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Date</th>
                      <th className="pb-2 text-left font-medium">Type</th>
                      <th className="pb-2 text-left font-medium">Description</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                      <th className="pb-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20">
                    {entries.map((entry) => {
                      const meta = TYPE_META[entry.type] ?? TYPE_META["adjustment"];
                      const amount = parseFloat(entry.amount);
                      const isDebit = meta.sign === "−";
                      return (
                        <tr key={entry.id} className="hover:bg-muted/20 transition-colors">
                          <td className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                            {fmtDate(entry.createdAt)}
                          </td>
                          <td className="py-2.5">
                            <Badge variant="outline" className={`text-xs ${meta.className}`}>
                              {meta.label}
                            </Badge>
                          </td>
                          <td className="py-2.5 text-xs max-w-xs truncate">
                            {entry.description}
                            {entry.referenceId && (
                              <span className="ml-1 text-muted-foreground/50">#{entry.referenceId}</span>
                            )}
                          </td>
                          <td className={`py-2.5 text-right text-xs font-mono font-medium ${isDebit ? "text-rose-400" : "text-emerald-400"}`}>
                            {isDebit ? "−" : "+"}{fmt(amount)}
                          </td>
                          <td className="py-2.5 text-right text-xs font-mono text-muted-foreground">
                            {fmt(entry.balanceAfter)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <div className="md:hidden space-y-2">
                {entries.map((entry) => {
                  const meta = TYPE_META[entry.type] ?? TYPE_META["adjustment"];
                  const amount = parseFloat(entry.amount);
                  const isDebit = meta.sign === "−";
                  return (
                    <div key={entry.id} className="rounded-lg border border-border/30 bg-card/20 px-3 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={`text-xs ${meta.className}`}>
                              {meta.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{fmtDate(entry.createdAt)}</span>
                          </div>
                          <p className="mt-1 text-xs truncate">{entry.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-mono font-bold ${isDebit ? "text-rose-400" : "text-emerald-400"}`}>
                            {isDebit ? "−" : "+"}{fmt(amount)}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">Bal: {fmt(entry.balanceAfter)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/20">
                  <p className="text-xs text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages} · {pagination.total} entries
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page <= 1 || loading}
                      onClick={() => load(pagination.page - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pagination.page >= pagination.totalPages || loading}
                      onClick={() => load(pagination.page + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
