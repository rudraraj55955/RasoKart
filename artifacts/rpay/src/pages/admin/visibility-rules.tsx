import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Search, Globe, Lock, Eye, EyeOff, RotateCcw, Users, Info } from "lucide-react";

function getToken() { return localStorage.getItem("rasokart_token") ?? ""; }
async function api(method: string, path: string, body?: object) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({ error: "Unknown error" })); throw new Error(e.error ?? "Request failed"); }
  return res.json();
}

export default function AdminVisibilityRules() {
  const queryClient = useQueryClient();
  const [selectedDetail, setSelectedDetail] = useState<any | null>(null);
  const [merchantSearch, setMerchantSearch] = useState("");
  const [detailSearch, setDetailSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDialog, setBulkDialog] = useState(false);
  const [bulkAction, setBulkAction] = useState<"show" | "hide" | "reset">("show");
  const [allMerchantsDialog, setAllMerchantsDialog] = useState(false);
  const [allMerchantsVisible, setAllMerchantsVisible] = useState(true);

  // List account details
  const { data: detailsData } = useQuery({
    queryKey: ["account-details-list", detailSearch],
    queryFn: () => api("GET", `/account-details?search=${encodeURIComponent(detailSearch)}&limit=100`),
  });
  const details: any[] = detailsData?.data ?? [];

  // List merchants with visibility for selected detail
  const { data: visData, isLoading: visLoading } = useQuery({
    queryKey: ["visibility", selectedDetail?.id, merchantSearch],
    queryFn: () => api("GET", `/account-details/${selectedDetail!.id}/visibility?search=${encodeURIComponent(merchantSearch)}&limit=100`),
    enabled: !!selectedDetail,
  });
  const merchantRows: any[] = visData?.data ?? [];
  const isGlobal: boolean = visData?.isGlobal ?? true;

  const updateMutation = useMutation({
    mutationFn: (body: object) => api("PUT", `/account-details/${selectedDetail!.id}/visibility`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["visibility", selectedDetail?.id] });
      queryClient.invalidateQueries({ queryKey: ["account-details"] });
      toast.success("Visibility updated");
      setSelected(new Set());
      setBulkDialog(false);
      setAllMerchantsDialog(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function toggleOne(merchantId: number, currentVisible: boolean) {
    updateMutation.mutate({ merchantIds: [merchantId], visible: !currentVisible });
  }

  function resetOne(merchantId: number) {
    updateMutation.mutate({ merchantIds: [merchantId], resetToDefault: true });
  }

  function handleBulk() {
    if (bulkAction === "reset") {
      updateMutation.mutate({ merchantIds: Array.from(selected), resetToDefault: true });
    } else {
      updateMutation.mutate({ merchantIds: Array.from(selected), visible: bulkAction === "show" });
    }
  }

  function handleAllMerchants() {
    updateMutation.mutate({ allMerchants: true, visible: allMerchantsVisible });
  }

  const allSelected = merchantRows.length > 0 && merchantRows.every((r: any) => selected.has(r.merchantId));
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Visibility Rules</h1>
        <p className="text-muted-foreground mt-1">Control which merchants can see each account detail</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Account Details picker */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Select Account Detail</CardTitle>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input className="pl-9 h-8 text-sm" placeholder="Search..." value={detailSearch} onChange={e => setDetailSearch(e.target.value)} />
              </div>
            </CardHeader>
            <CardContent className="p-0 max-h-[60vh] overflow-y-auto">
              {!details.length ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No account details found</div>
              ) : details.map((d: any) => (
                <button
                  key={d.id}
                  onClick={() => { setSelectedDetail(d); setSelected(new Set()); }}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors border-b border-border/30 ${selectedDetail?.id === d.id ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.label}</p>
                    <p className="text-xs text-muted-foreground capitalize">{d.type.replace(/_/g, " ")}</p>
                  </div>
                  <div className="shrink-0 mt-0.5">
                    {d.isGlobal
                      ? <Globe className="w-3.5 h-3.5 text-emerald-400" />
                      : <Lock className="w-3.5 h-3.5 text-amber-400" />
                    }
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right: Merchant visibility table */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedDetail ? (
            <Card className="h-full flex items-center justify-center min-h-[400px]">
              <div className="text-center text-muted-foreground">
                <Eye className="w-10 h-10 opacity-20 mx-auto mb-3" />
                <p className="text-sm">Select an account detail to manage its visibility</p>
              </div>
            </Card>
          ) : (
            <>
              {/* Selected detail info banner */}
              <Card>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">{selectedDetail.label}</p>
                      <p className="text-xs text-muted-foreground capitalize">{selectedDetail.type.replace(/_/g, " ")} · {isGlobal ? "Default: visible to all" : "Default: hidden"}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {selected.size > 0 && (
                        <Button variant="outline" size="sm" onClick={() => setBulkDialog(true)}>
                          <Users className="w-3.5 h-3.5 mr-1.5" />
                          Bulk ({selected.size})
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setAllMerchantsVisible(isGlobal); setAllMerchantsDialog(true); }}
                      >
                        <Globe className="w-3.5 h-3.5 mr-1.5" />
                        All Merchants
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Search merchants..." value={merchantSearch} onChange={e => setMerchantSearch(e.target.value)} />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">
                          <Checkbox
                            checked={allSelected}
                            data-state={someSelected ? "indeterminate" : undefined}
                            onCheckedChange={v => {
                              if (v) setSelected(new Set(merchantRows.map((r: any) => r.merchantId)));
                              else setSelected(new Set());
                            }}
                          />
                        </TableHead>
                        <TableHead>Merchant</TableHead>
                        <TableHead>Rule</TableHead>
                        <TableHead>Effective</TableHead>
                        <TableHead>Visible</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visLoading ? (
                        Array.from({ length: 6 }).map((_, i) => (
                          <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
                        ))
                      ) : !merchantRows.length ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground">No merchants found</TableCell>
                        </TableRow>
                      ) : merchantRows.map((row: any) => (
                        <TableRow key={row.merchantId} className={selected.has(row.merchantId) ? "bg-primary/5" : ""}>
                          <TableCell>
                            <Checkbox
                              checked={selected.has(row.merchantId)}
                              onCheckedChange={v => {
                                setSelected(prev => { const s = new Set(prev); v ? s.add(row.merchantId) : s.delete(row.merchantId); return s; });
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="text-sm font-medium">{row.businessName}</p>
                              <p className="text-xs text-muted-foreground">{row.email}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            {row.isDefault ? (
                              <Badge variant="outline" className="text-xs border-muted text-muted-foreground">Default</Badge>
                            ) : row.explicitRule ? (
                              <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-400">Allowed</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs border-rose-500/40 text-rose-400">Blocked</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {row.effectiveVisible
                              ? <span className="flex items-center gap-1 text-xs text-emerald-400"><Eye className="w-3 h-3" />Visible</span>
                              : <span className="flex items-center gap-1 text-xs text-muted-foreground"><EyeOff className="w-3 h-3" />Hidden</span>
                            }
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={row.effectiveVisible}
                              onCheckedChange={() => toggleOne(row.merchantId, row.effectiveVisible)}
                              disabled={updateMutation.isPending}
                              className="scale-75"
                            />
                          </TableCell>
                          <TableCell>
                            {!row.isDefault && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" onClick={() => resetOne(row.merchantId)} disabled={updateMutation.isPending}>
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Reset to default</TooltipContent>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Bulk Dialog */}
      <Dialog open={bulkDialog} onOpenChange={setBulkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Visibility Update</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground"><strong className="text-foreground">{selected.size}</strong> merchants selected</p>
            <div className="grid grid-cols-3 gap-2">
              {(["show", "hide", "reset"] as const).map(action => (
                <button
                  key={action}
                  onClick={() => setBulkAction(action)}
                  className={`rounded-lg border p-3 text-sm capitalize transition-colors ${bulkAction === action ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-muted-foreground hover:bg-muted/20"}`}
                >
                  {action === "show" && <Eye className="w-4 h-4 mx-auto mb-1" />}
                  {action === "hide" && <EyeOff className="w-4 h-4 mx-auto mb-1" />}
                  {action === "reset" && <RotateCcw className="w-4 h-4 mx-auto mb-1" />}
                  {action}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {bulkAction === "show" && "Force-show this detail for selected merchants"}
              {bulkAction === "hide" && "Force-hide this detail for selected merchants"}
              {bulkAction === "reset" && "Remove explicit rules — falls back to the default (isGlobal setting)"}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(false)}>Cancel</Button>
            <Button onClick={handleBulk} disabled={updateMutation.isPending}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* All Merchants Dialog */}
      <Dialog open={allMerchantsDialog} onOpenChange={setAllMerchantsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update All Merchants</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-400">This will update the <strong>isGlobal</strong> setting and remove all per-merchant rules for this account detail.</p>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-muted/10">
              <Switch checked={allMerchantsVisible} onCheckedChange={setAllMerchantsVisible} />
              <p className="text-sm">{allMerchantsVisible ? "Visible to all merchants (default on)" : "Hidden from all merchants (default off)"}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllMerchantsDialog(false)}>Cancel</Button>
            <Button onClick={handleAllMerchants} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Updating..." : "Apply to All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
