import { useState } from "react";
import { useListPaymentLinks, useDeletePaymentLink, useUpdatePaymentLink } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Link2, Trash2, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type LinkRow = {
  id: number;
  merchantId: number;
  merchantName?: string | null;
  title: string;
  description?: string | null;
  amount?: string | null;
  currency: string;
  slug: string;
  url?: string;
  status: string;
  expiresAt?: string | null;
  createdAt: string;
};

function statusBadge(status: string) {
  if (status === "active") return <Badge className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20">Active</Badge>;
  if (status === "inactive") return <Badge className="text-xs bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/20">Inactive</Badge>;
  if (status === "expired") return <Badge className="text-xs bg-rose-500/15 text-rose-400 border-rose-500/20 hover:bg-rose-500/20">Expired</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`));
}

export default function AdminPaymentLinks() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [merchantName, setMerchantName] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("merchant") ?? "";
  });
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListPaymentLinks({ status: status as any, search, merchantName, page, limit: 20 });
  const deleteMutation = useDeletePaymentLink();
  const updateMutation = useUpdatePaymentLink();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/payment-links"] });

  const handleDelete = (id: number) => {
    if (!confirm("Delete this payment link permanently?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Payment link deleted"); invalidate(); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const handleForceExpire = (id: number) => {
    if (!confirm("Force expire this payment link?")) return;
    updateMutation.mutate({ id, data: { status: "expired" as any } }, {
      onSuccess: () => { toast.success("Payment link expired"); invalidate(); },
      onError: () => toast.error("Failed to update"),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payment Links</h1>
        <p className="text-muted-foreground mt-1">All merchant payment links across the platform</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search title or slug..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Input className="w-[180px]" placeholder="Merchant name..." value={merchantName}
              onChange={e => { setMerchantName(e.target.value); setPage(1); }} />
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !data?.data?.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-14">
                    <Link2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No payment links found</p>
                  </TableCell>
                </TableRow>
              ) : (data.data as LinkRow[]).map(link => {
                const isExpired = link.expiresAt ? new Date(link.expiresAt) < new Date() : false;
                const payUrl = link.url ?? `${window.location.origin}/pay/${link.slug}`;
                return (
                  <TableRow key={link.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{link.title}</p>
                        {link.description && <p className="text-xs text-muted-foreground truncate max-w-[160px]">{link.description}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{link.merchantName ?? `#${link.merchantId}`}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {link.amount ? `₹${parseFloat(link.amount).toLocaleString("en-IN")}` : <span className="text-muted-foreground text-xs">Open</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-muted-foreground">/pay/{link.slug}</span>
                        <button className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                          onClick={() => copyToClipboard(payUrl, "URL")} title="Copy URL">
                          <Copy className="w-3 h-3" />
                        </button>
                        <a href={payUrl} target="_blank" rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground p-0.5 rounded">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>{statusBadge(isExpired && link.status === "active" ? "expired" : link.status)}</TableCell>
                    <TableCell className="text-xs">
                      {link.expiresAt ? (
                        <span className={isExpired ? "text-rose-400" : "text-amber-400"}>
                          {format(new Date(link.expiresAt), "MMM d, yyyy")}
                        </span>
                      ) : <span className="text-muted-foreground">Never</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(link.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {link.status === "active" && !isExpired && (
                          <button className="text-amber-500 hover:text-amber-400 p-1 rounded hover:bg-amber-500/10 text-xs font-medium"
                            onClick={() => handleForceExpire(link.id)} title="Force expire">
                            Expire
                          </button>
                        )}
                        <button className="text-rose-500 hover:text-rose-400 p-1 rounded hover:bg-rose-500/10"
                          onClick={() => handleDelete(link.id)} title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
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
