import { useState } from "react";
import { useListAdminAuditLogs, useGetAdminAuditLogStats } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Shield, Search, Eye, Activity, FileDown, CalendarIcon, X,
  CheckCircle2, XCircle, UserPlus, UserCog,
  Package, PencilLine, Trash2, ArrowRightLeft, CreditCard,
} from "lucide-react";
import { format, parseISO } from "date-fns";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  merchant_approved:  { label: "Merchant Approved",  color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  merchant_rejected:  { label: "Merchant Rejected",  color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  plan_assigned:      { label: "Plan Assigned",       color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  plan_upgraded:      { label: "Plan Upgraded",       color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  plan_downgraded:    { label: "Plan Downgraded",     color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  plan_renewed:       { label: "Plan Renewed",        color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  plan_created:       { label: "Plan Created",        color: "bg-primary/10 text-primary border-primary/20" },
  plan_updated:       { label: "Plan Updated",        color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  plan_deleted:       { label: "Plan Deleted",        color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  user_created:       { label: "User Created",        color: "bg-primary/10 text-primary border-primary/20" },
  user_role_changed:  { label: "Role Changed",        color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  csv_export:         { label: "CSV Export",          color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
};

const ALL_ACTIONS = Object.keys(ACTION_LABELS);

const FILTER_LABELS: Record<string, string> = {
  type: "Type",
  status: "Status",
  search: "Search",
  merchantId: "Merchant",
  dateFrom: "From",
  dateTo: "To",
};

function formatDateLabel(val: string): string {
  try { return format(parseISO(val), "MMM d, yyyy"); } catch { return val; }
}

function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}: </span>
      <span className="text-xs font-medium">{value}</span>
    </div>
  );
}

function SummaryCard({
  icon, title, subtitle, colorClass,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  colorClass: string;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${colorClass}`}>
      <div className="shrink-0">{icon}</div>
      <div>
        <p className="text-sm font-semibold leading-snug">{title}</p>
        {subtitle && <p className="text-xs opacity-70 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function CsvExportDetails({ log }: { log: any }) {
  let parsed: { rowCount?: number; filters?: Record<string, string | number | null> } = {};
  try { parsed = JSON.parse(log.details); } catch { return null; }

  const { rowCount, filters = {} } = parsed;
  const targetType = (log.targetType as string) || "records";

  const activeFilters = Object.entries(filters).filter(([, v]) => v != null && v !== "");

  const dateFrom = filters["dateFrom"] as string | null;
  const dateTo = filters["dateTo"] as string | null;
  const hasDates = dateFrom != null || dateTo != null;

  const nonDateFilters = activeFilters.filter(([k]) => k !== "dateFrom" && k !== "dateTo");

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<FileDown className="w-5 h-5 text-sky-400" />}
        title={`Exported ${rowCount != null ? rowCount.toLocaleString() : "—"} ${targetType}`}
        subtitle={!activeFilters.length ? "No filters applied — full export" : undefined}
        colorClass="bg-sky-500/10 border-sky-500/20"
      />
      {activeFilters.length > 0 && (
        <div className="rounded-lg bg-muted/20 p-3 space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Filters applied</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {nonDateFilters.map(([key, val]) => (
              <DetailRow key={key} label={FILTER_LABELS[key] ?? key} value={String(val)} />
            ))}
            {hasDates && (
              <div className="col-span-2">
                <span className="text-xs text-muted-foreground">Date range: </span>
                <span className="text-xs font-medium">
                  {dateFrom ? formatDateLabel(dateFrom) : "—"}
                  {" – "}
                  {dateTo ? formatDateLabel(dateTo) : "—"}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MerchantApprovedDetails({ log }: { log: any }) {
  let parsed: { businessName?: string; email?: string; reason?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
        title={parsed.businessName ? `Approved: ${parsed.businessName}` : "Merchant application approved"}
        subtitle={parsed.email}
        colorClass="bg-emerald-500/10 border-emerald-500/20"
      />
      {parsed.reason && (
        <div className="rounded-lg bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <p className="text-xs">{parsed.reason}</p>
        </div>
      )}
      <div className="rounded-lg bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground mb-1">Target merchant ID</p>
        <p className="text-xs font-mono">#{log.targetId ?? "—"}</p>
      </div>
    </div>
  );
}

function MerchantRejectedDetails({ log }: { log: any }) {
  let parsed: { businessName?: string; email?: string; reason?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<XCircle className="w-5 h-5 text-rose-400" />}
        title={parsed.businessName ? `Rejected: ${parsed.businessName}` : "Merchant application rejected"}
        subtitle={parsed.email}
        colorClass="bg-rose-500/10 border-rose-500/20"
      />
      {parsed.reason && (
        <div className="rounded-lg bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground mb-1">Rejection reason</p>
          <p className="text-xs">{parsed.reason}</p>
        </div>
      )}
      <div className="rounded-lg bg-muted/20 p-3">
        <p className="text-xs text-muted-foreground mb-1">Target merchant ID</p>
        <p className="text-xs font-mono">#{log.targetId ?? "—"}</p>
      </div>
    </div>
  );
}

function PlanAssignmentDetails({ log }: { log: any }) {
  let parsed: { planName?: string; fromPlanId?: number | null; toPlanId?: number } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const action = log.action as string;
  const actionLabel =
    action === "plan_upgraded" ? "upgraded to" :
    action === "plan_downgraded" ? "downgraded to" :
    action === "plan_renewed" ? "renewed:" :
    "assigned:";

  const iconColor =
    action === "plan_downgraded" ? "text-amber-400" : "text-blue-400";
  const cardColor =
    action === "plan_downgraded"
      ? "bg-amber-500/10 border-amber-500/20"
      : "bg-blue-500/10 border-blue-500/20";

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<ArrowRightLeft className={`w-5 h-5 ${iconColor}`} />}
        title={parsed.planName ? `Plan ${actionLabel} ${parsed.planName}` : "Plan assignment changed"}
        subtitle={`Merchant #${log.targetId ?? "—"}`}
        colorClass={cardColor}
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.fromPlanId != null && (
          <DetailRow label="Previous plan ID" value={<span className="font-mono">#{parsed.fromPlanId}</span>} />
        )}
        {parsed.toPlanId != null && (
          <DetailRow label="New plan ID" value={<span className="font-mono">#{parsed.toPlanId}</span>} />
        )}
        {parsed.planName && (
          <DetailRow label="Plan name" value={parsed.planName} />
        )}
      </div>
    </div>
  );
}

function PlanCreatedDetails({ log }: { log: any }) {
  let parsed: { name?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Package className="w-5 h-5 text-primary" />}
        title={parsed.name ? `New plan created: ${parsed.name}` : "New plan created"}
        subtitle={`Plan #${log.targetId ?? "—"}`}
        colorClass="bg-primary/10 border-primary/20"
      />
    </div>
  );
}

function PlanUpdatedDetails({ log }: { log: any }) {
  let parsed: { name?: string; changes?: string[] } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<PencilLine className="w-5 h-5 text-amber-400" />}
        title={parsed.name ? `Updated plan: ${parsed.name}` : "Plan updated"}
        subtitle={`Plan #${log.targetId ?? "—"}`}
        colorClass="bg-amber-500/10 border-amber-500/20"
      />
      {parsed.changes && parsed.changes.length > 0 && (
        <div className="rounded-lg bg-muted/20 p-3 space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Fields changed</p>
          <div className="flex flex-wrap gap-1.5">
            {parsed.changes.map((c: string) => (
              <span key={c} className="inline-flex items-center rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                {humanizeKey(c)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanDeletedDetails({ log }: { log: any }) {
  let parsed: { name?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Trash2 className="w-5 h-5 text-rose-400" />}
        title={parsed.name ? `Deleted plan: ${parsed.name}` : "Plan deleted"}
        subtitle={`Plan #${log.targetId ?? "—"} has been permanently removed`}
        colorClass="bg-rose-500/10 border-rose-500/20"
      />
    </div>
  );
}

function UserCreatedDetails({ log }: { log: any }) {
  let parsed: { email?: string; role?: string; name?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<UserPlus className="w-5 h-5 text-primary" />}
        title={parsed.email ? `New user: ${parsed.email}` : "New user account created"}
        subtitle={parsed.role ? `Role: ${parsed.role}` : undefined}
        colorClass="bg-primary/10 border-primary/20"
      />
      {(parsed.name || parsed.email || parsed.role) && (
        <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
          {parsed.name && <DetailRow label="Name" value={parsed.name} />}
          {parsed.email && <DetailRow label="Email" value={parsed.email} />}
          {parsed.role && <DetailRow label="Role" value={<span className="capitalize">{parsed.role}</span>} />}
          <DetailRow label="User ID" value={<span className="font-mono">#{log.targetId ?? "—"}</span>} />
        </div>
      )}
    </div>
  );
}

function UserRoleChangedDetails({ log }: { log: any }) {
  let parsed: { email?: string; fromRole?: string; toRole?: string; role?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const hasRoleChange = parsed.fromRole || parsed.toRole;

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<UserCog className="w-5 h-5 text-purple-400" />}
        title={
          hasRoleChange
            ? `Role changed: ${parsed.fromRole ?? "?"} → ${parsed.toRole ?? "?"}`
            : parsed.email
            ? `Role changed for ${parsed.email}`
            : "User role updated"
        }
        subtitle={parsed.email && !hasRoleChange ? undefined : parsed.email}
        colorClass="bg-purple-500/10 border-purple-500/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.email && <DetailRow label="User" value={parsed.email} />}
        {parsed.fromRole && <DetailRow label="Previous role" value={<span className="capitalize">{parsed.fromRole}</span>} />}
        {(parsed.toRole || parsed.role) && (
          <DetailRow label="New role" value={<span className="capitalize">{parsed.toRole ?? parsed.role}</span>} />
        )}
        <DetailRow label="User ID" value={<span className="font-mono">#{log.targetId ?? "—"}</span>} />
      </div>
    </div>
  );
}

function RawJsonDetails({ log }: { log: any }) {
  return (
    <div className="rounded-lg bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground mb-2">Details</p>
      <pre className="text-xs font-mono overflow-auto max-h-48">
        {(() => { try { return JSON.stringify(JSON.parse(log.details), null, 2); } catch { return log.details; } })()}
      </pre>
    </div>
  );
}

function ActionDetails({ log }: { log: any }) {
  if (!log.details) return null;

  switch (log.action) {
    case "csv_export":
      return <CsvExportDetails log={log} />;
    case "merchant_approved":
      return <MerchantApprovedDetails log={log} />;
    case "merchant_rejected":
      return <MerchantRejectedDetails log={log} />;
    case "plan_assigned":
    case "plan_upgraded":
    case "plan_downgraded":
    case "plan_renewed":
      return <PlanAssignmentDetails log={log} />;
    case "plan_created":
      return <PlanCreatedDetails log={log} />;
    case "plan_updated":
      return <PlanUpdatedDetails log={log} />;
    case "plan_deleted":
      return <PlanDeletedDetails log={log} />;
    case "user_created":
      return <UserCreatedDetails log={log} />;
    case "user_role_changed":
      return <UserRoleChangedDetails log={log} />;
    default:
      return <RawJsonDetails log={log} />;
  }
}

function ActionBadge({ action }: { action: string }) {
  const config = ACTION_LABELS[action];
  if (!config) return <Badge variant="secondary" className="text-xs capitalize">{action.replace(/_/g, " ")}</Badge>;
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}

export default function AdminAuditLogs() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (action && action !== "all") params.set("action", action);
      if (search) params.set("search", search);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const token = localStorage.getItem("rasokart_token");
      const res = await fetch(`/api/audit-logs/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const { data: statsData } = useGetAdminAuditLogStats();
  const csvExportsLast30Days = statsData?.csvExportsLast30Days ?? 0;

  const hasDateFilter = dateFrom !== "" || dateTo !== "";

  function resetFilters() {
    setSearch("");
    setAction("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const { data, isLoading } = useListAdminAuditLogs({
    action: action === "all" ? undefined : action,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: 20,
  } as any);

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;

  function handleExportStatClick() {
    setAction("csv_export");
    setPage(1);
    setSearch("");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-muted-foreground mt-1">Track all admin actions and changes</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/20 border border-border/50 rounded-lg px-3 py-2">
          <Shield className="w-3.5 h-3.5" />
          <span>{total} events logged</span>
        </div>
      </div>

      <button
        onClick={handleExportStatClick}
        className="w-full text-left group"
      >
        <Card className="border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10 hover:border-sky-500/40 transition-colors cursor-pointer">
          <CardContent className="flex items-center gap-4 py-4 px-5">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/20 shrink-0">
              <FileDown className="w-5 h-5 text-sky-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-2xl font-bold text-sky-400 leading-none">{csvExportsLast30Days}</p>
              <p className="text-xs text-muted-foreground mt-1">CSV exports in the last 30 days</p>
            </div>
            <span className="text-xs text-sky-400/70 group-hover:text-sky-400 transition-colors font-medium">
              Filter to exports →
            </span>
          </CardContent>
        </Card>
      </button>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by admin or action..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                />
              </div>
              <Select value={action} onValueChange={v => { setAction(v); setPage(1); }}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Action type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {ALL_ACTIONS.map(a => (
                    <SelectItem key={a} value={a}>{ACTION_LABELS[a].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="flex items-center gap-2 flex-1">
                <CalendarIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex items-center gap-2 flex-1">
                  <div className="relative flex-1">
                    <Input
                      type="date"
                      value={dateFrom}
                      max={dateTo || undefined}
                      onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                      className="text-sm [color-scheme:dark]"
                      aria-label="Date from"
                    />
                    {dateFrom && (
                      <button
                        onClick={() => { setDateFrom(""); setPage(1); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label="Clear from date"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <span className="text-muted-foreground text-sm shrink-0">to</span>
                  <div className="relative flex-1">
                    <Input
                      type="date"
                      value={dateTo}
                      min={dateFrom || undefined}
                      onChange={e => { setDateTo(e.target.value); setPage(1); }}
                      className="text-sm [color-scheme:dark]"
                      aria-label="Date to"
                    />
                    {dateTo && (
                      <button
                        onClick={() => { setDateTo(""); setPage(1); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label="Clear to date"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(hasDateFilter || search !== "" || action !== "all") && (
                  <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5 mr-1.5" />
                    Clear filters
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportCsv}
                  disabled={exporting}
                  className="border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300 hover:border-sky-500/50"
                >
                  <FileDown className="w-3.5 h-3.5 mr-1.5" />
                  {exporting ? "Exporting…" : "Export CSV"}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admin</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target Type</TableHead>
                <TableHead>Target ID</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !logs.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Activity className="w-8 h-8 opacity-30" />
                      <p className="text-sm">No audit events yet</p>
                      <p className="text-xs opacity-70">Admin actions will be logged here</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : logs.map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{log.adminEmail}</p>
                      <p className="text-xs text-muted-foreground">ID #{log.adminId}</p>
                    </div>
                  </TableCell>
                  <TableCell><ActionBadge action={log.action} /></TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">{log.targetType}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {log.targetId ? `#${log.targetId}` : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {log.ipAddress ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(log.createdAt), "MMM d, yyyy HH:mm:ss")}
                  </TableCell>
                  <TableCell>
                    {log.details && (
                      <Button variant="ghost" size="icon" onClick={() => setSelected(log)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} total events</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Event Details — #{selected?.id}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <ActionBadge action={selected.action} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Admin</p>
                  <p className="text-sm">{selected.adminEmail}</p>
                </div>
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Timestamp</p>
                  <p className="text-xs font-mono">{format(new Date(selected.createdAt), "MMM d, yyyy HH:mm:ss")}</p>
                </div>
              </div>
              {selected.details && <ActionDetails log={selected} />}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
