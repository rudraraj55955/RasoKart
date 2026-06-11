import { useState } from "react";
import { useGetCallbackSecret, useListApiKeys, useGetMe, useListMySecurityActivity } from "@workspace/api-client-react";
import { SECRET_WARN_DAYS, SECRET_ROTATION_OVERDUE_DAYS } from "@/lib/webhook-constants";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, KeyRound, Webhook, RotateCcw, CheckCircle2, AlertTriangle, Clock, Lock, Shield, ChevronLeft, ChevronRight, AlertCircle, UserCog, CreditCard, FileText, Sliders, Info, X } from "lucide-react";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { Link } from "wouter";

// ── Activity log helpers ───────────────────────────────────────────────────────

const ACTION_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  merchant_approved:        { label: "Account Approved",        icon: <UserCog className="w-4 h-4" />,     color: "text-emerald-400" },
  merchant_suspended:       { label: "Account Suspended",       icon: <AlertCircle className="w-4 h-4" />, color: "text-red-400" },
  merchant_reinstated:      { label: "Account Reinstated",      icon: <UserCog className="w-4 h-4" />,     color: "text-emerald-400" },
  merchant_rejected:        { label: "Account Rejected",        icon: <AlertCircle className="w-4 h-4" />, color: "text-red-400" },
  plan_assigned:            { label: "Plan Assigned",           icon: <CreditCard className="w-4 h-4" />,  color: "text-blue-400" },
  plan_suspended:           { label: "Plan Suspended",          icon: <AlertCircle className="w-4 h-4" />, color: "text-amber-400" },
  plan_reinstated:          { label: "Plan Reinstated",         icon: <CreditCard className="w-4 h-4" />,  color: "text-emerald-400" },
  api_key_reset:            { label: "API Key Reset",           icon: <KeyRound className="w-4 h-4" />,    color: "text-amber-400" },
  webhook_url_changed:      { label: "Webhook URL Changed",     icon: <Webhook className="w-4 h-4" />,     color: "text-amber-400" },
  settlement_approved:      { label: "Settlement Approved",     icon: <FileText className="w-4 h-4" />,    color: "text-emerald-400" },
  settlement_rejected:      { label: "Settlement Rejected",     icon: <FileText className="w-4 h-4" />,    color: "text-red-400" },
  settlement_paid:          { label: "Settlement Paid",         icon: <FileText className="w-4 h-4" />,    color: "text-emerald-400" },
  feature_toggle:           { label: "Feature Changed",         icon: <Sliders className="w-4 h-4" />,     color: "text-blue-400" },
};

const ACTION_CHIPS = [
  { value: "all", label: "All" },
  ...Object.entries(ACTION_META).map(([value, meta]) => ({ value, label: meta.label })),
];

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

// ── Credential rotation helpers ────────────────────────────────────────────────

function ageStatusBadge(date: string | null | undefined, warnDays: number, overdueDays: number) {
  if (!date) return null;
  const days = differenceInDays(new Date(), new Date(date));
  if (days >= overdueDays) {
    return (
      <Badge className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-xs">
        <AlertTriangle className="w-3 h-3 mr-1" />
        Overdue — rotate now
      </Badge>
    );
  }
  if (days >= warnDays) {
    return (
      <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs">
        <AlertTriangle className="w-3 h-3 mr-1" />
        Rotation due soon
      </Badge>
    );
  }
  return (
    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
      <CheckCircle2 className="w-3 h-3 mr-1" />
      Up to date
    </Badge>
  );
}

function CredentialRow({
  label,
  icon: Icon,
  date,
  accountDate,
  statusBadge,
  detail,
  notSetLabel,
}: {
  label: string;
  icon: React.ElementType;
  date: string | null | undefined;
  accountDate?: string | null;
  statusBadge?: React.ReactNode;
  detail?: React.ReactNode;
  notSetLabel?: string;
}) {
  const displayDate = date ?? null;

  return (
    <div className="flex items-start gap-4 py-4 border-b border-border/40 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{label}</span>
          {statusBadge}
        </div>
        {displayDate ? (
          <p className="text-xs text-muted-foreground mt-1">
            Last changed{" "}
            <span className="font-mono">{format(new Date(displayDate), "d MMM yyyy, HH:mm")}</span>
            {" "}—{" "}
            <span className="text-muted-foreground/70">
              {formatDistanceToNow(new Date(displayDate), { addSuffix: true })}
            </span>
          </p>
        ) : accountDate ? (
          <p className="text-xs text-muted-foreground/60 mt-1 italic">
            {notSetLabel ?? "No changes recorded"} — set since account creation ({format(new Date(accountDate), "d MMM yyyy")})
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/50 mt-1 italic">
            {notSetLabel ?? "No history available"}
          </p>
        )}
        {detail && <div className="mt-2">{detail}</div>}
      </div>
    </div>
  );
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function MerchantSecurity() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const LIMIT = 20;

  const { data: me, isLoading: meLoading } = useGetMe();
  const { data: secretStatus, isLoading: secretLoading } = useGetCallbackSecret();
  const { data: apiKeys, isLoading: keysLoading } = useListApiKeys();
  const { data: activityData, isLoading: activityLoading } = useListMySecurityActivity({
    page,
    limit: LIMIT,
    ...(actionFilter !== "all" ? { action: actionFilter } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  });

  const allKeys = apiKeys ?? [];
  const activeKeys = allKeys.filter(k => k.isActive);
  const revokedKeys = allKeys.filter(k => !k.isActive);

  const entries = activityData?.data ?? [];
  const total = activityData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const credentialsLoading = meLoading || secretLoading || keysLoading;

  const hasActiveFilters = actionFilter !== "all" || dateFrom !== "" || dateTo !== "";

  function handleActionFilter(value: string) {
    setActionFilter(value);
    setPage(1);
  }

  function handleDateFrom(value: string) {
    setDateFrom(value);
    setPage(1);
  }

  function handleDateTo(value: string) {
    setDateTo(value);
    setPage(1);
  }

  function clearFilters() {
    setActionFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
          <ShieldCheck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Security</h1>
          <p className="text-muted-foreground mt-0.5">Credential rotation history and account security overview</p>
        </div>
      </div>

      {/* ── Credential rotation ── */}
      <Card>
        <CardHeader>
          <CardTitle>Credential Rotation History</CardTitle>
          <CardDescription>
            Rotate credentials regularly to reduce exposure. Callback secrets should be rotated every {SECRET_ROTATION_OVERDUE_DAYS} days.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 px-6 pb-2">
          {credentialsLoading ? (
            <div className="space-y-4 py-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-4 border-b border-border/40 last:border-0">
                  <div className="w-8 h-8 rounded-lg bg-muted/40 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted/50 rounded w-48 animate-pulse" />
                    <div className="h-3 bg-muted/40 rounded w-64 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Account password */}
              <CredentialRow
                label="Account Password"
                icon={Lock}
                date={me?.passwordUpdatedAt ?? null}
                accountDate={me?.createdAt ?? null}
                statusBadge={
                  me?.passwordUpdatedAt ? (
                    <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/20 text-xs">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Changed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground/60 text-xs border-border/50">
                      Never changed
                    </Badge>
                  )
                }
                notSetLabel="Password has never been changed"
              />

              {/* Callback signing secret */}
              <CredentialRow
                label="Callback Signing Secret"
                icon={Webhook}
                date={secretStatus?.lastRotatedAt ?? null}
                statusBadge={
                  secretStatus?.isSet
                    ? ageStatusBadge(secretStatus.lastRotatedAt, SECRET_WARN_DAYS, SECRET_ROTATION_OVERDUE_DAYS)
                    : (
                      <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Not configured
                      </Badge>
                    )
                }
                detail={
                  secretStatus?.isSet ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground/60">Prefix:</span>
                      <code className="text-xs font-mono bg-muted/40 border border-border/40 px-1.5 py-0.5 rounded text-muted-foreground">
                        {secretStatus.secretPrefix}…
                      </code>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-400/80 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Inbound callbacks cannot be verified without a signing secret
                    </p>
                  )
                }
                notSetLabel="No secret has been configured"
              />

              {/* API keys */}
              <CredentialRow
                label="API Keys"
                icon={KeyRound}
                date={
                  allKeys.length > 0
                    ? allKeys.reduce((latest, k) =>
                        new Date(k.createdAt) > new Date(latest) ? k.createdAt : latest,
                        allKeys[0]!.createdAt
                      )
                    : null
                }
                statusBadge={
                  activeKeys.length > 0 ? (
                    <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/20 text-xs">
                      {activeKeys.length} active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground/60 text-xs border-border/50">
                      No active keys
                    </Badge>
                  )
                }
                detail={
                  allKeys.length > 0 ? (
                    <div className="space-y-1.5 mt-1">
                      {allKeys
                        .slice()
                        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                        .map(key => (
                          <div key={key.id} className="flex items-center gap-2 text-xs flex-wrap">
                            <code className="font-mono bg-muted/40 border border-border/40 px-1.5 py-0.5 rounded text-muted-foreground">
                              {key.keyPrefix}…
                            </code>
                            <Badge
                              variant="outline"
                              className={
                                key.isActive
                                  ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5 text-[10px] px-1.5 py-0"
                                  : "text-muted-foreground/50 border-border/40 text-[10px] px-1.5 py-0"
                              }
                            >
                              {key.isActive ? "Active" : "Revoked"}
                            </Badge>
                            <span className="text-muted-foreground/60">
                              Generated {format(new Date(key.createdAt), "d MMM yyyy")}
                            </span>
                            {key.lastUsedAt && (
                              <span className="text-muted-foreground/40">
                                · Last used {formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true })}
                              </span>
                            )}
                          </div>
                        ))}
                      {revokedKeys.length > 0 && (
                        <p className="text-xs text-muted-foreground/40 italic mt-1">
                          {revokedKeys.length} revoked {revokedKeys.length === 1 ? "key" : "keys"} — revoking old keys is good practice
                        </p>
                      )}
                    </div>
                  ) : null
                }
                notSetLabel="No API keys have been generated"
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Best practices ── */}
      <Card className="border-border/50">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-start gap-3">
            <Clock className="w-4 h-4 text-muted-foreground/60 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Rotation best practices</p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground/70 list-disc list-inside">
                <li>Rotate your callback signing secret every <strong className="text-muted-foreground">{SECRET_ROTATION_OVERDUE_DAYS} days</strong></li>
                <li>Use a strong, unique password and change it if you suspect compromise</li>
                <li>Revoke unused API keys immediately to reduce attack surface</li>
                <li>Never share secret keys in client-side code or public repositories</li>
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button variant="outline" size="sm" asChild>
              <Link href="/merchant/webhook">
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                Rotate callback secret
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/merchant/api-keys">
                <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                Manage API keys
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Admin activity log ── */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2 mb-3">
          <Shield className="w-5 h-5 text-primary" />
          Security Activity
        </h2>

        <Card className="border-blue-500/20 bg-blue-950/10 mb-4">
          <CardContent className="py-3 flex items-start gap-3">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-300/80">
              This log shows actions performed by RasoKart platform administrators on your account.
              Admin identities are partially redacted for privacy. If you have concerns about any
              entry, please contact support.
            </p>
          </CardContent>
        </Card>

        {/* ── Filters ── */}
        <div className="space-y-3 mb-4">
          {/* Action type chips */}
          <div className="flex flex-wrap gap-2">
            {ACTION_CHIPS.map(chip => (
              <button
                key={chip.value}
                onClick={() => handleActionFilter(chip.value)}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  actionFilter === chip.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border bg-transparent"
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Date range */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => handleDateFrom(e.target.value)}
                max={dateTo || undefined}
                className="h-8 text-xs w-40 bg-background border-border/60"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={e => handleDateTo(e.target.value)}
                min={dateFrom || undefined}
                className="h-8 text-xs w-40 bg-background border-border/60"
              />
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Clear filters
              </Button>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {activityLoading ? (
              <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
            ) : entries.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                <Shield className="w-10 h-10 opacity-20" />
                <p className="text-sm">
                  {hasActiveFilters ? "No events match your filters" : "No admin activity on your account yet"}
                </p>
                {hasActiveFilters && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
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
          <div className="flex items-center justify-between text-sm text-muted-foreground mt-3">
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
    </div>
  );
}
