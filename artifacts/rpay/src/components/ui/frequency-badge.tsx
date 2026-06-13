import { Badge } from "@/components/ui/badge";

interface FrequencyBadgeProps {
  frequency?: string | null;
}

export function FrequencyBadge({ frequency }: FrequencyBadgeProps) {
  if (!frequency) {
    return <span className="text-xs text-muted-foreground/60">—</span>;
  }
  if (frequency === "daily") {
    return (
      <Badge className="text-xs capitalize bg-violet-600/20 text-violet-400 border border-violet-600/30 hover:bg-violet-600/20">
        Daily
      </Badge>
    );
  }
  if (frequency === "weekly") {
    return (
      <Badge className="text-xs capitalize bg-amber-600/20 text-amber-400 border border-amber-600/30 hover:bg-amber-600/20">
        Weekly
      </Badge>
    );
  }
  if (frequency === "monthly") {
    return (
      <Badge className="text-xs capitalize bg-sky-600/20 text-sky-400 border border-sky-600/30 hover:bg-sky-600/20">
        Monthly
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs capitalize">
      {frequency}
    </Badge>
  );
}
