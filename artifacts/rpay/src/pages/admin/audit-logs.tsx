import { useState } from "react";
import { useListAdminAuditLogs } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Shield, Search, Eye, Activity } from "lucide-react";
import { format } from "date-fns";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  merchant_approved:  { label: "Merchant Approved",  color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  merchant_rejected:  { label: "Merchant Rejected",  color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  plan_assigned:      { label: "Plan Assigned",       color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  plan_created:       { label: "Plan Created",        color: "bg-primary/10 text-primary border-primary/20" },
  plan_updated:       { label: "Plan Updated",        color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  plan_deleted:       { label: "Plan Deleted",        color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  user_created:       { label: "User Created",        color: "bg-primary/10 text-primary border-primary/20" },
  user_role_changed:  { label: "Role Changed",        color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  csv_export:         { label: "CSV Export",          color: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
};

const ALL_ACTIONS = Object.keys(ACTION_LABELS);

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
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any | null>(null);

  const { data, isLoading } = useListAdminAuditLogs({
    action: action === "all" ? undefined : action,
    search: search || undefined,
    page,
    limit: 20,
  } as any);

  const logs = data?.data ?? [];
  const total = data?.total ?? 0;

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

      <Card>
        <CardHeader className="pb-4">
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
              {selected.details && (
                <div className="rounded-lg bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground mb-2">Details</p>
                  <pre className="text-xs font-mono overflow-auto max-h-48">
                    {(() => { try { return JSON.stringify(JSON.parse(selected.details), null, 2); } catch { return selected.details; } })()}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
