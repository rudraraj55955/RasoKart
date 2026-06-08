import { useState } from "react";
import { useListVirtualAccounts, useUpdateVirtualAccount, useDeleteVirtualAccount } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, XCircle, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function AdminVirtualAccounts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [merchantSearch, setMerchantSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useListVirtualAccounts({ status: status as any, search, page, limit: 20 });
  const updateMutation = useUpdateVirtualAccount();
  const deleteMutation = useDeleteVirtualAccount();

  const handleClose = (id: number) => {
    updateMutation.mutate({ id, data: { status: "closed" } }, {
      onSuccess: () => { toast.success("Account closed"); qc.invalidateQueries({ queryKey: ["list-virtual-accounts"] }); },
      onError: () => toast.error("Failed to close account"),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this virtual account?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Virtual account deleted"); qc.invalidateQueries({ queryKey: ["list-virtual-accounts"] }); },
      onError: () => toast.error("Failed to delete"),
    });
  };

  const exportCsv = () => {
    if (!filtered?.length) return;
    const rows = [["ID", "Merchant", "Account Number", "IFSC", "Bank", "Account Holder", "Label", "Status", "Created"]];
    filtered.forEach(va => rows.push([String(va.id), va.merchantName ?? "", va.accountNumber, va.ifsc, va.bankName, va.accountHolder, va.label ?? "", va.status, va.createdAt]));
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv])); a.download = "virtual-accounts.csv"; a.click();
  };

  const filtered = merchantSearch
    ? data?.data?.filter(va => va.merchantName?.toLowerCase().includes(merchantSearch.toLowerCase()))
    : data?.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Virtual Accounts</h1>
          <p className="text-muted-foreground mt-1">Monitor all merchant virtual accounts</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search account number, holder..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
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
            <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Merchant</TableHead>
                <TableHead>Account Number</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>IFSC</TableHead>
                <TableHead>Label</TableHead>
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
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">No virtual accounts found</TableCell></TableRow>
              ) : filtered?.map(va => (
                <TableRow key={va.id}>
                  <TableCell className="font-medium text-sm">{va.merchantName ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{va.accountNumber}</TableCell>
                  <TableCell className="text-sm">{va.bankName}</TableCell>
                  <TableCell className="font-mono text-xs">{va.ifsc}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{va.label ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={va.status === "active" ? "default" : "secondary"} className="text-xs">
                      {va.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(new Date(va.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {va.status === "active" && (
                        <Button size="sm" variant="ghost" className="text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 h-8 text-xs" onClick={() => handleClose(va.id)}>
                          <XCircle className="w-3.5 h-3.5 mr-1" />Close
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-500 hover:text-rose-400" onClick={() => handleDelete(va.id)}>
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
