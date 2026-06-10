import { useState } from "react";
import { useListCallbackLogs } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

function CallbackRow({ log }: { log: any }) {
  const [open, setOpen] = useState(false);
  const isPendingRetry = log.status === "pending_retry";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <TableRow className="cursor-pointer" onClick={() => setOpen(!open)}>
        <TableCell>{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</TableCell>
        <TableCell className="max-w-[200px] truncate text-sm font-mono">{log.url}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={log.status} />
            {isPendingRetry && <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" style={{ animationDuration: "3s" }} />}
          </div>
        </TableCell>
        <TableCell><span className={`font-mono text-sm ${log.httpStatus === 200 ? "text-emerald-500" : "text-rose-500"}`}>{log.httpStatus || "—"}</span></TableCell>
        <TableCell className="text-center">{log.attempts}</TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {isPendingRetry && log.nextRetryAt ? (
            <span className="text-amber-400" title={format(new Date(log.nextRetryAt), "MMM d, HH:mm:ss")}>
              in {formatDistanceToNow(new Date(log.nextRetryAt))}
            </span>
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{format(new Date(log.createdAt), "MMM d, HH:mm")}</TableCell>
      </TableRow>
      <CollapsibleContent asChild>
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/20 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-2 pt-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Request Body</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap">{log.requestBody ? JSON.stringify(JSON.parse(log.requestBody), null, 2) : "—"}</pre>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Response Body</p>
                <pre className="text-xs bg-background/50 rounded p-3 overflow-x-auto border border-border/50 whitespace-pre-wrap">{log.responseBody ? (() => { try { return JSON.stringify(JSON.parse(log.responseBody), null, 2); } catch { return log.responseBody; } })() : "—"}</pre>
              </div>
              {log.lastAttemptAt && (
                <div className="md:col-span-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Last Attempt</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(log.lastAttemptAt), "MMM d, yyyy HH:mm:ss")}</p>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function AdminCallbacks() {
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useListCallbackLogs({ status: status as any, page, limit: 20 });

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-bold tracking-tight">Callback Logs</h1><p className="text-muted-foreground mt-1">Webhook delivery history with automatic retry</p></div>

      <Card>
        <CardHeader className="pb-4">
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="pending_retry">Pending Retry</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead className="text-center">Attempts</TableHead>
                <TableHead>Next Retry</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No callback logs found</TableCell></TableRow>
              ) : data?.data?.map(log => <CallbackRow key={log.id} log={log} />)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">{data.total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= data.total}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
