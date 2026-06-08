import { useGetMyPlan, useGetMyPlanUsage, useGetMyPlanHistory, useListInvoices } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CreditCard, Clock, CheckCircle2, Shield, Webhook, KeyRound, Percent,
  TrendingUp, Infinity, AlertTriangle, ChevronRight, History, Lock, Receipt
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

function LimitBadge({ value }: { value: number }) {
  if (value >= 999) return <span className="flex items-center gap-1 text-emerald-400 font-mono text-sm"><Infinity className="w-3.5 h-3.5" /> Unlimited</span>;
  return <span className="font-mono text-sm">{value.toLocaleString()}</span>;
}

function FeaturePill({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400"}`}>
      {enabled ? <CheckCircle2 className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
      {label}
    </div>
  );
}

const ACTION_META: Record<string, { label: string; color: string }> = {
  assigned: { label: "Plan Assigned", color: "text-sky-400" },
  upgraded: { label: "Upgraded", color: "text-emerald-400" },
  downgraded: { label: "Downgraded", color: "text-amber-400" },
  renewed: { label: "Renewed", color: "text-violet-400" },
  expired: { label: "Expired", color: "text-rose-400" },
  removed: { label: "Removed", color: "text-muted-foreground" },
};

const INVOICE_STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  overdue: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  void: "bg-muted/30 text-muted-foreground border-border/40",
};

export default function MerchantPlanPage() {
  const { data: plan } = useGetMyPlan();
  const { data: usage } = useGetMyPlanUsage();
  const { data: history } = useGetMyPlanHistory();
  const { data: invoicesData } = useListInvoices({});

  const isExpiringSoon = plan && !plan.isExpired && plan.daysUntilExpiry != null && plan.daysUntilExpiry <= 7;
  const tierColor = plan?.planName === "Platinum" ? "text-yellow-400" :
    plan?.planName === "Gold" ? "text-amber-400" :
    plan?.planName === "Silver" ? "text-slate-300" :
    plan?.planName === "Custom" ? "text-violet-400" :
    "text-sky-400";

  let features: string[] = [];
  if (plan?.features) { try { features = JSON.parse(plan.features); } catch {} }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Plan & Billing</h1>
        <p className="text-muted-foreground mt-1">Your subscription details, usage, and billing history.</p>
      </div>

      {!plan ? (
        <Card className="border-dashed border-muted-foreground/30">
          <CardContent className="py-10 flex flex-col items-center gap-3 text-muted-foreground">
            <CreditCard className="w-8 h-8 opacity-40" />
            <p className="text-sm">No plan assigned yet. Contact support to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Plan Banner */}
          <Card className={`border ${plan.isExpired ? "border-rose-500/40 bg-rose-950/20" : isExpiringSoon ? "border-amber-500/40 bg-amber-950/20" : "border-primary/30 bg-primary/5"}`}>
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-2xl font-bold ${tierColor}`}>{plan.planName}</span>
                    {plan.status === "suspended" ? (
                      <Badge className="text-xs bg-orange-500/20 text-orange-400 border-orange-500/30">Suspended</Badge>
                    ) : plan.isExpired ? (
                      <Badge variant="destructive" className="text-xs">Expired</Badge>
                    ) : isExpiringSoon ? (
                      <Badge className="text-xs bg-amber-500/20 text-amber-400 border-amber-500/30">Expiring Soon</Badge>
                    ) : (
                      <Badge className="text-xs bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Active</Badge>
                    )}
                  </div>
                  {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
                  <div className="flex flex-wrap gap-2">
                    <FeaturePill enabled={plan.apiAccess} label="API Access" />
                    <FeaturePill enabled={plan.webhookAccess} label="Webhooks" />
                  </div>
                </div>
                <div className="text-right space-y-1 sm:shrink-0">
                  {plan.monthlyFee && plan.monthlyFee !== "0" ? (
                    <p className="text-2xl font-bold">₹{parseInt(plan.monthlyFee).toLocaleString()}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                  ) : plan.planName === "Custom" ? (
                    <p className="text-sm text-muted-foreground">Contact sales</p>
                  ) : (
                    <p className="text-lg font-bold text-emerald-400">Free</p>
                  )}
                  {plan.yearlyFee && plan.yearlyFee !== "0" && (
                    <p className="text-xs text-muted-foreground">₹{parseInt(plan.yearlyFee).toLocaleString()}/yr</p>
                  )}
                </div>
              </div>

              <Separator className="my-4 bg-border/50" />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Assigned</p>
                  <p className="font-medium">{format(new Date(plan.assignedAt), "MMM d, yyyy")}</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Expires</p>
                  {plan.expiresAt ? (
                    <p className={`font-medium ${plan.isExpired ? "text-rose-400" : isExpiringSoon ? "text-amber-400" : ""}`}>
                      {format(new Date(plan.expiresAt), "MMM d, yyyy")}
                      {plan.daysUntilExpiry !== null && !plan.isExpired && (
                        <span className="text-xs text-muted-foreground ml-1">({plan.daysUntilExpiry}d left)</span>
                      )}
                    </p>
                  ) : (
                    <p className="font-medium text-emerald-400">No expiry</p>
                  )}
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Settlement Fee</p>
                  <p className="font-medium flex items-center gap-1"><Percent className="w-3 h-3" />{plan.settlementFee}%</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Deposit Fee</p>
                  <p className="font-medium flex items-center gap-1"><Percent className="w-3 h-3" />{plan.depositFee}%</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {plan.isExpired && (
            <Card className="border-rose-500/30 bg-rose-950/20">
              <CardContent className="py-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                <p className="text-sm text-rose-400">Your plan has expired. New QR codes, virtual accounts, and payouts are restricted. Please contact support to renew.</p>
              </CardContent>
            </Card>
          )}

          {isExpiringSoon && !plan.isExpired && (
            <Card className="border-amber-500/30 bg-amber-950/20">
              <CardContent className="py-4 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <p className="text-sm text-amber-400">Your plan expires in {plan.daysUntilExpiry} day{plan.daysUntilExpiry === 1 ? "" : "s"}. Contact support to renew.</p>
              </CardContent>
            </Card>
          )}

          {/* Usage grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" /> Feature Usage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {usage ? (
                  <>
                    {[
                      { label: "Dynamic QR Codes", d: usage.dynamicQr },
                      { label: "Static QR Codes", d: usage.staticQr },
                      { label: "Virtual Accounts", d: usage.virtualAccount },
                      { label: "Payment Links", d: usage.paymentLink },
                      { label: "Payouts", d: usage.payout },
                    ].map(({ label, d }) => {
                      const isUnlimited = d.limit >= 999;
                      const pct = isUnlimited ? 0 : Math.min(100, (d.used / d.limit) * 100);
                      const isNear = !isUnlimited && pct >= 80;
                      const isAt = !isUnlimited && d.used >= d.limit;
                      return (
                        <div key={label} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{label}</span>
                            <span className={`font-medium tabular-nums ${isAt ? "text-rose-400" : isNear ? "text-amber-400" : ""}`}>
                              {isUnlimited
                                ? <span className="flex items-center gap-1">{d.used} / <Infinity className="w-3.5 h-3.5 text-emerald-400" /></span>
                                : `${d.used} / ${d.limit}`}
                            </span>
                          </div>
                          {!isUnlimited && (
                            <div className="h-1.5 w-full rounded-full bg-muted/50">
                              <div className={`h-1.5 rounded-full transition-all ${isAt ? "bg-rose-500" : isNear ? "bg-amber-400" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-6 bg-muted/30 animate-pulse rounded" />)}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" /> Transaction Limits
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {usage ? (
                  <>
                    {[
                      { label: "Today", d: usage.dailyTransaction },
                      { label: "This Month", d: usage.monthlyTransaction },
                    ].map(({ label, d }) => {
                      const isUnlimited = d.limit >= 999;
                      const pct = isUnlimited ? 0 : Math.min(100, (d.used / d.limit) * 100);
                      const isNear = !isUnlimited && pct >= 80;
                      const isAt = !isUnlimited && d.used >= d.limit;
                      return (
                        <div key={label} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{label}</span>
                            <span className={`font-medium tabular-nums ${isAt ? "text-rose-400" : isNear ? "text-amber-400" : ""}`}>
                              {isUnlimited
                                ? <span className="flex items-center gap-1">{d.used} / <Infinity className="w-3.5 h-3.5 text-emerald-400" /></span>
                                : `${d.used} / ${d.limit.toLocaleString()}`}
                            </span>
                          </div>
                          {!isUnlimited && (
                            <div className="h-1.5 w-full rounded-full bg-muted/50">
                              <div className={`h-1.5 rounded-full transition-all ${isAt ? "bg-rose-500" : isNear ? "bg-amber-400" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <Separator className="bg-border/50" />
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Settlement Fee</p>
                        <p className="font-medium text-lg">{usage.settlementFee}%</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Deposit Fee</p>
                        <p className="font-medium text-lg">{usage.depositFee}%</p>
                      </div>
                    </div>
                    <Separator className="bg-border/50" />
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2">
                        <KeyRound className={`w-4 h-4 ${usage.apiAccess ? "text-emerald-400" : "text-rose-400"}`} />
                        <span className={`text-sm ${usage.apiAccess ? "text-emerald-400" : "text-rose-400"}`}>
                          API {usage.apiAccess ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Webhook className={`w-4 h-4 ${usage.webhookAccess ? "text-emerald-400" : "text-rose-400"}`} />
                        <span className={`text-sm ${usage.webhookAccess ? "text-emerald-400" : "text-rose-400"}`}>
                          Webhooks {usage.webhookAccess ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-6 bg-muted/30 animate-pulse rounded" />)}</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Plan limits summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" /> Plan Limits Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {[
                  { label: "Dynamic QR", value: plan.dynamicQrLimit },
                  { label: "Static QR", value: plan.staticQrLimit },
                  { label: "Virtual Accounts", value: plan.virtualAccountLimit },
                  { label: "Payment Links", value: plan.paymentLinkLimit },
                  { label: "Payouts", value: plan.payoutLimit },
                  { label: "Daily Transactions", value: plan.dailyTransactionLimit },
                  { label: "Monthly Transactions", value: plan.monthlyTransactionLimit },
                ].map(({ label, value }) => (
                  <div key={label} className="p-3 rounded-lg bg-muted/20 border border-border/50 space-y-1">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <LimitBadge value={value} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Features */}
          {features.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Included Features
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Invoice History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" /> Billing Invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!invoicesData || invoicesData.data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border/40">
                    <th className="text-left pb-2 px-2 font-medium">Invoice #</th>
                    <th className="text-left pb-2 px-2 font-medium">Period</th>
                    <th className="text-right pb-2 px-2 font-medium">Amount</th>
                    <th className="text-center pb-2 px-2 font-medium">Status</th>
                    <th className="text-right pb-2 px-2 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {invoicesData.data.slice(0, 10).map((inv) => (
                    <tr key={inv.id} className="border-b border-border/20 hover:bg-muted/10">
                      <td className="py-2 px-2 font-mono text-xs text-muted-foreground">{inv.invoiceNumber}</td>
                      <td className="py-2 px-2 text-muted-foreground">
                        {inv.periodFrom && inv.periodTo
                          ? `${format(new Date(inv.periodFrom), "MMM d")} – ${format(new Date(inv.periodTo), "MMM d, yyyy")}`
                          : inv.period ?? "—"}
                      </td>
                      <td className="py-2 px-2 text-right font-medium">₹{parseFloat(inv.amount).toLocaleString()}</td>
                      <td className="py-2 px-2 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${INVOICE_STATUS_STYLE[inv.status] ?? "border-border/40 text-muted-foreground"}`}>
                          {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-muted-foreground text-xs">
                        {inv.dueDate ? format(new Date(inv.dueDate), "MMM d, yyyy") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {invoicesData.total > 10 && (
                <p className="text-xs text-muted-foreground text-center pt-3">{invoicesData.total - 10} more invoices not shown</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-4 h-4 text-primary" /> Plan History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!history || history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No plan history yet.</p>
          ) : (
            <div className="space-y-3">
              {history.map((entry, i) => {
                const meta = ACTION_META[entry.action] ?? { label: entry.action, color: "text-muted-foreground" };
                return (
                  <div key={entry.id} className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${meta.color}`}>{meta.label}</span>
                        {entry.toPlanName && <Badge variant="outline" className="text-xs">{entry.toPlanName}</Badge>}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      {entry.adminEmail && <p className="text-xs text-muted-foreground mt-0.5">by {entry.adminEmail}</p>}
                      {entry.notes && <p className="text-xs text-muted-foreground italic mt-0.5">"{entry.notes}"</p>}
                    </div>
                    {i < history.length - 1 && <Separator orientation="vertical" className="absolute left-0" />}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
