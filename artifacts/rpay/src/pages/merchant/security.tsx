import { useState } from "react";
import { useListMySecurityActivity } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, ChevronLeft, ChevronRight, AlertCircle, UserCog, CreditCard, KeyRound, Webhook, FileText, Sliders, Info } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

const ACTION_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  merchant_approved:        { label: "Account Approved",        icon: <UserCog className="w-4 h-4" />,   color: "text-emerald-400" },
  merchant_suspended:       { label: "Account Suspended",       icon: <AlertCircle className="w-4 h-4" />, color: "text-red-400" },
  merchant_reinstated:      { label: "Account Reinstated",      icon: <UserCog className="w-4 h-4" />,   color: "text-emerald-400" },
  merchant_rejected:        { label: "Account Rejected",        icon: <AlertCircle className="w-4 h-4" />, color: "text-red-400" },
  plan_assigned:            { label: "Plan Assigned",           icon: <CreditCard className="w-4 h-4" />, color: "text-blue-400" },
  plan_suspended:           { label: "Plan Suspended",          icon: <AlertCircle className="w-4 h-4" />, color: "text-amber-400" },
  plan_reinstated:          { label: "Plan Reinstated",         icon: <CreditCard className="w-4 h-4" />, color: "text-emerald-400" },
  api_key_reset:            { label: "API Key Reset",           icon: <KeyRound className="w-4 h-4" />,   color: "text-amber-400" },
  webhook_url_changed:      { label: "Webhook URL Changed",     icon: <Webhook className="w-4 h-4" />,    color: "text-amber-400" },
  settlement_approved:      { label: "Settlement Approved",     icon: <FileText className="w-4 h-4" />,   color: "text-emerald-400" },
  settlement_rejected:      { label: "Settlement Rejected",     icon: <FileText className="w-4 h-4" />,   color: "text-red-400" },
  settlement_paid:          { label: "Settlement Paid",         icon: <FileText className="w-4 h-4" />,   color: "text-emerald-400" },
  feature_toggle:           { label: "Feature Changed",         icon: <Sliders className="w-4 h-4" />,    color: "text-blue-400" },
};

function actionMeta(action: string) {
  return ACTION_META[action] ?? { label: formatAction(action), icon: <Shield className="w-4 h-4" />, color: "text-muted-foreground" };
}

function formatAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function actionBadgeVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.includes("rejected") || action.includes("suspended")) return "destructive";
  if (action.includes("approved") || action.includes("reinstated") || action.includes("paid")) return "secondary";
  return "outline";
}

export default function MerchantSecurityPage() {
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const { data, isLoading } = useListMySecurityActivity({ page, limit: LIMIT });

  const entries = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="w-6 h-6 text-primary" />
          Security Activity
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          A log of admin-initiated changes made to your account
        </p>
      </div>

      <Card className="border-blue-500/20 bg-blue-950/10">
        <CardContent className="py-3 flex items-start gap-3">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-300/80">
            This log shows actions performed by RasoKart platform administrators on your account.
            Admin identities are partially redacted for privacy. If you have concerns about any
            entry, please contact support.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Shield className="w-10 h-10 opacity-20" />
              <p className="text-sm">No admin activity on your account yet</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {entries.map((entry) => {
                const meta = actionMeta(entry.action);
                return (
                  <li key={entry.id} className="flex items-start gap-4 px-5 py-4">
                    <div className={`mt-0.5 shrink-0 ${meta.color}`}>
                      {meta.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{meta.label}</span>
                        <Badge variant={actionBadgeVariant(entry.action)} className="text-[10px] px-1.5 py-0 h-4">
                          {entry.targetType}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        By <span className="font-mono">{entry.adminEmail}</span>
                      </p>
                      {entry.details && (() => {
                        try {
                          const parsed = JSON.parse(entry.details);
                          const interesting = Object.entries(parsed)
                            .filter(([k]) => !["merchantId", "merchantIds", "adminId"].includes(k))
                            .slice(0, 3);
                          if (interesting.length === 0) return null;
                          return (
                            <p className="text-xs text-muted-foreground/70 mt-1">
                              {interesting.map(([k, v]) => `${formatAction(k)}: ${v}`).join(" · ")}
                            </p>
                          );
                        } catch {
                          return null;
                        }
                      })()}
                      <p className="text-[11px] text-muted-foreground/50 mt-1">
                        {format(new Date(entry.createdAt), "dd MMM yyyy, HH:mm")}
                        {" · "}
                        {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {totalPages} · {total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
