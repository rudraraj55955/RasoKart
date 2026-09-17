import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Activity, CheckCircle2, CircleAlert, CircleX, Clock3, Loader2, RefreshCw } from "lucide-react";
import { apiUrl } from "@/lib/api-url";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  deliveryEventsPath,
  displayableTimelineEvent,
  getDeliveryTimelineState,
  type DeliveryTimelineEvent,
} from "@/lib/email-delivery-timeline";

type DeliveryStatus = "accepted" | "delivered" | "bounced" | "failed";

interface DeliveryLog {
  id: number;
  purpose: string;
  provider: string;
  status: DeliveryStatus;
  providerMessageId: string | null;
  errorReason: string | null;
  createdAt: string;
  updatedAt: string;
  lastEventAt: string | null;
}

interface DeliveryResponse {
  logs: DeliveryLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface DeliveryEventsResponse {
  events: DeliveryTimelineEvent[];
}

const statusMeta: Record<DeliveryStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  accepted: { label: "Accepted", className: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: Activity },
  delivered: { label: "Delivered", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: CheckCircle2 },
  bounced: { label: "Bounced", className: "border-amber-500/30 bg-amber-500/10 text-amber-300", icon: CircleAlert },
  failed: { label: "Failed", className: "border-rose-500/30 bg-rose-500/10 text-rose-300", icon: CircleX },
};

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function CallbackTimeline({
  delivery,
  onClose,
}: {
  delivery: DeliveryLog | null;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<DeliveryTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!delivery) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setEvents([]);

    void fetch(apiUrl(deliveryEventsPath(delivery.id)), {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Unable to load callback timeline");
        return body as DeliveryEventsResponse;
      })
      .then((body) => setEvents(Array.isArray(body.events) ? body.events : []))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unable to load callback timeline");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [delivery, reloadKey]);

  const timelineState = getDeliveryTimelineState(loading, error, events);

  return (
    <Dialog open={delivery !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Provider callback timeline</DialogTitle>
          <DialogDescription>
            Sanitized provider events for delivery record #{delivery?.id}. Recipient and message content are not included.
          </DialogDescription>
        </DialogHeader>

        {timelineState.kind === "loading" ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading callback timeline…
          </div>
        ) : timelineState.kind === "error" ? (
          <div className="space-y-3 py-8 text-center">
            <p className="text-sm text-rose-300">{timelineState.message}</p>
            <Button variant="outline" size="sm" onClick={() => setReloadKey((value) => value + 1)}>
              <RefreshCw className="mr-2 h-4 w-4" /> Try again
            </Button>
          </div>
        ) : timelineState.kind === "empty" ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No provider callbacks have been received for this delivery.
          </div>
        ) : (
          <ol className="space-y-4">
            {timelineState.events.map((rawEvent) => {
              const event = displayableTimelineEvent(rawEvent);
              const meta = statusMeta[event.status] ?? statusMeta.failed;
              const StatusIcon = meta.icon;
              return (
                <li key={rawEvent.id} className="relative rounded-lg border border-border/60 bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                      <StatusIcon className="h-3 w-3" /> {meta.label}
                    </Badge>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      {format(new Date(event.receivedAt), "MMM d, yyyy HH:mm:ss")}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[140px_1fr]">
                    <dt className="text-muted-foreground">Provider</dt>
                    <dd className="break-all">{event.provider}</dd>
                    <dt className="text-muted-foreground">Provider message ID</dt>
                    <dd className="break-all">{event.providerMessageId ?? "—"}</dd>
                    <dt className="text-muted-foreground">Provider event ID</dt>
                    <dd className="break-all">{event.providerEventId ?? "—"}</dd>
                    {event.failureSummary && (
                      <>
                        <dt className="text-muted-foreground">Failure summary</dt>
                        <dd className="break-words text-rose-300">{event.failureSummary}</dd>
                      </>
                    )}
                  </dl>
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminEmailDelivery() {
  const [status, setStatus] = useState<"all" | DeliveryStatus>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DeliveryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryLog | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (status !== "all") params.set("status", status);
      const response = await fetch(apiUrl(`/api/admin/email-delivery?${params}`), { headers: authHeaders() });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Unable to load email delivery status");
      setData(body as DeliveryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load email delivery status");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Activity className="h-5 w-5 text-indigo-400" />
            Password Reset Email Delivery
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Provider acceptance and downstream delivery events for password reset emails. Reset codes and message bodies are never shown.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={status} onValueChange={(value) => { setStatus(value as typeof status); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="bounced">Bounced</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{data?.total ?? 0} reset emails</span>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Delivery history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-rose-300">{error}</div>
          ) : loading && !data ? (
            <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading delivery history…
            </div>
          ) : data?.logs.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Last provider event</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">Timeline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.logs.map((log) => {
                  const meta = statusMeta[log.status] ?? statusMeta.failed;
                  const StatusIcon = meta.icon;
                  return (
                    <TableRow key={log.id}>
                      <TableCell>
                        <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                          <StatusIcon className="h-3 w-3" /> {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{log.provider}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {format(new Date(log.createdAt), "MMM d, yyyy HH:mm")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {log.lastEventAt ? format(new Date(log.lastEventAt), "MMM d, yyyy HH:mm") : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {log.errorReason ?? (log.providerMessageId ? `Provider message ${log.providerMessageId}` : "No additional details")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => setSelectedDelivery(log)}>
                          View timeline
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">No password reset email records yet.</div>
          )}
        </CardContent>
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {data.page} of {data.totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</Button>
          </div>
        </div>
      )}

      <CallbackTimeline delivery={selectedDelivery} onClose={() => setSelectedDelivery(null)} />
    </div>
  );
}