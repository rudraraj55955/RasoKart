import { ReactNode, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Spinner } from "@/components/ui/spinner";
import { UserRole, useGetMyPlanUsage, useGetCallbackSecret, useListApiKeys, useGetSecurityComplianceSummary, useGetKycSummary, useListMerchantReportSchedules, useListNotifications, useGetMe, ListNotificationsIsRead, useGetReportDeliveryHealth, useGetReportSchedule, useGetGithubSyncStatus, useGetGithubSyncDivergence } from "@workspace/api-client-react";

import { SidebarProvider, Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarHeader, SidebarFooter, useSidebar } from "@/components/ui/sidebar";
import { format } from "date-fns";
import { Link, useLocation } from "wouter";
import { LogOut, LayoutDashboard, Store, ArrowRightLeft, Landmark, FileText, Webhook, KeyRound, Users, Package, Plug, BookOpen, QrCode, Building2, CreditCard, ArrowDownLeft, Activity, Shield, UserCog, Sliders, Eye, LayoutGrid, Lock, Receipt, BookMarked, Zap, GitMerge, Link2, Paintbrush, Settings, ShieldAlert, ShieldCheck, X, Download, ShieldOff, Layers, ToggleLeft, BadgeCheck, BarChart3, Wallet, Headphones, Code2, CheckCircle2, TrendingUp, User, MessageSquare, Mail, ChevronDown, ChevronUp, Trash2, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotificationBell } from "@/components/notification-bell";
import { RasoKartLogo } from "@/components/ui/rasokart-logo";
import { useCompanySettings } from "@/lib/company-settings";
import { Card, CardContent } from "@/components/ui/card";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { InstallAppButton } from "@/components/ui/install-app-banner";

export const REPORTS_SNOOZE_EVENT = "rasokart-reports-snooze-changed";
export function getReportSnoozeKey(userId: number | string | undefined): string {
  return userId != null ? `rasokart_reports_snooze_until_${userId}` : "rasokart_reports_snooze_until";
}
export const AUDIT_SNOOZE_EVENT = "rasokart-audit-snooze-changed";
export function getAuditSnoozeKey(userId: number | string | undefined): string {
  return userId != null ? `rasokart_audit_snooze_until_${userId}` : "rasokart_audit_snooze_until";
}

function SuspensionBanner() {
  const { user, logout } = useAuth();

  if (user?.role !== UserRole.merchant || user?.merchantStatus !== "suspended") return null;

  return (
    <div className="border border-red-500/40 bg-red-950/20 rounded-lg mb-6 p-4 flex items-start gap-3">
      <ShieldOff className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-400 font-semibold">Account Suspended</p>
        <p className="text-xs text-red-400/80 mt-0.5 leading-relaxed">
          Your merchant account has been suspended. Access to payments and account features is restricted.
          Please contact our support team at{" "}
          <a href="mailto:support@rasokart.com" className="underline underline-offset-2 hover:text-red-300">
            support@rasokart.com
          </a>{" "}
          with your registered email address for assistance.
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0"
        onClick={logout}
      >
        Sign Out
      </Button>
    </div>
  );
}

const CALLBACK_BANNER_SESSION_KEY = "rasokart_callback_banner_dismissed";

function CallbackSecretBanner() {
  const { user } = useAuth();
  const { data: callbackSecret } = useGetCallbackSecret();
  const { data: apiKeys } = useListApiKeys();
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(CALLBACK_BANNER_SESSION_KEY) === "1"
  );

  const rotationDismissKey = user?.id && callbackSecret?.lastRotatedAt
    ? `rasokart_rotation_dismissed_${user.id}_${callbackSecret.lastRotatedAt}`
    : null;
  const [rotationDismissed, setRotationDismissed] = useState(false);
  useEffect(() => {
    if (!rotationDismissKey) return;
    setRotationDismissed(localStorage.getItem(rotationDismissKey) === "1");
  }, [rotationDismissKey]);

  const hasActiveApiKey = Array.isArray(apiKeys) && apiKeys.some(k => k.isActive);
  const showNotConfigured = !dismissed && callbackSecret != null && !callbackSecret.isSet && hasActiveApiKey;

  const secretAgeExceeds90Days = (() => {
    if (!callbackSecret?.isSet) return false;
    const lastRotated = callbackSecret.lastRotatedAt;
    if (!lastRotated) return true;
    const diffMs = Date.now() - new Date(lastRotated).getTime();
    return diffMs > 90 * 24 * 60 * 60 * 1000;
  })();
  const showRotationReminder = !rotationDismissed && secretAgeExceeds90Days;

  function handleDismiss() {
    sessionStorage.setItem(CALLBACK_BANNER_SESSION_KEY, "1");
    setDismissed(true);
  }

  function handleRotationDismiss() {
    if (rotationDismissKey) localStorage.setItem(rotationDismissKey, "1");
    setRotationDismissed(true);
  }

  if (!showNotConfigured && !showRotationReminder) return null;

  return (
    <>
      {showNotConfigured && (
        <Card className="border-orange-500/40 bg-orange-950/20 rounded-lg mb-6">
          <CardContent className="py-3 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-orange-400 font-medium">Callback Secret Not Configured</p>
              <p className="text-xs text-orange-400/70">
                You have an active API key but no callback signing secret. Without it, payment notifications on{" "}
                <code className="font-mono bg-orange-900/30 px-1 rounded">POST /api/callbacks</code> cannot be verified and may be spoofed.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/merchant/webhook">
                <Button size="sm" variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hidden sm:flex">
                  Set Up Secret
                </Button>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-orange-400/60 hover:text-orange-400 hover:bg-orange-500/10"
                onClick={handleDismiss}
                aria-label="Dismiss callback secret warning"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {showRotationReminder && (
        <Card className="border-amber-500/40 bg-amber-950/20 rounded-lg mb-6">
          <CardContent className="py-3 flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-400 font-medium">Callback Secret Rotation Due</p>
              <p className="text-xs text-amber-400/70">
                Your callback signing secret{callbackSecret?.lastRotatedAt ? ` was last rotated on ${format(new Date(callbackSecret.lastRotatedAt), "dd MMM yyyy")}` : " has not been rotated recently"}.
                {" "}Rotate it every 90 days to keep your webhook endpoint secure.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/merchant/webhook">
                <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hidden sm:flex">
                  Rotate Secret
                </Button>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10"
                onClick={handleRotationDismiss}
                aria-label="Dismiss rotation reminder"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

interface DashboardLayoutProps {
  children: ReactNode;
  publicMode?: boolean;
}

function MerchantSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { data: usage } = useGetMyPlanUsage();
  const merchantId = (user as any)?.merchantId as number | undefined;
  const { data: kycSummary } = useGetKycSummary(merchantId ?? 0, {
    query: { enabled: !!merchantId, queryKey: ["/api/kyc/summary", merchantId] },
  });
  const isKycVerified = kycSummary?.isVerified === true;
  const { data: me } = useGetMe();
  const { data: reportSchedule } = useGetReportSchedule({
    query: { refetchInterval: 5 * 60 * 1000, queryKey: ["/api/reports/schedule"] },
  });
  const hasReportScheduleWarning =
    reportSchedule?.schedule != null &&
    (reportSchedule.schedule.consecutiveFailures > 0 || !reportSchedule.schedule.isActive);
  const disabledNotifCount = me == null ? 0 : [
    me.apiKeyGeneratedEmails,
    me.apiKeyRevokedEmails,
    me.signatureFailureAlertEmails,
    me.loginAlertEmails,
    me.reportScheduleChangedEmails,
    me.settlementStateChangedEmails,
  ].filter(v => v === false).length;

  const navGroups = [
    {
      group: "Overview",
      items: [
        { title: "Dashboard", icon: LayoutDashboard, href: "/merchant/dashboard", locked: false, lockReason: null, badge: null },
        { title: "My Plan", icon: CreditCard, href: "/merchant/plan", locked: false, lockReason: null, badge: null },
        { title: "Profile", icon: User, href: "/merchant/profile", locked: false, lockReason: null, badge: null },
        { title: "Verification", icon: BadgeCheck, href: "/merchant/verification", locked: false, lockReason: null, badge: isKycVerified ? "Verified" : null },
        { title: "Secure Onboarding", icon: ShieldCheck, href: "/merchant/onboarding", locked: false, lockReason: null, badge: null },
        { title: "KYC Verification", icon: ShieldCheck, href: "/merchant/auto-kyc", locked: false, lockReason: null, badge: null },
      ],
    },
    {
      group: "Payments",
      items: [
        { title: "Deposits", icon: ArrowDownLeft, href: "/merchant/deposits", locked: false, lockReason: null },
        { title: "Transactions", icon: ArrowRightLeft, href: "/merchant/transactions", locked: false, lockReason: null },
        { title: "Payouts", icon: Landmark, href: "/merchant/payouts", locked: false, lockReason: null },
        { title: "Settlements", icon: FileText, href: "/merchant/settlements", locked: false, lockReason: null },
        { title: "Wallet", icon: Wallet, href: "/merchant/wallet", locked: false, lockReason: null },
        { title: "Balance Ledger", icon: BookMarked, href: "/merchant/ledger", locked: false, lockReason: null },
        { title: "Reports", icon: BarChart3, href: "/merchant/reports", locked: false, lockReason: null },
        { title: "Account Statement", icon: FileText, href: "/merchant/account-statement", locked: false, lockReason: null },
      ],
    },
    {
      group: "Products",
      items: [
        { title: "Virtual Accounts", icon: Building2, href: "/merchant/virtual-accounts", locked: false, lockReason: null },
        { title: "Dynamic QR", icon: QrCode, href: "/merchant/qr-codes", locked: false, lockReason: null },
        { title: "Payment Links", icon: Link2, href: "/merchant/payment-links", locked: false, lockReason: null },
        { title: "Plans & Pricing", icon: Package, href: "/merchant/products", locked: false, lockReason: null },
      ],
    },
    {
      group: "Support",
      items: [
        { title: "Support", icon: Headphones, href: "/merchant/support", locked: false, lockReason: null },
      ],
    },
    {
      group: "API Services",
      items: [
        { title: "UPI Collection API", icon: Code2, href: "/upi-collection-api", locked: false, lockReason: null },
      ],
    },
    {
      group: "Integration",
      items: [
        { title: "RasoKart Services", icon: Layers, href: "/merchant/rasokart-services", locked: false, lockReason: null },
        { title: "Connect", icon: Plug, href: "/merchant/connect", locked: false, lockReason: null },
        {
          title: "API Keys", icon: KeyRound, href: "/merchant/api-keys",
          locked: usage !== undefined && !usage.apiAccess,
          lockReason: "API access is not included in your current plan. Upgrade to unlock."
        },
        {
          title: "Webhooks", icon: Webhook, href: "/merchant/webhook",
          locked: usage !== undefined && !usage.webhookAccess,
          lockReason: "Webhook access is not included in your current plan. Upgrade to unlock."
        },
        { title: "Callbacks", icon: FileText, href: "/merchant/callbacks", locked: false, lockReason: null },
        { title: "Security Activity", icon: Shield, href: "/merchant/security", locked: false, lockReason: null },
        { title: "API Docs", icon: BookOpen, href: "/merchant/api-docs", locked: false, lockReason: null },
      ],
    },
  ];

  return (
    <>
      {navGroups.map((group) => (
        <SidebarGroup key={group.group}>
          <SidebarGroupLabel>{group.group}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  {item.locked ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-3 px-2 py-1.5 rounded-md text-sm text-muted-foreground/50 cursor-not-allowed w-full">
                          <item.icon className="w-4 h-4 shrink-0" />
                          <span className="flex-1">{item.title}</span>
                          <Lock className="w-3 h-3 shrink-0 text-muted-foreground/40" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs text-xs">
                        {item.lockReason}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <SidebarMenuButton asChild isActive={location === item.href} tooltip={item.title}>
                      <Link href={item.href} className="flex items-center gap-3">
                        <item.icon className="w-4 h-4" />
                        <span className="flex-1">{item.title}</span>
                        {"badge" in item && item.badge && (
                          <span className="flex items-center gap-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-1 py-0.5 leading-none shrink-0">
                            <BadgeCheck className="w-3 h-3" />
                            {item.badge}
                          </span>
                        )}
                        {item.href === "/merchant/security" && disabledNotifCount > 0 && (
                          <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-amber-500 text-[10px] font-bold text-black px-1 leading-none shrink-0">
                            {disabledNotifCount}
                          </span>
                        )}
                        {item.href === "/merchant/reports" && hasReportScheduleWarning && (
                          <span className="flex items-center justify-center w-2 h-2 rounded-full bg-amber-400 shrink-0" aria-label="Report schedule issue" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

const ADMIN_NAV = [
  {
    group: "Overview",
    items: [
      { title: "Dashboard", icon: LayoutDashboard, href: "/admin/dashboard" },
    ],
  },
  {
    group: "Merchants",
    items: [
      { title: "Merchants", icon: Store, href: "/admin/merchants" },
      { title: "KYC Review", icon: BadgeCheck, href: "/admin/kyc-review" },
      { title: "Verifications", icon: ShieldCheck, href: "/admin/merchant-verifications" },
      { title: "Secure Onboarding", icon: ShieldCheck, href: "/admin/merchant-onboarding" },
      { title: "Auto KYC", icon: ShieldCheck, href: "/admin/merchant-kyc" },
      { title: "Plans", icon: CreditCard, href: "/admin/plans" },
      { title: "Invoices", icon: Receipt, href: "/admin/invoices" },
    ],
  },
  {
    group: "Payments",
    items: [
      { title: "Deposits", icon: ArrowDownLeft, href: "/admin/deposits" },
      { title: "UPI Approvals", icon: CheckCircle2, href: "/admin/utr-verifications" },
      { title: "Payouts", icon: Landmark, href: "/admin/payouts" },
      { title: "Payout Beneficiaries", icon: BadgeCheck, href: "/admin/payout-beneficiaries" },
      { title: "Payout Merchants", icon: Store, href: "/admin/payout-merchants" },
      { title: "Settlements", icon: FileText, href: "/admin/settlements" },
      { title: "Transactions", icon: ArrowRightLeft, href: "/admin/transactions" },
      { title: "Balance Ledger", icon: BookMarked, href: "/admin/ledger" },
      { title: "Wallets", icon: Wallet, href: "/admin/wallets" },
    ],
  },
  {
    group: "Instruments",
    items: [
      { title: "Dynamic QR", icon: QrCode, href: "/admin/qr-codes" },
      { title: "Virtual Accounts", icon: Building2, href: "/admin/virtual-accounts" },
      { title: "Payment Links", icon: Link2, href: "/admin/payment-links" },
    ],
  },
  {
    group: "Gateways",
    items: [
      { title: "UPI Gateways", icon: Zap, href: "/admin/upi-gateways" },
      { title: "Payment Gateways", icon: Plug, href: "/admin/payment-gateways" },
      { title: "Payin Gateway", icon: CreditCard, href: "/admin/payin-gateway" },
      { title: "Payout Gateway", icon: Landmark, href: "/admin/payout-gateway" },
      { title: "Smart Routing", icon: GitMerge, href: "/admin/smart-routing" },
      { title: "Payment Providers", icon: Zap, href: "/admin/providers" },
      { title: "QR Providers", icon: QrCode, href: "/admin/qr-providers" },
      { title: "Provider Integrations", icon: Layers, href: "/admin/provider-integrations" },
      { title: "Visibility Rules", icon: Eye, href: "/admin/visibility-rules" },
      { title: "Merchant Access", icon: LayoutGrid, href: "/admin/merchant-access" },
    ],
  },
  {
    group: "Monitoring",
    items: [
      { title: "Webhook Logs", icon: Webhook, href: "/admin/webhook-logs" },
      { title: "Payout Webhook Logs", icon: Activity, href: "/admin/payout-webhook-logs" },
      { title: "Callback Logs", icon: Activity, href: "/admin/callbacks" },
      { title: "API Monitoring", icon: Activity, href: "/admin/api-monitoring" },
    ],
  },
  {
    group: "Control & Access",
    items: [
      { title: "Module Control", icon: ToggleLeft, href: "/admin/module-control" },
      { title: "Feature Control", icon: Sliders, href: "/admin/feature-control" },
      { title: "Account Details", icon: CreditCard, href: "/admin/account-details" },
    ],
  },
  {
    group: "Finance",
    items: [
      { title: "Reconciliation",       icon: GitMerge,    href: "/admin/reconciliation" },
      { title: "Reports",              icon: BarChart3,   href: "/admin/reports" },
      { title: "Merchant Statements",  icon: FileText,    href: "/admin/merchant-statements" },
      { title: "Platform Profit",      icon: TrendingUp,  href: "/admin/platform-profit", superAdminOnly: true as const },
    ],
  },
  {
    group: "Support",
    items: [
      { title: "Support Tickets", icon: Headphones, href: "/admin/support-tickets" },
    ],
  },
  {
    group: "Administration",
    items: [
      { title: "Audit Logs", icon: Shield, href: "/admin/audit-logs" },
      { title: "User Roles", icon: UserCog, href: "/admin/user-roles" },
      { title: "Company Branding", icon: Paintbrush, href: "/admin/company-branding" },
      { title: "OTP / SMS Settings", icon: MessageSquare, href: "/admin/otp-settings", superAdminOnly: true },
      { title: "Email OTP Settings", icon: Mail, href: "/admin/otp-email-settings", superAdminOnly: true as const },
      { title: "Social Auth Providers", icon: Shield, href: "/admin/social-providers", superAdminOnly: true as const },
      { title: "Secure ID Provider", icon: ShieldCheck, href: "/admin/secure-id-settings", superAdminOnly: true as const },
      { title: "Merchant Auto KYC Settings", icon: ShieldCheck, href: "/admin/merchant-kyc-settings", superAdminOnly: true as const },
      { title: "Data Hygiene", icon: Trash2, href: "/admin/data-hygiene", superAdminOnly: true as const },
      { title: "Agents", icon: Users, href: "/admin/agents" },
      { title: "IAM & Permissions", icon: ShieldCheck, href: "/admin/iam", superAdminOnly: true as const, permissionOverride: "iam_read" as const },
      { title: "Settings", icon: Settings, href: "/admin/settings" },
      { title: "API Reference", icon: BookOpen, href: "/admin/api-docs" },
    ],
  },
];

function getScheduleNextDue(lastSentAt: string | null | undefined, frequency: string): Date | null {
  if (!lastSentAt) return null;
  const last = new Date(lastSentAt);
  const days = frequency === "monthly" ? 28 : frequency === "daily" ? 1 : 7;
  return new Date(last.getTime() + days * 24 * 60 * 60 * 1000);
}

function AdminSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const hasIamRead = useHasPermission("iam_read");
  const { data: complianceData } = useGetSecurityComplianceSummary();
  const neverCount = complianceData?.neverCount ?? 0;

  const { data: schedulesData } = useListMerchantReportSchedules();
  const schedules = schedulesData?.schedules ?? [];
  const deliveryFailureCount = schedules.filter((s) => s.consecutiveFailures > 0).length;

  const now = new Date();
  const overdueCount = schedules.filter((s) => {
    if (!s.isActive || s.consecutiveFailures > 0) return false;
    const nextDue = getScheduleNextDue(s.lastSentAt, s.frequency);
    return nextDue != null && nextDue < now;
  }).length;

  const { data: deliveryHealth } = useGetReportDeliveryHealth(undefined, {
    query: { refetchInterval: 60_000, queryKey: ["/api/reports/delivery-health"] },
  });
  const hasDeliveryAlert =
    (deliveryHealth?.stats.autoPausedSchedules ?? 0) > 0 ||
    (deliveryHealth?.stats.overallFailureRate ?? 0) >= 0.2;

  const { data: meData } = useGetMe();
  const snoozeKey = getReportSnoozeKey(user?.id);
  const auditSnoozeKey = getAuditSnoozeKey(user?.id);

  const [localSnoozeUntil, setLocalSnoozeUntil] = useState<number | null>(null);
  const [localAuditSnoozeUntil, setLocalAuditSnoozeUntil] = useState<number | null>(null);

  useEffect(() => {
    const v = localStorage.getItem(snoozeKey);
    const ts = v ? parseInt(v, 10) : NaN;
    setLocalSnoozeUntil(!isNaN(ts) && ts > Date.now() ? ts : null);
  }, [snoozeKey]);

  useEffect(() => {
    const v = localStorage.getItem(auditSnoozeKey);
    const ts = v ? parseInt(v, 10) : NaN;
    setLocalAuditSnoozeUntil(!isNaN(ts) && ts > Date.now() ? ts : null);
  }, [auditSnoozeKey]);

  useEffect(() => {
    if (localSnoozeUntil == null) return;
    const remaining = localSnoozeUntil - Date.now();
    if (remaining <= 0) { setLocalSnoozeUntil(null); return; }
    const timer = setTimeout(() => setLocalSnoozeUntil(null), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [localSnoozeUntil]);

  useEffect(() => {
    if (localAuditSnoozeUntil == null) return;
    const remaining = localAuditSnoozeUntil - Date.now();
    if (remaining <= 0) { setLocalAuditSnoozeUntil(null); return; }
    const timer = setTimeout(() => setLocalAuditSnoozeUntil(null), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [localAuditSnoozeUntil]);

  useEffect(() => {
    const readCurrent = () => {
      const v = localStorage.getItem(snoozeKey);
      const ts = v ? parseInt(v, 10) : NaN;
      setLocalSnoozeUntil(!isNaN(ts) && ts > Date.now() ? ts : null);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== snoozeKey) return;
      readCurrent();
    };
    const onCustom = () => readCurrent();
    window.addEventListener("storage", onStorage);
    window.addEventListener(REPORTS_SNOOZE_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(REPORTS_SNOOZE_EVENT, onCustom);
    };
  }, [snoozeKey]);

  useEffect(() => {
    const readAuditCurrent = () => {
      const v = localStorage.getItem(auditSnoozeKey);
      const ts = v ? parseInt(v, 10) : NaN;
      setLocalAuditSnoozeUntil(!isNaN(ts) && ts > Date.now() ? ts : null);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== auditSnoozeKey) return;
      readAuditCurrent();
    };
    const onCustom = () => readAuditCurrent();
    window.addEventListener("storage", onStorage);
    window.addEventListener(AUDIT_SNOOZE_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUDIT_SNOOZE_EVENT, onCustom);
    };
  }, [auditSnoozeKey]);

  const serverReportsSnoozeTs = (meData?.badgeSnoozedUntil?.["reports"] ?? meData?.reportsBadgeSnoozedUntil) != null
    ? new Date((meData?.badgeSnoozedUntil?.["reports"] ?? meData?.reportsBadgeSnoozedUntil)!).getTime()
    : null;
  const serverSnoozed = serverReportsSnoozeTs != null && serverReportsSnoozeTs > Date.now();
  const isSnoozed = serverSnoozed || (localSnoozeUntil != null && localSnoozeUntil > Date.now());

  const serverAuditSnoozeTs = meData?.badgeSnoozedUntil?.["audit"] != null
    ? new Date(meData.badgeSnoozedUntil["audit"]).getTime()
    : null;
  const serverAuditSnoozed = serverAuditSnoozeTs != null && serverAuditSnoozeTs > Date.now();
  const isAuditSnoozed = serverAuditSnoozed || (localAuditSnoozeUntil != null && localAuditSnoozeUntil > Date.now());

  return (
    <>
      {ADMIN_NAV.map((group) => (
        <SidebarGroup key={group.group}>
          <SidebarGroupLabel>{group.group}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                if ((item as any).superAdminOnly) {
                  const hasPermOverride = (item as any).permissionOverride && hasIamRead;
                  if (!meData?.isSuperAdmin && !hasPermOverride) return null;
                }
                const isAuditLogs = item.href === "/admin/audit-logs";
                const isReports = item.href === "/admin/reports";
                const isActive = location === item.href || (isAuditLogs && location.startsWith("/admin/audit-logs"));
                const linkHref = isAuditLogs && !isAuditSnoozed && neverCount > 0
                  ? "/admin/audit-logs?tab=compliance"
                  : isReports && !isSnoozed && hasDeliveryAlert
                  ? "/admin/reports?tab=delivery-health"
                  : item.href;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                      <Link href={linkHref} className="flex items-center gap-3">
                        <item.icon className="w-4 h-4 shrink-0" />
                        <span className="flex-1">{item.title}</span>
                        {isAuditLogs && !isAuditSnoozed && neverCount > 0 && (
                          <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-amber-500 text-[10px] font-bold text-black px-1 leading-none">
                            {neverCount > 99 ? "99+" : neverCount}
                          </span>
                        )}
                        {isReports && overdueCount > 0 && (
                          <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-amber-500 text-[10px] font-bold text-black px-1 leading-none" aria-label={`${overdueCount} overdue schedule${overdueCount !== 1 ? "s" : ""}`}>
                            {overdueCount > 99 ? "99+" : overdueCount}
                          </span>
                        )}
                        {isReports && !isSnoozed && deliveryFailureCount > 0 && (
                          <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-[10px] font-bold text-white px-1 leading-none">
                            {deliveryFailureCount > 99 ? "99+" : deliveryFailureCount}
                          </span>
                        )}
                        {isReports && !isSnoozed && hasDeliveryAlert && (
                          <span className="flex items-center justify-center w-2 h-2 rounded-full bg-amber-400 shrink-0" aria-label="Delivery health alert" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

function MobileHeader({
  publicMode,
  isAdmin,
  isPayoutMerchant,
  portalLabel,
  portalName,
  user,
}: {
  publicMode: boolean;
  isAdmin: boolean;
  isPayoutMerchant: boolean;
  portalLabel: string;
  portalName: string;
  user: ReturnType<typeof useAuth>["user"];
}) {
  const { openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const [location] = useLocation();

  useEffect(() => {
    setOpenMobile(false);
  }, [location, setOpenMobile]);

  useEffect(() => {
    if (openMobile) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [openMobile]);

  const logoHref = publicMode ? "/"
    : isAdmin ? "/admin/dashboard"
    : isPayoutMerchant ? "/payout-merchant/dashboard"
    : "/merchant/dashboard";

  return (
    <header
      className="xl:hidden sticky top-0 z-40 flex items-center gap-2 h-14 border-b border-border/50 bg-background/95 backdrop-blur shrink-0"
      style={{ paddingLeft: "12px", paddingRight: "12px" }}
    >
      <button
        type="button"
        onClick={toggleSidebar}
        className="h-11 w-11 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label={openMobile ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={openMobile}
      >
        {openMobile ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>
      <Link
        href={logoHref}
        className="flex items-center gap-2 flex-1 min-w-0 min-h-[44px]"
      >
        <RasoKartLogo size={22} className="shrink-0" />
        <span className="font-semibold text-sm truncate">{portalLabel}</span>
      </Link>
      {!publicMode && user && <NotificationBell isAdmin={isAdmin} />}
      <InstallAppButton
        appName={portalName}
        variant="ghost"
        className="h-9 w-9 !p-0 shrink-0 text-muted-foreground hover:text-foreground [&>span]:hidden"
      />
    </header>
  );
}

const DEPLOY_SYNC_ALERT_DISMISS_KEY = "rasokart_deploy_sync_alert_dismissed";

function GithubSyncAdminAlert() {
  const [expanded, setExpanded] = useState(false);
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(DEPLOY_SYNC_ALERT_DISMISS_KEY);
    } catch {
      return null;
    }
  });

  const { data: divergence, dataUpdatedAt: divergenceCheckedAt } = useGetGithubSyncDivergence({
    query: {
      refetchInterval: 5 * 60 * 1000,
      staleTime: 4 * 60 * 1000,
      queryKey: ["/api/github-sync/divergence", "admin-sidebar-alert"],
    },
  });
  const { data: syncStatus, dataUpdatedAt: statusCheckedAt } = useGetGithubSyncStatus({
    query: {
      refetchInterval: 5 * 60 * 1000,
      staleTime: 4 * 60 * 1000,
      queryKey: ["/api/github-sync/status", "admin-sidebar-alert"],
    },
  });

  const diverged = divergence?.checked === true && divergence.diverged === true;
  const pushFailed = syncStatus?.status === "failure";
  const pushSkipped = syncStatus?.status === "skipped";
  const hasIssue = diverged || pushFailed || pushSkipped;

  const signature = `${diverged ? "d" : "-"}${pushFailed ? "f" : "-"}${pushSkipped ? "s" : "-"}:${divergence?.remoteAheadBy ?? 0}`;

  if (!hasIssue || dismissedSignature === signature) return null;

  const lastCheckedMs = Math.max(divergenceCheckedAt || 0, statusCheckedAt || 0);

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(DEPLOY_SYNC_ALERT_DISMISS_KEY, signature);
    } catch {
      // sessionStorage unavailable — dismissal just won't persist, non-critical
    }
    setDismissedSignature(signature);
  };

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-950/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full text-left px-2.5 py-2"
        aria-expanded={expanded}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
        </span>
        <span className="flex-1 text-xs font-medium text-amber-300 truncate">Deploy sync needs attention</span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-amber-400/70 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Replit ↔ GitHub</span>
            <span className={diverged ? "text-amber-400 font-medium" : "text-emerald-400 font-medium"}>
              {diverged ? `${divergence?.remoteAheadBy ?? "some"} commit${divergence?.remoteAheadBy === 1 ? "" : "s"} diverged` : "In sync"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">GitHub push</span>
            <span className={pushFailed ? "text-red-400 font-medium" : pushSkipped ? "text-amber-400 font-medium" : "text-emerald-400 font-medium"}>
              {syncStatus?.status === "failure" ? "Failed" : syncStatus?.status === "skipped" ? "Skipped" : syncStatus?.status === "running" ? "Running" : syncStatus?.status === "never" ? "Never run" : "Synced"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">VPS deploy</span>
            <span className="text-muted-foreground/80" title="Deployed manually per DEPLOY_HETZNER.md — not auto-tracked yet">Manual — pending your deploy</span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-amber-500/20 text-muted-foreground/70">
            <span>Last checked</span>
            <span>{lastCheckedMs ? format(new Date(lastCheckedMs), "d MMM, h:mm a") : "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Link href="/admin/settings" className="text-[11px] text-amber-300 hover:text-amber-200 underline underline-offset-2">
              Open GitHub Sync settings
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={handleDismiss}
            >
              Dismiss for now
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardLayout({ children, publicMode = false }: DashboardLayoutProps) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  // Hooks must run unconditionally on every render (React rules-of-hooks).
  // Previously this was called after an early `if (!user) return ...`
  // below, so the very first render right after a hard-redirect login (user
  // still null while /api/auth/me resolves) skipped this hook, and the next
  // render (user populated) called it — a hook-count mismatch that crashed
  // the whole dashboard with "Rendered more hooks than during the previous
  // render". Calling it here, before any early return, keeps hook order
  // stable across both renders.
  const { companyName, supportPhone } = useCompanySettings();

  if (!publicMode && !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    );
  }

  const isAdmin = user?.role === UserRole.admin;
  const isPayoutMerchant = !isAdmin && (user as any)?.merchantType === "PAYOUT_ONLY";
  const portalName = location.startsWith("/admin") ? "RasoKart Admin"
    : location.startsWith("/merchant") ? "RasoKart Merchant"
    : location.startsWith("/agent") ? "RasoKart Agent"
    : "RasoKart";

  const publicNav = [
    { title: "UPI Collection API", icon: Code2, href: "/upi-collection-api" },
    { title: "API Docs", icon: BookOpen, href: "/merchant/api-docs" },
  ];

  const portalLabel = publicMode ? "Developer Docs" : (isAdmin ? "Admin Console" : "Merchant Portal");

  return (
    <SidebarProvider defaultOpen={typeof window !== 'undefined' ? window.innerWidth >= 1280 : true}>
      <div className="flex min-h-screen bg-background w-full">
        <Sidebar collapsible="offcanvas" variant="sidebar" className="border-r border-border/50">
          <SidebarHeader className="p-4 flex-row items-center gap-2 hidden xl:flex">
            <Link
              href={publicMode ? "/" : isAdmin ? "/admin/dashboard" : "/merchant/dashboard"}
              className="flex items-center gap-2 flex-1 min-w-0"
            >
              <RasoKartLogo size={32} className="shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-sm tracking-wide">RasoKart</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{portalLabel}</span>
              </div>
            </Link>
            {!publicMode && user && <NotificationBell isAdmin={isAdmin} />}
          </SidebarHeader>
          <SidebarContent>
            {publicMode ? (
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {publicNav.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild isActive={location === item.href} tooltip={item.title}>
                          <Link href={item.href} className="flex items-center gap-3">
                            <item.icon className="w-4 h-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : isAdmin ? (
              <AdminSidebar />
            ) : (
              <MerchantSidebar />
            )}
          </SidebarContent>
          <SidebarFooter className="p-4 space-y-2">
            {!publicMode && isAdmin && <GithubSyncAdminAlert />}
            <InstallAppButton
              appName={portalName}
              variant="ghost"
              className="w-full justify-start text-muted-foreground hover:text-foreground text-xs h-8 px-2"
            />
            <p className="text-[10px] text-muted-foreground/70 truncate px-2" title={`Operated by ${companyName} · Support: ${supportPhone}`}>
              Operated by {companyName} · {supportPhone}
            </p>
            {user ? (
              <div className="flex items-center justify-between">
                <div className="flex flex-col truncate pr-2">
                  <span className="text-sm font-medium truncate">{user.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={logout} title="Sign out" className="shrink-0 text-muted-foreground hover:text-foreground">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Link href="/merchant/login">
                <Button variant="outline" size="sm" className="w-full">Sign In</Button>
              </Link>
            )}
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile top header — proper 3-line hamburger + branding */}
          <MobileHeader
            publicMode={publicMode}
            isAdmin={isAdmin}
            isPayoutMerchant={isPayoutMerchant}
            portalLabel={portalLabel}
            portalName={portalName}
            user={user}
          />

          {/* Page content */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 pb-24 md:pb-8">
            {!publicMode && !isAdmin && <SuspensionBanner />}
            {!publicMode && !isAdmin && <CallbackSecretBanner />}
            {children}
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation — hidden on md+ */}
      <MobileBottomNav />
    </SidebarProvider>
  );
}
