import { useState, type ReactNode } from "react";
import { useListAdminAuditLogs } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { History, ChevronLeft, ChevronRight, Loader2, Download, X } from "lucide-react";

const LIMIT = 10;

// Boolean "*Updated" flags recorded when a secret/credential value is rotated —
// we never log the actual value, only that it changed.
const ROTATED_FIELD_LABELS: Record<string, string> = {
  clientIdUpdated: "Client ID",
  clientSecretUpdated: "Client Secret",
  webhookSecretUpdated: "Webhook Secret",
  apiKeyUpdated: "API Key",
  fundsourceIdUpdated: "Fundsource ID",
};

// Remaining non-secret settings that can change alongside credentials.
const SETTING_LABELS: Record<string, string> = {
  enabled: "Enabled",
  env: "Environment",
  baseUrl: "Base URL",
  apiVersion: "API Version",
  upiEnabled: "UPI",
  qrEnabled: "QR Codes",
  paymentLinksEnabled: "Payment Links",
  merchantPayinEnabled: "Merchant Payin",
  merchantEnabled: "Merchant Access",
  adminApprovalRequired: "Admin Approval Required",
  bulkEnabled: "Bulk Payouts",
  // Cashfree payin limit fields
  minAmount: "Min Amount (₹)",
  maxAmount: "Max Amount (₹)",
  // Cashfree payout limit fields
  minLimit: "Min Limit (₹)",
  maxLimit: "Max Limit (₹)",
  // Shared limit field (dailyLimit applies to both payin and payout)
  dailyLimit: "Daily Limit (₹)",
  // Provider integration fields
  isEnabled: "Enabled",
  environment: "Environment",
  displayNamePublic: "Display Name",
  productType: "Product Type",
  webhookUrl: "Webhook URL",
  notes: "Notes",
};

// Keys to skip when rendering provider_integration_updated details.
const SKIP_KEYS = new Set(["providerKey", "updatedByEmail", "section", "key"]);

function formatValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function isFromTo(v: unknown): v is { from: unknown; to: unknown } {
  return typeof v === "object" && v !== null && "from" in v && "to" in v;
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function ChangeSummary({ details }: { details: string | null | undefined }) {
  if (!details) {
    return <span className="text-muted-foreground text-xs">No details recorded</span>;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(details) as Record<string, unknown>;
  } catch {
    return <span className="text-muted-foreground text-xs">{details}</span>;
  }

  const rotated: string[] = [];
  const changed: { label: string; from?: unknown; to?: unknown; value?: unknown; hasDiff: boolean; unchanged: boolean }[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (SKIP_KEYS.has(key)) continue;

    // Boolean "*Updated" flags (built-in gateways)
    if (key in ROTATED_FIELD_LABELS) {
      if (value === true) rotated.push(ROTATED_FIELD_LABELS[key]!);
      continue;
    }

    // "*Encrypted" fields from provider_integration_updated (value is "[redacted]")
    if (key.endsWith("Encrypted") && value === "[redacted]") {
      const baseName = key.replace(/Encrypted$/, "");
      const labelMap: Record<string, string> = {
        apiKey: "API Key",
        apiSecret: "API Secret",
        webhookSecret: "Webhook Secret",
      };
      rotated.push(labelMap[baseName] ?? baseName);
      continue;
    }

    const label = SETTING_LABELS[key] ?? key;
    if (isFromTo(value)) {
      const fromStr = formatValue(value.from);
      const toStr = formatValue(value.to);
      const unchanged = fromStr === toStr;
      changed.push({ label, from: value.from, to: value.to, hasDiff: true, unchanged });
    } else {
      changed.push({ label, value, hasDiff: false, unchanged: false });
    }
  }

  if (rotated.length === 0 && changed.length === 0) {
    return <span className="text-muted-foreground text-xs">No changes recorded</span>;
  }

  const diffItems = changed.filter((i) => i.hasDiff);
  const noRealChanges =
    rotated.length === 0 && diffItems.length > 0 && diffItems.every((i) => i.unchanged);

  if (noRealChanges) {
    return (
      <span className="text-muted-foreground/50 text-xs italic">Saved with no changes</span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {rotated.map((label) => (
        <Badge key={label} variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10 text-[11px] font-normal">
          {label} rotated
        </Badge>
      ))}
      {changed.map((item) => (
        <Badge
          key={item.label}
          variant="outline"
          className={
            item.unchanged
              ? "text-muted-foreground/40 border-border/30 text-[11px] font-normal italic"
              : "text-muted-foreground text-[11px] font-normal"
          }
          title={item.unchanged ? "Value was saved without any change" : undefined}
        >
          {item.hasDiff
            ? <>
                {item.label}:{" "}
                <span className={item.unchanged ? "text-muted-foreground/40" : "text-red-400/80"}>{formatValue(item.from)}</span>
                {" → "}
                <span className={item.unchanged ? "text-muted-foreground/40" : "text-emerald-400/90"}>{formatValue(item.to)}</span>
              </>
            : <>{item.label}: {formatValue(item.value)}</>
          }
        </Badge>
      ))}
    </div>
  );
}

/**
 * Shows the full change history for a gateway's credential/config section,
 * sourced from the existing audit_logs trail (action=system_config_updated,
 * filtered by section) — not just the single latest editor shown inline on
 * the config panel.
 *
 * For custom provider integrations, pass action="provider_integration_updated"
 * and section=providerKey.
 */
async function downloadGatewayHistoryCsv(
  action: string,
  section: string,
  label: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const paramObj: Record<string, string> = { action, settingKey: section };
  if (dateFrom) paramObj["dateFrom"] = dateFrom;
  if (dateTo)   paramObj["dateTo"]   = dateTo;
  const params = new URLSearchParams(paramObj);
  const res = await fetch(`/api/audit-logs/export?${params.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Export failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = label.toLowerCase().replace(/\s+/g, "-");
  const today = new Date().toISOString().slice(0, 10);
  const from = dateFrom ? new Date(dateFrom).toISOString().slice(0, 10) : null;
  const to   = dateTo   ? new Date(dateTo).toISOString().slice(0, 10)   : null;
  a.download = (from || to)
    ? `gateway-history-${slug}-${from ?? "start"}-to-${to ?? today}.csv`
    : `gateway-history-${slug}-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function CredentialHistoryDialog({
  section, label, trigger, action = "system_config_updated", dateFrom, dateTo,
}: {
  section: string;
  label: string;
  trigger?: ReactNode;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [fromDate, setFromDate] = useState(dateFrom ?? "");
  const [toDate, setToDate] = useState(dateTo ?? "");

  const effectiveFrom = fromDate || undefined;
  const effectiveTo = toDate || undefined;
  const hasDateFilter = Boolean(effectiveFrom || effectiveTo);

  const queryParams: Record<string, unknown> = { action, settingKey: section, page, limit: LIMIT };
  if (effectiveFrom) queryParams["dateFrom"] = effectiveFrom;
  if (effectiveTo)   queryParams["dateTo"]   = effectiveTo;

  const { data, isLoading } = useListAdminAuditLogs(
    queryParams as any,
    {
      query: { enabled: open },
      request: { headers: { Authorization: `Bearer ${getToken()}` } },
    } as any,
  );

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setPage(1);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
            <History className="w-3.5 h-3.5 mr-1.5" />
            View history
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" />
                {label} — Change History
              </DialogTitle>
              <DialogDescription className="mt-1">
                Every credential and configuration change ever made to this gateway, most recent first.
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 shrink-0 text-xs"
              disabled={isExporting}
              onClick={async () => {
                setIsExporting(true);
                try {
                  await downloadGatewayHistoryCsv(action, section, label, effectiveFrom, effectiveTo);
                } finally {
                  setIsExporting(false);
                }
              }}
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5 mr-1.5" />
              )}
              {isExporting ? "Exporting…" : "Download CSV"}
            </Button>
          </div>
        </DialogHeader>

        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <Label htmlFor="gateway-history-from" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="gateway-history-from"
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className="h-8 w-[150px] text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gateway-history-to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="gateway-history-to"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className="h-8 w-[150px] text-xs"
            />
          </div>
          {hasDateFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setPage(1);
              }}
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Loading history…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No changes have been recorded for this gateway yet.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.id} className="rounded-lg border border-border/50 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{row.adminEmail}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatDate(row.createdAt)}</span>
                </div>
                <ChangeSummary details={row.details} />
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages} · {total} {total === 1 ? "change" : "changes"}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
