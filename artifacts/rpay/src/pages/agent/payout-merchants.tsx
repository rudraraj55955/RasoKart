import { useEffect, useState } from "react";
import { useUrlFilters } from "@/hooks/use-url-filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, Search, X } from "lucide-react";
import { getToken } from "@/lib/auth";
import { format } from "date-fns";

interface AgentMerchant {
  id: number;
  businessName: string;
  email: string;
  contactName: string;
  phone: string;
  status: string;
  payoutServiceEnabled: boolean;
  createdAt: string;
}

async function fetchMerchants(): Promise<AgentMerchant[]> {
  const token = getToken();
  const res = await fetch("/api/agent/payout-merchants", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Failed to load merchants");
  const data = await res.json();
  return data.data ?? [];
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  approved:  { label: "Active",    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  pending:   { label: "Pending",   className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  suspended: { label: "Suspended", className: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  rejected:  { label: "Rejected",  className: "bg-muted text-muted-foreground" },
};

export default function AgentPayoutMerchants() {
  const [merchants, setMerchants] = useState<AgentMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const urlFilters = useUrlFilters({ status: { default: "", allow: ["pending", "approved", "rejected", "suspended"] } });

  useEffect(() => {
    fetchMerchants()
      .then(setMerchants)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = merchants.filter((m) => {
    const q = search.toLowerCase();
    const matchesSearch = m.businessName?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q);
    const matchesStatus = !urlFilters.status || m.status === urlFilters.status;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">My Payout Merchants</h1>
        <p className="text-muted-foreground">Merchants you have onboarded</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search merchants…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {urlFilters.status && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Active filter:</span>
          <button
            onClick={() => urlFilters.set("status", "")}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/30 text-xs px-2.5 py-1 hover:bg-primary/20 transition-colors capitalize"
          >
            Status: {STATUS_BADGE[urlFilters.status]?.label ?? urlFilters.status}
            <X className="w-3 h-3 ml-0.5" />
          </button>
        </div>
      )}

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 text-primary" />
            Merchants
            <Badge variant="outline" className="ml-1 text-xs">{filtered.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? "No merchants match your search." : "No merchants onboarded yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Business</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Contact</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Payout</th>
                    <th className="text-left py-2 text-xs font-medium text-muted-foreground">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filtered.map((m) => {
                    const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE["pending"];
                    return (
                      <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 pr-4">
                          <p className="font-medium">{m.businessName}</p>
                          <p className="text-xs text-muted-foreground">{m.email}</p>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">{m.contactName}</td>
                        <td className="py-3 pr-4">
                          <Badge variant="outline" className={`text-xs ${badge.className}`}>{badge.label}</Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge
                            variant="outline"
                            className={`text-xs ${m.payoutServiceEnabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-muted text-muted-foreground"}`}
                          >
                            {m.payoutServiceEnabled ? "Enabled" : "Disabled"}
                          </Badge>
                        </td>
                        <td className="py-3 text-xs text-muted-foreground">
                          {m.createdAt ? format(new Date(m.createdAt), "dd MMM yyyy") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
