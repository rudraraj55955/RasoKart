import { Badge } from "./badge";

export type StatusType = 
  | "pending" 
  | "success" 
  | "failed" 
  | "approved" 
  | "rejected" 
  | "processed"
  | "all";

interface StatusBadgeProps {
  status: StatusType | string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase();

  switch (normalizedStatus) {
    case "success":
    case "approved":
    case "processed":
      return <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20">{status}</Badge>;
    case "pending":
      return <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">{status}</Badge>;
    case "failed":
    case "rejected":
      return <Badge className="bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border-rose-500/20">{status}</Badge>;
    default:
      return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
  }
}
