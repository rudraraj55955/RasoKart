/**
 * Admin PayU Orders — paginated view of all PayU payment orders.
 * CREDIT_FAILED orders are highlighted and shown in a dedicated tab
 * so admins can spot and reconcile them immediately.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, RefreshCw, CheckCircle, XCircle, Clock, Ban, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiUrl } from "@/lib/api-url";
import { getToken } from "@/lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PayuOrder {
  id: number;
  txnid: string;
  merchantId: number;
  amount: string;
  status: string;
  environment: string;
  mihpayid: string | null;
  bankRefNo: string | null;
  paymentMode: string | null;
  hashVerified: boolean;
  failureReason: string | null;
  creditFailedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface OrdersResponse {
  orders: PayuOrder[];
}

// ── Status display ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  INITIATED:     { label: "Initiated",     icon: Clock,          className: "bg-zinc-800 text-zinc-300 border-zinc-700" },
  SUCCESS:       { label: "Success",       icon: CheckCircle,    className: "bg-emerald-950 text-emerald-400 border-emerald-800" },
  FAILED:        { label: "Failed",        icon: XCircle,        className: "bg-red-950 text-red-400 border-red-800" },
  PENDING:       { label: "Pending",       icon: Clock,          className: "bg-yellow-950 text-yellow-400 border-yellow-800" },
  CANCELLED:     { label: "Cancelled",     icon: Ban,            className: "bg-zinc-900 text-zinc-400 border-zinc-700" },
  CREDIT_FAILED: { label: "Credit Failed", icon: AlertTriangle,  className: "bg-orange-950 text-orange-400 border-orange-700" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, icon: AlertCircle, className: "bg-zinc-800 text-zinc-300 border-zinc-700" };
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1.5 font-medium ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

function formatAmount(val: string | null): string {
  if (!val) return "—";
  const n = parseFloat(val);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(val: string | null): string {
  if (!val) return "—";
  try { return format(new Date(val), "dd MMM yyyy, HH:mm"); } catch { return val; }
}

// ── Fetch hook ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

function usePayuOrders(statusFilter: string | null, page: number) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
  if (statusFilter) params.set("status", statusFilter);

  return useQuery<OrdersResponse>({
    queryKey: ["admin", "payu-orders", statusFilter, page],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/admin/payu/orders?${params}`), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error("Failed to load orders");
      return res.json() as Promise<OrdersResponse>;
    },
    refetchInterval: 30_000,
  });
}

// ── Orders table ──────────────────────────────────────────────────────────────

function OrdersTable({ orders, isCreditFailedTab }: { orders: PayuOrder[]; isCreditFailedTab: boolean }) {
  if (orders.length === 0) {
    return (
      <div className="py-16 text-center text-zinc-500">
        {isCreditFailedTab
          ? "No credit-failed orders — all payments are healthy ✓"
          : "No orders found"}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Table>
        <TableHeader>
          <TableRow className="border-zinc-800 hover:bg-transparent">
            <TableHead className="text-zinc-400">Transaction ID</TableHead>
            <TableHead className="text-zinc-400">Merchant</TableHead>
            <TableHead className="text-zinc-400 text-right">Amount</TableHead>
            <TableHead className="text-zinc-400">Status</TableHead>
            <TableHead className="text-zinc-400">Env</TableHead>
            <TableHead className="text-zinc-400">PayU ID</TableHead>
            <TableHead className="text-zinc-400">Mode</TableHead>
            <TableHead className="text-zinc-400">{isCreditFailedTab ? "Failed At" : "Paid At"}</TableHead>
            <TableHead className="text-zinc-400">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map(order => {
            const isCreditFailed = order.status === "CREDIT_FAILED";
            return (
              <TableRow
                key={order.id}
                className={`border-zinc-800 ${
                  isCreditFailed
                    ? "bg-orange-950/20 hover:bg-orange-950/30 border-l-2 border-l-orange-600"
                    : "hover:bg-zinc-900/50"
                }`}
              >
                <TableCell className="font-mono text-xs text-zinc-300 max-w-[180px]">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-default truncate block">{order.txnid}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="font-mono text-xs">{order.txnid}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-zinc-300">#{order.merchantId}</TableCell>
                <TableCell className="text-right font-medium text-zinc-200">{formatAmount(order.amount)}</TableCell>
                <TableCell><StatusBadge status={order.status} /></TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-xs ${order.environment === "live" ? "bg-emerald-950 text-emerald-400 border-emerald-800" : "bg-zinc-800 text-zinc-400 border-zinc-700"}`}>
                    {order.environment}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-zinc-400">
                  {order.mihpayid ?? <span className="text-zinc-600">—</span>}
                </TableCell>
                <TableCell className="text-zinc-400 text-sm">
                  {order.paymentMode ?? <span className="text-zinc-600">—</span>}
                </TableCell>
                <TableCell className="text-zinc-400 text-sm">
                  {isCreditFailed
                    ? <span className="text-orange-400">{formatDate(order.creditFailedAt)}</span>
                    : formatDate(order.paidAt)}
                </TableCell>
                <TableCell className="text-zinc-500 text-sm">{formatDate(order.createdAt)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPayuOrders() {
  const [tab, setTab]   = useState<"all" | "credit_failed">("all");
  const [page, setPage] = useState(0);

  const statusFilter = tab === "credit_failed" ? "CREDIT_FAILED" : null;
  const { data, isLoading, isFetching, refetch, error } = usePayuOrders(statusFilter, page);

  const orders          = data?.orders ?? [];
  const hasNextPage     = orders.length === PAGE_SIZE;
  const hasPrevPage     = page > 0;

  function handleTabChange(value: string) {
    setTab(value as "all" | "credit_failed");
    setPage(0);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">PayU Orders</h1>
          <p className="text-sm text-zinc-500 mt-0.5">All PayU payment orders — CREDIT_FAILED orders require manual reconciliation</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Credit-failed banner */}
      {tab === "all" && orders.some(o => o.status === "CREDIT_FAILED") && (
        <Card className="border-orange-700 bg-orange-950/20">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-orange-400 shrink-0" />
            <p className="text-sm text-orange-300">
              <span className="font-semibold">Attention:</span> This page contains orders in{" "}
              <span className="font-mono font-semibold">CREDIT_FAILED</span> state. These payments
              were confirmed by PayU but the merchant wallet was NOT credited. Switch to the{" "}
              <button onClick={() => handleTabChange("credit_failed")} className="underline hover:text-orange-200">
                Credit Failed tab
              </button>{" "}
              to review them.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="bg-zinc-900 border border-zinc-800">
          <TabsTrigger value="all" className="data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-100 text-zinc-400">
            All Orders
          </TabsTrigger>
          <TabsTrigger
            value="credit_failed"
            className="data-[state=active]:bg-orange-950 data-[state=active]:text-orange-300 text-zinc-400 gap-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Credit Failed
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <Card className="border-zinc-800 bg-zinc-950">
            <CardContent className="p-0">
              {error ? (
                <div className="py-12 text-center text-red-400">Failed to load orders</div>
              ) : isLoading ? (
                <div className="py-12 text-center text-zinc-500">Loading…</div>
              ) : (
                <OrdersTable orders={orders} isCreditFailedTab={false} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credit_failed" className="mt-4">
          <Card className="border-orange-800/50 bg-zinc-950">
            <CardHeader className="pb-3 border-b border-zinc-800">
              <CardTitle className="text-base font-medium text-orange-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Orders Requiring Manual Reconciliation
              </CardTitle>
              <p className="text-sm text-zinc-500 mt-1">
                These payments were confirmed by PayU (hash verified) but the RasoKart wallet credit
                DB transaction failed. The merchant's customer was charged. Manually credit each wallet
                after verifying with PayU.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {error ? (
                <div className="py-12 text-center text-red-400">Failed to load orders</div>
              ) : isLoading ? (
                <div className="py-12 text-center text-zinc-500">Loading…</div>
              ) : (
                <OrdersTable orders={orders} isCreditFailedTab={true} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-sm text-zinc-500">
          Page {page + 1} · showing {orders.length} order{orders.length !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => p - 1)}
            disabled={!hasPrevPage || isFetching}
            className="gap-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => p + 1)}
            disabled={!hasNextPage || isFetching}
            className="gap-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
