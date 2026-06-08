import { useState } from "react";
import { useListProviders } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Search, AtSign, Smartphone, Store, Landmark, Building, Zap, RefreshCw } from "lucide-react";
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
  hdfc_smarthub: <Building className="w-7 h-7 text-yellow-400" />,
};

function ProviderIcon({ slug }: { slug: string }) {
  return ICONS[slug] ?? <Zap className="w-7 h-7 text-muted-foreground" />;
}

export default function MerchantConnect() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [connectDialog, setConnectDialog] = useState<any | null>(null);

  const { data, isLoading, refetch } = useListProviders();
  const providers = data?.data ?? [];

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
                            <CardTitle className="text-base truncate">{p.name}</CardTitle>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              <Badge variant="outline" className={`text-xs ${cmeta.color}`}>{cmeta.label}</Badge>
                              <Badge variant="outline" className={`text-xs ${smeta.color}`}>{smeta.label}</Badge>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {p.description && (
                          <p className="text-xs text-muted-foreground leading-relaxed">{p.description}</p>
                        )}
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
                            <CardTitle className="text-base text-muted-foreground truncate">{p.name}</CardTitle>
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge variant="outline" className={`text-xs ${cmeta.color}`}>{cmeta.label}</Badge>
                              <Badge variant="outline" className="text-xs bg-sky-500/10 text-sky-400 border-sky-500/30">Coming Soon</Badge>
                            </div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {p.description && (
                          <p className="text-xs text-muted-foreground mb-3">{p.description}</p>
                        )}
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
              Connect {connectDialog?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
              <p className="text-sm text-muted-foreground">
                Provider connection setup is coming soon. Your admin will configure the integration credentials for <strong>{connectDialog?.name}</strong>.
              </p>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Provider</Label>
                <p className="text-sm font-medium">{connectDialog?.name}</p>
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
