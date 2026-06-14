import { useState, useEffect, useMemo, useRef } from "react";
import { useSearch, Link } from "wouter";
import {
  useListAdminAuditLogs, useGetAdminAuditLogStats,
  useListAuditReportSchedules, useCreateAuditReportSchedule,
  useUpdateAuditReportSchedule, useDeleteAuditReportSchedule,
  useSendAuditReportNow,
  getListAuditReportSchedulesQueryKey,
  getListAdminAuditLogsQueryKey,
  useListAuditReportScheduleLogs,
  useListAllAuditReportScheduleLogs,
  previewAuditReportEmail,
  useListCredentialEvents,
  useGetAuditReportRetentionConfig,
  useGetSecurityComplianceSummary,
  useSendSecurityReviewReminder,
  useCreateAdminAuditLog,
  useReenableAdminMerchantReportSchedule,
  useDeleteAdminMerchantReportSchedule,
  useSendAdminMerchantReportNow,
  useGetAdminReportDeliveryHistory,
  GetAdminReportDeliveryHistorySuccess,
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
  Shield, Search, Eye, Activity, FileDown, CalendarIcon, X, XCircle,
  CheckCircle2, UserPlus, UserCog,
  Package, PencilLine, Trash2, ArrowRightLeft, CreditCard,
  Users, Loader2, QrCode, Landmark,
  Clock, Mail, Plus, Ban, Send, History, ChevronDown, ChevronUp, AlertCircle, Settings,
  MonitorPlay, RefreshCw, KeyRound, RotateCcw, ClipboardCheck, AlertTriangle, Building2, BellRing,
  ArrowUpRight, AtSign, Network, CalendarDays, Bot, ExternalLink,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format, parseISO, formatDistanceToNow, subDays, eachDayOfInterval } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from "recharts";
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
  test_email_sent:              { label: "Test Email Sent",              color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  setting_updated:              { label: "Setting Updated",              color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  system_config_updated:        { label: "System Config Updated",        color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  security_activity_exported:        { label: "Security Activity Exported",        color: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
  compliance_report_exported:        { label: "Compliance Report Exported",        color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
  security_review_reminded:              { label: "Security Review Reminder Sent",       color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  audit_schedule_failure_acknowledged:   { label: "Failure Acknowledged",               color: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
  report_schedule_created:               { label: "Report Schedule Created",              color: "bg-primary/10 text-primary border-primary/20" },
  report_schedule_updated:               { label: "Report Schedule Updated",              color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  report_schedule_reenabled:             { label: "Report Schedule Re-enabled",           color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  report_schedule_failures_reset:        { label: "Report Schedule Failures Reset",        color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  report_schedule_override_set:          { label: "Report Schedule Next-Run Overridden",  color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  report_schedule_override_cleared:      { label: "Report Schedule Override Cleared",     color: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
  report_schedule_deleted:               { label: "Report Schedule Deleted",              color: "bg-red-500/10 text-red-400 border-red-500/20" },
  report_schedule_auto_paused:           { label: "Report Schedule Auto-Paused",          color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  scheduled_report_failure:              { label: "Scheduled Report Failure",              color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  notification_preferences_updated:      { label: "Notification Preferences Updated",      color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
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
  { value: "report_schedule",    label: "Report Schedule" },
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

function ReportScheduleCreatedDetails({ log }: { log: any }) {
  let parsed: {
    merchantId?: number | null;
    businessName?: string | null;
    frequency?: string | null;
    format?: string | null;
    nextRunAt?: string | null;
  } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const FREQUENCY_LABELS_LOCAL: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  };
  const FORMAT_LABELS: Record<string, string> = {
    xlsx: "XLSX",
    csv: "CSV",
    pdf: "PDF",
    json: "JSON",
  };

  const freqLabel = parsed.frequency ? (FREQUENCY_LABELS_LOCAL[parsed.frequency] ?? parsed.frequency) : null;
  const fmtLabel = parsed.format ? (FORMAT_LABELS[parsed.format] ?? parsed.format.toUpperCase()) : null;

  let nextRunFormatted: string | null = null;
  if (parsed.nextRunAt) {
    try { nextRunFormatted = format(parseISO(parsed.nextRunAt), "MMM d, yyyy 'at' HH:mm"); } catch { nextRunFormatted = parsed.nextRunAt; }
  }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<CalendarIcon className="w-5 h-5 text-primary" />}
        title="Report schedule created"
        subtitle={parsed.businessName ? `Merchant: ${parsed.businessName}` : undefined}
        colorClass="bg-primary/10 border-primary/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.businessName && <DetailRow label="Merchant" value={parsed.businessName} />}
        {parsed.merchantId != null && (
          <DetailRow label="Merchant ID" value={<span className="font-mono">#{parsed.merchantId}</span>} />
        )}
        {freqLabel && <DetailRow label="Frequency" value={freqLabel} />}
        {fmtLabel && <DetailRow label="Report format" value={fmtLabel} />}
        {nextRunFormatted && <DetailRow label="First run" value={<span className="font-mono">{nextRunFormatted}</span>} />}
      </div>
    </div>
  );
}

function ReportScheduleUpdatedDetails({ log }: { log: any }) {
  let parsed: {
    merchantId?: number | null;
    businessName?: string | null;
    frequency?: string | null;
    format?: string | null;
    nextRunAt?: string | null;
  } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const FREQUENCY_LABELS_LOCAL: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  };
  const FORMAT_LABELS: Record<string, string> = {
    xlsx: "XLSX",
    csv: "CSV",
    pdf: "PDF",
    json: "JSON",
  };

  const freqLabel = parsed.frequency ? (FREQUENCY_LABELS_LOCAL[parsed.frequency] ?? parsed.frequency) : null;
  const fmtLabel = parsed.format ? (FORMAT_LABELS[parsed.format] ?? parsed.format.toUpperCase()) : null;

  let nextRunFormatted: string | null = null;
  if (parsed.nextRunAt) {
    try { nextRunFormatted = format(parseISO(parsed.nextRunAt), "MMM d, yyyy 'at' HH:mm"); } catch { nextRunFormatted = parsed.nextRunAt; }
  }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<PencilLine className="w-5 h-5 text-amber-400" />}
        title="Report schedule updated"
        subtitle={parsed.businessName ? `Merchant: ${parsed.businessName}` : undefined}
        colorClass="bg-amber-500/10 border-amber-500/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.businessName && <DetailRow label="Merchant" value={parsed.businessName} />}
        {parsed.merchantId != null && (
          <DetailRow label="Merchant ID" value={<span className="font-mono">#{parsed.merchantId}</span>} />
        )}
        {freqLabel && <DetailRow label="Frequency" value={freqLabel} />}
        {fmtLabel && <DetailRow label="Report format" value={fmtLabel} />}
        {nextRunFormatted && <DetailRow label="Next run" value={<span className="font-mono">{nextRunFormatted}</span>} />}
      </div>
    </div>
  );
}

function ReportScheduleReenabledDetails({ log }: { log: any }) {
  let parsed: {
    merchantId?: number | null;
    businessName?: string | null;
    frequency?: string | null;
    format?: string | null;
    nextRunAt?: string | null;
  } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const FREQUENCY_LABELS_LOCAL: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  };
  const FORMAT_LABELS: Record<string, string> = {
    xlsx: "XLSX",
    csv: "CSV",
    pdf: "PDF",
    json: "JSON",
  };

  const freqLabel = parsed.frequency ? (FREQUENCY_LABELS_LOCAL[parsed.frequency] ?? parsed.frequency) : null;
  const fmtLabel = parsed.format ? (FORMAT_LABELS[parsed.format] ?? parsed.format.toUpperCase()) : null;

  let nextRunFormatted: string | null = null;
  if (parsed.nextRunAt) {
    try { nextRunFormatted = format(parseISO(parsed.nextRunAt), "MMM d, yyyy 'at' HH:mm"); } catch { nextRunFormatted = parsed.nextRunAt; }
  }

  const [reenabled, setReenabled] = useState(false);
  const queryClient = useQueryClient();
  const reenable = useReenableAdminMerchantReportSchedule();

  function handleReenable() {
    if (parsed.merchantId == null) return;
    reenable.mutate({ merchantId: parsed.merchantId }, {
      onSuccess: () => {
        setReenabled(true);
        queryClient.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey() });
        toast.success("Report schedule re-enabled successfully.");
      },
      onError: () => {
        toast.error("Failed to re-enable the report schedule. Please try again.");
      },
    });
  }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<RefreshCw className="w-5 h-5 text-emerald-400" />}
        title="Report schedule re-enabled"
        subtitle={parsed.businessName ? `Merchant: ${parsed.businessName}` : undefined}
        colorClass="bg-emerald-500/10 border-emerald-500/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.businessName && <DetailRow label="Merchant" value={parsed.businessName} />}
        {parsed.merchantId != null && (
          <DetailRow label="Merchant ID" value={<span className="font-mono">#{parsed.merchantId}</span>} />
        )}
        {freqLabel && <DetailRow label="Frequency" value={freqLabel} />}
        {fmtLabel && <DetailRow label="Report format" value={fmtLabel} />}
        {nextRunFormatted && <DetailRow label="Next run" value={<span className="font-mono">{nextRunFormatted}</span>} />}
      </div>
      {parsed.merchantId != null && (
        reenabled ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-300">Schedule re-enabled. The audit log has been refreshed.</p>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
            onClick={handleReenable}
            disabled={reenable.isPending}
          >
            {reenable.isPending ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Re-enabling…</>
            ) : (
              <><RotateCcw className="w-3.5 h-3.5 mr-1.5" />Re-enable Schedule</>
            )}
          </Button>
        )
      )}
    </div>
  );
}

function ScheduledReportFailureDetails({ log }: { log: any }) {
  let parsed: {
    merchantId?: number | null;
    businessName?: string | null;
    consecutiveFailures?: number | null;
    autoPauseAfterFailures?: number | null;
    frequency?: string | null;
    format?: string | null;
    errorMessage?: string | null;
  } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const FREQUENCY_LABELS_LOCAL: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  };
  const FORMAT_LABELS: Record<string, string> = {
    xlsx: "XLSX",
    csv: "CSV",
    pdf: "PDF",
    json: "JSON",
  };

  const freqLabel = parsed.frequency ? (FREQUENCY_LABELS_LOCAL[parsed.frequency] ?? parsed.frequency) : null;
  const fmtLabel = parsed.format ? (FORMAT_LABELS[parsed.format] ?? parsed.format.toUpperCase()) : null;
  const failureCount = parsed.consecutiveFailures ?? null;
  const threshold = parsed.autoPauseAfterFailures ?? null;

  const [reenabled, setReenabled] = useState(false);
  const [confirmReenable, setConfirmReenable] = useState(false);
  const queryClient = useQueryClient();
  const reenable = useReenableAdminMerchantReportSchedule();

  function handleReenable() {
    if (parsed.merchantId == null) return;
    reenable.mutate({ merchantId: parsed.merchantId }, {
      onSuccess: () => {
        setReenabled(true);
        setConfirmReenable(false);
        queryClient.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey() });
        toast.success("Report schedule re-enabled successfully.");
      },
      onError: () => {
        toast.error("Failed to re-enable the report schedule. Please try again.");
      },
    });
  }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<AlertTriangle className="w-5 h-5 text-rose-400" />}
        title="Scheduled report delivery failed"
        subtitle={
          parsed.businessName
            ? `Merchant: ${parsed.businessName}`
            : parsed.merchantId != null
            ? `Merchant #${parsed.merchantId}`
            : undefined
        }
        colorClass="bg-rose-500/10 border-rose-500/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.businessName && <DetailRow label="Merchant" value={parsed.businessName} />}
        {parsed.merchantId != null && (
          <DetailRow label="Merchant ID" value={<span className="font-mono">#{parsed.merchantId}</span>} />
        )}
        {failureCount != null && threshold != null && (
          <DetailRow
            label="Failure count"
            value={
              <span className="font-medium text-rose-400">
                {failureCount} of {threshold} consecutive failures
              </span>
            }
          />
        )}
        {freqLabel && <DetailRow label="Frequency" value={freqLabel} />}
        {fmtLabel && <DetailRow label="Report format" value={fmtLabel} />}
        {parsed.errorMessage && (
          <div className="pt-1">
            <span className="text-xs text-muted-foreground">Error: </span>
            <span className="text-xs font-mono text-rose-300">{parsed.errorMessage}</span>
          </div>
        )}
      </div>
      {parsed.merchantId != null && (
        reenabled ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-300">Schedule re-enabled. The audit log has been refreshed.</p>
          </div>
        ) : confirmReenable ? (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 space-y-2">
            <p className="text-xs text-emerald-300">Make sure the delivery issue is resolved before re-enabling. The schedule will resume automated delivery immediately.</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200"
                onClick={handleReenable}
                disabled={reenable.isPending}
              >
                {reenable.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Re-enabling…</>
                ) : (
                  <><RotateCcw className="w-3.5 h-3.5 mr-1.5" />Confirm Re-enable</>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="flex-1 text-muted-foreground hover:text-foreground"
                onClick={() => setConfirmReenable(false)}
                disabled={reenable.isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full border-rose-500/30 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
            onClick={() => setConfirmReenable(true)}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />Re-enable Schedule
          </Button>
        )
      )}
    </div>
  );
}

function ReportScheduleOverrideSetDetails({ log }: { log: any }) {
  let parsed: {
    merchantId?: number | null;
    nextRunAt?: string | null;
    frequency?: string | null;
    format?: string | null;
  } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const FREQUENCY_LABELS_LOCAL: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  };
  const FORMAT_LABELS: Record<string, string> = {
    csv: "CSV",
    pdf: "PDF",
    json: "JSON",
  };

  const freqLabel = parsed.frequency ? (FREQUENCY_LABELS_LOCAL[parsed.frequency] ?? parsed.frequency) : null;
  const fmtLabel = parsed.format ? (FORMAT_LABELS[parsed.format] ?? parsed.format.toUpperCase()) : null;

  let nextRunFormatted: string | null = null;
  if (parsed.nextRunAt) {
    try { nextRunFormatted = format(parseISO(parsed.nextRunAt), "MMM d, yyyy 'at' HH:mm"); } catch { nextRunFormatted = parsed.nextRunAt; }
  }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Clock className="w-5 h-5 text-violet-400" />}
        title="Next-run date overridden for report schedule"
        subtitle={nextRunFormatted ? `Next run: ${nextRunFormatted}` : undefined}
        colorClass="bg-violet-500/10 border-violet-500/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.merchantId != null && (
          <DetailRow label="Merchant ID" value={<span className="font-mono">#{parsed.merchantId}</span>} />
        )}
        {nextRunFormatted && (
          <DetailRow label="Overridden next run" value={<span className="font-mono">{nextRunFormatted}</span>} />
        )}
        {freqLabel && (
          <DetailRow label="Frequency" value={freqLabel} />
        )}
        {fmtLabel && (
          <DetailRow label="Report format" value={fmtLabel} />
        )}
      </div>
    </div>
  );
}

function ReportScheduleOverrideClearedDetails({ log }: { log: any }) {
  let parsed: {
    merchantId?: number | null;
    frequency?: string | null;
    format?: string | null;
  } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const FREQUENCY_LABELS_LOCAL: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  };
  const FORMAT_LABELS: Record<string, string> = {
    csv: "CSV",
    pdf: "PDF",
    json: "JSON",
  };

  const freqLabel = parsed.frequency ? (FREQUENCY_LABELS_LOCAL[parsed.frequency] ?? parsed.frequency) : null;
  const fmtLabel = parsed.format ? (FORMAT_LABELS[parsed.format] ?? parsed.format.toUpperCase()) : null;

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<RotateCcw className="w-5 h-5 text-slate-400" />}
        title="Report schedule override cleared — reverted to automatic schedule"
        colorClass="bg-slate-500/10 border-slate-500/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.merchantId != null && (
          <DetailRow label="Merchant ID" value={<span className="font-mono">#{parsed.merchantId}</span>} />
        )}
        {freqLabel && (
          <DetailRow label="Frequency" value={freqLabel} />
        )}
        {fmtLabel && (
          <DetailRow label="Report format" value={fmtLabel} />
        )}
      </div>
    </div>
  );
}

function ReportScheduleDeletedDetails({ log }: { log: any }) {
  let parsed: {
    merchantId?: number | null;
    businessName?: string | null;
  } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Trash2 className="w-5 h-5 text-red-400" />}
        title="Report schedule deleted"
        subtitle={parsed.businessName ? `Merchant: ${parsed.businessName}` : undefined}
        colorClass="bg-red-500/10 border-red-500/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.businessName && (
          <DetailRow label="Merchant" value={parsed.businessName} />
        )}
        {parsed.merchantId != null && (
          <DetailRow label="Merchant ID" value={<span className="font-mono">#{parsed.merchantId}</span>} />
        )}
      </div>
    </div>
  );
}

function ReportScheduleAutoPausedDetails({ log }: { log: any }) {
  let parsed: {
    merchantId?: number | null;
    businessName?: string | null;
    consecutiveFailures?: number | null;
    autoPauseAfterFailures?: number | null;
    frequency?: string | null;
    format?: string | null;
  } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const FREQUENCY_LABELS_LOCAL: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
  };
  const FORMAT_LABELS: Record<string, string> = {
    xlsx: "XLSX",
    csv: "CSV",
    pdf: "PDF",
    json: "JSON",
  };

  const freqLabel = parsed.frequency ? (FREQUENCY_LABELS_LOCAL[parsed.frequency] ?? parsed.frequency) : null;
  const fmtLabel = parsed.format ? (FORMAT_LABELS[parsed.format] ?? parsed.format.toUpperCase()) : null;

  const failureCount = parsed.consecutiveFailures ?? null;
  const threshold = parsed.autoPauseAfterFailures ?? null;

  const [reenabled, setReenabled] = useState(false);
  const [confirmReenable, setConfirmReenable] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sentNow, setSentNow] = useState(false);
  const queryClient = useQueryClient();
  const reenable = useReenableAdminMerchantReportSchedule();
  const deleteMutation = useDeleteAdminMerchantReportSchedule();
  const sendNowMutation = useSendAdminMerchantReportNow();

  function handleReenable() {
    if (parsed.merchantId == null) return;
    reenable.mutate({ merchantId: parsed.merchantId }, {
      onSuccess: () => {
        setReenabled(true);
        setConfirmReenable(false);
        queryClient.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey() });
        toast.success("Report schedule re-enabled successfully.");
      },
      onError: () => {
        toast.error("Failed to re-enable the report schedule. Please try again.");
      },
    });
  }

  function handleDelete() {
    if (parsed.merchantId == null) return;
    deleteMutation.mutate({ merchantId: parsed.merchantId }, {
      onSuccess: () => {
        setDeleted(true);
        setConfirmDelete(false);
        queryClient.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey() });
        toast.success("Report schedule deleted.");
      },
      onError: () => {
        toast.error("Failed to delete the report schedule. Please try again.");
      },
    });
  }

  function handleSendNow() {
    if (parsed.merchantId == null) return;
    sendNowMutation.mutate({ merchantId: parsed.merchantId }, {
      onSuccess: () => {
        setSentNow(true);
        queryClient.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey() });
        toast.success("Report sent successfully.");
      },
      onError: () => {
        toast.error("Failed to send report. Check mailer configuration.");
      },
    });
  }

  const hasMerchantId = parsed.merchantId != null;

  const deliveryParams = hasMerchantId
    ? { merchantId: parsed.merchantId!, success: GetAdminReportDeliveryHistorySuccess.false, limit: 5 }
    : undefined;
  const { data: failureHistory, isLoading: failureHistoryLoading } = useGetAdminReportDeliveryHistory(deliveryParams);

  const recentFailures = failureHistory?.logs ?? [];

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<Ban className="w-5 h-5 text-orange-400" />}
        title="Report schedule auto-paused by system"
        subtitle={
          parsed.businessName
            ? `Merchant: ${parsed.businessName}`
            : parsed.merchantId != null
            ? `Merchant #${parsed.merchantId}`
            : undefined
        }
        colorClass="bg-orange-500/10 border-orange-500/20"
      />
      <div className="rounded-lg bg-muted/20 p-3 space-y-1.5">
        {parsed.businessName && <DetailRow label="Merchant" value={parsed.businessName} />}
        {parsed.merchantId != null && (
          <DetailRow label="Merchant ID" value={<span className="font-mono">#{parsed.merchantId}</span>} />
        )}
        {failureCount != null && threshold != null && (
          <DetailRow
            label="Failure count"
            value={
              <span className="font-medium text-orange-400">
                {failureCount} of {threshold} consecutive failures
              </span>
            }
          />
        )}
        {freqLabel && <DetailRow label="Frequency" value={freqLabel} />}
        {fmtLabel && <DetailRow label="Report format" value={fmtLabel} />}
      </div>
      {hasMerchantId && (
        <div className="rounded-lg bg-muted/20 border border-border/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent Delivery Failures</p>
            <Link
              href={`/admin/reports?tab=delivery-history&merchantId=${parsed.merchantId}&success=false`}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              View delivery history
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          {failureHistoryLoading ? (
            <div className="flex items-center gap-2 py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Loading failure history…</span>
            </div>
          ) : recentFailures.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No recent failure records found.</p>
          ) : (
            <div className="space-y-1.5">
              {recentFailures.map((entry) => {
                let attemptFormatted = entry.attemptedAt;
                try { attemptFormatted = format(parseISO(entry.attemptedAt), "MMM d, yyyy HH:mm"); } catch { /* ignore */ }
                const detailHref = `/admin/reports?tab=delivery-history&merchantId=${parsed.merchantId}&success=false`;
                return (
                  <Link key={entry.id} href={detailHref} className="flex gap-2 items-start rounded-md bg-rose-500/5 border border-rose-500/15 px-2.5 py-2 hover:bg-rose-500/10 hover:border-rose-500/30 transition-colors cursor-pointer group">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-xs text-muted-foreground font-mono">{attemptFormatted}</p>
                      <p className="text-xs text-rose-300 break-words">
                        {entry.failureReason ?? "Unknown error"}
                      </p>
                    </div>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/50 group-hover:text-muted-foreground shrink-0 mt-0.5 transition-colors" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className="rounded-lg bg-orange-500/5 border border-orange-500/20 p-3">
        <p className="text-xs text-orange-300/80">
          This schedule was automatically paused by the system after reaching the consecutive failure threshold. An admin must investigate the delivery issue and re-enable the schedule.
        </p>
      </div>
      {hasMerchantId && !deleted && (
        <div className="space-y-2">
          {reenabled ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-300">Schedule re-enabled. The audit log has been refreshed.</p>
            </div>
          ) : confirmReenable ? (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 space-y-2">
              <p className="text-xs text-emerald-300">Make sure the delivery issue is resolved before re-enabling. The schedule will resume automated delivery immediately.</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200"
                  onClick={handleReenable}
                  disabled={reenable.isPending}
                >
                  {reenable.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Re-enabling…</>
                  ) : (
                    <><RotateCcw className="w-3.5 h-3.5 mr-1.5" />Confirm Re-enable</>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setConfirmReenable(false)}
                  disabled={reenable.isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full border-orange-500/30 text-orange-300 hover:bg-orange-500/10 hover:text-orange-200"
              onClick={() => setConfirmReenable(true)}
              disabled={deleteMutation.isPending || sendNowMutation.isPending}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />Re-enable Schedule
            </Button>
          )}
          {sentNow ? (
            <div className="flex items-center gap-2 rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-2">
              <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
              <p className="text-xs text-sky-300">Report sent. Check delivery logs for the result.</p>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full border-sky-500/30 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
              onClick={handleSendNow}
              disabled={sendNowMutation.isPending || reenable.isPending || deleteMutation.isPending}
            >
              {sendNowMutation.isPending ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Sending…</>
              ) : (
                <><Send className="w-3.5 h-3.5 mr-1.5" />Send Now</>
              )}
            </Button>
          )}
          {confirmDelete ? (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 space-y-2">
              <p className="text-xs text-rose-300">This will permanently delete the merchant's report schedule. This cannot be undone.</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-rose-500/40 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Deleting…</>
                  ) : (
                    <><Trash2 className="w-3.5 h-3.5 mr-1.5" />Confirm Delete</>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleteMutation.isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
              onClick={() => setConfirmDelete(true)}
              disabled={reenable.isPending || sendNowMutation.isPending || deleteMutation.isPending}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete Schedule
            </Button>
          )}
        </div>
      )}
      {deleted && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2">
          <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
          <p className="text-xs text-rose-300">Schedule deleted. The audit log has been refreshed.</p>
        </div>
      )}
    </div>
  );
}

function NotificationPreferencesUpdatedDetails({ log }: { log: any }) {
  let parsed: { changes?: { field: string; oldValue: unknown; newValue: unknown }[] } = {};
  try { if (log.details) parsed = JSON.parse(log.details); } catch { /* ignore */ }

  const changes = parsed.changes ?? [];

  function formatBoolValue(v: unknown): React.ReactNode {
    if (v === true)  return <span className="text-emerald-400 font-medium">Enabled</span>;
    if (v === false) return <span className="text-rose-400 font-medium">Disabled</span>;
    if (v == null)   return <span className="text-muted-foreground">—</span>;
    return <span>{String(v)}</span>;
  }

  return (
    <div className="space-y-3">
      <SummaryCard
        icon={<BellRing className="w-5 h-5 text-indigo-400" />}
        title={changes.length > 0 ? `${changes.length} notification preference${changes.length !== 1 ? "s" : ""} changed` : "Notification preferences updated"}
        subtitle={`User #${log.targetId ?? "—"}`}
        colorClass="bg-indigo-500/10 border-indigo-500/20"
      />
      {changes.length > 0 && (
        <div className="rounded-lg bg-muted/20 p-3 space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Changes</p>
          <div className="divide-y divide-border/30">
            {changes.map((c, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
                <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate" title={humanizeKey(c.field)}>
                  {humanizeKey(c.field)}
                </span>
                <div className="flex items-center gap-1.5 shrink-0 text-xs">
                  {formatBoolValue(c.oldValue)}
                  <span className="text-muted-foreground/50">→</span>
                  {formatBoolValue(c.newValue)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
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
    case "report_schedule_created":
      return <ReportScheduleCreatedDetails log={log} />;
    case "report_schedule_updated":
      return <ReportScheduleUpdatedDetails log={log} />;
    case "report_schedule_reenabled":
      return <ReportScheduleReenabledDetails log={log} />;
    case "report_schedule_override_set":
      return <ReportScheduleOverrideSetDetails log={log} />;
    case "report_schedule_override_cleared":
      return <ReportScheduleOverrideClearedDetails log={log} />;
    case "report_schedule_deleted":
      return <ReportScheduleDeletedDetails log={log} />;
    case "report_schedule_auto_paused":
      return <ReportScheduleAutoPausedDetails log={log} />;
    case "scheduled_report_failure":
      return <ScheduledReportFailureDetails log={log} />;
    case "notification_preferences_updated":
      return <NotificationPreferencesUpdatedDetails log={log} />;
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

function ScheduleHistoryPanel({
  scheduleId,
  failureAcknowledgedAt,
  failureAcknowledgedByEmail,
}: {
  scheduleId: number;
  failureAcknowledgedAt?: string | null;
  failureAcknowledgedByEmail?: string | null;
}) {
  const { data, isLoading } = useListAuditReportScheduleLogs(scheduleId, { limit: 50 });
  const { data: retentionData } = useGetAuditReportRetentionConfig();
  const retentionDays = retentionData?.retentionDays ?? 90;
  const logs = data?.data ?? [];
  const [expandedCycles, setExpandedCycles] = useState<Set<string>>(new Set());
  const autoExpandedCycleRef = useRef<string | null>(null);

  const cycles = useMemo(() => {
    const map = new Map<string, typeof logs>();
    for (const log of logs) {
      const key = log.deliveryCycleId ?? `orphan-${log.id}`;
      const bucket = map.get(key) ?? [];
      bucket.push(log);
      map.set(key, bucket);
    }
    return Array.from(map.entries()).map(([cycleId, attempts]) => {
      const sortedAttempts = [...attempts].sort(
        (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
      );
      const overallSuccess = attempts.some(a => a.success);
      const initialAttempt = [...attempts].sort(
        (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
      )[0]!;
      return { cycleId, attempts: sortedAttempts, overallSuccess, initialAttempt };
    });
  }, [logs]);

  const mostRecentFailedCycleId = useMemo(() => {
    const mostRecent = [...cycles].sort(
      (a, b) =>
        new Date(b.initialAttempt.sentAt).getTime() -
        new Date(a.initialAttempt.sentAt).getTime(),
    )[0];
    return mostRecent && !mostRecent.overallSuccess ? mostRecent.cycleId : null;
  }, [cycles]);

  useEffect(() => {
    if (mostRecentFailedCycleId) {
      // Auto-expand this failed cycle if we haven't already tracked it
      if (autoExpandedCycleRef.current !== mostRecentFailedCycleId) {
        autoExpandedCycleRef.current = mostRecentFailedCycleId;
        setExpandedCycles(prev => new Set([...prev, mostRecentFailedCycleId]));
      }
    } else if (autoExpandedCycleRef.current !== null) {
      // Most recent cycle is now a success — collapse the previously auto-expanded cycle
      const toCollapse = autoExpandedCycleRef.current;
      autoExpandedCycleRef.current = null;
      setExpandedCycles(prev => {
        const next = new Set(prev);
        next.delete(toCollapse);
        return next;
      });
    }
  }, [mostRecentFailedCycleId]);

  function toggleCycle(cycleId: string) {
    setExpandedCycles(prev => {
      const next = new Set(prev);
      if (next.has(cycleId)) next.delete(cycleId);
      else next.add(cycleId);
      return next;
    });
    // If user manually toggles the auto-expanded cycle, stop tracking it
    // so the auto-collapse logic doesn't interfere with the manual state
    if (autoExpandedCycleRef.current === cycleId) {
      autoExpandedCycleRef.current = null;
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-1.5 px-2 py-2">
        {[1, 2, 3].map(i => <div key={i} className="h-8 bg-muted/20 rounded animate-pulse" />)}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="space-y-0">
        <div className="flex items-center gap-2 px-3 py-3 text-muted-foreground">
          <History className="w-4 h-4 opacity-40" />
          <span className="text-xs">No sends recorded yet — history will appear here after the first delivery.</span>
        </div>
        {retentionDays > 0 && (
          <div className="border-t border-border/30 px-3 py-2 flex items-center gap-1.5 text-xs text-muted-foreground/60">
            <Trash2 className="w-3 h-3 shrink-0" />
            <span>Entries older than {retentionDays} day{retentionDays !== 1 ? "s" : ""} are removed automatically.</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/30">
      {cycles.map(({ cycleId, attempts, overallSuccess, initialAttempt }) => {
        const isExpanded = expandedCycles.has(cycleId);
        const hasRetries = attempts.length > 1;
        return (
          <div
            key={cycleId}
            className={cycleId === mostRecentFailedCycleId ? "border-l-2 border-rose-500 bg-rose-500/5" : undefined}
          >
            <button
              type="button"
              className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-muted/10 transition-colors"
              onClick={() => hasRetries && toggleCycle(cycleId)}
            >
              <div className="mt-0.5 shrink-0">
                {overallSuccess
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  : <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium">
                    {format(new Date(initialAttempt.sentAt), "MMM d, yyyy 'at' HH:mm")}
                  </span>
                  {overallSuccess
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
                  {hasRetries && (
                    <span className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                      <RefreshCw className="w-2.5 h-2.5" />
                      {attempts.length} attempt{attempts.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {initialAttempt.rowCount.toLocaleString()} row{initialAttempt.rowCount !== 1 ? "s" : ""}
                  </span>
                  {hasRetries && (
                    <span className="ml-auto shrink-0 text-muted-foreground">
                      {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </span>
                  )}
                </div>
                {!overallSuccess && attempts[0]?.errorMessage && !hasRetries && (
                  <p className="text-xs text-rose-400/80 mt-0.5 break-words" title={attempts[0].errorMessage ?? undefined}>
                    {attempts[0].errorMessage}
                  </p>
                )}
              </div>
            </button>

            {hasRetries && isExpanded && (
              <div className="ml-10 mr-3 mb-2 rounded-md border border-border/30 bg-muted/5 divide-y divide-border/20 overflow-hidden">
                {attempts.map((log) => {
                  const attemptLabel = !log.isRetry
                    ? "Initial send"
                    : log.isManualRetry
                      ? `Manual retry #${log.retryAttempt}`
                      : `Auto-retry #${log.retryAttempt}`;
                  return (
                    <div key={log.id} className="flex items-start gap-2.5 px-3 py-2">
                      <div className="mt-0.5 shrink-0">
                        {log.success
                          ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          : <AlertCircle className="w-3 h-3 text-rose-400" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {!log.isRetry ? (
                            <span className="inline-flex items-center rounded border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              {attemptLabel}
                            </span>
                          ) : log.isManualRetry ? (
                            <span className="inline-flex items-center gap-1 rounded border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-400">
                              <RefreshCw className="w-2 h-2" />
                              {attemptLabel}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                              <RefreshCw className="w-2 h-2" />
                              {attemptLabel}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            {format(new Date(log.sentAt), "MMM d 'at' HH:mm")}
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
                        </div>
                        {!log.success && log.errorMessage && (
                          <p className="text-[10px] text-rose-400/80 mt-0.5 break-words" title={log.errorMessage ?? undefined}>
                            {log.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {failureAcknowledgedAt && (
        <div className="flex items-start gap-2.5 px-4 py-2.5 border-t border-amber-500/20 bg-amber-500/5">
          <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-amber-400">Failure acknowledged</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              by {failureAcknowledgedByEmail ?? "unknown"} &middot;{" "}
              {format(new Date(failureAcknowledgedAt), "MMM d, yyyy 'at' HH:mm")}
            </p>
          </div>
        </div>
      )}
      {retentionDays > 0 && (
        <div className="px-4 py-2 flex items-center gap-1.5 text-xs text-muted-foreground/60">
          <Trash2 className="w-3 h-3 shrink-0" />
          <span>Entries older than {retentionDays} day{retentionDays !== 1 ? "s" : ""} are removed automatically.</span>
        </div>
      )}
    </div>
  );
}

function ScheduleRow({
  s,
  onToggle,
  onDelete,
  onSendNow,
  onAcknowledge,
  sendingId,
}: {
  s: any;
  onToggle: (id: number, isActive: boolean) => void;
  onDelete: (id: number) => void;
  onSendNow?: (id: number) => void;
  onAcknowledge?: (id: number) => void;
  sendingId?: number | null;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div id={`schedule-row-${s.id}`} className={`rounded-lg border transition-colors ${
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
            {s.lastSendStatus === "ok" && (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Healthy
              </span>
            )}
            {s.lastSendStatus === "failed" && (
              <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400">
                <AlertCircle className="w-2.5 h-2.5" />
                Failing
              </span>
            )}
            {s.lastSendStatus === "none" && (
              <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <Clock className="w-2.5 h-2.5" />
                Never sent
              </span>
            )}
            {s.lastSuccessWasManualRetry && s.lastSendStatus === "ok" && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-400 cursor-default">
                      <RefreshCw className="w-2.5 h-2.5" />
                      Recovered via manual retry
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    The last successful delivery was triggered manually by an admin using "Retry Now".
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {s.lastDeliveryAttempts > 1 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 cursor-default">
                      <RotateCcw className="w-2.5 h-2.5" />
                      {s.lastDeliveryAttempts} attempts
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    The last delivery required {s.lastDeliveryAttempts} attempts ({s.lastDeliveryAttempts - 1} retr{s.lastDeliveryAttempts - 1 === 1 ? "y" : "ies"} after the initial send).
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {s.frequency === "daily" ? (
              <Badge className="text-xs capitalize bg-violet-600/20 text-violet-400 border border-violet-600/30 hover:bg-violet-600/20">Daily</Badge>
            ) : s.frequency === "weekly" ? (
              <Badge className="text-xs capitalize bg-amber-600/20 text-amber-400 border border-amber-600/30 hover:bg-amber-600/20">Weekly</Badge>
            ) : s.frequency === "monthly" ? (
              <Badge className="text-xs capitalize bg-sky-600/20 text-sky-400 border border-sky-600/30 hover:bg-sky-600/20">Monthly</Badge>
            ) : (
              <Badge variant="outline" className="text-xs capitalize">{FREQUENCY_LABELS[s.frequency] ?? s.frequency}</Badge>
            )}
            {!s.isActive && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400 cursor-default">
                      <Ban className="w-2.5 h-2.5" />
                      {s.consecutiveFailures > 0
                        ? `Auto-paused after ${s.consecutiveFailures} failure${s.consecutiveFailures !== 1 ? "s" : ""}`
                        : "Paused"}
                    </span>
                  </TooltipTrigger>
                  {s.consecutiveFailures > 0 && (
                    <TooltipContent side="top" className="max-w-xs">
                      This schedule was automatically paused after {s.consecutiveFailures} consecutive delivery failure{s.consecutiveFailures !== 1 ? "s" : ""}. Fix the email address, then re-enable it.
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}
            {s.retriesExhausted && !s.failureAcknowledgedAt && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-md border border-red-600/50 bg-red-600/15 px-2 py-0.5 text-xs font-medium text-red-400 cursor-default">
                      <XCircle className="w-2.5 h-2.5" />
                      Failed after {s.currentRetryAttempt} retr{s.currentRetryAttempt === 1 ? "y" : "ies"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    {s.lastErrorMessage
                      ? `All ${s.currentRetryAttempt} retr${s.currentRetryAttempt === 1 ? "y" : "ies"} exhausted. Final error: ${s.lastErrorMessage}`
                      : `All automatic retries (${s.currentRetryAttempt}) were exhausted and delivery still failed.`}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {s.lastSendStatus === "failed" && !s.retryInProgress && !s.retriesExhausted && !s.failureAcknowledgedAt && (
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
            {s.lastSendStatus === "failed" && !s.retryInProgress && !s.failureAcknowledgedAt && onAcknowledge && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onAcknowledge(s.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-500/20 bg-rose-500/5 px-2 py-0.5 text-xs font-medium text-rose-400/70 hover:bg-rose-500/15 hover:text-rose-300 hover:border-rose-500/40 transition-colors"
                    >
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      Dismiss
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    Mark this failure as reviewed and dismiss the alert
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {s.lastSendStatus === "failed" && !s.retryInProgress && s.failureAcknowledgedAt && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/20 px-2 py-0.5 text-xs font-medium text-muted-foreground cursor-default">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      Dismissed
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    Acknowledged by {s.failureAcknowledgedByEmail}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {s.retryInProgress && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 cursor-default">
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                      Auto-retrying ({s.currentRetryAttempt + 1} of {s.maxRetryAttempts ?? 2})
                      {s.nextRetryAt && (
                        <span className="text-amber-400/70">
                          {" · Retries at "}
                          {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(s.nextRetryAt))}
                        </span>
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    {s.lastErrorMessage
                      ? `Last attempt failed: ${s.lastErrorMessage}. Automatic retry pending.`
                      : `Delivery failed. Automatic retry pending.`}
                    {s.nextRetryAt && ` Next retry at ${new Date(s.nextRetryAt).toISOString()}.`}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {s.lastSendStatus === "failed" && onSendNow && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onSendNow(s.id)}
                      disabled={sendingId === s.id}
                      className="inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-400 hover:bg-violet-500/20 hover:border-violet-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {sendingId === s.id
                        ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        : <Send className="w-2.5 h-2.5" />
                      }
                      Retry
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    Re-send this report now — clears the failure badge on success
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
          <ScheduleHistoryPanel
            scheduleId={s.id}
            failureAcknowledgedAt={s.failureAcknowledgedAt}
            failureAcknowledgedByEmail={s.failureAcknowledgedByEmail}
          />
        </div>
      )}
    </div>
  );
}

function ScheduledReportsPanel() {
  const queryClient = useQueryClient();
  const { data: schedulesData, isLoading } = useListAuditReportSchedules({
    query: {
      queryKey: getListAuditReportSchedulesQueryKey(),
      refetchInterval: (query: { state: { data?: { data?: { retryInProgress?: boolean }[] } } }) => {
        const rows = query.state.data?.data ?? [];
        return rows.some((s) => s.retryInProgress) ? 30_000 : false;
      },
    },
  } as any);
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

  async function handleAcknowledge(id: number) {
    await updateSchedule.mutateAsync({ id, data: { acknowledgeFailure: true } });
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
                onAcknowledge={handleAcknowledge}
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
              Email Preview —{' '}
              <Badge className={`text-xs capitalize border ${
                newFrequency === 'daily'
                  ? 'bg-violet-600/20 text-violet-400 border-violet-600/30 hover:bg-violet-600/20'
                  : newFrequency === 'weekly'
                  ? 'bg-amber-600/20 text-amber-400 border-amber-600/30 hover:bg-amber-600/20'
                  : 'bg-sky-600/20 text-sky-400 border-sky-600/30 hover:bg-sky-600/20'
              }`}>{newFrequency}</Badge>{' '}
              Report
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

function GlobalDeliveryHistoryPanel() {
  const { data, isLoading } = useListAllAuditReportScheduleLogs({ limit: 100 });
  const [openCycles, setOpenCycles] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<"all" | "delivered" | "failed">("all");
  const [emailFilter, setEmailFilter] = useState("");
  const logs = data?.data ?? [];

  const allCycles = (() => {
    const map = new Map<string, typeof logs>();
    for (const log of logs) {
      const key = log.deliveryCycleId ?? `orphan-${log.id}`;
      const bucket = map.get(key) ?? [];
      bucket.push(log);
      map.set(key, bucket);
    }
    return Array.from(map.entries()).map(([cycleId, attempts]) => {
      const overallSuccess = attempts.some(a => a.success);
      const newestAttempt = attempts[0];
      return { cycleId, attempts, overallSuccess, newestAttempt };
    });
  })();

  const cycles = allCycles.filter(({ overallSuccess, newestAttempt }) => {
    if (statusFilter === "delivered" && !overallSuccess) return false;
    if (statusFilter === "failed" && overallSuccess) return false;
    if (emailFilter.trim()) {
      const q = emailFilter.trim().toLowerCase();
      if (!newestAttempt.scheduleEmail.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasActiveFilters = statusFilter !== "all" || emailFilter.trim() !== "";

  function clearFilters() {
    setStatusFilter("all");
    setEmailFilter("");
  }

  const timelineChartData = useMemo(() => {
    if (logs.length === 0) return [];
    const end = new Date();
    const start = subDays(end, 29);
    const recentLogs = logs.filter(l => {
      const d = new Date(l.sentAt);
      return d >= start && d <= end;
    });
    if (recentLogs.length === 0) return [];
    const dayMap = new Map<string, { date: string; success: number; failed: number }>();
    const days = eachDayOfInterval({ start, end });
    for (const d of days) {
      const key = format(d, "dd MMM");
      dayMap.set(key, { date: key, success: 0, failed: 0 });
    }
    for (const log of recentLogs) {
      const key = format(new Date(log.sentAt), "dd MMM");
      const entry = dayMap.get(key);
      if (entry) {
        if (log.success) entry.success++;
        else entry.failed++;
      }
    }
    return Array.from(dayMap.values());
  }, [logs]);

  const timelineSuccessRate = useMemo(() => {
    if (timelineChartData.length === 0) return null;
    const total = timelineChartData.reduce((s, d) => s + d.success + d.failed, 0);
    if (total === 0) return null;
    const success = timelineChartData.reduce((s, d) => s + d.success, 0);
    return Math.round((success / total) * 100);
  }, [timelineChartData]);

  function toggleCycle(cycleId: string) {
    setOpenCycles(prev => {
      const next = new Set(prev);
      if (next.has(cycleId)) next.delete(cycleId);
      else next.add(cycleId);
      return next;
    });
  }

  function goToSchedule(scheduleId: number) {
    const el = document.getElementById(`schedule-row-${scheduleId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.outline = "2px solid rgb(139 92 246)";
    el.style.boxShadow = "0 0 0 4px rgba(139, 92, 246, 0.25)";
    el.style.borderRadius = "8px";
    el.style.transition = "outline 0ms, box-shadow 0ms";
    setTimeout(() => {
      el.style.transition = "outline 800ms ease, box-shadow 800ms ease";
      el.style.outline = "2px solid transparent";
      el.style.boxShadow = "0 0 0 4px rgba(139, 92, 246, 0)";
      setTimeout(() => {
        el.style.outline = "";
        el.style.boxShadow = "";
        el.style.transition = "";
      }, 900);
    }, 1400);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-violet-400" />
          <CardTitle className="text-base font-semibold">Global Report Delivery History</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          All delivery cycles across all schedules — each row is one logical delivery attempt, expandable to show individual retry attempts.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {!isLoading && allCycles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as "all" | "delivered" | "failed")}>
              <SelectTrigger className="h-7 w-[130px] text-xs border-border/50 bg-muted/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Filter by email…"
                value={emailFilter}
                onChange={e => setEmailFilter(e.target.value)}
                className="h-7 pl-6 text-xs border-border/50 bg-muted/20"
              />
              {emailFilter && (
                <button
                  type="button"
                  onClick={() => setEmailFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </Button>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto">
              {cycles.length} of {allCycles.length}
            </span>
          </div>
        )}
        {!isLoading && timelineChartData.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-violet-400" />
              Delivery Timeline — last 30 days
              {timelineSuccessRate != null && (
                <span
                  className={[
                    "ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none",
                    timelineSuccessRate >= 90
                      ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                      : timelineSuccessRate >= 75
                      ? "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30"
                      : "bg-red-500/15 text-red-400 ring-1 ring-red-500/30",
                  ].join(" ")}
                >
                  {timelineSuccessRate}% delivered
                </span>
              )}
            </p>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart
                data={timelineChartData}
                margin={{ top: 0, right: 8, left: -20, bottom: 16 }}
                barCategoryGap="20%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.floor(timelineChartData.length / 7)}
                  angle={-40}
                  textAnchor="end"
                  dy={4}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                />
                <RechartsTooltip
                  cursor={{ fill: "hsl(var(--muted)/0.15)" }}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(val: number, name: string) => [val, name === "success" ? "Delivered" : "Failed"]}
                />
                <Bar dataKey="success" name="success" stackId="a" fill="hsl(142 71% 45%)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="failed" name="failed" stackId="a" fill="hsl(0 84% 60%)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-10 bg-muted/20 rounded animate-pulse" />)}
          </div>
        ) : cycles.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <History className="w-7 h-7 opacity-30" />
            <p className="text-sm">{allCycles.length === 0 ? "No delivery history yet" : "No results match the current filters"}</p>
            <p className="text-xs opacity-60">
              {allCycles.length === 0
                ? "History will appear here after the first scheduled report is sent"
                : "Try adjusting the status or email filter"}
            </p>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="mt-1 text-xs">
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/30 -mx-6 px-0">
            {cycles.map(({ cycleId, attempts, overallSuccess, newestAttempt }) => {
              const isOpen = openCycles.has(cycleId);
              const hasRetries = attempts.length > 1;
              const isOrphan = cycleId.startsWith("orphan-");
              return (
                <div key={cycleId} className="group/cycle">
                  <div className="flex items-center">
                    <button
                      type="button"
                      className="flex-1 flex items-center gap-3 px-6 py-2.5 text-left hover:bg-muted/10 transition-colors min-w-0"
                      onClick={() => toggleCycle(cycleId)}
                    >
                      <div className="shrink-0">
                        {overallSuccess
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          : <XCircle className="w-4 h-4 text-rose-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium truncate">
                            {format(new Date(newestAttempt.sentAt), "MMM d, yyyy 'at' HH:mm")}
                          </span>
                          {overallSuccess
                            ? <span className="inline-flex items-center rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">Delivered</span>
                            : <span className="inline-flex items-center rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">Failed</span>}
                          {hasRetries && (
                            <span className="inline-flex items-center rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                              {attempts.length} attempts
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                          {!isOrphan && <span className="font-mono opacity-60">{cycleId.slice(0, 8)}…</span>}
                          <Mail className="w-3 h-3 shrink-0" />
                          <span className="truncate">{newestAttempt.scheduleEmail}</span>
                          <span className="capitalize">{FREQUENCY_LABELS[newestAttempt.scheduleFrequency] ?? newestAttempt.scheduleFrequency}</span>
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-0.5 pr-4 shrink-0">
                      {!isOrphan && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => goToSchedule(newestAttempt.scheduleId)}
                                className="p-1.5 rounded text-muted-foreground/40 hover:text-violet-400 hover:bg-violet-500/10 opacity-0 group-hover/cycle:opacity-100 transition-all focus-visible:opacity-100"
                                aria-label="Go to schedule"
                              >
                                <ArrowUpRight className="w-3.5 h-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="left">Go to schedule</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleCycle(cycleId)}
                        className="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={isOpen ? "Collapse" : "Expand"}
                      >
                        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="bg-muted/5 border-t border-border/20 divide-y divide-border/20">
                      {attempts.map((log: (typeof logs)[number]) => (
                        <div key={log.id} className="flex items-start gap-3 px-10 py-2">
                          <div className="mt-0.5 shrink-0">
                            {log.success
                              ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              : <AlertCircle className="w-3 h-3 text-rose-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap text-[11px]">
                              <span className="font-medium">
                                {format(new Date(log.sentAt), "MMM d, yyyy 'at' HH:mm:ss")}
                              </span>
                              {log.isRetry && (
                                <span className="inline-flex items-center rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                                  Retry
                                </span>
                              )}
                              <span className="text-muted-foreground">{log.rowCount} row{log.rowCount !== 1 ? "s" : ""}</span>
                            </div>
                            {log.errorMessage && (
                              <p className="text-[10px] text-rose-400 mt-0.5 break-words" title={log.errorMessage}>{log.errorMessage}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CREDENTIAL_EVENT_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; cardColor: string }> = {
  api_key_generated: {
    label: "API Key Generated",
    icon: <KeyRound className="w-4 h-4" />,
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    cardColor: "bg-emerald-500/5 border-emerald-500/20",
  },
  api_key_revoked: {
    label: "API Key Revoked",
    icon: <Trash2 className="w-4 h-4" />,
    color: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    cardColor: "bg-rose-500/5 border-rose-500/20",
  },
  callback_secret_rotated: {
    label: "Callback Secret Rotated",
    icon: <RotateCcw className="w-4 h-4" />,
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    cardColor: "bg-amber-500/5 border-amber-500/20",
  },
};

function CredentialEventBadge({ eventType }: { eventType: string }) {
  const cfg = CREDENTIAL_EVENT_CONFIG[eventType];
  if (!cfg) {
    return (
      <Badge variant="outline" className="text-xs capitalize">{eventType.replace(/_/g, " ")}</Badge>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function SecurityEventsPanel() {
  const [eventType, setEventType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [merchantIdInput, setMerchantIdInput] = useState("");
  const [merchantId, setMerchantId] = useState<number | undefined>(undefined);
  const [actorEmailInput, setActorEmailInput] = useState("");
  const [ipAddressInput, setIpAddressInput] = useState("");
  const [page, setPage] = useState(1);

  function resetFilters() {
    setEventType("all");
    setDateFrom("");
    setDateTo("");
    setMerchantIdInput("");
    setMerchantId(undefined);
    setActorEmailInput("");
    setIpAddressInput("");
    setPage(1);
  }

  function applyMerchantIdFilter(val: string) {
    const num = parseInt(val.trim());
    setMerchantId(val.trim() !== "" && !isNaN(num) ? num : undefined);
    setPage(1);
  }

  const hasFilters = eventType !== "all" || dateFrom !== "" || dateTo !== "" || merchantId != null || actorEmailInput !== "" || ipAddressInput !== "";

  const { data, isLoading } = useListCredentialEvents({
    eventType: eventType === "all" ? undefined : eventType,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    merchantId,
    actorEmail: actorEmailInput.trim() || undefined,
    ipAddress: ipAddressInput.trim() || undefined,
    page,
    limit: 20,
  } as any);

  const events = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-amber-400" />
          <CardTitle className="text-base font-semibold">Security Events</CardTitle>
          <span className="text-xs text-muted-foreground ml-1">
            Credential rotations and API key changes across all merchants
          </span>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={eventType} onValueChange={v => { setEventType(v); setPage(1); }}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Event type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Security Events</SelectItem>
                <SelectItem value="api_key_generated">API Key Generated</SelectItem>
                <SelectItem value="api_key_revoked">API Key Revoked</SelectItem>
                <SelectItem value="callback_secret_rotated">Callback Secret Rotated</SelectItem>
              </SelectContent>
            </Select>
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
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 min-w-0">
              <AtSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 pr-7 text-sm h-9"
                placeholder="Actor email (contains)"
                value={actorEmailInput}
                onChange={e => { setActorEmailInput(e.target.value); setPage(1); }}
                aria-label="Filter by actor email"
              />
              {actorEmailInput && (
                <button
                  onClick={() => { setActorEmailInput(""); setPage(1); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear actor email filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="relative flex-1 min-w-0">
              <Network className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8 pr-7 text-sm h-9"
                placeholder="IP address (prefix)"
                value={ipAddressInput}
                onChange={e => { setIpAddressInput(e.target.value); setPage(1); }}
                aria-label="Filter by IP address"
              />
              {ipAddressInput && (
                <button
                  onClick={() => { setIpAddressInput(""); setPage(1); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear IP address filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-3.5 h-3.5 mr-1.5" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Merchant</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Key Prefix</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !events.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-16">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <KeyRound className="w-8 h-8 opacity-30" />
                    <p className="text-sm">No security events yet</p>
                    <p className="text-xs opacity-70">API key and callback secret changes will appear here</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : events.map((ev: any) => (
              <TableRow key={ev.id}>
                <TableCell>
                  <div>
                    <p className="text-sm font-medium">{ev.merchantBusinessName ?? `Merchant #${ev.merchantId}`}</p>
                    <p className="text-xs text-muted-foreground font-mono">ID #{ev.merchantId}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <CredentialEventBadge eventType={ev.eventType} />
                </TableCell>
                <TableCell>
                  <div>
                    <p className="text-sm">{ev.actorEmail}</p>
                    <p className="text-xs text-muted-foreground">ID #{ev.actorId}</p>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {ev.keyPrefix ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {ev.ipAddress ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {format(new Date(ev.createdAt), "MMM d, yyyy HH:mm:ss")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </CardContent>

      {total > 20 && (
        <div className="flex items-center justify-between px-6 py-4 border-t border-border/40">
          <span className="text-sm text-muted-foreground">{total} total events</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <span className="text-sm text-muted-foreground px-1">Page {page} of {Math.ceil(total / 20)}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>Next</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

type ComplianceSortKey = "lastLoginAt" | "lastExportedAt";

function CompliancePanel() {
  const [statusFilter, setStatusFilter] = useState<"all" | "exported" | "never" | "inactive">("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<ComplianceSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetSecurityComplianceSummary(
    statusFilter !== "all" ? { status: statusFilter } : {},
  );

  const remind = useSendSecurityReviewReminder();
  const logExport = useCreateAdminAuditLog();

  const rows = data?.data ?? [];
  const totalMerchants = data?.totalMerchants ?? 0;
  const exportedCount = data?.exportedCount ?? 0;
  const neverCount = data?.neverCount ?? 0;
  const inactiveCount = (data as any)?.inactiveCount ?? 0;

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows as any[];
    return [...(rows as any[])].sort((a, b) => {
      const av = a[sortKey] ? new Date(a[sortKey]).getTime() : -Infinity;
      const bv = b[sortKey] ? new Date(b[sortKey]).getTime() : -Infinity;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [rows, sortKey, sortDir]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedRows;
    return sortedRows.filter((r: any) =>
      (r.businessName ?? "").toLowerCase().includes(q) ||
      (r.email ?? "").toLowerCase().includes(q),
    );
  }, [sortedRows, searchQuery]);

  function handleSortToggle(key: ComplianceSortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handleExportCsv() {
    function escapeCsv(val: string | null | undefined): string {
      if (val == null) return "";
      let s = String(val);
      // Neutralize spreadsheet formula injection: prefix with a single quote
      // when the value starts with =, +, -, @, tab, or carriage return so that
      // Excel / Sheets treats it as plain text rather than a formula.
      if (/^[=+\-@\t\r]/.test(s)) {
        s = `'${s}`;
      }
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }
    const header = ["Merchant ID", "Business Name", "Email", "Last Login At", "Last Export At", "Is Inactive", "Last Dormant Alert At"];
    const csvRows = (rows as any[]).map(r => [
      escapeCsv(String(r.merchantId)),
      escapeCsv(r.businessName),
      escapeCsv(r.email),
      escapeCsv(r.lastLoginAt ?? null),
      escapeCsv(r.lastExportedAt ?? null),
      escapeCsv(r.isInactive ? "true" : "false"),
      escapeCsv(r.lastDormantAlertAt ?? null),
    ].join(","));
    const csv = [header.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    logExport.mutate({
      data: {
        action: "compliance_report_exported",
        targetType: "compliance_report",
        details: JSON.stringify({
          rowCount: (rows as any[]).length,
          statusFilter,
        }),
      },
    });
  }

  const FILTER_BUTTONS: { value: typeof statusFilter; label: string; activeClass: string }[] = [
    { value: "all",      label: "All",           activeClass: "bg-primary/15 border-primary/40 text-primary" },
    { value: "exported", label: "Reviewed",       activeClass: "bg-teal-500/15 border-teal-500/40 text-teal-300" },
    { value: "never",    label: "Never reviewed", activeClass: "bg-amber-500/15 border-amber-500/40 text-amber-300" },
    { value: "inactive", label: "Inactive (90d+)", activeClass: "bg-rose-500/15 border-rose-500/40 text-rose-300" },
  ];

  function filterLabel() {
    if (statusFilter === "exported") return "reviewed";
    if (statusFilter === "never") return "never reviewed";
    if (statusFilter === "inactive") return "inactive";
    return null;
  }

  const neverRows = rows.filter((r: any) => r.status === "never");
  const selectableIds = neverRows.map((r: any) => r.merchantId as number);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));
  const someSelected = selectableIds.some(id => selected.has(id));

  function toggleRow(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        selectableIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        selectableIds.forEach(id => next.add(id));
        return next;
      });
    }
  }

  async function handleRemind(merchantIds?: number[]) {
    try {
      const result = await remind.mutateAsync({ data: merchantIds ? { merchantIds } : {} });
      queryClient.invalidateQueries({ queryKey: ["getSecurityComplianceSummary"] });
      setSelected(new Set());
      const label = merchantIds ? `${result.sent} merchant${result.sent !== 1 ? "s" : ""}` : `all ${result.sent} non-compliant merchant${result.sent !== 1 ? "s" : ""}`;
      if (result.sent === 0) {
        toast.info("No reminders sent — all selected merchants have already reviewed their security log.");
      } else if (result.emailsDispatched > 0) {
        toast.success(`Reminder sent to ${label}. ${result.emailsDispatched} email${result.emailsDispatched !== 1 ? "s" : ""} dispatched.`);
      } else {
        toast.success(`Reminder logged for ${label}. (SMTP not configured — no emails sent.)`);
      }
    } catch {
      toast.error("Failed to send reminders. Please try again.");
    }
  }

  const selectedNeverIds = Array.from(selected).filter(id =>
    neverRows.some((r: any) => r.merchantId === id),
  );
  const canRemindSelected = selectedNeverIds.length > 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/10 px-4 py-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-muted/20 border border-border/40 shrink-0">
            <Building2 className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xl font-bold leading-none">{totalMerchants}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Total merchants</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-teal-500/20 bg-teal-500/5 px-4 py-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-teal-500/10 border border-teal-500/20 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-teal-400 leading-none">{exportedCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Reviewed security log</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-amber-500/10 border border-amber-500/20 shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-amber-400 leading-none">{neverCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Never reviewed</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-md bg-rose-500/10 border border-rose-500/20 shrink-0">
            <Clock className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-rose-400 leading-none">{inactiveCount}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Inactive (90d+)</p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-teal-400" />
              Security Review Status
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by name or email…"
                  className="h-7 pl-8 pr-7 text-xs w-52 bg-muted/10 border-border/40"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              {FILTER_BUTTONS.map(({ value, label, activeClass }) => (
                <button
                  key={value}
                  onClick={() => { setStatusFilter(value); setSelected(new Set()); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors border ${
                    statusFilter === value
                      ? activeClass
                      : "border-border/40 bg-transparent text-muted-foreground hover:text-foreground hover:border-border/70"
                  }`}
                >
                  {label}
                </button>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs gap-1.5"
                onClick={handleExportCsv}
                disabled={isLoading || rows.length === 0}
              >
                <FileDown className="w-3 h-3" />
                Export CSV
              </Button>
              {canRemindSelected ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-xs gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 hover:border-amber-500/60"
                  onClick={() => handleRemind(selectedNeverIds)}
                  disabled={remind.isPending}
                >
                  {remind.isPending
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <BellRing className="w-3 h-3" />
                  }
                  Remind selected ({selectedNeverIds.length})
                </Button>
              ) : neverCount > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-xs gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 hover:border-amber-500/60"
                  onClick={() => handleRemind()}
                  disabled={remind.isPending}
                >
                  {remind.isPending
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <BellRing className="w-3 h-3" />
                  }
                  Remind all ({neverCount})
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    {selectableIds.length > 0 && (
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all non-reviewed merchants"
                        className="border-border/60"
                        data-state={someSelected && !allSelected ? "indeterminate" : allSelected ? "checked" : "unchecked"}
                      />
                    )}
                  </TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSortToggle("lastLoginAt")}
                      className="flex items-center gap-1 hover:text-foreground transition-colors group"
                    >
                      Last Login
                      {sortKey === "lastLoginAt"
                        ? sortDir === "desc"
                          ? <ChevronDown className="w-3.5 h-3.5" />
                          : <ChevronUp className="w-3.5 h-3.5" />
                        : <ChevronDown className="w-3.5 h-3.5 opacity-30 group-hover:opacity-60" />
                      }
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSortToggle("lastExportedAt")}
                      className="flex items-center gap-1 hover:text-foreground transition-colors group"
                    >
                      Last Export
                      {sortKey === "lastExportedAt"
                        ? sortDir === "desc"
                          ? <ChevronDown className="w-3.5 h-3.5" />
                          : <ChevronUp className="w-3.5 h-3.5" />
                        : <ChevronDown className="w-3.5 h-3.5 opacity-30 group-hover:opacity-60" />
                      }
                    </button>
                  </TableHead>
                  <TableHead>Last Alert</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : !rows.length ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-14">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <ClipboardCheck className="w-8 h-8 opacity-30" />
                        <p className="text-sm">No merchants match this filter</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : !filteredRows.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-14">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Search className="w-8 h-8 opacity-30" />
                        <p className="text-sm">No merchants match your search</p>
                        <p className="text-xs opacity-70">Try a different name or email</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredRows.map((row: any) => {
                  const isNever = row.status === "never";
                  const isChecked = selected.has(row.merchantId);
                  return (
                    <TableRow key={row.merchantId} className={isChecked ? "bg-amber-500/5" : row.isInactive ? "bg-rose-500/5" : undefined}>
                      <TableCell className="pl-4">
                        {isNever && (
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleRow(row.merchantId)}
                            aria-label={`Select ${row.businessName}`}
                            className="border-border/60"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="text-sm font-medium">{row.businessName}</p>
                            <p className="text-xs text-muted-foreground font-mono">ID #{row.merchantId}</p>
                          </div>
                          {row.isInactive && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link
                                    href={`/admin/merchants?open=${row.merchantId}`}
                                    className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 hover:border-rose-500/50 transition-colors cursor-pointer"
                                  >
                                    <Clock className="w-2.5 h-2.5" />
                                    Dormant 90d+
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  No login in the last 90 days — click to view merchant profile
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.email}</TableCell>
                      <TableCell>
                        {row.status === "exported" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-teal-500/20 bg-teal-500/10 px-2 py-0.5 text-xs font-medium text-teal-400">
                            <CheckCircle2 className="w-3 h-3" />
                            Reviewed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                            <AlertTriangle className="w-3 h-3" />
                            Never reviewed
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.lastLoginAt ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`cursor-default ${row.isInactive ? "text-rose-400" : ""}`}>
                                  {formatDistanceToNow(new Date(row.lastLoginAt), { addSuffix: true })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {format(new Date(row.lastLoginAt), "MMM d, yyyy HH:mm:ss")}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-rose-400/70 italic">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.lastExportedAt ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-default">
                                  {formatDistanceToNow(new Date(row.lastExportedAt), { addSuffix: true })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                {format(new Date(row.lastExportedAt), "MMM d, yyyy HH:mm:ss")}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-muted-foreground/50 italic">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.lastDormantAlertAt ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 text-rose-400/80 cursor-default">
                                  <BellRing className="w-3 h-3 shrink-0" />
                                  {formatDistanceToNow(new Date(row.lastDormantAlertAt), { addSuffix: true })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                Dormant alert last sent {format(new Date(row.lastDormantAlertAt), "MMM d, yyyy HH:mm:ss")}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-muted-foreground/50 italic">—</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-3">
                        {isNever && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10"
                                  onClick={() => handleRemind([row.merchantId])}
                                  disabled={remind.isPending}
                                >
                                  {remind.isPending
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <BellRing className="w-3.5 h-3.5" />
                                  }
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Send reminder email</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
        {rows.length > 0 && (
          <div className="px-6 py-3 border-t border-border/40 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {searchQuery.trim()
                ? `${filteredRows.length} of ${rows.length} merchant${rows.length !== 1 ? "s" : ""} match your search`
                : <>Showing {rows.length} of {totalMerchants} merchant{totalMerchants !== 1 ? "s" : ""}{statusFilter !== "all" && ` (filtered: ${filterLabel()})`}</>
              }
            </p>
            {someSelected && (
              <p className="text-xs text-amber-400">
                {selectedNeverIds.length} selected
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

const SETTING_KEY_OPTIONS: { value: string; label: string }[] = [
  { value: "finance_report_email",   label: "Finance Report Email" },
  { value: "reconciliation_schedule", label: "Reconciliation Schedule" },
];

const SYSTEM_CONFIG_SECTION_OPTIONS: { value: string; label: string }[] = [
  { value: "reconciliation",          label: "Reconciliation" },
  { value: "qr_cleanup",              label: "QR Cleanup" },
  { value: "signature_failure_alert", label: "Signature Failure Alert" },
];

const VALID_TABS = ["admin-actions", "security-events", "compliance"] as const;
type AuditTab = typeof VALID_TABS[number];

function getTabFromUrl(): AuditTab {
  const fromSearch = new URLSearchParams(window.location.search).get("tab");
  if (VALID_TABS.includes(fromSearch as AuditTab)) return fromSearch as AuditTab;
  const hash = window.location.hash.replace(/^#/, "");
  if (VALID_TABS.includes(hash as AuditTab)) return hash as AuditTab;
  return "admin-actions";
}

export default function AdminAuditLogs() {
  const urlSearch = useSearch();
  const [activeTab, setActiveTab] = useState<AuditTab>(getTabFromUrl);

  useEffect(() => {
    setActiveTab(getTabFromUrl());
  }, [urlSearch]);

  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const [targetType, setTargetType] = useState("all");
  const [performedBy, setPerformedBy] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [merchantIdInput, setMerchantIdInput] = useState("");
  const [merchantId, setMerchantId] = useState<number | undefined>(undefined);
  const [actorEmailInput, setActorEmailInput] = useState("");
  const [settingKey, setSettingKey] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastExportCount, setLastExportCount] = useState<number | null>(null);

  const showSettingKeyFilter = action === "setting_updated" || action === "system_config_updated";
  const settingKeyOptions = action === "setting_updated" ? SETTING_KEY_OPTIONS : SYSTEM_CONFIG_SECTION_OPTIONS;
  const settingKeyLabel = action === "setting_updated" ? "Setting Key" : "Config Section";

  function handleActionChange(v: string) {
    setAction(v);
    setSettingKey("all");
    setPage(1);
  }

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
      if (actorEmailInput.trim()) params.set("actorEmail", actorEmailInput.trim());
      if (showSettingKeyFilter && settingKey !== "all") params.set("settingKey", settingKey);
      if (performedBy && performedBy !== "all") params.set("performedBy", performedBy);

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
  const hasActorEmail = actorEmailInput.trim() !== "";
  const hasSettingKey = showSettingKeyFilter && settingKey !== "all";
  const hasPerformedBy = performedBy !== "all";

  function resetFilters() {
    setSearch("");
    setAction("all");
    setTargetType("all");
    setPerformedBy("all");
    setDateFrom("");
    setDateTo("");
    setMerchantIdInput("");
    setMerchantId(undefined);
    setActorEmailInput("");
    setSettingKey("all");
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
    performedBy: performedBy === "all" ? undefined : (performedBy as "system" | "admin"),
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    merchantId,
    actorEmail: actorEmailInput.trim() || undefined,
    settingKey: hasSettingKey ? settingKey : undefined,
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
          <p className="text-muted-foreground mt-1">Track all admin actions and security events</p>
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

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AuditTab)}>
        <TabsList className="mb-2">
          <TabsTrigger value="admin-actions" className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />
            Admin Actions
          </TabsTrigger>
          <TabsTrigger value="security-events" className="flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" />
            Security Events
          </TabsTrigger>
          <TabsTrigger value="compliance" className="flex items-center gap-1.5">
            <ClipboardCheck className="w-3.5 h-3.5" />
            Compliance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="admin-actions" className="space-y-6 mt-0">
          <ScheduledReportsPanel />
          <GlobalDeliveryHistoryPanel />

          <Card>
            <CardHeader className="pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by admin or action..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                />
              </div>
              <Select value={action} onValueChange={handleActionChange}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Action type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {ALL_ACTIONS.map(a => (
                    <SelectItem key={a} value={a}>{ACTION_LABELS[a].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showSettingKeyFilter && (
                <Select value={settingKey} onValueChange={v => { setSettingKey(v); setPage(1); }}>
                  <SelectTrigger className="w-[220px]"><SelectValue placeholder={settingKeyLabel} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All {settingKeyLabel}s</SelectItem>
                    {settingKeyOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={targetType} onValueChange={v => { setTargetType(v); setPage(1); }}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Target type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Target Types</SelectItem>
                  {TARGET_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={performedBy} onValueChange={v => { setPerformedBy(v); setPage(1); }}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Performed by" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any Actor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
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
              <div className="relative shrink-0">
                <AtSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-8 pr-7 text-sm h-9 w-44"
                  placeholder="Actor email"
                  value={actorEmailInput}
                  onChange={e => { setActorEmailInput(e.target.value); setPage(1); }}
                  aria-label="Filter by actor email"
                />
                {actorEmailInput && (
                  <button
                    onClick={() => { setActorEmailInput(""); setPage(1); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear actor email filter"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(hasDateFilter || search !== "" || action !== "all" || hasTargetType || hasMerchantId || hasPerformedBy || hasActorEmail) && (
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

        {(hasTargetType || hasDateFilter || hasMerchantId || hasSettingKey || hasPerformedBy || hasActorEmail) && (
          <div className="flex items-center gap-2 px-6 py-2 border-t border-border/40 bg-muted/10 flex-wrap">
            {hasPerformedBy && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-0.5 text-xs font-medium text-teal-400">
                <Bot className="w-3 h-3" />
                {performedBy === "system" ? "System only" : "Admin only"}
                <button
                  onClick={() => { setPerformedBy("all"); setPage(1); }}
                  className="ml-0.5 hover:text-teal-300 transition-colors"
                  aria-label="Clear performed-by filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {hasActorEmail && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-0.5 text-xs font-medium text-sky-400">
                <AtSign className="w-3 h-3" />
                Actor: {actorEmailInput.trim()}
                <button
                  onClick={() => { setActorEmailInput(""); setPage(1); }}
                  className="ml-0.5 hover:text-sky-300 transition-colors"
                  aria-label="Clear actor email filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
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
            {hasSettingKey && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-0.5 text-xs font-medium text-amber-400">
                <Settings className="w-3 h-3" />
                {settingKeyLabel}: {settingKeyOptions.find(o => o.value === settingKey)?.label ?? settingKey}
                <button
                  onClick={() => { setSettingKey("all"); setPage(1); }}
                  className="ml-0.5 hover:text-amber-300 transition-colors"
                  aria-label={`Clear ${settingKeyLabel} filter`}
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
          <div className="overflow-x-auto">
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
                    {log.adminEmail === "system" || log.adminId === 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-slate-400">
                        <Bot className="w-3 h-3" />
                        System
                      </span>
                    ) : (
                      <div>
                        <p className="text-sm font-medium">{log.adminEmail}</p>
                        <p className="text-xs text-muted-foreground">ID #{log.adminId}</p>
                      </div>
                    )}
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
          </div>
        </CardContent>
      </Card>

          {total > 20 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{total} total events</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <span className="text-sm text-muted-foreground px-1">Page {page} of {Math.ceil(total / 20)}</span>
                <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>Next</Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="security-events" className="mt-0">
          <SecurityEventsPanel />
        </TabsContent>

        <TabsContent value="compliance" className="mt-0">
          <CompliancePanel />
        </TabsContent>
      </Tabs>

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
                  <p className="text-xs text-muted-foreground mb-1">Performed by</p>
                  {selected.adminEmail === "system" || selected.adminId === 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-slate-400">
                      <Bot className="w-3 h-3" />
                      System
                    </span>
                  ) : (
                    <p className="text-sm">{selected.adminEmail}</p>
                  )}
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
