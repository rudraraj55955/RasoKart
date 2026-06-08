import { useState } from "react";
import { useListMerchantConnections, useCreateMerchantConnection, useUpdateMerchantConnection, useDeleteMerchantConnection, getListMerchantConnectionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Smartphone, Store, Landmark, Building, AtSign, CheckCircle, PlusCircle, Search } from "lucide-react";
import { toast } from "sonner";

const PROVIDERS = [
  { id: "phonepe", label: "PhonePe Business", icon: <Smartphone className="w-6 h-6 text-purple-400" />, fields: ["Merchant ID", "API Key", "Salt Key"] },
  { id: "paytm", label: "Paytm Business", icon: <Smartphone className="w-6 h-6 text-blue-400" />, fields: ["MID", "Merchant Key", "Website"] },
  { id: "bharatpe", label: "BharatPe", icon: <Store className="w-6 h-6 text-green-400" />, fields: ["Merchant ID", "Client ID", "Client Secret"] },
  { id: "yono_sbi", label: "YONO SBI Merchant", icon: <Landmark className="w-6 h-6 text-red-400" />, fields: ["Terminal ID", "Merchant ID", "API Key"] },
  { id: "hdfc_smarthub", label: "HDFC SmartHub", icon: <Building className="w-6 h-6 text-yellow-400" />, fields: ["Merchant ID", "API Key", "Salt"] },
  { id: "upi_id", label: "UPI ID", icon: <AtSign className="w-6 h-6 text-emerald-400" />, fields: ["UPI ID", "Display Name"] },
];

type CredMap = Record<string, string>;

export default function ConnectMerchant() {
  const qc = useQueryClient();
  const { data: connections, isLoading } = useListMerchantConnections();
  const createMutation = useCreateMerchantConnection();
  const updateMutation = useUpdateMerchantConnection();
  const deleteMutation = useDeleteMerchantConnection();

  const [dialogProvider, setDialogProvider] = useState<string | null>(null);
  const [credFields, setCredFields] = useState<CredMap>({});
  const [monthlyLimit, setMonthlyLimit] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const connMap = new Map((connections ?? []).map(c => [c.provider, c]));

  const filteredProviders = PROVIDERS.filter(p => {
    const matchSearch = !search || p.label.toLowerCase().includes(search.toLowerCase());
    const conn = connMap.get(p.id);
    const matchStatus =
      statusFilter === "all" ||
      (statusFilter === "connected" && !!conn) ||
      (statusFilter === "not_connected" && !conn) ||
      (statusFilter === "active" && conn?.isActive) ||
      (statusFilter === "inactive" && conn && !conn.isActive);
    return matchSearch && matchStatus;
  });

  const openDialog = (providerId: string) => {
    const existing = connMap.get(providerId);
    let parsed: CredMap = {};
    if (existing?.credentials) {
      try { parsed = JSON.parse(existing.credentials); } catch {}
    }
    setDialogProvider(providerId);
    setCredFields(parsed);
    setMonthlyLimit(existing ? String(existing.monthlyLimit) : "0");
    setIsActive(existing ? existing.isActive : true);
    setEditId(existing?.id ?? null);
  };

  const handleSave = () => {
    if (!dialogProvider) return;
    const credentials = JSON.stringify(credFields);
    const payload = { provider: dialogProvider, credentials, monthlyLimit: parseFloat(monthlyLimit) || 0, isActive };

    if (editId) {
      updateMutation.mutate({ id: editId, data: payload }, {
        onSuccess: () => { toast.success("Connection updated"); setDialogProvider(null); qc.invalidateQueries({ queryKey: getListMerchantConnectionsQueryKey() }); },
        onError: () => toast.error("Failed to update"),
      });
    } else {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => { toast.success("Provider connected"); setDialogProvider(null); qc.invalidateQueries({ queryKey: getListMerchantConnectionsQueryKey() }); },
        onError: () => toast.error("Failed to connect"),
      });
    }
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Connection removed"); qc.invalidateQueries({ queryKey: getListMerchantConnectionsQueryKey() }); },
      onError: () => toast.error("Failed to remove"),
    });
  };

  const exportCsv = () => {
    const connected = filteredProviders
      .filter(p => connMap.has(p.id))
      .map(p => {
        const c = connMap.get(p.id)!;
        return [p.label, c.isActive ? "Active" : "Inactive", String(c.monthlyLimit)];
      });
    if (!connected.length) { toast.error("No connected providers to export"); return; }
    const rows = [["Provider", "Status", "Monthly Limit (₹)"], ...connected];
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv])); a.download = "connections.csv"; a.click();
  };

  const providerMeta = PROVIDERS.find(p => p.id === dialogProvider);
  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Connect Providers</h1>
          <p className="text-muted-foreground mt-1">Link your payment provider accounts to enable collections.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search providers..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Providers</SelectItem>
            <SelectItem value="connected">Connected</SelectItem>
            <SelectItem value="not_connected">Not Connected</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <Card key={i} className="animate-pulse h-44 bg-muted/50" />)}
        </div>
      ) : filteredProviders.length === 0 ? (
        <p className="text-center text-muted-foreground py-10">No providers match your filter.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProviders.map(provider => {
            const conn = connMap.get(provider.id);
            return (
              <Card key={provider.id} className={`border ${conn ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-card border border-border/60 flex items-center justify-center">
                        {provider.icon}
                      </div>
                      <div>
                        <CardTitle className="text-base">{provider.label}</CardTitle>
                        {conn ? (
                          <Badge variant={conn.isActive ? "default" : "secondary"} className="text-[10px] mt-0.5">
                            {conn.isActive ? "Connected" : "Inactive"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] mt-0.5 text-muted-foreground">Not connected</Badge>
                        )}
                      </div>
                    </div>
                    {conn && <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {conn && (
                    <div className="text-xs text-muted-foreground">
                      Monthly limit: <span className="font-semibold text-foreground">₹{Number(conn.monthlyLimit).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => openDialog(provider.id)}>
                      <PlusCircle className="w-3 h-3 mr-1" />
                      {conn ? "Edit" : "Connect"}
                    </Button>
                    {conn && (
                      <Button size="sm" variant="ghost" className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                        onClick={() => handleDelete(conn.id)} disabled={deleteMutation.isPending}>
                        Remove
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!dialogProvider} onOpenChange={() => setDialogProvider(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit" : "Connect"} {providerMeta?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {providerMeta?.fields.map(field => (
              <div key={field} className="space-y-1.5">
                <Label>{field}</Label>
                <Input
                  placeholder={`Enter ${field}`}
                  value={credFields[field] ?? ""}
                  onChange={e => setCredFields(prev => ({ ...prev, [field]: e.target.value }))}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>Monthly Limit (₹)</Label>
              <Input type="number" placeholder="0" value={monthlyLimit} onChange={e => setMonthlyLimit(e.target.value)} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogProvider(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isPending}>{editId ? "Update" : "Connect"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
