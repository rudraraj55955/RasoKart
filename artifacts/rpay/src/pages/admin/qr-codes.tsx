import { useState } from "react";
import { useListQrCodes, useUpdateQrCode, useDeleteQrCode } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Trash2, ToggleLeft, ToggleRight, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function AdminQrCodes() {
  const qc = useQueryClient();
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [merchantSearch, setMerchantSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListQrCodes({ type: type as any, status: status as any, search, page, limit: 20 });
  const updateMutation = useUpdateQrCode();
  const deleteMutation = useDeleteQrCode();

  const invalidateQr = () => qc.invalidateQueries({ queryKey: ["list-qr-codes"] });

  const handleToggle = (id: number, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    updateMutation.mutate({ id, data: { status: newStatus as any } }, {
      onSuccess: () => { toast.success(`QR ${newStatus}`); invalidateQr(); },
      onError: () => toast.error("Failed to update"),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this QR code?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("QR code deleted"); invalidateQr(); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const exportCsv = () => {
    if (!filtered?.length) return;
    const rows = [["ID", "Merchant", "Type", "Label", "Payload", "Amount", "Status", "Created"]];
    filtered.forEach(q => rows.push([String(q.id), q.merchantName ?? "", q.type, q.label ?? "", q.payload, q.amount ?? "", q.status, q.createdAt]));
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv])); a.download = "qr-codes.csv"; a.click();
  };

  const filtered = merchantSearch
    ? data?.data?.filter(q => q.merchantName?.toLowerCase().includes(merchantSearch.toLowerCase()))
    : data?.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">QR Management</h1>
          <p className="text-muted-foreground mt-1">Monitor and manage all merchant QR codes</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search label or payload..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <div className="relative min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 pr-8" placeholder="Filter by merchant..." value={merchantSearch} onChange={e => setMerchantSearch(e.target.value)} />
              {merchantSearch && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setMerchantSearch("")}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <Select value={type} onValueChange={v => { setType(v); setPage(1); }}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="dynamic">Dynamic</SelectItem>
                <SelectItem value="static">Static</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 8 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                ))
              ) : filtered?.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">No QR codes found</TableCell></TableRow>
              ) : filtered?.map(qr => (
                <TableRow key={qr.id}>
                  <TableCell className="font-mono text-xs">#{qr.id}</TableCell>
                  <TableCell className="text-sm">{qr.merchantName ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{qr.type}</Badge></TableCell>
                  <TableCell className="text-sm">{qr.label ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{qr.amount ? `₹${qr.amount}` : "Dynamic"}</TableCell>
                  <TableCell>
                    <Badge variant={qr.status === "active" ? "default" : "secondary"} className="text-xs">
                      {qr.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(qr.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleToggle(qr.id, qr.status)} title="Toggle status">
                        {qr.status === "active" ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:text-rose-400" onClick={() => handleDelete(qr.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
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
