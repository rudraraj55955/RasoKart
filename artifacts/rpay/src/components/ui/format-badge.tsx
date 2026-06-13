import { Badge } from "@/components/ui/badge";

interface FormatBadgeProps {
  format: string;
}

export function FormatBadge({ format }: FormatBadgeProps) {
  if (format === "xlsx") {
    return (
      <Badge className="text-xs uppercase bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/20">
        XLSX
      </Badge>
    );
  }
  if (format === "pdf") {
    return (
      <Badge className="text-xs uppercase bg-blue-600/20 text-blue-400 border border-blue-600/30 hover:bg-blue-600/20">
        PDF
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs uppercase">
      {format}
    </Badge>
  );
}
