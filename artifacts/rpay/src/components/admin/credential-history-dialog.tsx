import { useState, type ReactNode } from "react";
import { useListAdminAuditLogs } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

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
};

function formatValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function formatDate(ts: string) {
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function ChangeSummary({ details }: { details: string | null | undefined }) {
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
  const changed: { label: string; value: unknown }[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (key === "section") continue;
    if (key in ROTATED_FIELD_LABELS) {
      if (value === true) rotated.push(ROTATED_FIELD_LABELS[key]!);
      continue;
    }
    changed.push({ label: SETTING_LABELS[key] ?? key, value });
  }

  if (rotated.length === 0 && changed.length === 0) {
    return <span className="text-muted-foreground text-xs">No changes recorded</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {rotated.map((label) => (
        <Badge key={label} variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10 text-[11px] font-normal">
          {label} rotated
        </Badge>
      ))}
      {changed.map(({ label, value }) => (
        <Badge key={label} variant="outline" className="text-muted-foreground text-[11px] font-normal">
          {label}: {formatValue(value)}
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
 */
export function CredentialHistoryDialog({
  section, label, trigger,
}: {
  section: string;
  label: string;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListAdminAuditLogs(
    { action: "system_config_updated", settingKey: section, page, limit: LIMIT },
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
          <DialogTitle className="flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            {label} — Change History
          </DialogTitle>
          <DialogDescription>
            Every credential and configuration change ever made to this gateway, most recent first.
          </DialogDescription>
        </DialogHeader>

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
