export const EVENT_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "payment.success":      { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25" },
  "payment.failed":       { bg: "bg-rose-500/10",    text: "text-rose-400",    border: "border-rose-500/25"    },
  "payment.pending":      { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/25"   },
  "payment.received":     { bg: "bg-sky-500/10",     text: "text-sky-400",     border: "border-sky-500/25"     },
  "withdrawal.approved":  { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25" },
  "withdrawal.rejected":  { bg: "bg-rose-500/10",    text: "text-rose-400",    border: "border-rose-500/25"    },
  "settlement.processed": { bg: "bg-violet-500/10",  text: "text-violet-400",  border: "border-violet-500/25"  },
};

export function EventTypeBadge({ eventType, size = "sm" }: { eventType: string | null | undefined; size?: "sm" | "md" }) {
  if (!eventType) return null;
  const colors = EVENT_TYPE_COLORS[eventType] ?? { bg: "bg-muted/40", text: "text-muted-foreground", border: "border-border/50" };
  const cls = size === "md"
    ? `inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono font-semibold ${colors.bg} ${colors.text} ${colors.border}`
    : `inline-flex items-center rounded border px-1.5 py-px text-[10px] font-mono font-semibold ${colors.bg} ${colors.text} ${colors.border}`;
  return <span className={cls}>{eventType}</span>;
}
