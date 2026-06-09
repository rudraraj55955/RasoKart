import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Download, Users, CheckCircle2, XCircle, Shield, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";

const FEATURES = [
  { key: "dynamicQr",      label: "Dynamic QR",   short: "DQR", color: "text-primary" },
  { key: "staticQr",       label: "Static QR",    short: "SQR", color: "text-violet-400" },
  { key: "virtualAccount", label: "Virtual Acct", short: "VA",  color: "text-blue-400" },
  { key: "paymentLinks",   label: "Pay Links",    short: "PL",  color: "text-emerald-400" },
  { key: "payouts",        label: "Payouts",      short: "PO",  color: "text-amber-400" },
  { key: "withdrawals",    label: "Withdrawals",  short: "WD",  color: "text-rose-400" },
  { key: "settlements",    label: "Settlements",  short: "ST",  color: "text-sky-400" },
  { key: "webhooks",       label: "Webhooks",     short: "WH",  color: "text-orange-400" },
  { key: "apiKeys",        label: "API Keys",     short: "AK",  color: "text-pink-400" },
  { key: "csvExport",      label: "CSV Export",   short: "CSV", color: "text-indigo-400" },
] as const;

function getToken() { return localStorage.getItem("rasokart_token") ?? ""; }
async function api(method: string, path: string) {
  const res = await fetch(`/api${path}`, { method, headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) { const e = await res.json().catch(() => ({ error: "Unknown error" })); throw new Error(e.error ?? "Request failed"); }
  return res.json();
}

function FeatureCell({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex justify-center">
          {enabled
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            : <XCircle className="w-4 h-4 text-muted-foreground/30" />
          }
        </div>
      </TooltipTrigger>
      <TooltipContent>{label}: {enabled ? "Enabled" : "Disabled"}</TooltipContent>
    </Tooltip>
  );
}

export default function AdminMerchantAccess() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("approved");
  const [page, setPage] = useState(1);
  const [detailRow, setDetailRow] = useState<any | null>(null);
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery({
    queryKey: ["merchant-access", search, statusFilter, page],
    queryFn: () => api("GET", `/feature-control?search=${encodeURIComponent(search)}&status=${statusFilter}&page=${page}&limit=25`),
  });

  const rows: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;

  function handleCsvExport() {
    fetch(`/api/feature-control/export/csv?search=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    }).then(r => r.blob()).then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `merchant-access-${Date.now()}.csv`;
      a.click();
    });
  }

  const enabledCounts = FEATURES.map(f => ({
    key: f.key,
    count: rows.filter((r: any) => r.features?.[f.key]).length,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Merchant Access Matrix</h1>
          <p className="text-muted-foreground mt-1">Combined view of features enabled per merchant</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/admin/feature-control")}>
            <Shield className="w-4 h-4 mr-2" />Edit Features
          </Button>
          <Button variant="outline" size="sm" onClick={handleCsvExport}>
            <Download className="w-4 h-4 mr-2" />Export CSV
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-5 gap-2">
        {enabledCounts.slice(0, 5).map(({ key, count }) => {
          const f = FEATURES.find(f => f.key === key)!;
          return (
            <Card key={key} className="border-border/50">
              <CardContent className="p-3 text-center">
                <p className={`text-xl font-bold ${f.color}`}>{count}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{f.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search merchants..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px] sticky left-0 bg-background z-10">Merchant</TableHead>
                <TableHead>Status</TableHead>
                {FEATURES.map(f => (
                  <TableHead key={f.key} className="text-center min-w-[60px]">
                    <Tooltip>
                      <TooltipTrigger className={`cursor-default text-xs font-medium ${f.color}`}>{f.short}</TooltipTrigger>
                      <TooltipContent>{f.label}</TooltipContent>
                    </Tooltip>
                  </TableHead>
                ))}
                <TableHead>Enabled Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: FEATURES.length + 3 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !rows.length ? (
                <TableRow>
                  <TableCell colSpan={FEATURES.length + 3} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Users className="w-8 h-8 opacity-30" />
                      <p className="text-sm">No merchants found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : rows.map((row: any) => {
                const enabledCount = FEATURES.filter(f => row.features?.[f.key]).length;
                const hasFeatures = !!row.features;
                return (
                  <TableRow
                    key={row.merchantId}
                    className="cursor-pointer hover:bg-muted/10"
                    onClick={() => setDetailRow(row)}
                  >
                    <TableCell className="sticky left-0 bg-background">
                      <div>
                        <p className="text-sm font-medium">{row.businessName}</p>
                        <p className="text-xs text-muted-foreground">{row.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs capitalize ${
                          row.status === "approved" ? "border-emerald-500/40 text-emerald-400" :
                          row.status === "pending" ? "border-amber-500/40 text-amber-400" :
                          "border-rose-500/40 text-rose-400"
                        }`}
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                    {FEATURES.map(f => (
                      <TableCell key={f.key} className="text-center">
                        {hasFeatures
                          ? <FeatureCell enabled={row.features[f.key]} label={f.label} />
                          : <span className="text-xs text-muted-foreground/30">—</span>
                        }
                      </TableCell>
                    ))}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-muted/20 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-primary"
                            style={{ width: `${hasFeatures ? (enabledCount / FEATURES.length) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{hasFeatures ? `${enabledCount}/10` : "—"}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > 25 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} merchants</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm text-muted-foreground flex items-center px-2">Page {page}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 25 >= total}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      <Dialog open={!!detailRow} onOpenChange={() => setDetailRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailRow?.businessName}</DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{detailRow.email} · {detailRow.status}</p>
              <div className="grid grid-cols-2 gap-2">
                {FEATURES.map(f => {
                  const enabled = detailRow.features?.[f.key] ?? false;
                  return (
                    <div key={f.key} className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${enabled ? "border-emerald-500/20 bg-emerald-500/5" : "border-border/50 bg-muted/5"}`}>
                      {enabled
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        : <XCircle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                      }
                      <span className={enabled ? "text-foreground" : "text-muted-foreground"}>{f.label}</span>
                    </div>
                  );
                })}
              </div>
              {!detailRow.features && (
                <p className="text-xs text-center text-muted-foreground italic">No feature configuration set — merchant uses system defaults</p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={() => { setDetailRow(null); navigate("/admin/feature-control"); }}
              >
                <Shield className="w-3.5 h-3.5 mr-1.5" />
                Edit in Feature Control
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
