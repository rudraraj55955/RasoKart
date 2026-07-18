import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft, X } from "lucide-react";
import { getToken } from "@/lib/auth";
import { format } from "date-fns";
import { useUrlFilters } from "@/hooks/use-url-filters";

interface Payout {
  id: number;
  merchantId: number;
  amount: string;
  mode: string | null;
  localStatus: string | null;
  transferStatus: string | null;
  approvalType: string | null;
  approvedBySystem: boolean | null;
  createdAt: string;
}

async function fetchPayouts(): Promise<Payout[]> {
  const token = getToken();
  const res = await fetch("/api/payout-admin/payouts?limit=50", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load payouts");
  const data = await res.json();
  return data.data ?? [];
}

const LOCAL_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  PENDING_ADMIN_APPROVAL: { label: "Pending Approval", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  APPROVED:               { label: "Approved",          className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  REJECTED:               { label: "Rejected",          className: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  CREATED:                { label: "Created",           className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
};

const TRANSFER_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  SUCCESS:    { label: "Sent",       className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  FAILED:     { label: "Failed",     className: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  REVERSED:   { label: "Reversed",   className: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  INITIATED:  { label: "Processing", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  PROCESSING: { label: "Processing", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
};

export default function PayoutAdminPayouts() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const urlFilters = useUrlFilters({
    status: { default: "", allow: ["PENDING_ADMIN_APPROVAL", "APPROVED", "REJECTED", "CREATED"] },
  });

  useEffect(() => {
    fetchPayouts()
      .then(setPayouts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const visiblePayouts = urlFilters.status
    ? payouts.filter((p) => p.localStatus === urlFilters.status)
    : payouts;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Payouts</h1>
        <p className="text-muted-foreground">All payout requests across merchants</p>
      </div>

      {urlFilters.status && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Active filter:</span>
          <button
            onClick={() => urlFilters.set("status", "")}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary border border-primary/30 text-xs px-2.5 py-1 hover:bg-primary/20 transition-colors"
          >
            {LOCAL_STATUS_BADGE[urlFilters.status]?.label ?? urlFilters.status}
            <X className="w-3 h-3 ml-0.5" />
          </button>
        </div>
      )}

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Recent Payouts
            <Badge variant="outline" className="ml-1 text-xs">{visiblePayouts.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
          ) : visiblePayouts.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No payouts found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">ID</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Amount</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Mode</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Transfer</th>
                    <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Approval</th>
                    <th className="text-left py-2 text-xs font-medium text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {visiblePayouts.map((p) => {
                    const localBadge = LOCAL_STATUS_BADGE[p.localStatus ?? ""] ?? { label: p.localStatus ?? "—", className: "bg-muted text-muted-foreground" };
                    const transferBadge = p.transferStatus ? TRANSFER_STATUS_BADGE[p.transferStatus] : null;
                    return (
                      <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 pr-4 text-muted-foreground">#{p.id}</td>
                        <td className="py-3 pr-4 font-medium">₹{Number(p.amount).toLocaleString()}</td>
                        <td className="py-3 pr-4 text-muted-foreground">{p.mode ?? "—"}</td>
                        <td className="py-3 pr-4">
                          <Badge variant="outline" className={`text-xs ${localBadge.className}`}>{localBadge.label}</Badge>
                        </td>
                        <td className="py-3 pr-4">
                          {transferBadge ? (
                            <Badge variant="outline" className={`text-xs ${transferBadge.className}`}>{transferBadge.label}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge
                            variant="outline"
                            className={`text-xs ${p.approvalType === "AUTO" ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" : "bg-muted text-muted-foreground"}`}
                          >
                            {p.approvalType === "AUTO" ? "Auto" : "Manual"}
                          </Badge>
                        </td>
                        <td className="py-3 text-xs text-muted-foreground">
                          {p.createdAt ? format(new Date(p.createdAt), "dd MMM, HH:mm") : "—"}
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
