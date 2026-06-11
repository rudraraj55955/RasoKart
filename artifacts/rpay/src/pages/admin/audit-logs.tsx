import { useState } from "react";
import {
  useListAdminAuditLogs, useGetAdminAuditLogStats,
  useListAuditReportSchedules, useCreateAuditReportSchedule,
  useUpdateAuditReportSchedule, useDeleteAuditReportSchedule,
  useSendAuditReportNow,
  getListAuditReportSchedulesQueryKey,
  useListAuditReportScheduleLogs,
  previewAuditReportEmail,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Shield, Search, Eye, Activity, FileDown, CalendarIcon, X,
  CheckCircle2, XCircle, UserPlus, UserCog,
  Package, PencilLine, Trash2, ArrowRightLeft, CreditCard,
  Users, Loader2, QrCode, Landmark,
  Clock, Mail, Plus, Ban, Send, History, ChevronDown, ChevronUp, AlertCircle, Settings,
  MonitorPlay,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  merchant_approved:        { label: "Merchant Approved",    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  merchant_rejected:        { label: "Merchant Rejected",    color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  merchant_suspended:       { label: "Merchant Suspended",   color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  merchant_reinstated:      { label: "Merchant Reinstated",  color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  plan_assigned:            { label: "Plan Assigned",         color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  plan_upgraded:            { label: "Plan Upgraded",         color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  plan_downgraded:          { label: "Plan Downgraded",       color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  plan_renewed:             { label: "Plan Renewed",          color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  plan_created:             { label: "Plan Created",          color: "bg-primary/10 text-primary border-primary/20" },
  plan_updated:             { label: "Plan Updated",          color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  plan_deleted:             { label: "Plan Deleted",          color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  user_created:             { label: "User Created",          color: "bg-primary/10 text-primary border-primary/20" },
  user_role_changed:        { label: "Role Changed",          color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  csv_export:               { label: "CSV Export",            color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  account_detail_created:   { label: "Account Detail Added",  color: "bg-primary/10 text-primary border-primary/20" },
  account_detail_updated:   { label: "Account Detail Updated",color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  account_detail_deleted:   { label: "Account Detail Deleted",color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  visibility_rule_updated:  { label: "Visibility Rule Set",   color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  bulk_approve:             { label: "Bulk Approve",          color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  bulk_suspend:             { label: "Bulk Suspend",          color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  bulk_reinstate:           { label: "Bulk Reinstate",        color: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
  bulk_assign_plan:         { label: "Bulk Plan Assign",      color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  qr_code_created:          { label: "QR Code Created",       color: "bg-primary/10 text-primary border-primary/20" },
  qr_code_updated:          { label: "QR Code Updated",       color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  qr_code_deleted:          { label: "QR Code Deleted",       color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  virtual_account_created:  { label: "VA Created",            color: "bg-primary/10 text-primary border-primary/20" },
  virtual_account_updated:  { label: "VA Updated",            color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  virtual_account_deleted:  { label: "VA Deleted",            color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  test_email_sent:          { label: "Test Email Sent",       color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  setting_updated:          { label: "Setting Updated",       color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
};

const ALL_ACTIONS = Object.keys(ACTION_LABELS);

const TARGET_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "merchant",           label: "Merchant" },
  { value: "plan",               label: "Plan" },
  { value: "user",               label: "User" },
  { value: "account_detail",     label: "Account Detail" },
  { value: "qr_code",            label: "QR Code" },
  { value: "virtual_account",    label: "Virtual Account" },
  { value: "transaction",        label: "Transaction" },
  { value: "provider",           label: "Provider" },
  { value: "merchant_features",  label: "Merchant Features" },
  { value: "settlements",        label: "Settlements" },
  { value: "reconciliation_item",label: "Reconciliation Item" },
  { value: "system_config",      label: "System Config" },
  { value: "audit_logs",         label: "Audit Logs" },
];

const FILTER_LABELS: Record<string, string> = {
  type: "Type",
  status: "Status",
  search: "Search",
  merchantId: "Merchant",
  targetType: "Target Type",
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

function AccountDetailCreatedDetails({ log }: { log: any }) {
  let parsed: { label?: string; type?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<CreditCard className="w-5 h-5 text-primary" />}
        title={parsed.label ? `New account detail: ${parsed.label}` : "Account detail created"}
        subtitle={parsed.type ? `Type: ${parsed.type.toUpperCase()}` : undefined}
        colorClass="bg-primary/10 border-primary/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.label && <DetailRow label="Label" value={parsed.label} />}
        {parsed.type && <DetailRow label="Type" value={<span className="uppercase">{parsed.type}</span>} />}
        <DetailRow label="Account detail ID" value={<span className="font-mono">#{log.targetId ?? "—"}</span>} />
      </div>
    </div>
  );
}

function AccountDetailUpdatedDetails({ log }: { log: any }) {
  let parsed: { label?: string; changes?: string[] } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<PencilLine className="w-5 h-5 text-amber-400" />}
        title={parsed.label ? `Updated: ${parsed.label}` : "Account detail updated"}
        subtitle={`Account detail #${log.targetId ?? "—"}`}
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

function AccountDetailDeletedDetails({ log }: { log: any }) {
  let parsed: { label?: string; type?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Trash2 className="w-5 h-5 text-rose-400" />}
        title={parsed.label ? `Deleted: ${parsed.label}` : "Account detail deleted"}
        subtitle={
          [
            parsed.type ? `Type: ${parsed.type.toUpperCase()}` : null,
            "Permanently removed",
          ].filter(Boolean).join(" · ") || undefined
        }
        colorClass="bg-rose-500/10 border-rose-500/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.label && <DetailRow label="Label" value={parsed.label} />}
        {parsed.type && <DetailRow label="Type" value={<span className="uppercase">{parsed.type}</span>} />}
        <DetailRow label="Account detail ID" value={<span className="font-mono">#{log.targetId ?? "—"}</span>} />
      </div>
    </div>
  );
}

function VisibilityRuleUpdatedDetails({ log }: { log: any }) {
  let parsed: {
    scope?: string;
    visible?: boolean;
    merchantIds?: number[];
    count?: number;
  } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const isAllMerchants = parsed.scope === "all_merchants";
  const isReset = parsed.scope === "reset_to_default";
  const affectedCount = parsed.count ?? parsed.merchantIds?.length;

  const scopeLabel = isAllMerchants
    ? "All merchants"
    : isReset
    ? `${affectedCount ?? "Selected"} merchant${affectedCount !== 1 ? "s" : ""} reset to default`
    : `${affectedCount ?? "Selected"} specific merchant${affectedCount !== 1 ? "s" : ""}`;

  const visibleLabel =
    isReset ? null :
    parsed.visible === true ? "Visible (on)" :
    parsed.visible === false ? "Hidden (off)" :
    null;

  const cardColor = parsed.visible === false
    ? "bg-rose-500/10 border-rose-500/20"
    : isReset
    ? "bg-muted/30 border-border/50"
    : "bg-purple-500/10 border-purple-500/20";

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Eye className="w-5 h-5 text-purple-400" />}
        title={`Visibility updated — ${scopeLabel}`}
        subtitle={visibleLabel ?? undefined}
        colorClass={cardColor}
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        <DetailRow label="Scope" value={scopeLabel} />
        {visibleLabel && <DetailRow label="Visibility" value={visibleLabel} />}
        <DetailRow label="Account detail ID" value={<span className="font-mono">#{log.targetId ?? "—"}</span>} />
        {!isAllMerchants && !isReset && affectedCount != null && (
          <DetailRow label="Merchants affected" value={affectedCount} />
        )}
      </div>
    </div>
  );
}

function BulkActionDetails({ log }: { log: any }) {
  let parsed: {
    merchantIds?: number[];
    count?: number;
    failed?: number;
    planId?: number;
    planName?: string;
    results?: { id: number; name: string; success: boolean; reason: string | null }[];
  } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const action = log.action as string;
  const succeeded = parsed.count ?? 0;
  const failed = parsed.failed ?? 0;
  const total = succeeded + failed;

  const isApprove = action === "bulk_approve";
  const isSuspend = action === "bulk_suspend";
  const isReinstate = action === "bulk_reinstate";
  const isPlanAssign = action === "bulk_assign_plan";

  const iconColor = isSuspend ? "text-rose-400" : isReinstate ? "text-teal-400" : isApprove ? "text-emerald-400" : "text-blue-400";
  const cardColor = isSuspend
    ? "bg-rose-500/10 border-rose-500/20"
    : isReinstate
    ? "bg-teal-500/10 border-teal-500/20"
    : isApprove
    ? "bg-emerald-500/10 border-emerald-500/20"
    : "bg-blue-500/10 border-blue-500/20";

  const verb = isApprove ? "approved" : isSuspend ? "suspended" : isReinstate ? "reinstated" : "assigned";
  const summaryParts: string[] = [];
  if (succeeded > 0) summaryParts.push(`${succeeded} ${verb}`);
  if (failed > 0) summaryParts.push(`${failed} failed`);
  const title = summaryParts.length > 0 ? summaryParts.join(", ") : `${total} merchant${total !== 1 ? "s" : ""}`;

  const subtitle = isPlanAssign && parsed.planName ? `Plan: ${parsed.planName}` : undefined;

  const results = parsed.results ?? [];
  const hasResults = results.length > 0;

  const fallbackIds = !hasResults && parsed.merchantIds && parsed.merchantIds.length > 0
    ? parsed.merchantIds
    : null;

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Users className={`w-5 h-5 ${iconColor}`} />}
        title={title.charAt(0).toUpperCase() + title.slice(1)}
        subtitle={subtitle}
        colorClass={cardColor}
      />

      {isPlanAssign && parsed.planName && (
        <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
          <DetailRow label="Plan" value={parsed.planName} />
          {parsed.planId != null && (
            <DetailRow label="Plan ID" value={<span className="font-mono">#{parsed.planId}</span>} />
          )}
        </div>
      )}

      {hasResults && (
        <div className="rounded-lg bg-muted/20 p-3 space-y-1">
          <p className="text-xs text-muted-foreground mb-2">
            {succeeded > 0 && failed > 0
              ? `${succeeded} succeeded · ${failed} failed`
              : succeeded > 0
              ? `All ${succeeded} succeeded`
              : `All ${failed} failed`}
          </p>
          {results.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/30 last:border-0">
              <div className="flex items-center gap-1.5 min-w-0">
                {r.success
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                }
                <span className="text-xs truncate">{r.name}</span>
                <span className="text-xs text-muted-foreground font-mono shrink-0">#{r.id}</span>
              </div>
              {!r.success && r.reason && (
                <span className="text-xs text-rose-400 shrink-0">{r.reason}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {!hasResults && fallbackIds && (
        <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
          <DetailRow label="Merchants affected" value={total || fallbackIds.length} />
          {failed > 0 && <DetailRow label="Failed" value={<span className="text-rose-400">{failed}</span>} />}
          <div>
            <span className="text-xs text-muted-foreground">Merchant IDs: </span>
            <span className="text-xs font-mono">{fallbackIds.map(id => `#${id}`).join(", ")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function QrCodeCreatedDetails({ log }: { log: any }) {
  let parsed: { label?: string | null; type?: string; merchantId?: number } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<QrCode className="w-5 h-5 text-primary" />}
        title={parsed.label ? `New QR code: ${parsed.label}` : "New QR code created"}
        subtitle={parsed.type ? `Type: ${parsed.type.charAt(0).toUpperCase() + parsed.type.slice(1)}` : undefined}
        colorClass="bg-primary/10 border-primary/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.label && <DetailRow label="Label" value={parsed.label} />}
        {parsed.type && <DetailRow label="Type" value={<span className="capitalize">{parsed.type}</span>} />}
        <DetailRow label="QR code ID" value={<span className="font-mono">#{log.targetId ?? "—"}</span>} />
        {parsed.merchantId != null && <DetailRow label="Merchant ID" value={<span className="font-mono">#{parsed.merchantId}</span>} />}
      </div>
    </div>
  );
}

function QrCodeUpdatedDetails({ log }: { log: any }) {
  let parsed: { label?: string | null; changes?: string[] } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<PencilLine className="w-5 h-5 text-amber-400" />}
        title={parsed.label ? `Updated QR code: ${parsed.label}` : "QR code updated"}
        subtitle={`QR code #${log.targetId ?? "—"}`}
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

function QrCodeDeletedDetails({ log }: { log: any }) {
  let parsed: { label?: string | null; type?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Trash2 className="w-5 h-5 text-rose-400" />}
        title={parsed.label ? `Deleted QR code: ${parsed.label}` : "QR code deleted"}
        subtitle={`QR code #${log.targetId ?? "—"} has been permanently removed`}
        colorClass="bg-rose-500/10 border-rose-500/20"
      />
      {(parsed.label || parsed.type) && (
        <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
          {parsed.label && <DetailRow label="Label" value={parsed.label} />}
          {parsed.type && <DetailRow label="Type" value={<span className="capitalize">{parsed.type}</span>} />}
          <DetailRow label="QR code ID" value={<span className="font-mono">#{log.targetId ?? "—"}</span>} />
        </div>
      )}
    </div>
  );
}

function VirtualAccountCreatedDetails({ log }: { log: any }) {
  let parsed: { label?: string | null; accountHolder?: string; accountNumber?: string; bankName?: string; merchantId?: number } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Landmark className="w-5 h-5 text-primary" />}
        title={parsed.label ? `New virtual account: ${parsed.label}` : parsed.accountHolder ? `New virtual account for ${parsed.accountHolder}` : "Virtual account created"}
        subtitle={parsed.bankName ?? undefined}
        colorClass="bg-primary/10 border-primary/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.label && <DetailRow label="Label" value={parsed.label} />}
        {parsed.accountHolder && <DetailRow label="Account holder" value={parsed.accountHolder} />}
        {parsed.accountNumber && <DetailRow label="Account number" value={<span className="font-mono">{parsed.accountNumber}</span>} />}
        {parsed.bankName && <DetailRow label="Bank" value={parsed.bankName} />}
        <DetailRow label="Virtual account ID" value={<span className="font-mono">#{log.targetId ?? "—"}</span>} />
        {parsed.merchantId != null && <DetailRow label="Merchant ID" value={<span className="font-mono">#{parsed.merchantId}</span>} />}
      </div>
    </div>
  );
}

function VirtualAccountUpdatedDetails({ log }: { log: any }) {
  let parsed: { label?: string | null; changes?: string[] } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<PencilLine className="w-5 h-5 text-amber-400" />}
        title={parsed.label ? `Updated virtual account: ${parsed.label}` : "Virtual account updated"}
        subtitle={`Virtual account #${log.targetId ?? "—"}`}
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

function VirtualAccountDeletedDetails({ log }: { log: any }) {
  let parsed: { label?: string | null; accountHolder?: string; accountNumber?: string; bankName?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Trash2 className="w-5 h-5 text-rose-400" />}
        title={parsed.label ? `Deleted virtual account: ${parsed.label}` : parsed.accountHolder ? `Deleted account for ${parsed.accountHolder}` : "Virtual account deleted"}
        subtitle={`Virtual account #${log.targetId ?? "—"} has been permanently removed`}
        colorClass="bg-rose-500/10 border-rose-500/20"
      />
      {(parsed.accountHolder || parsed.accountNumber || parsed.bankName) && (
        <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
          {parsed.label && <DetailRow label="Label" value={parsed.label} />}
          {parsed.accountHolder && <DetailRow label="Account holder" value={parsed.accountHolder} />}
          {parsed.accountNumber && <DetailRow label="Account number" value={<span className="font-mono">{parsed.accountNumber}</span>} />}
          {parsed.bankName && <DetailRow label="Bank" value={parsed.bankName} />}
          <DetailRow label="Virtual account ID" value={<span className="font-mono">#{log.targetId ?? "—"}</span>} />
        </div>
      )}
    </div>
  );
}

function TestEmailSentDetails({ log }: { log: any }) {
  let parsed: { recipients?: string[]; success?: boolean; error?: string } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const success = parsed.success !== false;
  const recipients = parsed.recipients ?? [];
  const recipientLabel = recipients.length > 0 ? recipients.join(", ") : undefined;

  const errorMessages: Record<string, string> = {
    no_recipient: "No recipient configured",
    invalid_email: "Invalid email address",
    smtp_send_failed: "SMTP not configured or send failed",
  };

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={
          success
            ? <Mail className="w-5 h-5 text-violet-400" />
            : <XCircle className="w-5 h-5 text-rose-400" />
        }
        title={success ? "Test email delivered successfully" : "Test email failed to send"}
        subtitle={recipientLabel}
        colorClass={success ? "bg-violet-500/10 border-violet-500/20" : "bg-rose-500/10 border-rose-500/20"}
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {recipients.length > 0 && (
          <DetailRow
            label={recipients.length === 1 ? "Recipient" : "Recipients"}
            value={recipientLabel!}
          />
        )}
        {recipients.length === 0 && (
          <DetailRow label="Recipients" value={<span className="text-muted-foreground">None configured</span>} />
        )}
        <DetailRow label="Outcome" value={
          success
            ? <span className="text-emerald-400">Sent</span>
            : <span className="text-rose-400">Failed</span>
        } />
        {!success && parsed.error && (
          <DetailRow
            label="Reason"
            value={<span className="text-rose-400">{errorMessages[parsed.error] ?? parsed.error}</span>}
          />
        )}
      </div>
    </div>
  );
}

function SettingUpdatedDetails({ log }: { log: any }) {
  let parsed: { key?: string; oldValue?: string | null; newValue?: string | null } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const keyLabels: Record<string, string> = {
    finance_report_email: "Finance Report Email",
    reconciliation_schedule: "Reconciliation Schedule",
  };

  const keyLabel = parsed.key ? (keyLabels[parsed.key] ?? parsed.key) : "System setting";
  const wasCleared = parsed.newValue === null || parsed.newValue === "";
  const wasSet = parsed.oldValue === null || parsed.oldValue === "";

  const subtitle = wasCleared
    ? "Recipient list cleared"
    : wasSet
    ? "Value configured for the first time"
    : "Value changed";

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Settings className="w-5 h-5 text-amber-400" />}
        title={`Updated: ${keyLabel}`}
        subtitle={subtitle}
        colorClass="bg-amber-500/10 border-amber-500/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        <DetailRow label="Setting" value={keyLabel} />
        <DetailRow
          label="Previous value"
          value={
            parsed.oldValue != null && parsed.oldValue !== ""
              ? <span className="font-mono break-all">{parsed.oldValue}</span>
              : <span className="text-muted-foreground italic">Not set</span>
          }
        />
        <DetailRow
          label="New value"
          value={
            parsed.newValue != null && parsed.newValue !== ""
              ? <span className="font-mono break-all">{parsed.newValue}</span>
              : <span className="text-muted-foreground italic">Cleared</span>
          }
        />
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
    case "account_detail_created":
      return <AccountDetailCreatedDetails log={log} />;
    case "account_detail_updated":
      return <AccountDetailUpdatedDetails log={log} />;
    case "account_detail_deleted":
      return <AccountDetailDeletedDetails log={log} />;
    case "visibility_rule_updated":
      return <VisibilityRuleUpdatedDetails log={log} />;
    case "bulk_approve":
    case "bulk_suspend":
    case "bulk_reinstate":
    case "bulk_assign_plan":
      return <BulkActionDetails log={log} />;
    case "qr_code_created":
      return <QrCodeCreatedDetails log={log} />;
    case "qr_code_updated":
      return <QrCodeUpdatedDetails log={log} />;
    case "qr_code_deleted":
      return <QrCodeDeletedDetails log={log} />;
    case "virtual_account_created":
      return <VirtualAccountCreatedDetails log={log} />;
    case "virtual_account_updated":
      return <VirtualAccountUpdatedDetails log={log} />;
    case "virtual_account_deleted":
      return <VirtualAccountDeletedDetails log={log} />;
    case "test_email_sent":
      return <TestEmailSentDetails log={log} />;
    case "setting_updated":
      return <SettingUpdatedDetails log={log} />;
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

const FREQUENCY_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

function ScheduleHistoryPanel({ scheduleId }: { scheduleId: number }) {
  const { data, isLoading } = useListAuditReportScheduleLogs(scheduleId, { limit: 20 });
  const logs = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-1.5 px-2 py-2">
        {[1, 2, 3].map(i => <div key={i} className="h-8 bg-muted/20 rounded animate-pulse" />)}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-muted-foreground">
        <History className="w-4 h-4 opacity-40" />
        <span className="text-xs">No sends recorded yet — history will appear here after the first delivery.</span>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/30">
      {logs.map((log: any) => (
        <div key={log.id} className="flex items-start gap-3 px-4 py-2.5">
          <div className="mt-0.5 shrink-0">
            {log.success
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              : <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium">
                {format(new Date(log.sentAt), "MMM d, yyyy 'at' HH:mm")}
              </span>
              {log.success
                ? (
                  <span className="inline-flex items-center rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                    Delivered
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
                    Failed
                  </span>
                )
              }
              <span className="text-xs text-muted-foreground">
                {log.rowCount.toLocaleString()} row{log.rowCount !== 1 ? "s" : ""}
              </span>
            </div>
            {!log.success && log.errorMessage && (
              <p className="text-xs text-rose-400/80 mt-0.5 truncate" title={log.errorMessage}>
                {log.errorMessage}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScheduleRow({
  s,
  onToggle,
  onDelete,
  onSendNow,
  sendingId,
}: {
  s: any;
  onToggle: (id: number, isActive: boolean) => void;
  onDelete: (id: number) => void;
  onSendNow?: (id: number) => void;
  sendingId?: number | null;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className={`rounded-lg border transition-colors ${
      s.isActive
        ? "border-violet-500/20 bg-violet-500/5"
        : "border-border/40 bg-muted/10 opacity-70"
    }`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-violet-500/10 border border-violet-500/20 shrink-0">
          <Mail className="w-4 h-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{s.recipientEmail}</span>
            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
              s.isActive
                ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                : "bg-muted/30 text-muted-foreground border-border/50"
            }`}>
              {FREQUENCY_LABELS[s.frequency] ?? s.frequency}
            </span>
            {!s.isActive && (
              <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400">
                <Ban className="w-2.5 h-2.5" />
                Paused
              </span>
            )}
            {s.lastSendStatus === "failed" && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400 cursor-default">
                      <AlertCircle className="w-2.5 h-2.5" />
                      Delivery failed
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    {s.lastErrorMessage ?? "Last delivery attempt failed"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {s.lastSentAt
              ? `Last sent: ${format(new Date(s.lastSentAt), "MMM d, yyyy 'at' HH:mm")}`
              : "Not yet sent"}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHistoryOpen(v => !v)}
            className={`text-xs h-7 px-2 gap-1 ${
              historyOpen ? "text-violet-400" : "text-muted-foreground hover:text-violet-400"
            }`}
            title="View send history"
          >
            <History className="w-3 h-3" />
            {historyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
          {onSendNow && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSendNow(s.id)}
                    disabled={sendingId === s.id}
                    className="text-xs h-7 px-2 text-muted-foreground hover:text-violet-400"
                    title="Send now"
                  >
                    {sendingId === s.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Send className="w-3 h-3" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Send now</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onToggle(s.id, s.isActive)}
            className={`text-xs h-7 px-2 ${
              s.isActive
                ? "text-muted-foreground hover:text-amber-400"
                : "text-muted-foreground hover:text-emerald-400"
            }`}
            title={s.isActive ? "Pause schedule" : "Resume schedule"}
          >
            {s.isActive ? <Ban className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(s.id)}
            className="text-xs h-7 px-2 text-muted-foreground hover:text-rose-400"
            title="Delete schedule"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
      {historyOpen && (
        <div className="border-t border-border/30">
          <div className="px-2 py-1.5 bg-muted/10">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2">
              Send History (last 20)
            </span>
          </div>
          <ScheduleHistoryPanel scheduleId={s.id} />
        </div>
      )}
    </div>
  );
}

function ScheduledReportsPanel() {
  const queryClient = useQueryClient();
  const { data: schedulesData, isLoading } = useListAuditReportSchedules();
  const createSchedule = useCreateAuditReportSchedule();
  const updateSchedule = useUpdateAuditReportSchedule();
  const deleteSchedule = useDeleteAuditReportSchedule();
  const sendNow = useSendAuditReportNow();

  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newFrequency, setNewFrequency] = useState("weekly");
  const [adding, setAdding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const schedules = schedulesData?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListAuditReportSchedulesQueryKey() });

  async function handleAdd() {
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      await createSchedule.mutateAsync({ data: { frequency: newFrequency as "daily" | "weekly" | "monthly", recipientEmail: newEmail.trim() } });
      invalidate();
      setShowAdd(false);
      setNewEmail("");
      setNewFrequency("weekly");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggleActive(id: number, isActive: boolean) {
    await updateSchedule.mutateAsync({ id, data: { isActive: !isActive } });
    invalidate();
  }

  async function handleDelete(id: number) {
    setDeleting(true);
    try {
      await deleteSchedule.mutateAsync({ id });
      invalidate();
      setConfirmDeleteId(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSendNow(id: number) {
    setSendingId(id);
    try {
      await sendNow.mutateAsync({ id });
      invalidate();
      toast.success("Report sent successfully");
    } catch {
      toast.error("Failed to send report. Check mailer configuration.");
    } finally {
      setSendingId(null);
    }
  }

  async function handlePreview() {
    setLoadingPreview(true);
    try {
      const result = await previewAuditReportEmail({ frequency: newFrequency as "daily" | "weekly" | "monthly" });
      setPreviewHtml(result.html);
    } catch {
      toast.error("Failed to load preview");
    } finally {
      setLoadingPreview(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-violet-400" />
            <CardTitle className="text-base font-semibold">Scheduled Email Reports</CardTitle>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAdd(true)}
            className="border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300 hover:border-violet-500/50"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Schedule
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Automatically email audit log CSV reports on a recurring schedule. Click the history icon on any schedule to see past deliveries and failures.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-14 bg-muted/30 rounded-lg animate-pulse" />)}
          </div>
        ) : schedules.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Mail className="w-7 h-7 opacity-30" />
            <p className="text-sm">No scheduled reports configured</p>
            <p className="text-xs opacity-60">Add a schedule to receive automatic audit log emails</p>
          </div>
        ) : (
          <div className="space-y-2">
            {schedules.map((s: any) => (
              <ScheduleRow
                key={s.id}
                s={s}
                onToggle={handleToggleActive}
                onDelete={(id) => setConfirmDeleteId(id)}
                onSendNow={handleSendNow}
                sendingId={sendingId}
              />
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={showAdd} onOpenChange={open => { if (!open) { setShowAdd(false); setNewEmail(""); setNewFrequency("weekly"); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Scheduled Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Recipient Email</Label>
              <Input
                type="email"
                placeholder="compliance@example.com"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              />
            </div>
            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select value={newFrequency} onValueChange={setNewFrequency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              The CSV attachment will contain all audit log entries from the previous {newFrequency === "daily" ? "24 hours" : newFrequency === "weekly" ? "7 days" : "30 days"}.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={loadingPreview}
              className="w-full border-violet-500/30 text-violet-400 hover:bg-violet-500/10 hover:text-violet-300 hover:border-violet-500/50"
            >
              {loadingPreview
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <MonitorPlay className="w-3.5 h-3.5 mr-1.5" />
              }
              {loadingPreview ? "Loading preview…" : "Preview email"}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAdd(false)} disabled={adding}>Cancel</Button>
            <Button
              onClick={handleAdd}
              disabled={adding || !newEmail.trim()}
              className="bg-violet-600 hover:bg-violet-500 text-white"
            >
              {adding ? "Adding…" : "Add Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewHtml !== null} onOpenChange={open => { if (!open) setPreviewHtml(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MonitorPlay className="w-4 h-4 text-violet-400" />
              Email Preview — <span className="capitalize text-violet-400">{newFrequency}</span> Report
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">
            This is a read-only preview. No email has been sent. The event count shown is a placeholder.
          </p>
          <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-border/50 mt-2">
            {previewHtml && (
              <iframe
                srcDoc={previewHtml}
                title="Email preview"
                className="w-full h-full min-h-[460px]"
                sandbox="allow-same-origin"
              />
            )}
          </div>
          <DialogFooter className="mt-2">
            <Button variant="ghost" onClick={() => setPreviewHtml(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteId !== null} onOpenChange={open => { if (!open) setConfirmDeleteId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel Schedule</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove the scheduled report. No more emails will be sent to this address.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDeleteId(null)} disabled={deleting}>Keep</Button>
            <Button
              variant="destructive"
              onClick={() => confirmDeleteId !== null && handleDelete(confirmDeleteId)}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Cancel Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function AdminAuditLogs() {
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [targetType, setTargetType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [merchantIdInput, setMerchantIdInput] = useState("");
  const [merchantId, setMerchantId] = useState<number | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastExportCount, setLastExportCount] = useState<number | null>(null);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (action && action !== "all") params.set("action", action);
      if (targetType && targetType !== "all") params.set("targetType", targetType);
      if (search) params.set("search", search);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (merchantId != null) params.set("merchantId", String(merchantId));

      const token = localStorage.getItem("rasokart_token");
      const res = await fetch(`/api/audit-logs/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) throw new Error("Export failed");

      const text = await res.text();
      const lines = text.split("\n").filter(l => l.trim() !== "");
      const rowCount = Math.max(0, lines.length - 1);
      setLastExportCount(rowCount);

      const blob = new Blob([text], { type: "text/csv" });
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
  const hasTargetType = targetType !== "all";
  const hasMerchantId = merchantId != null;

  function resetFilters() {
    setSearch("");
    setAction("all");
    setTargetType("all");
    setDateFrom("");
    setDateTo("");
    setMerchantIdInput("");
    setMerchantId(undefined);
    setPage(1);
  }

  function applyMerchantIdFilter(val: string) {
    const trimmed = val.trim();
    const num = parseInt(trimmed);
    setMerchantId(trimmed !== "" && !isNaN(num) ? num : undefined);
    setPage(1);
  }

  const { data, isLoading } = useListAdminAuditLogs({
    action: action === "all" ? undefined : action,
    targetType: targetType === "all" ? undefined : targetType,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    merchantId,
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

      <ScheduledReportsPanel />

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
              <Select value={targetType} onValueChange={v => { setTargetType(v); setPage(1); }}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Target type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Target Types</SelectItem>
                  {TARGET_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
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
              <div className="relative w-36 shrink-0">
                <Landmark className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-8 pr-7 text-sm h-9"
                  placeholder="Merchant ID"
                  value={merchantIdInput}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  onChange={e => {
                    const v = e.target.value.replace(/\D/g, "");
                    setMerchantIdInput(v);
                    applyMerchantIdFilter(v);
                  }}
                  aria-label="Filter by merchant ID"
                />
                {merchantIdInput && (
                  <button
                    onClick={() => { setMerchantIdInput(""); setMerchantId(undefined); setPage(1); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear merchant ID filter"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(hasDateFilter || search !== "" || action !== "all" || hasTargetType || hasMerchantId) && (
                  <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3.5 h-3.5 mr-1.5" />
                    Clear filters
                  </Button>
                )}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExportCsv}
                        disabled={exporting}
                        className="border-sky-500/30 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300 hover:border-sky-500/50"
                      >
                        {exporting
                          ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                          : <FileDown className="w-3.5 h-3.5 mr-1.5" />
                        }
                        {exporting ? "Exporting…" : "Export CSV"}
                      </Button>
                    </TooltipTrigger>
                    {lastExportCount != null && !exporting && (
                      <TooltipContent side="bottom">
                        Last export: {lastExportCount.toLocaleString()} row{lastExportCount !== 1 ? "s" : ""}
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </CardHeader>

        {(hasTargetType || hasDateFilter || hasMerchantId) && (
          <div className="flex items-center gap-2 px-6 py-2 border-t border-border/40 bg-muted/10 flex-wrap">
            {hasMerchantId && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-0.5 text-xs font-medium text-orange-400">
                <Landmark className="w-3 h-3" />
                Merchant #{merchantId}
                <button
                  onClick={() => { setMerchantIdInput(""); setMerchantId(undefined); setPage(1); }}
                  className="ml-0.5 hover:text-orange-300 transition-colors"
                  aria-label="Clear merchant ID filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {hasTargetType && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-0.5 text-xs font-medium text-violet-400">
                Target: {TARGET_TYPE_OPTIONS.find(o => o.value === targetType)?.label ?? targetType}
                <button
                  onClick={() => { setTargetType("all"); setPage(1); }}
                  className="ml-0.5 hover:text-violet-300 transition-colors"
                  aria-label="Clear target type filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {hasDateFilter && <span className="text-xs text-muted-foreground shrink-0">Date:</span>}
            {dateFrom && dateTo ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-0.5 text-xs font-medium text-primary">
                <CalendarIcon className="w-3 h-3" />
                {formatDateLabel(dateFrom)} → {formatDateLabel(dateTo)}
                <button
                  onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
                  className="ml-0.5 hover:text-primary/70 transition-colors"
                  aria-label="Clear date range"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ) : (
              <>
                {dateFrom && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-0.5 text-xs font-medium text-primary">
                    <CalendarIcon className="w-3 h-3" />
                    From: {formatDateLabel(dateFrom)}
                    <button
                      onClick={() => { setDateFrom(""); setPage(1); }}
                      className="ml-0.5 hover:text-primary/70 transition-colors"
                      aria-label="Clear from date"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {dateTo && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-0.5 text-xs font-medium text-primary">
                    <CalendarIcon className="w-3 h-3" />
                    To: {formatDateLabel(dateTo)}
                    <button
                      onClick={() => { setDateTo(""); setPage(1); }}
                      className="ml-0.5 hover:text-primary/70 transition-colors"
                      aria-label="Clear to date"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </>
            )}
          </div>
        )}

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
              ) : logs.map((log: any) => {
                const isBulkAction = (log.action as string).startsWith("bulk_");
                const isDirectMerchantMatch = hasMerchantId && log.targetId === merchantId;
                const isBulkMerchantMatch = hasMerchantId && isBulkAction && !isDirectMerchantMatch;
                return (
                <TableRow
                  key={log.id}
                  className={isDirectMerchantMatch ? "bg-orange-500/5 hover:bg-orange-500/10" : undefined}
                >
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{log.adminEmail}</p>
                      <p className="text-xs text-muted-foreground">ID #{log.adminId}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <ActionBadge action={log.action} />
                      {isBulkAction && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-400 uppercase tracking-wide">
                          <Users className="w-2.5 h-2.5" />
                          Bulk
                        </span>
                      )}
                      {isBulkMerchantMatch && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-orange-400 uppercase tracking-wide">
                          <Landmark className="w-2.5 h-2.5" />
                          Includes #{merchantId}
                        </span>
                      )}
                    </div>
                  </TableCell>
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
                );
              })}
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
