import { useState, useEffect } from "react";
import { useGetDashboardStats, useGetDashboardChart, useGetMe, useGetMyPlan, useGetMyPlanUsage, useListMerchantConnections, useUpdateMerchantConnection, getListMerchantConnectionsQueryKey, listPaymentLinks, ListPaymentLinksStatus, type PaymentLink } from "@workspace/api-client-react";
import { OnboardingProgress } from "@/components/merchant/onboarding-progress";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TrendingUp, ArrowDownLeft, QrCode, CreditCard, Infinity, AlertTriangle, ChevronRight, Lock, Plug, Link2, Hash, BadgeCheck, X, BellOff, BarChart3, Landmark, FileText, Headphones } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { format, differenceInDays } from "date-fns";
import { MERCHANT_KPI_ROUTES } from "@/lib/kpi-routes";
import { Link } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

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
  upi_id:        "UPI Direct",
  google_pay:    "RasoKart UPI",
  phonepe:       "RasoKart Collect",
  paytm:         "RasoKart Wallet",
  bharatpe:      "RasoKart Merchant",
  freecharge:    "RasoKart Pay",
  amazon_pay:    "RasoKart Digital",
  yono_sbi:      "Bank UPI",
  sbi_yono:      "Bank UPI",
  hdfc_smarthub: "Bank SmartQR",
  icici_eazypay: "Bank QR",
  axis_pay:      "Bank QR",
  kotak_smart:   "Bank Smart Collect",
  razorpay:      "RasoKart Gateway",
  cashfree:      "RasoKart Payments",
  payu:          "RasoKart Gateway Plus",
  ekqr:          "RasoKart QR Gateway",
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

import { useMerchantReadiness } from "@/hooks/use-merchant-readiness";

export default function MerchantDashboard() {
  const { data: user } = useGetMe();
  const { data: readiness } = useMerchantReadiness();
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: chartData, isLoading: chartLoading } = useGetDashboardChart();
  const { data: myPlan } = useGetMyPlan();
  const { data: usage } = useGetMyPlanUsage();
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
      onError: (_err, _vars, context) => {
        queryClient.setQueryData(getListMerchantConnectionsQueryKey(), (context as any)?.previous);
        toast({ title: "Failed to update provider", description: "Please try again.", variant: "destructive" });
      },
      onSuccess: (_data, { data }) => {
        toast({ title: data.isActive ? "Provider enabled" : "Provider disabled" });
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getListMerchantConnectionsQueryKey() });
      },
    },
  });


  // Notification reminder banner: show when any email notification has been disabled for ≥30 days
  const NOTIF_REMINDER_THRESHOLD_DAYS = 30;
  const NOTIF_REMINDER_DISMISS_KEY = user?.id ? `rasokart_notif_reminder_dismissed_${user.id}` : null;

  const NOTIF_FIELD_LABELS: Record<string, string> = {
    reconciliationAlertEmails: "Reconciliation alerts",
    planExpiryAlertEmails: "Plan expiry alerts",
    settlementStateEmails: "Settlement state emails",
    signatureFailureAlertEmails: "Signature failure alerts",
    webhookFailureEmails: "Webhook failure alerts",
    ekqrSyncAlertEmails: "QR Gateway sync alerts",
    reportFailureAlertEmails: "Report failure alerts",
    weeklyDeliveryDigestEmails: "Weekly delivery digest",
    apiKeyGeneratedEmails: "API key generated alerts",
    apiKeyRevokedEmails: "API key revoked alerts",
    loginAlertEmails: "Login alerts",
    reportScheduleChangedEmails: "Report schedule changed",
    settlementStateChangedEmails: "Settlement state changed",
    planChangeEmails: "Plan change emails",
  };

  // Compute which fields are disabled AND have been so for ≥30 days
  const now = new Date();
  const longDisabledFields: Array<{ label: string; days: number }> = [];
  const fieldDisabledAt = user?.notifFieldDisabledAt ?? null;
  if (fieldDisabledAt) {
    for (const [field, isoTs] of Object.entries(fieldDisabledAt)) {
      const days = differenceInDays(now, new Date(isoTs));
      if (days >= NOTIF_REMINDER_THRESHOLD_DAYS && field in NOTIF_FIELD_LABELS) {
        longDisabledFields.push({ label: NOTIF_FIELD_LABELS[field]!, days });
      }
    }
  }
  // Fallback: if notifFieldDisabledAt not available yet, use legacy notifPrefsDisabledAt
  const notifPrefsDisabledAt = user?.notifPrefsDisabledAt ? new Date(user.notifPrefsDisabledAt) : null;
  const notifDisabledDaysLegacy = notifPrefsDisabledAt != null ? differenceInDays(now, notifPrefsDisabledAt) : null;

  const [notifReminderDismissedAt, setNotifReminderDismissedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!NOTIF_REMINDER_DISMISS_KEY) return;
    const stored = localStorage.getItem(NOTIF_REMINDER_DISMISS_KEY);
    setNotifReminderDismissedAt(stored ? Number(stored) : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [NOTIF_REMINDER_DISMISS_KEY]);
  const notifReminderDismissedRecently = notifReminderDismissedAt != null
    && (Date.now() - notifReminderDismissedAt) < NOTIF_REMINDER_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

  const hasLongDisabledFields = longDisabledFields.length > 0;
  const showNotifReminderBanner = !notifReminderDismissedRecently && (
    hasLongDisabledFields ||
    (!fieldDisabledAt && notifDisabledDaysLegacy != null && notifDisabledDaysLegacy >= NOTIF_REMINDER_THRESHOLD_DAYS)
  );

  // Build banner text from per-field data
  const notifBannerText = (() => {
    if (hasLongDisabledFields) {
      const maxDays = Math.max(...longDisabledFields.map(f => f.days));
      const names = longDisabledFields.map(f => f.label);
      const listed = names.length <= 3
        ? names.join(", ")
        : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
      return `${listed} have been off for ${maxDays}+ days. Re-enable them to stay informed about important account events.`;
    }
    return `You have had one or more email notifications disabled for over ${notifDisabledDaysLegacy} days. Re-enable them to stay informed about important security and account events.`;
  })();

  // Immediate "currently disabled" summary — shows as soon as any preference is off
  const currentlyDisabledNotifs = user == null ? [] :
    Object.entries(NOTIF_FIELD_LABELS)
      .filter(([field]) => (user as unknown as Record<string, unknown>)[field] === false)
      .map(([, label]) => label);

  const isExpiringSoon = myPlan && !myPlan.isExpired && myPlan.daysUntilExpiry != null && myPlan.daysUntilExpiry <= 7;

  const allLinks = allPaymentLinks ?? [];
  const activeLinks = allLinks.filter(l => l.status === ListPaymentLinksStatus.active);
  const totalLinkPayments = allLinks.reduce((sum, l) => sum + l.paymentCount, 0);
  const topLinks = [...allLinks].sort((a, b) => b.paymentCount - a.paymentCount).slice(0, 3);
  const hasChartActivity = chartData?.some(point =>
    point.deposits > 0 || point.withdrawals > 0 || point.failed > 0 || point.refunded > 0
  ) ?? false;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-bold tracking-tight">Welcome, {user?.name || "Merchant"}</h1>
          {readiness?.serverData.kyc.status === "approved" && (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2.5 py-1 leading-none">
              <BadgeCheck className="w-3.5 h-3.5" />
              KYC Verified
            </span>
          )}
        </div>
        <p className="text-muted-foreground">Overview of your deposit collection activity.</p>
      </div>

      {/* Onboarding Progress — shown until all required steps are complete */}
      <OnboardingProgress />

      {statsLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Card key={i} className="animate-pulse bg-muted/50 h-32" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            title="Available Balance"
            value={`₹${(stats.availableBalance ?? 0).toLocaleString()}`}
            icon={<CreditCard className="w-4 h-4 text-primary" />}
            description="Current wallet balance available to use"
            href="/merchant/wallet"
          />
          <StatCard
            title="Today's Successful Collections"
            value={`₹${stats.todayDepositAmount.toLocaleString()}`}
            icon={<TrendingUp className="w-4 h-4 text-primary" />}
            description={`${stats.todayDeposits} payment${stats.todayDeposits !== 1 ? "s" : ""} today${readiness?.collectionState === 'paused_historical_only' ? ' (Collection paused)' : ''}`}
            href={MERCHANT_KPI_ROUTES.todayDeposits()}
          />
          <StatCard
            title="Pending Settlements"
            value={`₹${(stats.pendingSettlementAmount ?? 0).toLocaleString()}`}
            icon={<Landmark className="w-4 h-4 text-amber-500" />}
            description="Current pending and processing settlements"
            href="/merchant/settlements"
          />
          <StatCard
            title="Today's Payouts"
            value={`₹${stats.todayPayoutAmount.toLocaleString()}`}
            icon={<ArrowDownLeft className="w-4 h-4 text-violet-500" />}
            description={`${stats.todayPayouts} successful payout${stats.todayPayouts !== 1 ? "s" : ""} today`}
            href="/merchant/payouts"
          />
          <StatCard
            title="Lifetime Success Rate"
            value={`${stats.successTransactions + stats.failedTransactions > 0 ? ((stats.successTransactions / (stats.successTransactions + stats.failedTransactions)) * 100).toFixed(1) : "0.0"}%`}
            icon={<BarChart3 className="w-4 h-4 text-emerald-500" />}
            description={`${stats.successTransactions.toLocaleString()} successful transactions`}
            href="/merchant/transactions?status=success"
          />
          <StatCard
            title="Lifetime Failed Transactions"
            value={stats.failedTransactions.toLocaleString()}
            icon={<AlertTriangle className="w-4 h-4 text-rose-500" />}
            description="All recorded failed transactions"
            href="/merchant/transactions?status=failed"
          />
          <StatCard
            title="Active Payment Links"
            value={activeLinks.length}
            icon={<Link2 className="w-4 h-4 text-sky-500" />}
            description={`${totalLinkPayments.toLocaleString()} lifetime payments through links`}
            href="/merchant/payment-links"
          />
          <StatCard
            title="Active QR & Virtual Accounts"
            value={stats.qrCount + stats.vaCount}
            icon={<QrCode className="w-4 h-4 text-sky-500" />}
            description={`${stats.qrCount} QR codes · ${stats.vaCount} virtual accounts`}
            href="/merchant/qr-codes"
          />
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Quick Actions</h2>
        <div className="flex flex-wrap items-center gap-3">
          {(() => {
            const actions = [
              { label: "Create Payment Link", href: "/merchant/payment-links", feature: "create_payment_link", icon: Link2 },
              { label: "Create QR Code", href: "/merchant/qr-codes", feature: "create_qr", icon: QrCode },
              { label: "Connect Provider", href: "/merchant/connect", feature: "connect_provider", icon: Plug },
              { label: "Configure Callback", href: "/merchant/webhook", feature: "configure_callback", icon: Lock },
              { label: "Initiate Payout", href: "/merchant/payouts", feature: "initiate_payout", icon: Landmark },
              { label: "Download Statement", href: "/merchant/account-statement", feature: "download_statement", icon: FileText },
              { label: "Contact Support", href: "/merchant/support", feature: "contact_support", icon: Headphones },
            ];

            return actions.map((action) => {
              const check = readiness ? readiness.canUseFeature(action.feature) : { allowed: false, reason: "Loading..." };
              const Icon = action.icon;

              if (check.allowed) {
                return (
                  <Link key={action.label} href={action.href}>
                    <Button variant="outline" size="sm" className="gap-1.5 min-h-10 shadow-sm">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                      {action.label}
                    </Button>
                  </Link>
                );
              }

              return (
                <UITooltip key={action.label}>
                  <TooltipTrigger asChild>
                    <div>
                      <Button disabled variant="outline" size="sm" className="gap-1.5 min-h-10 opacity-50 shadow-sm">
                        <Icon className="w-3.5 h-3.5" />
                        {action.label}
                      </Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs max-w-xs text-center">
                    {check.reason}
                  </TooltipContent>
                </UITooltip>
              );
            });
          })()}
        </div>
      </div>

      {/* Notification reminder banner (30+ days) */}
      {showNotifReminderBanner && (
        <Card className="border-amber-500/40 bg-amber-950/20">
          <CardContent className="py-4 flex items-center gap-3">
            <BellOff className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-amber-400 font-medium">Email Notifications Turned Off</p>
              <p className="text-xs text-amber-400/70">
                {notifBannerText}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/merchant/security?section=notifications">
                <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hidden sm:flex">
                  Review Settings
                </Button>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10"
                onClick={() => {
                  const now = Date.now();
                  if (NOTIF_REMINDER_DISMISS_KEY) localStorage.setItem(NOTIF_REMINDER_DISMISS_KEY, String(now));
                  setNotifReminderDismissedAt(now);
                }}
                aria-label="Dismiss notification reminder banner"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Disabled notifications summary callout — immediate, shown whenever any preference is off */}
      {!showNotifReminderBanner && currentlyDisabledNotifs.length > 0 && (
        <Link href="/merchant/security?section=notifications" className="block">
          <Card className="border-slate-500/30 bg-slate-900/40 hover:border-slate-400/50 hover:bg-slate-900/60 transition-colors cursor-pointer">
            <CardContent className="py-3 flex items-center gap-3">
              <BellOff className="w-4 h-4 text-slate-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-300">
                  {currentlyDisabledNotifs.length === 1
                    ? "1 email notification is turned off"
                    : `${currentlyDisabledNotifs.length} email notifications are turned off`}
                </p>
                <p className="text-xs text-slate-400/70 mt-0.5 truncate">
                  {currentlyDisabledNotifs.length <= 3
                    ? currentlyDisabledNotifs.join(", ")
                    : `${currentlyDisabledNotifs.slice(0, 3).join(", ")} and ${currentlyDisabledNotifs.length - 3} more`}
                </p>
              </div>
              <span className="text-xs text-slate-400 flex items-center gap-0.5 shrink-0">
                Review <ChevronRight className="w-3.5 h-3.5" />
              </span>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Provider Status */}
      {connectionsLoading ? (
        <Card className="animate-pulse h-28 bg-muted/30" />
      ) : connections.length === 0 ? (
        null
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
                      {myPlan?.isExpired ? (
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <div>
                              <Switch disabled checked={conn.isActive} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="text-xs">
                            Plan expired. Please renew to manage providers.
                          </TooltipContent>
                        </UITooltip>
                      ) : (
                        <Switch
                          checked={conn.isActive}
                          onCheckedChange={(checked) =>
                            updateConnection({ id: conn.id, data: { provider: conn.provider, isActive: checked } })
                          }
                          disabled={togglingId}
                          aria-label={`${conn.isActive ? "Disable" : "Enable"} ${label}`}
                          className={conn.isActive ? "data-[state=checked]:bg-emerald-500" : ""}
                        />
                      )}
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
               <CardTitle className="text-base">Current Plan — {myPlan.planName}</CardTitle>
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
             {usage && !myPlan.isExpired ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                <QrUsageRow label="Dynamic QR Codes" active={usage.dynamicQr.used} limit={usage.dynamicQr.limit} usedCount={usage.dynamicQr.usedCount ?? 0} expiredCount={usage.dynamicQr.expiredCount ?? 0} />
                <QrUsageRow label="Static QR Codes" active={usage.staticQr.used} limit={usage.staticQr.limit} usedCount={usage.staticQr.usedCount ?? 0} expiredCount={usage.staticQr.expiredCount ?? 0} />
                <UsageRow label="Virtual Accounts" used={usage.virtualAccount.used} limit={usage.virtualAccount.limit} />
                <UsageRow label="Payment Links" used={usage.paymentLink.used} limit={usage.paymentLink.limit} />
                <UsageRow label="Payouts" used={usage.payout.used} limit={usage.payout.limit} />
                <UsageRow label="Transactions Today" used={usage.dailyTransaction.used} limit={usage.dailyTransaction.limit} />
              </div>
             ) : myPlan.isExpired ? (
               <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300">
                 Plan usage and limits are unavailable while this plan is expired.
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
                   API {usage.apiAccess ? "Included in plan" : "Not included"}
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${usage.webhookAccess ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-rose-500/30 bg-rose-500/10 text-rose-400"}`}>
                  {usage.webhookAccess ? null : <Lock className="w-3 h-3" />}
                   Webhooks {usage.webhookAccess ? "Included in plan" : "Not included"}
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
          <CardTitle>Transaction Activity (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent className="h-[400px]">
          {chartLoading ? (
            <div className="w-full h-full animate-pulse bg-muted/20 rounded-md" />
          ) : chartData && hasChartActivity ? (
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
                <Area type="monotone" dataKey="withdrawals" name="Payouts" stroke="hsl(var(--chart-5))" fillOpacity={1} fill="url(#colorWithdrawals)" strokeWidth={2} />
                <Area type="monotone" dataKey="failed" name="Failed" stroke="hsl(var(--destructive))" fillOpacity={0} strokeWidth={2} />
                <Area type="monotone" dataKey="refunded" name="Refunded" stroke="hsl(var(--chart-4))" fillOpacity={0} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/60">
              <BarChart3 className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No deposits during the selected period</p>
              <p className="text-xs">No successful, failed, refunded, or payout activity was recorded in the last 30 days.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
