import { History, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import type { AdminAuditLog } from "@workspace/api-client-react";

type FilterType = "all" | "success" | "failed";

interface TestEmailHistoryPanelProps {
  data: AdminAuditLog[];
  isLoading: boolean;
  title?: string;
  filter: FilterType;
  onFilterChange: (f: FilterType) => void;
  total?: number;
  onLoadMore?: () => void;
  successCount?: number;
  failedCount?: number;
  onRetry?: (recipient: string) => void;
  retrying?: boolean;
}

export function TestEmailHistoryPanel({
  data,
  isLoading,
  title = "Test email history",
  filter,
  onFilterChange,
  total,
  onLoadMore,
  successCount,
  failedCount,
  onRetry,
  retrying,
}: TestEmailHistoryPanelProps) {
  return (
    <div className="border-t border-border/50 pt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{title}</p>
        </div>
        <div className="flex items-center gap-1">
          {(["all", "success", "failed"] as const).map(f => {
            const badge =
              f === "success" ? successCount
              : f === "failed" ? failedCount
              : null;
            return (
              <button
                key={f}
                type="button"
                onClick={() => onFilterChange(f)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors flex items-center gap-1 ${
                  filter === f
                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                {badge != null && badge > 0 && (
                  <span
                    className={`inline-flex items-center justify-center rounded-full px-1 min-w-[1rem] h-4 text-[10px] font-semibold leading-none ${
                      f === "failed"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-emerald-500/20 text-emerald-400"
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {isLoading && (
        <p className="text-xs text-muted-foreground">Loading history…</p>
      )}

      {!isLoading && (() => {
        if (data.length === 0) {
          return (
            <p className="text-xs text-muted-foreground italic">
              {filter === "all"
                ? "No test emails have been sent yet."
                : `No ${filter} entries found.`}
            </p>
          );
        }

        const remaining = total != null ? total - data.length : 0;

        return (
          <div className="space-y-1.5">
            {data.map((row: AdminAuditLog) => {
              let details: { recipients?: string[]; success?: boolean; error?: string } = {};
              try { details = JSON.parse(row.details ?? "{}"); } catch {}
              const success = details.success === true;
              const recipients = details.recipients ?? [];
              const recipientLabel =
                recipients.length > 0 ? recipients.join(", ") : "unknown recipient";
              const errorLabel = details.error
                ? details.error.replace(/_/g, " ")
                : null;
              const retryRecipient =
                !success && recipients.length > 0 ? recipients[0]! : null;

              return (
                <div
                  key={row.id}
                  className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-xs ${
                    success
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-red-500/20 bg-red-500/5"
                  }`}
                >
                  {success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-400" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate ${success ? "text-emerald-400" : "text-red-400"}`}>
                      {recipientLabel}
                    </p>
                    {!success && errorLabel && (
                      <p className="text-muted-foreground mt-0.5">{errorLabel}</p>
                    )}
                  </div>
                  {retryRecipient && onRetry && (
                    <button
                      type="button"
                      disabled={retrying}
                      onClick={() => onRetry(retryRecipient)}
                      title={`Retry — send to ${retryRecipient}`}
                      className="shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Retry
                    </button>
                  )}
                  <time
                    dateTime={row.createdAt}
                    className="shrink-0 text-muted-foreground tabular-nums"
                    title={new Date(row.createdAt).toLocaleString()}
                  >
                    {new Date(row.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              );
            })}
            {remaining > 0 && onLoadMore && (
              <button
                type="button"
                onClick={onLoadMore}
                className="w-full rounded-md border border-border/50 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
              >
                Load more ({remaining} remaining)
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}
