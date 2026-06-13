import { useState } from "react";
import { useListProviders, useListMerchantConnections } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Search, AtSign, Smartphone, Store, Landmark, Building, Zap, RefreshCw, Link2 } from "lucide-react";
import { toast } from "sonner";

const STATUS_META: Record<string, { label: string; color: string; live: boolean }> = {
  live:         { label: "Live",        color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", live: true },
  testing:      { label: "Testing",     color: "bg-amber-500/10 text-amber-400 border-amber-500/30",       live: true },
  coming_soon:  { label: "Coming Soon", color: "bg-sky-500/10 text-sky-400 border-sky-500/30",             live: false },
  disabled:     { label: "Disabled",    color: "bg-muted text-muted-foreground border-border",             live: false },
};

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  upi:     { label: "UPI",     color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  bank:    { label: "Bank",    color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  gateway: { label: "Gateway", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
};

const ICONS: Record<string, React.ReactNode> = {
  upi_id:        <AtSign className="w-7 h-7 text-emerald-400" />,
  google_pay:    <Zap className="w-7 h-7 text-blue-400" />,
  phonepe:       <Smartphone className="w-7 h-7 text-purple-400" />,
  paytm:         <Smartphone className="w-7 h-7 text-blue-500" />,
  bharatpe:      <Store className="w-7 h-7 text-green-400" />,
  freecharge:    <Zap className="w-7 h-7 text-rose-400" />,
  yono_sbi:      <Landmark className="w-7 h-7 text-red-400" />,
  sbi_yono:      <Landmark className="w-7 h-7 text-red-400" />,
  hdfc_smarthub: <Building className="w-7 h-7 text-yellow-400" />,
};

const PROVIDER_WHITE_LABEL: Record<string, string> = {
  google_pay:    "RasoKart UPI",
  phonepe:       "RasoKart Collect",
  paytm:         "RasoKart Wallet",
  bharatpe:      "RasoKart Merchant",
  freecharge:    "RasoKart Pay",
  amazon_pay:    "RasoKart Digital",
  mobikwik:      "Mobile Wallet",
  sbi_yono:      "Bank UPI",
  yono_sbi:      "Bank UPI",
  hdfc_smarthub: "Bank SmartQR",
  icici_eazypay: "Bank QR",
  axis_pay:      "Bank QR",
  kotak_smart:   "Bank Smart Collect",
  razorpay:      "RasoKart Gateway",
  cashfree:      "RasoKart Payments",
  payu:          "RasoKart Gateway Plus",
  ekqr:          "RasoKart QR Gateway",
};

const PROVIDER_WHITE_LABEL_DESC: Record<string, string> = {
  google_pay:    "Fast UPI collections for your business",
  phonepe:       "QR-based UPI merchant payments",
  paytm:         "UPI, wallet, and net banking collections",
  bharatpe:      "Zero MDR UPI collections via QR",
  freecharge:    "UPI collections — launching soon",
  amazon_pay:    "UPI merchant checkout — launching soon",
  mobikwik:      "Mobile wallet payment gateway — launching soon",
  sbi_yono:      "Bank merchant collection account",
  yono_sbi:      "Bank merchant collection account",
  hdfc_smarthub: "All-in-one bank merchant solution",
  icici_eazypay: "Bank merchant collection gateway",
  axis_pay:      "Bank merchant payment gateway",
  kotak_smart:   "Bank merchant digital payments",
  razorpay:      "Full-stack payment gateway — cards, UPI, wallets",
  cashfree:      "Multi-mode payment gateway",
  payu:          "Merchant payment gateway",
  ekqr:          "Dynamic QR & auto-credit deposits",
};

function wlName(slug: string, name: string): string {
  return PROVIDER_WHITE_LABEL[slug] ?? name;
}

function wlDesc(slug: string, desc?: string | null): string | null {
  return PROVIDER_WHITE_LABEL_DESC[slug] ?? desc ?? null;
}

function ProviderIcon({ slug }: { slug: string }) {
  return ICONS[slug] ?? <Zap className="w-7 h-7 text-muted-foreground" />;
}

function usagePct(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function usageColor(pct: number) {
  if (pct >= 100) return "text-rose-400";
  if (pct >= 80) return "text-amber-400";
  return "text-emerald-400";
}

function progressColor(pct: number) {
  if (pct >= 100) return "[&>div]:bg-rose-500";
  if (pct >= 80) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-emerald-500";
}

export default function MerchantConnect() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [connectDialog, setConnectDialog] = useState<any | null>(null);

  const { data, isLoading, refetch } = useListProviders();
  const providers = data?.data ?? [];

  const { data: connections, isLoading: connectionsLoading } = useListMerchantConnections();

  const filtered = providers.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === "all" || p.category === categoryFilter;
    const matchStatus = statusFilter === "all" || p.status === statusFilter;
    return matchSearch && matchCat && matchStatus;
  });

  // Group by live-capable vs coming soon
  const liveProviders = filtered.filter(p => p.status === "live" || p.status === "testing");
  const comingSoon = filtered.filter(p => p.status === "coming_soon");

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payment Providers</h1>
          <p className="text-sm text-muted-foreground mt-1">Connect your payment provider accounts to start collecting payments</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {/* Stats summary */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span><span className="font-semibold text-foreground">{providers.length}</span> providers available</span>
        <span>·</span>
        <span><span className="font-semibold text-emerald-400">{liveProviders.length}</span> ready to connect</span>
        {comingSoon.length > 0 && (<><span>·</span><span><span className="font-semibold text-sky-400">{comingSoon.length}</span> coming soon</span></>)}
      </div>

      {/* Active connections with monthly usage */}
      {(connectionsLoading || (connections && connections.length > 0)) && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5" /> Your Active Connections
          </h2>
          {connectionsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {Array.from({ length: 2 }).map((_, i) => <Card key={i} className="animate-pulse h-28 bg-muted/30" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {connections!.map(conn => {
                const pct = usagePct(conn.monthlyUsed, conn.monthlyLimit);
                const hasLimit = conn.monthlyLimit > 0;
                const usedFmt = `₹${Math.round(conn.monthlyUsed).toLocaleString("en-IN")}`;
                const limitFmt = hasLimit ? `₹${Math.round(conn.monthlyLimit).toLocaleString("en-IN")}` : null;
                return (
                  <Card key={conn.id} className={`border-border/60 bg-card ${!conn.isActive ? "opacity-60" : ""}`}>
                    <CardContent className="pt-4 pb-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-background border border-border/60 flex items-center justify-center shrink-0">
                            <ProviderIcon slug={conn.provider} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold">{PROVIDER_WHITE_LABEL[conn.provider] ?? conn.provider.replace(/_/g, " ")}</p>
                            <p className="text-xs text-muted-foreground">Provider connection</p>
                          </div>
                        </div>
                        <Badge variant="outline" className={`text-xs ${conn.isActive ? "border-emerald-500/40 text-emerald-400" : "border-muted text-muted-foreground"}`}>
                          {conn.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Used this month</span>
                          <span className={`font-semibold tabular-nums ${hasLimit ? usageColor(pct) : "text-foreground"}`}>
                            {usedFmt}{hasLimit ? ` / ${limitFmt}` : ""}
                          </span>
                        </div>
                        {hasLimit && (
                          <>
                            <Progress value={pct} className={`h-1.5 bg-muted/40 ${progressColor(pct)}`} />
                            <p className="text-xs text-muted-foreground text-right">{pct}% of monthly limit</p>
                          </>
                        )}
                        {!hasLimit && (
                          <p className="text-xs text-muted-foreground">No monthly limit set</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search providers…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="upi">UPI</SelectItem>
            <SelectItem value="bank">Bank</SelectItem>
            <SelectItem value="gateway">Gateway</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="live">Live</SelectItem>
            <SelectItem value="testing">Testing</SelectItem>
            <SelectItem value="coming_soon">Coming Soon</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Card key={i} className="animate-pulse h-44 bg-muted/30" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No providers match your filters</p>
        </div>
      ) : (
        <>
          {/* Live / Testing providers */}
          {liveProviders.length > 0 && (
            <div className="space-y-3">
              {(statusFilter === "all" || statusFilter === "live" || statusFilter === "testing") && (
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Available Providers</h2>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {liveProviders.map(p => {
                  const smeta = STATUS_META[p.status] ?? STATUS_META.disabled;
                  const cmeta = CATEGORY_META[p.category] ?? { label: p.category, color: "bg-muted text-muted-foreground border-border" };
                  return (
                    <Card key={p.id} className="border-border/60 hover:border-primary/40 transition-colors bg-card">
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-3">
                          <div className="w-14 h-14 rounded-xl bg-background border border-border/60 flex items-center justify-center shrink-0">
                            <ProviderIcon slug={p.slug} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base truncate">{wlName(p.slug, p.name)}</CardTitle>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <Badge variant="outline" className={`text-xs ${cmeta.color}`}>{cmeta.label}</Badge>
                              <Badge variant="outline" className={`text-xs ${smeta.color}`}>{smeta.label}</Badge>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {wlDesc(p.slug, p.description) ? (
                          <p className="text-xs text-muted-foreground leading-relaxed">{wlDesc(p.slug, p.description)}</p>
                        ) : null}
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={p.status !== "live"}
                          onClick={() => p.status === "live" && setConnectDialog(p)}
                          title={p.status !== "live" ? "Available soon" : undefined}
                        >
                          {p.status === "live" ? "Connect" : "Coming Soon"}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Coming Soon */}
          {comingSoon.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Coming Soon</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {comingSoon.map(p => {
                  const cmeta = CATEGORY_META[p.category] ?? { label: p.category, color: "bg-muted text-muted-foreground border-border" };
                  return (
                    <Card key={p.id} className="border-border/30 bg-muted/10 opacity-70">
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-3">
                          <div className="w-14 h-14 rounded-xl bg-background/50 border border-border/30 flex items-center justify-center shrink-0 grayscale">
                            <ProviderIcon slug={p.slug} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-base text-muted-foreground truncate">{wlName(p.slug, p.name)}</CardTitle>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge variant="outline" className={`text-xs ${cmeta.color}`}>{cmeta.label}</Badge>
                              <Badge variant="outline" className="text-xs bg-sky-500/10 text-sky-400 border-sky-500/30">Coming Soon</Badge>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {wlDesc(p.slug, p.description) ? (
                          <p className="text-xs text-muted-foreground mb-3">{wlDesc(p.slug, p.description)}</p>
                        ) : null}
                        <Button size="sm" className="w-full" variant="outline" disabled>
                          Coming Soon
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Connect Dialog (placeholder) */}
      <Dialog open={!!connectDialog} onOpenChange={open => !open && setConnectDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {connectDialog && <ProviderIcon slug={connectDialog.slug} />}
              Connect {connectDialog ? wlName(connectDialog.slug, connectDialog.name) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
              <p className="text-sm text-muted-foreground">
                Provider connection setup is coming soon. Your admin will configure the integration credentials for <strong>{connectDialog ? wlName(connectDialog.slug, connectDialog.name) : ""}</strong>.
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Provider</Label>
                <p className="text-sm font-medium">{connectDialog ? wlName(connectDialog.slug, connectDialog.name) : ""}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Category</Label>
                <p className="text-sm">{CATEGORY_META[connectDialog?.category]?.label ?? connectDialog?.category}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Status</Label>
                {connectDialog && (
                  <Badge variant="outline" className={`text-xs ${STATUS_META[connectDialog.status]?.color}`}>
                    {STATUS_META[connectDialog.status]?.label}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialog(null)}>Close</Button>
            <Button disabled onClick={() => { toast.info("Provider connections will be available soon"); setConnectDialog(null); }}>
              Connect (Coming Soon)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
