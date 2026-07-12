import { useState } from "react";
import { format } from "date-fns";
import { useListRazorpayWebhookLogs } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Activity } from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

function resultColor(result?: string) {
  if (!result) return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  if (result === "credited") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  if (result === "already_credited" || result === "already_processed") return "bg-sky-500/10 text-sky-400 border-sky-500/30";
  if (result === "ignored") return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
  if (result.startsWith("error") || result === "failed") return "bg-rose-500/10 text-rose-400 border-rose-500/30";
  if (result === "sig_invalid") return "bg-amber-500/10 text-amber-400 border-amber-500/30";
  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/30";
}

export default function AdminRazorpayWebhookLogs() {
  const [result, setResult] = useState("all");
  const [eventType, setEventType] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useListRazorpayWebhookLogs(
    {
      page,
      limit: 20,
      ...(result !== "all" ? { result } : {}),
      ...(eventType !== "all" ? { eventType } : {}),
    },
    { request: { headers: authHeader() } },
  );

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-400" />
          Razorpay Webhook Logs
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Incoming webhook events — super admin only · no raw payloads stored</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={result} onValueChange={v => { setResult(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="All results" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All results</SelectItem>
            <SelectItem value="credited">Credited</SelectItem>
            <SelectItem value="already_credited">Already credited</SelectItem>
            <SelectItem value="ignored">Ignored</SelectItem>
            <SelectItem value="sig_invalid">Sig invalid</SelectItem>
            <SelectItem value="error_order_not_found">Error: order not found</SelectItem>
            <SelectItem value="error_db">Error: DB</SelectItem>
          </SelectContent>
        </Select>
        <Select value={eventType} onValueChange={v => { setEventType(v); setPage(1); }}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="All event types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            <SelectItem value="payment.captured">payment.captured</SelectItem>
            <SelectItem value="payment.failed">payment.failed</SelectItem>
            <SelectItem value="order.paid">order.paid</SelectItem>
            <SelectItem value="refund.created">refund.created</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {isLoading ? "Loading…" : `${total.toLocaleString()} event${total !== 1 ? "s" : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="py-12 text-center text-sm text-destructive">Failed to load webhook logs</div>
          ) : !rows.length ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No webhook events found</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Event ID</TableHead>
                    <TableHead className="text-xs">Event Type</TableHead>
                    <TableHead className="text-xs">Merchant</TableHead>
                    <TableHead className="text-xs">Razorpay Order</TableHead>
                    <TableHead className="text-xs">Razorpay Payment</TableHead>
                    <TableHead className="text-xs">Amount</TableHead>
                    <TableHead className="text-xs">Result</TableHead>
                    <TableHead className="text-xs">Safe Message</TableHead>
                    <TableHead className="text-xs">Received At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs max-w-[120px] truncate" title={row.webhookEventId ?? ""}>
                        {row.webhookEventId ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{row.eventType ?? "—"}</TableCell>
                      <TableCell className="text-xs">{row.merchantId ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[130px] truncate" title={row.razorpayOrderId ?? ""}>
                        {row.razorpayOrderId ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[130px] truncate" title={row.razorpayPaymentId ?? ""}>
                        {row.razorpayPaymentId ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {row.amount != null ? `₹${Number(row.amount).toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] h-5 ${resultColor(row.processingResult)}`}>
                          {row.processingResult ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={row.safeMessage ?? ""}>
                        {row.safeMessage ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.receivedAt ? format(new Date(row.receivedAt), "MMM d, yyyy HH:mm:ss") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} total</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
