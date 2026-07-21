import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ChevronLeft, ChevronRight, Wallet, ArrowRight, TrendingUp, Users } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function getToken() { return localStorage.getItem("rasokart_token") ?? ""; }
async function apiGet(path: string) {
  const r = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
const INR = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(v);

type WalletRow = {
  merchantId: number | null;
  businessName: string;
  email: string;
  merchantStatus: string;
  wallet: {
    availableBalance: number; pendingBalance: number; holdBalance: number;
    totalCollection: number; totalPayout: number;
    settlementBalance: number; payoutBalance: number;
    totalCharges: number; totalRefunds: number; totalReversals: number;
    updatedAt: string;
  } | null;
};

const STATUS_COLOR: Record<string, string> = {
  approved:  "border-emerald-500/40 text-emerald-400 bg-emerald-500/8",
  pending:   "border-amber-500/40 text-amber-400 bg-amber-500/8",
  rejected:  "border-rose-500/40 text-rose-400 bg-rose-500/8",
  suspended: "border-orange-500/40 text-orange-400 bg-orange-500/8",
};

export default function AdminWallets() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [env, setEnv] = useState("production");
  const LIMIT = 20;

  const { data, isLoading } = useQuery<{ data: WalletRow[]; total: number; page: number; limit: number }>({
    queryKey: ["admin-wallets-list", search, page, env],
    queryFn: () => apiGet(`/wallets?search=${encodeURIComponent(search)}&page=${page}&limit=${LIMIT}&env=${env}`),
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  // aggregate stats
  const totalAvailable  = rows.reduce((s, r) => s + (r.wallet?.availableBalance  ?? 0), 0);
  const totalPending    = rows.reduce((s, r) => s + (r.wallet?.pendingBalance    ?? 0), 0);
  const totalCollection = rows.reduce((s, r) => s + (r.wallet?.totalCollection   ?? 0), 0);

  function handleSearch(v: string) { setSearch(v); setPage(1); }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Merchant Wallets</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Real-time balance overview across all merchants</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total Available", value: totalAvailable, icon: Wallet, color: "text-emerald-400" },
          { label: "Total Pending", value: totalPending, icon: TrendingUp, color: "text-amber-400" },
          { label: "Total Collection", value: totalCollection, icon: Users, color: "text-sky-400" },
        ].map(c => (
          <Card key={c.label} className="border-border/60 bg-card">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-muted/40 ${c.color}`}><c.icon className="w-5 h-5" /></div>
              <div>
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className={`text-lg font-bold ${c.color}`}>{INR(c.value)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + env filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Search merchants…" value={search} onChange={e => handleSearch(e.target.value)}
            className="pl-9 border-border/60 bg-background text-sm" />
        </div>
        <Select value={env} onValueChange={v => { setEnv(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="production">Production</SelectItem>
            <SelectItem value="demo">Demo / Test</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="border-border/60 bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b border-border/40">
              {["Merchant", "Status", "Available", "Pending", "Hold", "Total Collection", ""].map(h => (
                <TableHead key={h} className="text-xs text-muted-foreground py-2">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground text-sm">No merchants found</TableCell></TableRow>
            ) : rows.map(row => (
              <TableRow key={row.businessName} className="hover:bg-muted/20 border-border/30">
                <TableCell className="py-3">
                  <p className="font-medium text-sm text-foreground">{row.businessName}</p>
                  <p className="text-xs text-muted-foreground">{row.email}</p>
                </TableCell>
                <TableCell className="py-3">
                  <Badge variant="outline" className={`text-[11px] px-2 py-0 ${STATUS_COLOR[row.merchantStatus] ?? ""}`}>
                    {row.merchantStatus}
                  </Badge>
                </TableCell>
                <TableCell className="py-3 font-medium text-sm text-emerald-400">
                  {row.wallet ? INR(row.wallet.availableBalance) : <span className="text-muted-foreground italic">—</span>}
                </TableCell>
                <TableCell className="py-3 text-sm text-amber-400">
                  {row.wallet ? INR(row.wallet.pendingBalance) : "—"}
                </TableCell>
                <TableCell className="py-3 text-sm text-orange-400">
                  {row.wallet ? INR(row.wallet.holdBalance) : "—"}
                </TableCell>
                <TableCell className="py-3 text-sm text-sky-400">
                  {row.wallet ? INR(row.wallet.totalCollection) : "—"}
                </TableCell>
                <TableCell className="py-3">
                  {row.merchantId && (
                    <Link href={`/admin/wallets/${row.merchantId}`}>
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground">
                        Details <ArrowRight className="w-3 h-3" />
                      </Button>
                    </Link>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {total > LIMIT && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
            <span className="text-xs text-muted-foreground">{total} merchants</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
