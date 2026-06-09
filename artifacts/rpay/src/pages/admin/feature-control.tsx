import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Search, Download, Settings2, Users, ChevronLeft, ChevronRight, Shield } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth-context";

const FEATURES = [
  { key: "dynamicQr",      label: "Dynamic QR",   short: "DQR" },
  { key: "staticQr",       label: "Static QR",    short: "SQR" },
  { key: "virtualAccount", label: "Virtual Acct", short: "VA"  },
  { key: "paymentLinks",   label: "Pay Links",    short: "PL"  },
  { key: "payouts",        label: "Payouts",      short: "PO"  },
  { key: "withdrawals",    label: "Withdrawals",  short: "WD"  },
  { key: "settlements",    label: "Settlements",  short: "ST"  },
  { key: "webhooks",       label: "Webhooks",     short: "WH"  },
  { key: "apiKeys",        label: "API Keys",     short: "AK"  },
  { key: "csvExport",      label: "CSV Export",   short: "CSV" },
] as const;

type FeatureKey = typeof FEATURES[number]["key"];

function getToken() { return localStorage.getItem("rasokart_token") ?? ""; }

async function apiGet(path: string) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPut(path: string, body: object) {
  const res = await fetch(`/api${path}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost(path: string, body: object) {
  const res = await fetch(`/api${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function AdminFeatureControl() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDialog, setBulkDialog] = useState(false);
  const [bulkFeature, setBulkFeature] = useState<FeatureKey>("dynamicQr");
  const [bulkEnabled, setBulkEnabled] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ["feature-control", search, page],
    queryFn: () => apiGet(`/feature-control?search=${encodeURIComponent(search)}&page=${page}&limit=20`),
  });

  const rows: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;

  const updateMutation = useMutation({
    mutationFn: ({ merchantId, updates }: { merchantId: number; updates: Partial<Record<FeatureKey, boolean>> }) =>
      apiPut(`/feature-control/${merchantId}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature-control"] });
      toast.success("Feature updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const bulkMutation = useMutation({
    mutationFn: (body: { merchantIds: number[]; feature: FeatureKey; enabled: boolean }) =>
      apiPost("/feature-control/bulk", body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["feature-control"] });
      toast.success(`Updated ${res.updated} merchants`);
      setBulkDialog(false);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  function toggleFeature(merchantId: number, key: FeatureKey, currentValue: boolean) {
    updateMutation.mutate({ merchantId, updates: { [key]: !currentValue } });
  }

  function handleSelectAll(checked: boolean) {
    if (checked) setSelected(new Set(rows.map((r: any) => r.merchantId)));
    else setSelected(new Set());
  }

  function handleSelectRow(id: number, checked: boolean) {
    setSelected(prev => { const s = new Set(prev); checked ? s.add(id) : s.delete(id); return s; });
  }

  function handleCsvExport() {
    const a = document.createElement("a");
    a.href = `/api/feature-control/export/csv?search=${encodeURIComponent(search)}`;
    const headers = new Headers({ Authorization: `Bearer ${getToken()}` });
    fetch(a.href, { headers }).then(res => res.blob()).then(blob => {
      a.href = URL.createObjectURL(blob);
      a.download = `feature-control-${Date.now()}.csv`;
      a.click();
    });
  }

  const allSelected = rows.length > 0 && rows.every((r: any) => selected.has(r.merchantId));
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Feature Control</h1>
          <p className="text-muted-foreground mt-1">Enable or disable features per merchant</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="outline" size="sm" onClick={() => setBulkDialog(true)}>
              <Settings2 className="w-4 h-4 mr-2" />
              Bulk Update ({selected.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleCsvExport}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search merchants..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    data-state={someSelected ? "indeterminate" : undefined}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Status</TableHead>
                {FEATURES.map(f => (
                  <TableHead key={f.key} className="text-center min-w-[70px]">
                    <Tooltip>
                      <TooltipTrigger className="cursor-default">{f.short}</TooltipTrigger>
                      <TooltipContent>{f.label}</TooltipContent>
                    </Tooltip>
                  </TableHead>
                ))}
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: FEATURES.length + 4 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !rows.length ? (
                <TableRow>
                  <TableCell colSpan={FEATURES.length + 4} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Shield className="w-8 h-8 opacity-30" />
                      <p className="text-sm">No merchants found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : rows.map((row: any) => (
                <TableRow key={row.merchantId} className={selected.has(row.merchantId) ? "bg-primary/5" : ""}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(row.merchantId)}
                      onCheckedChange={(v) => handleSelectRow(row.merchantId, !!v)}
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{row.businessName}</p>
                      <p className="text-xs text-muted-foreground">{row.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-xs capitalize ${
                        row.status === "approved" ? "border-emerald-500/40 text-emerald-400" :
                        row.status === "pending" ? "border-amber-500/40 text-amber-400" :
                        "border-rose-500/40 text-rose-400"
                      }`}
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                  {FEATURES.map(f => {
                    const val = row.features?.[f.key] ?? false;
                    return (
                      <TableCell key={f.key} className="text-center">
                        <Switch
                          checked={val}
                          onCheckedChange={() => toggleFeature(row.merchantId, f.key, val)}
                          disabled={updateMutation.isPending}
                          className="scale-75"
                        />
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-xs text-muted-foreground">
                    {row.features?.updatedAt ? format(new Date(row.features.updatedAt), "MMM d, HH:mm") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} merchants</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-muted-foreground flex items-center px-2">Page {page}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Bulk Update Dialog */}
      <Dialog open={bulkDialog} onOpenChange={setBulkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Feature Update</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Update <strong className="text-foreground">{selected.size}</strong> merchant(s)</p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Feature</label>
              <Select value={bulkFeature} onValueChange={v => setBulkFeature(v as FeatureKey)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FEATURES.map(f => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/10">
              <Switch checked={bulkEnabled} onCheckedChange={setBulkEnabled} />
              <span className="text-sm">{bulkEnabled ? "Enable" : "Disable"} for selected merchants</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(false)}>Cancel</Button>
            <Button
              onClick={() => bulkMutation.mutate({ merchantIds: Array.from(selected), feature: bulkFeature, enabled: bulkEnabled })}
              disabled={bulkMutation.isPending}
            >
              {bulkMutation.isPending ? "Updating..." : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
