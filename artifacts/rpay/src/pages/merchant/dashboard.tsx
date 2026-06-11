import { useState } from "react";
import { useGetDashboardStats, useGetDashboardChart, useGetMe, useGetMyPlan, useGetMyPlanUsage, useListMerchantConnections, useUpdateMerchantConnection, getListMerchantConnectionsQueryKey, listPaymentLinks, ListPaymentLinksStatus, type PaymentLink, useGetCallbackSecret } from "@workspace/api-client-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TrendingUp, ArrowDownLeft, QrCode, Building2, CreditCard, Infinity, AlertTriangle, ChevronRight, Lock, Plug, Link2, Hash, ShieldAlert } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { format, differenceInDays } from "date-fns";
import { Link } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { SECRET_WARN_DAYS, SECRET_ROTATION_OVERDUE_DAYS } from "@/lib/webhook-constants";
import { getApiErrorMessage } from "@/lib/utils";

interface UsageRowProps { label: string; used: number; limit: number; }

function UsageRow({ label, used, limit }: UsageRowProps) {
  const isUnlimited = limit >= 999;
  const remaining = isUnlimited ? null : Math.max(0, limit - used);
  const pct = isUnlimited ? 0 : Math.min(100, (used / limit) * 100);
  const isNearLimit = !isUnlimited && pct >= 80;
  const isAtLimit = !isUnlimited && used >= limit;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium tabular-nums ${isAtLimit ? "text-rose-400" : isNearLimit ? "text-amber-400" : "text-foreground"}`}>
          {isUnlimited
            ? <span className="flex items-center gap-1">{used} used · <Infinity className="w-3.5 h-3.5 text-emerald-400" /></span>
            : `${used} used · ${remaining} left`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-1.5 w-full rounded-full bg-muted/50">
          <div className={`h-1.5 rounded-full transition-all ${isAtLimit ? "bg-rose-500" : isNearLimit ? "bg-amber-400" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

interface QrUsageRowProps { label: string; active: number; limit: number; usedCount: number; expiredCount: number; }

function QrUsageRow({ label, active, limit, usedCount, expiredCount }: QrUsageRowProps) {
  const isUnlimited = limit >= 999;
  const remaining = isUnlimited ? null : Math.max(0, limit - active);
  const pct = isUnlimited ? 0 : Math.min(100, (active / limit) * 100);
  const isNearLimit = !isUnlimited && pct >= 80;
  const isAtLimit = !isUnlimited && active >= limit;
  const hasInactive = usedCount > 0 || expiredCount > 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium tabular-nums ${isAtLimit ? "text-rose-400" : isNearLimit ? "text-amber-400" : "text-foreground"}`}>
          {isUnlimited
            ? <span className="flex items-center gap-1">{active} active · <Infinity className="w-3.5 h-3.5 text-emerald-400" /></span>
            : `${active} active · ${remaining} left`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-1.5 w-full rounded-full bg-muted/50">
          <div className={`h-1.5 rounded-full transition-all ${isAtLimit ? "bg-rose-500" : isNearLimit ? "bg-amber-400" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {hasInactive && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground/70">
          {usedCount > 0 && <span>{usedCount} used</span>}
          {expiredCount > 0 && <span>{expiredCount} expired</span>}
        </div>
      )}
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  upi_id:        "UPI ID",
  google_pay:    "Google Pay",
  phonepe:       "PhonePe",
  paytm:         "Paytm",
  bharatpe:      "BharatPe",
  freecharge:    "FreeCharge",
  yono_sbi:      "YONO SBI",
  hdfc_smarthub: "HDFC SmartHub",
};

function getVpa(credentials: string | null | undefined): string | null {
  if (!credentials) return null;
  if (credentials.includes("@")) return credentials.trim();
  try {
    const parsed = JSON.parse(credentials);
    const vpa = parsed.vpa ?? parsed.upi_id ?? parsed.virtualAddress ?? null;
    return typeof vpa === "string" ? vpa : null;
  } catch {
    return null;
  }
}

const PAGE_SIZE = 100;

async function fetchAllPaymentLinks(): Promise<PaymentLink[]> {
  const first = await listPaymentLinks({ status: ListPaymentLinksStatus.all, limit: PAGE_SIZE, page: 1 });
  const all = [...first.data];
  if (first.total > PAGE_SIZE) {
    const totalPages = Math.ceil(first.total / PAGE_SIZE);
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) =>
        listPaymentLinks({ status: ListPaymentLinksStatus.all, limit: PAGE_SIZE, page: i + 2 })
      )
    );
    for (const page of rest) all.push(...page.data);
  }
  return all;
}

export default function MerchantDashboard() {
  const { data: user } = useGetMe();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: chartData, isLoading: chartLoading } = useGetDashboardChart();
  const { data: myPlan } = useGetMyPlan();
  const { data: usage } = useGetMyPlanUsage();
  const { data: secretStatus } = useGetCallbackSecret();
  const { data: connectionsRaw, isLoading: connectionsLoading } = useListMerchantConnections();
  const { data: allPaymentLinks, isLoading: paymentLinksLoading } = useQuery<PaymentLink[]>({
    queryKey: ["payment-links-all-for-dashboard"],
    queryFn: fetchAllPaymentLinks,
  });
  const connections = Array.isArray(connectionsRaw) ? connectionsRaw : [];
  const activeConnections = connections.filter(c => c.isActive);

  const queryClient = useQueryClient();
  const { mutate: updateConnection, isPending: togglingId } = useUpdateMerchantConnection({
    mutation: {
      onMutate: async ({ id, data }) => {
        await queryClient.cancelQueries({ queryKey: getListMerchantConnectionsQueryKey() });
        const previous = queryClient.getQueryData(getListMerchantConnectionsQueryKey());
        queryClient.setQueryData(getListMerchantConnectionsQueryKey(), (old: unknown) => {
          if (!Array.isArray(old)) return old;
          return old.map((c: { id: number }) => c.id === id ? { ...c, isActive: data.isActive } : c);
        });
        return { previous };
      },
      onError: (err, _vars, context) => {
        queryClient.setQueryData(getListMerchantConnectionsQueryKey(), (context as any)?.previous);
        toast({ title: "Failed to update provider", description: getApiErrorMessage(err, "Please try again."), variant: "destructive" });
      },
      onSuccess: (_data, { data }) => {
        toast({ title: data.isActive ? "Provider enabled" : "Provider disabled" });
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getListMerchantConnectionsQueryKey() });
      },
    },
  });

  const isExpiringSoon = myPlan && !myPlan.isExpired && myPlan.daysUntilExpiry != null && myPlan.daysUntilExpiry <= 7;

  const secretAgeInDays = secretStatus?.isSet && secretStatus.lastRotatedAt != null
    ? differenceInDays(new Date(), new Date(secretStatus.lastRotatedAt))
    : null;
  const secretDaysLeft = secretAgeInDays != null ? Math.max(0, SECRET_ROTATION_OVERDUE_DAYS - secretAgeInDays) : null;
  const isSecretOverdue = secretAgeInDays != null && secretAgeInDays >= SECRET_ROTATION_OVERDUE_DAYS;
  const isSecretWarningSoon = secretAgeInDays != null && secretAgeInDays >= SECRET_WARN_DAYS && !isSecretOverdue;

  const allLinks = allPaymentLinks ?? [];
  const activeLinks = allLinks.filter(l => l.status === ListPaymentLinksStatus.active);
  const totalLinkPayments = allLinks.reduce((sum, l) => sum + l.paymentCount, 0);
  const topLinks = [...allLinks].sort((a, b) => b.paymentCount - a.paymentCount).slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Welcome, {user?.name || "Merchant"}</h1>
        <p className="text-muted-foreground">Overview of your deposit collection activity.</p>
      </div>

      {statsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse bg-muted/50 h-32" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Today's Deposits"
            value={`₹${stats.todayDepositAmount.toLocaleString()}`}
            icon={<TrendingUp className="w-4 h-4 text-primary" />}
            description={`${stats.todayDeposits} payment${stats.todayDeposits !== 1 ? "s" : ""} today`}
          />
          <StatCard
            title="Total Deposits"
            value={`₹${stats.totalDeposits.toLocaleString()}`}
            icon={<ArrowDownLeft className="w-4 h-4 text-emerald-500" />}
            description={(() => {
              const reserved = stats.pendingSettlementAmount ?? 0;
              const available = stats.totalBalance - reserved;
              if (reserved > 0) {
                return `₹${available.toLocaleString()} available · ₹${reserved.toLocaleString()} reserved`;
              }
              return `₹${stats.totalBalance.toLocaleString()} available balance`;
            })()}
          />
          <StatCard
            title="Active QR Codes"
            value={stats.qrCount}
            icon={<QrCode className="w-4 h-4 text-sky-500" />}
            description="Dynamic QR codes accepting payments"
          />
          <StatCard
            title="Virtual Accounts"
            value={stats.vaCount}
            icon={<Building2 className="w-4 h-4 text-violet-500" />}
            description="Active virtual bank accounts"
          />
        </div>
      ) : null}

      {/* Expiry alerts */}
      {myPlan?.isExpired && (
        <Card className="border-rose-500/40 bg-rose-950/20">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-rose-400 font-medium">Plan Expired</p>
              <p className="text-xs text-rose-400/70">Your {myPlan.planName} plan has expired. New QR codes, virtual accounts, and payouts are restricted.</p>
            </div>
            <Link href="/merchant/plan">
              <Button size="sm" variant="outline" className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 shrink-0">View Plan</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {isExpiringSoon && !myPlan?.isExpired && (
        <Card className="border-amber-500/40 bg-amber-950/20">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-amber-400 font-medium">Plan Expiring Soon</p>
              <p className="text-xs text-amber-400/70">Your {myPlan?.planName} plan expires in {myPlan?.daysUntilExpiry} day{myPlan?.daysUntilExpiry === 1 ? "" : "s"}. Contact support to renew.</p>
            </div>
            <Link href="/merchant/plan">
              <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 shrink-0">View Plan</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {(isSecretWarningSoon || isSecretOverdue) && secretDaysLeft != null && (
        <Card className="border-amber-500/40 bg-amber-950/20">
          <CardContent className="py-4 flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              {isSecretOverdue ? (
                <>
                  <p className="text-sm text-amber-400 font-medium">Callback Secret Rotation Overdue</p>
                  <p className="text-xs text-amber-400/70">Your callback signing secret is {secretAgeInDays} days old. Rotate it now to keep your integration secure.</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-amber-400 font-medium">Callback Secret Rotation Due in {secretDaysLeft} Day{secretDaysLeft !== 1 ? "s" : ""}</p>
                  <p className="text-xs text-amber-400/70">Rotate your callback signing secret soon to keep your integration secure.</p>
                </>
              )}
            </div>
            <Link href="/merchant/webhook">
              <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 shrink-0">Rotate Secret</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Provider Status */}
      {connectionsLoading ? (
        <Card className="animate-pulse h-28 bg-muted/30" />
      ) : connections.length === 0 ? (
        <Card className="border-dashed border-muted-foreground/30">
          <CardContent className="py-4 flex items-center gap-3">
            <Plug className="w-4 h-4 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">No payment provider connected.</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">Connect a provider to start collecting payments.</p>
            </div>
            <Link href="/merchant/connect">
              <Button size="sm" variant="outline" className="shrink-0">Connect Provider</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        (() => {
          const anyAtLimit = connections.some(c => c.isActive && c.monthlyLimit > 0 && c.monthlyUsed >= c.monthlyLimit);
          const anyNearLimit = !anyAtLimit && connections.some(c => c.isActive && c.monthlyLimit > 0 && (c.monthlyUsed / c.monthlyLimit) * 100 >= 80);
          const cardClass = anyAtLimit
            ? "border-rose-500/40 bg-rose-950/10"
            : anyNearLimit
            ? "border-amber-500/30 bg-amber-950/10"
            : activeConnections.length > 0
            ? "border-emerald-500/20 bg-emerald-950/10"
            : "border-border/50";
          return (
        <Card className={cardClass}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Plug className={`w-4 h-4 ${anyAtLimit ? "text-rose-400" : anyNearLimit ? "text-amber-400" : activeConnections.length > 0 ? "text-emerald-400" : "text-muted-foreground"}`} />
              <CardTitle className="text-base">Provider Status</CardTitle>
              {anyAtLimit ? (
                <Badge variant="outline" className="ml-1 text-rose-400 border-rose-500/40 bg-rose-950/20 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Limit Reached
                </Badge>
              ) : anyNearLimit ? (
                <Badge variant="outline" className="ml-1 text-amber-400 border-amber-500/40 bg-amber-950/20 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Limit Warning
                </Badge>
              ) : activeConnections.length > 0 ? (
                <Badge variant="outline" className="ml-1 text-emerald-400 border-emerald-500/30">
                  {activeConnections.length} Active
                </Badge>
              ) : null}
              <Link href="/merchant/connect" className="ml-auto">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                  Manage <ChevronRight className="w-3 h-3 ml-0.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {connections.map(conn => {
              const label = PROVIDER_LABELS[conn.provider] ?? conn.provider;
              const vpa = getVpa(conn.credentials);
              const limit = conn.monthlyLimit;
              const used = conn.monthlyUsed;
              const hasLimit = limit > 0;
              const pct = hasLimit ? Math.min(100, (used / limit) * 100) : 0;
              const isNearLimit = hasLimit && pct >= 80;
              const isAtLimit = hasLimit && used >= limit;
              return (
                <div key={conn.id} className={`space-y-2 rounded-lg p-2 transition-opacity ${conn.isActive ? "" : "opacity-50"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${conn.isActive ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                    {vpa && (
                      <span className="text-xs text-muted-foreground font-mono bg-muted/40 px-1.5 py-0.5 rounded">
                        {vpa}
                      </span>
                    )}
                    {!conn.isActive && (
                      <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/20">Inactive</Badge>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{conn.isActive ? "Enabled" : "Disabled"}</span>
                      <Switch
                        checked={conn.isActive}
                        onCheckedChange={(checked) =>
                          updateConnection({ id: conn.id, data: { provider: conn.provider, isActive: checked } })
                        }
                        disabled={togglingId}
                        aria-label={`${conn.isActive ? "Disable" : "Enable"} ${label}`}
                        className={conn.isActive ? "data-[state=checked]:bg-emerald-500" : ""}
                      />
                    </div>
                  </div>
                  {conn.isActive && hasLimit && (
                    <div className="space-y-1 pl-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Monthly limit usage</span>
                        <span className={`tabular-nums font-medium ${isAtLimit ? "text-rose-400" : isNearLimit ? "text-amber-400" : "text-foreground"}`}>
                          ₹{Math.round(used).toLocaleString()} / ₹{limit.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted/50">
                        <div
                          className={`h-1.5 rounded-full transition-all ${isAtLimit ? "bg-rose-500" : isNearLimit ? "bg-amber-400" : "bg-emerald-500"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {isAtLimit && (
                        <p className="text-xs text-rose-400">Monthly limit reached. Payments may be restricted.</p>
                      )}
                      {isNearLimit && !isAtLimit && (
                        <p className="text-xs text-amber-400">Approaching monthly limit.</p>
                      )}
                    </div>
                  )}
                  {conn.isActive && !hasLimit && (
                    <p className="text-xs text-muted-foreground pl-1">No monthly limit set</p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
          );
        })()
      )}

      {/* Payment Links Summary */}
      {paymentLinksLoading ? (
        <Card className="animate-pulse h-28 bg-muted/30" />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-violet-400" />
              <CardTitle className="text-base">Payment Links</CardTitle>
              <Badge variant="outline" className="ml-1 text-violet-400 border-violet-500/30">
                {activeLinks.length} Active
              </Badge>
              <Link href="/merchant/payment-links" className="ml-auto">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                  Manage <ChevronRight className="w-3 h-3 ml-0.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Links</p>
                <p className="text-2xl font-bold text-violet-400">{activeLinks.length}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Payments</p>
                <p className="text-2xl font-bold text-emerald-400 flex items-center gap-1.5">
                  <Hash className="w-4 h-4" />{totalLinkPayments}
                </p>
              </div>
            </div>
            {topLinks.length > 0 ? (
              <div className="space-y-2 pt-3 border-t border-border/50">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Top Performing Links</p>
                {topLinks.map((link, i) => {
                  const count = link.paymentCount ?? 0;
                  const max = topLinks[0]?.paymentCount ?? 1;
                  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
                  return (
                    <div key={link.id} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground/60 w-4 tabular-nums">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm font-medium truncate">{link.title}</span>
                          <span className="text-xs font-mono text-emerald-400 tabular-nums shrink-0 ml-2">{count}</span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-muted/50 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-violet-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="pt-3 border-t border-border/50 text-center text-muted-foreground/60">
                <Link2 className="w-6 h-6 mx-auto mb-1 opacity-30" />
                <p className="text-xs">No payment links yet. Create one to start collecting payments.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {myPlan ? (
        <Card className={`border ${myPlan.isExpired ? "border-rose-500/30 bg-rose-950/10" : "border-primary/30 bg-primary/5"}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              <CardTitle className="text-base">Active Plan</CardTitle>
              <Badge variant="outline" className={`ml-1 ${myPlan.isExpired ? "text-rose-400 border-rose-500/30" : "text-primary border-primary/40"}`}>{myPlan.planName}</Badge>
              {myPlan.status === "suspended" && <Badge className="text-xs bg-orange-500/20 text-orange-400 border-orange-500/30">Suspended</Badge>}
              {myPlan.isExpired && myPlan.status !== "suspended" && <Badge variant="destructive" className="text-xs">Expired</Badge>}
              {myPlan.expiresAt && !myPlan.isExpired && myPlan.status !== "suspended" && (
                <span className={`ml-auto text-xs ${isExpiringSoon ? "text-amber-400" : "text-muted-foreground"}`}>
                  Expires {format(new Date(myPlan.expiresAt), "MMM d, yyyy")}
                </span>
              )}
              {!myPlan.expiresAt && myPlan.status !== "suspended" && <span className="ml-auto text-xs text-emerald-400">No expiry</span>}
              {myPlan.monthlyFee && myPlan.monthlyFee !== "0" && (
                <span className="ml-auto text-xs text-muted-foreground">₹{parseInt(myPlan.monthlyFee).toLocaleString()}/mo</span>
              )}
              <Link href="/merchant/plan">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground ml-1">
                  View Details <ChevronRight className="w-3 h-3 ml-0.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {usage ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                <QrUsageRow label="Dynamic QR Codes" active={usage.dynamicQr.used} limit={usage.dynamicQr.limit} usedCount={usage.dynamicQr.usedCount ?? 0} expiredCount={usage.dynamicQr.expiredCount ?? 0} />
                <QrUsageRow label="Static QR Codes" active={usage.staticQr.used} limit={usage.staticQr.limit} usedCount={usage.staticQr.usedCount ?? 0} expiredCount={usage.staticQr.expiredCount ?? 0} />
                <UsageRow label="Virtual Accounts" used={usage.virtualAccount.used} limit={usage.virtualAccount.limit} />
                <UsageRow label="Payment Links" used={usage.paymentLink.used} limit={usage.paymentLink.limit} />
                <UsageRow label="Payouts" used={usage.payout.used} limit={usage.payout.limit} />
                <UsageRow label="Transactions Today" used={usage.dailyTransaction.used} limit={usage.dailyTransaction.limit} />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(() => {
                  let features: string[] = [];
                  try { features = JSON.parse(myPlan.features); } catch {}
                  return (
                    <div className="col-span-full space-y-1.5">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Features</p>
                      <ul className="flex flex-wrap gap-x-6 gap-y-1">
                        {features.slice(0, 6).map((f, i) => (
                          <li key={i} className="text-sm text-muted-foreground">• {f}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Feature access badges */}
            {usage && (
              <div className="mt-4 pt-3 border-t border-border/50 flex flex-wrap gap-2">
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${usage.apiAccess ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400"}`}>
                  {usage.apiAccess ? null : <Lock className="w-3 h-3" />}
                  API {usage.apiAccess ? "Enabled" : "Locked"}
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${usage.webhookAccess ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400"}`}>
                  {usage.webhookAccess ? null : <Lock className="w-3 h-3" />}
                  Webhooks {usage.webhookAccess ? "Enabled" : "Locked"}
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border border-border/50 text-muted-foreground">
                  Settlement: {usage.settlementFee}%
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed border-muted-foreground/30">
          <CardContent className="py-4 flex items-center gap-3 text-muted-foreground">
            <CreditCard className="w-4 h-4 shrink-0" />
            <p className="text-sm">No plan assigned yet. Contact support to get started with a plan.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Deposit Volume (30 Days)</CardTitle>
        </CardHeader>
        <CardContent className="h-[400px]">
          {chartLoading ? (
            <div className="w-full h-full animate-pulse bg-muted/20 rounded-md" />
          ) : chartData && chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorDeposits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorWithdrawals" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-5))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--chart-5))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tickFormatter={(val) => format(new Date(val), "MMM d")} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                <YAxis tickFormatter={(val) => `₹${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}`} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dx={-10} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} itemStyle={{ color: 'hsl(var(--foreground))' }} labelFormatter={(val) => format(new Date(val), "MMM d, yyyy")} />
                <Area type="monotone" dataKey="deposits" name="Deposits" stroke="hsl(var(--chart-1))" fillOpacity={1} fill="url(#colorDeposits)" strokeWidth={2} />
                <Area type="monotone" dataKey="withdrawals" name="Withdrawals" stroke="hsl(var(--chart-5))" fillOpacity={1} fill="url(#colorWithdrawals)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">No data available</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
