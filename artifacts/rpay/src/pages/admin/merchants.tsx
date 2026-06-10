import { useState } from "react";
import {
  useListMerchants, useApproveMerchant, useRejectMerchant,
  useSuspendMerchant, useUnsuspendMerchant,
  useListPlans, useAssignMerchantPlan, useGetMerchantPlan, useGetMerchantPlanHistory,
  useUpgradeMerchantPlan, useDowngradeMerchantPlan, useSuspendMerchantPlan,
  useReinstateMerchantPlan, useRenewMerchantPlan, useBulkAssignMerchantPlan,
  useBulkApproveMerchants, useBulkSuspendMerchants,
  useUpdateMerchantBranding, useGetMerchantPlanUsageAdmin,
  getListMerchantsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Search, CreditCard, Calendar, History, ShieldOff, ShieldCheck, TrendingUp, TrendingDown, PauseCircle, PlayCircle, RefreshCw, AlertTriangle, Paintbrush, Users, UserCheck, UserX, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

const ACTION_COLOR: Record<string, string> = {
  assigned: "text-sky-400",
  upgraded: "text-emerald-400",
  downgraded: "text-amber-400",
  renewed: "text-violet-400",
  suspended: "text-orange-400",
  reinstated: "text-emerald-400",
  expired: "text-rose-400",
  removed: "text-muted-foreground",
};

const PLAN_SUB_STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  suspended: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  expired: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

export default function AdminMerchants() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [expiryStatus, setExpiryStatus] = useState<"" | "expiring" | "expired">("");
  const [page, setPage] = useState(1);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [brandingMerchant, setBrandingMerchant] = useState<{ id: number; name: string; logoUrl: string | null; brandColor: string | null } | null>(null);
  const [brandingLogoUrl, setBrandingLogoUrl] = useState("");
  const [brandingColor, setBrandingColor] = useState("");
  const [brandingLogoError, setBrandingLogoError] = useState(false);
  const [assignPlanMerchant, setAssignPlanMerchant] = useState<{ id: number; name: string } | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [assignNotes, setAssignNotes] = useState<string>("");
  const [actionNotes, setActionNotes] = useState<string>("");
  const [showHistory, setShowHistory] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"upgrade" | "downgrade" | "suspend" | "reinstate" | "renew" | null>(null);
  const [renewExpiresAt, setRenewExpiresAt] = useState<string>("");

  // Bulk selection state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkPlanId, setBulkPlanId] = useState<string>("");
  const [bulkExpiresAt, setBulkExpiresAt] = useState<string>("");
  const [bulkNotes, setBulkNotes] = useState<string>("");
  const [bulkStatusAction, setBulkStatusAction] = useState<"approve" | "suspend" | "reinstate" | null>(null);

  const { data, isLoading } = useListMerchants({ status: status as any, search, page, limit: 20, expiryStatus: expiryStatus as any || undefined });
  const { data: plans } = useListPlans();
  const { data: currentMerchantPlan, isLoading: planLoading } = useGetMerchantPlan(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant, queryKey: ["getMerchantPlan", assignPlanMerchant?.id ?? 0] } }
  );
  const { data: planHistory } = useGetMerchantPlanHistory(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant && showHistory, queryKey: ["getMerchantPlanHistory", assignPlanMerchant?.id ?? 0] } }
  );
  const { data: merchantPlanUsage } = useGetMerchantPlanUsageAdmin(
    assignPlanMerchant?.id ?? 0,
    { query: { enabled: !!assignPlanMerchant && !!currentMerchantPlan, queryKey: ["getMerchantPlanUsageAdmin", assignPlanMerchant?.id ?? 0] } }
  );
  const updateBrandingMutation = useUpdateMerchantBranding();
  const approveMutation = useApproveMerchant();
  const rejectMutation = useRejectMerchant();
  const merchantSuspendMutation = useSuspendMerchant();
  const merchantUnsuspendMutation = useUnsuspendMerchant();
  const assignPlanMutation = useAssignMerchantPlan();
  const upgradeMutation = useUpgradeMerchantPlan();
  const downgradeMutation = useDowngradeMerchantPlan();
  const suspendPlanMutation = useSuspendMerchantPlan();
  const reinstatePlanMutation = useReinstateMerchantPlan();
  const renewMutation = useRenewMerchantPlan();
  const bulkAssignMutation = useBulkAssignMerchantPlan();
  const bulkApproveMutation = useBulkApproveMerchants();
  const bulkSuspendMutation = useBulkSuspendMerchants();

  const invalidatePlanData = (id: number) => {
    qc.invalidateQueries({ queryKey: ["getMerchantPlan", id] });
    qc.invalidateQueries({ queryKey: ["getMerchantPlanHistory", id] });
  };

  const handlePlanAction = (action: typeof confirmAction) => {
    if (!assignPlanMerchant) return;
    const id = assignPlanMerchant.id;
    const notes = actionNotes || null;

    const afterSuccess = (msg: string, extra?: () => void) => {
      toast.success(msg);
      invalidatePlanData(id);
      qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
      setConfirmAction(null);
      setActionNotes("");
      extra?.();
    };

    if (action === "upgrade" || action === "downgrade") {
      if (!selectedPlanId) return;
      const mutation = action === "upgrade" ? upgradeMutation : downgradeMutation;
      mutation.mutate({ id, data: { planId: parseInt(selectedPlanId), notes } }, {
        onSuccess: () => afterSuccess(`Plan ${action}d`, () => setSelectedPlanId("")),
        onError: () => toast.error(`Failed to ${action} plan`),
      });
    } else if (action === "suspend") {
      suspendPlanMutation.mutate({ id, data: { notes } }, {
        onSuccess: () => afterSuccess("Plan suspended"),
        onError: () => toast.error("Failed to suspend plan"),
      });
    } else if (action === "reinstate") {
      reinstatePlanMutation.mutate({ id, data: { notes } }, {
        onSuccess: () => afterSuccess("Plan reinstated"),
        onError: () => toast.error("Failed to reinstate plan"),
      });
    } else if (action === "renew") {
      const defaultExpiry = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
      renewMutation.mutate({ id, data: { expiresAt: renewExpiresAt || defaultExpiry, notes } }, {
        onSuccess: () => afterSuccess("Plan renewed", () => setRenewExpiresAt("")),
        onError: () => toast.error("Failed to renew plan"),
      });
    }
  };

  const isActionPending = upgradeMutation.isPending || downgradeMutation.isPending || suspendPlanMutation.isPending || reinstatePlanMutation.isPending || renewMutation.isPending;

  const handleApprove = (id: number) => {
    approveMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Merchant approved"); qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() }); },
      onError: () => toast.error("Failed to approve merchant"),
    });
  };

  const handleSuspend = (id: number) => {
    merchantSuspendMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Merchant suspended"); qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() }); },
      onError: () => toast.error("Failed to suspend merchant"),
    });
  };

  const handleUnsuspend = (id: number) => {
    merchantUnsuspendMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Merchant reinstated"); qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() }); },
      onError: () => toast.error("Failed to unsuspend merchant"),
    });
  };

  const handleReject = () => {
    if (!rejectId || !rejectReason.trim()) return;
    rejectMutation.mutate({ id: rejectId, data: { reason: rejectReason } }, {
      onSuccess: () => {
        toast.success("Merchant rejected");
        setRejectId(null); setRejectReason("");
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
      },
      onError: () => toast.error("Failed to reject merchant"),
    });
  };

  const openBranding = (merchant: { id: number; businessName: string; logoUrl?: string | null; brandColor?: string | null }) => {
    setBrandingMerchant({ id: merchant.id, name: merchant.businessName, logoUrl: merchant.logoUrl ?? null, brandColor: merchant.brandColor ?? null });
    setBrandingLogoUrl(merchant.logoUrl ?? "");
    setBrandingColor(merchant.brandColor ?? "");
    setBrandingLogoError(false);
  };

  const closeBranding = () => { setBrandingMerchant(null); };

  const handleSaveBranding = () => {
    if (!brandingMerchant) return;
    updateBrandingMutation.mutate({
      id: brandingMerchant.id,
      data: { logoUrl: brandingLogoUrl.trim() || null, brandColor: brandingColor.trim() || null },
    }, {
      onSuccess: () => {
        toast.success("Branding updated");
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        closeBranding();
      },
      onError: () => toast.error("Failed to update branding"),
    });
  };

  const openAssignPlan = (id: number, name: string) => {
    setAssignPlanMerchant({ id, name });
    setSelectedPlanId("");
    setExpiresAt("");
    setAssignNotes("");
    setShowHistory(false);
  };

  const closeAssignPlan = () => {
    setAssignPlanMerchant(null);
    setSelectedPlanId("");
    setExpiresAt("");
    setAssignNotes("");
    setShowHistory(false);
  };

  const handleAssignPlan = () => {
    if (!assignPlanMerchant || !selectedPlanId) return;
    assignPlanMutation.mutate({
      id: assignPlanMerchant.id,
      data: {
        planId: parseInt(selectedPlanId),
        expiresAt: expiresAt || null,
        notes: assignNotes || null,
      },
    }, {
      onSuccess: () => {
        toast.success("Plan assigned successfully");
        qc.invalidateQueries({ queryKey: ["getMerchantPlan", assignPlanMerchant.id] });
        qc.invalidateQueries({ queryKey: ["getMerchantPlanHistory", assignPlanMerchant.id] });
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        closeAssignPlan();
      },
      onError: () => toast.error("Failed to assign plan"),
    });
  };

  const handleBulkAssign = () => {
    if (!bulkPlanId || selected.size === 0) return;
    bulkAssignMutation.mutate({
      data: {
        merchantIds: Array.from(selected),
        planId: parseInt(bulkPlanId),
        expiresAt: bulkExpiresAt || null,
        notes: bulkNotes || null,
      },
    }, {
      onSuccess: (result) => {
        const { updated, failed } = result;
        if (failed === 0) {
          toast.success(`Plan assigned to ${updated} merchant${updated !== 1 ? "s" : ""}`);
        } else {
          toast.warning(`${updated} assigned, ${failed} failed`);
        }
        qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
        setSelected(new Set());
        closeBulkDialog();
      },
      onError: () => toast.error("Bulk plan assignment failed"),
    });
  };

  const closeBulkDialog = () => {
    setBulkDialogOpen(false);
    setBulkPlanId("");
    setBulkExpiresAt("");
    setBulkNotes("");
  };

  const handleBulkStatusAction = () => {
    if (!bulkStatusAction || selected.size === 0) return;
    const ids = Array.from(selected);

    if (bulkStatusAction === "approve") {
      bulkApproveMutation.mutate({ data: { merchantIds: ids } }, {
        onSuccess: (result) => {
          const { updated, failed } = result;
          if (failed === 0) {
            toast.success(`${updated} merchant${updated !== 1 ? "s" : ""} approved`);
          } else {
            toast.warning(`${updated} approved, ${failed} failed`);
          }
          qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
          setSelected(new Set());
          setBulkStatusAction(null);
        },
        onError: () => toast.error("Bulk approve failed"),
      });
    } else {
      bulkSuspendMutation.mutate({ data: { merchantIds: ids, action: bulkStatusAction } }, {
        onSuccess: (result) => {
          const { updated, failed } = result;
          const verb = bulkStatusAction === "suspend" ? "suspended" : "reinstated";
          if (failed === 0) {
            toast.success(`${updated} merchant${updated !== 1 ? "s" : ""} ${verb}`);
          } else {
            toast.warning(`${updated} ${verb}, ${failed} failed`);
          }
          qc.invalidateQueries({ queryKey: getListMerchantsQueryKey() });
          setSelected(new Set());
          setBulkStatusAction(null);
        },
        onError: () => toast.error(`Bulk ${bulkStatusAction} failed`),
      });
    }
  };

  const isBulkStatusPending = bulkApproveMutation.isPending || bulkSuspendMutation.isPending;

  const exportCsv = () => {
    if (!data?.data) return;
    const rows = [["ID", "Business Name", "Contact", "Email", "Phone", "Status", "Balance", "Created"]];
    data.data.forEach(m => rows.push([String(m.id), m.businessName, m.contactName, m.email, m.phone, m.status, String(m.balance), m.createdAt]));
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "merchants.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const merchants = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const now = Date.now();
  const expiringCount = merchants.filter(m => {
    if (!m.currentPlanExpiresAt || m.currentPlanIsExpired) return false;
    const msLeft = new Date(m.currentPlanExpiresAt).getTime() - now;
    return msLeft > 0 && msLeft <= 7 * 86400000;
  }).length;
  const expiredCount = merchants.filter(m => m.currentPlanIsExpired).length;

  const allPageIds = merchants.map(m => m.id);
  const allPageSelected = allPageIds.length > 0 && allPageIds.every(id => selected.has(id));
  const somePageSelected = allPageIds.some(id => selected.has(id));

  const toggleSelectAll = () => {
    if (allPageSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        allPageIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        allPageIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Merchants</h1>
          <p className="text-muted-foreground mt-1">{total} total merchants</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>Export CSV</Button>
      </div>

      {(expiringCount > 0 || expiredCount > 0) && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {[
              expiredCount > 0 && `${expiredCount} merchant${expiredCount === 1 ? "" : "s"} with an expired plan`,
              expiringCount > 0 && `${expiringCount} merchant${expiringCount === 1 ? "" : "s"} expiring within 7 days`,
            ].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search merchants..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <div className="flex gap-1 flex-wrap">
          {(["all", "pending", "approved", "rejected", "suspended"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => { setStatus(tab); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm capitalize transition-colors border ${
                status === tab
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              {tab === "all" ? "All" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {([
            { value: "", label: "Any Expiry" },
            { value: "expiring", label: "Expiring Soon" },
            { value: "expired", label: "Expired" },
          ] as const).map(tab => (
            <button
              key={tab.value}
              onClick={() => { setExpiryStatus(tab.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors border ${
                expiryStatus === tab.value
                  ? tab.value === "expired"
                    ? "bg-rose-500/20 text-rose-400 border-rose-500/40"
                    : tab.value === "expiring"
                      ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                      : "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 flex-wrap">
          <Users className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-primary">{selected.size} merchant{selected.size !== 1 ? "s" : ""} selected</span>
          <div className="flex gap-2 ml-auto flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
              onClick={() => setBulkStatusAction("approve")}
            >
              <UserCheck className="w-3.5 h-3.5 mr-1.5" />
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
              onClick={() => setBulkStatusAction("suspend")}
            >
              <UserX className="w-3.5 h-3.5 mr-1.5" />
              Suspend
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-sky-400 border-sky-500/30 hover:bg-sky-500/10"
              onClick={() => setBulkStatusAction("reinstate")}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Reinstate
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-primary border-primary/30 hover:bg-primary/10"
              onClick={() => { setBulkPlanId(""); setBulkExpiresAt(""); setBulkNotes(""); setBulkDialogOpen(true); }}
            >
              <CreditCard className="w-3.5 h-3.5 mr-1.5" />
              Assign Plan
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all on this page"
                  />
                </TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1,2,3,4,5].map(i => (
                  <TableRow key={i}>
                    {[1,2,3,4,5,6,7,8].map(j => <TableCell key={j}><div className="h-4 bg-muted/50 animate-pulse rounded" /></TableCell>)}
                  </TableRow>
                ))
              ) : merchants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">No merchants found</TableCell>
                </TableRow>
              ) : merchants.map(merchant => (
                <TableRow key={merchant.id} className={selected.has(merchant.id) ? "bg-primary/5" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(merchant.id)}
                      onCheckedChange={() => toggleSelect(merchant.id)}
                      aria-label={`Select ${merchant.businessName}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{merchant.businessName}</p>
                      <p className="text-xs text-muted-foreground">{merchant.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm">{merchant.contactName}</p>
                      <p className="text-xs text-muted-foreground">{merchant.phone}</p>
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge status={merchant.status} /></TableCell>
                  <TableCell>
                    {merchant.currentPlanName ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium">{merchant.currentPlanName}</span>
                          {merchant.currentPlanIsExpired ? (
                            <Badge variant="outline" className="text-xs py-0 text-rose-400 border-rose-500/30 bg-rose-500/10">
                              Expired
                            </Badge>
                          ) : (() => {
                            if (!merchant.currentPlanExpiresAt) return null;
                            const msLeft = new Date(merchant.currentPlanExpiresAt).getTime() - now;
                            if (msLeft > 0 && msLeft <= 7 * 86400000) {
                              return (
                                <Badge variant="outline" className="text-xs py-0 text-amber-400 border-amber-500/30 bg-amber-500/10">
                                  Expires soon
                                </Badge>
                              );
                            }
                            return null;
                          })()}
                          {merchant.currentPlanStatus && merchant.currentPlanStatus !== "active" && !merchant.currentPlanIsExpired && (
                            <Badge
                              variant="outline"
                              className={`text-xs py-0 ${PLAN_SUB_STATUS_COLOR[merchant.currentPlanStatus] ?? ""}`}
                            >
                              {merchant.currentPlanStatus}
                            </Badge>
                          )}
                        </div>
                        {merchant.currentPlanExpiresAt && (
                          <span className={`text-xs ${merchant.currentPlanIsExpired ? "text-rose-400" : "text-muted-foreground"}`}>
                            {merchant.currentPlanIsExpired ? "Expired " : "Expires "}
                            {format(new Date(merchant.currentPlanExpiresAt), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">No plan</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">₹{Number(merchant.balance).toLocaleString()}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(merchant.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {merchant.status === "pending" && (
                        <>
                          <Button size="sm" variant="ghost" className="text-emerald-500 hover:bg-emerald-500/10" onClick={() => handleApprove(merchant.id)}>
                            <CheckCircle className="w-4 h-4 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-500 hover:bg-rose-500/10" onClick={() => { setRejectId(merchant.id); setRejectReason(""); }}>
                            <XCircle className="w-4 h-4 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                      {merchant.status === "approved" && (
                        <Button size="sm" variant="ghost" className="text-orange-500 hover:bg-orange-500/10" onClick={() => handleSuspend(merchant.id)}>
                          <ShieldOff className="w-4 h-4 mr-1" /> Suspend
                        </Button>
                      )}
                      {merchant.status === "suspended" && (
                        <Button size="sm" variant="ghost" className="text-emerald-500 hover:bg-emerald-500/10" onClick={() => handleUnsuspend(merchant.id)}>
                          <ShieldCheck className="w-4 h-4 mr-1" /> Reinstate
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-primary hover:bg-primary/10" onClick={() => openAssignPlan(merchant.id, merchant.businessName)}>
                        <CreditCard className="w-4 h-4 mr-1" /> {merchant.currentPlanName ? "Change Plan" : "Assign Plan"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-violet-400 hover:bg-violet-500/10" onClick={() => openBranding(merchant)}>
                        <Paintbrush className="w-4 h-4 mr-1" /> Branding
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-3 text-sm">
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}

      {/* Reject Dialog */}
      <Dialog open={!!rejectId} onOpenChange={() => { setRejectId(null); setRejectReason(""); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Merchant</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Rejection reason *</Label>
            <Textarea placeholder="Explain why this merchant is being rejected..." rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectId(null); setRejectReason(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim() || rejectMutation.isPending}>
              {rejectMutation.isPending ? "Rejecting..." : "Reject Merchant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Branding Dialog */}
      <Dialog open={!!brandingMerchant} onOpenChange={closeBranding}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Paintbrush className="w-4 h-4 text-violet-400" /> Branding — {brandingMerchant?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="adminLogoUrl">Logo URL</Label>
              <Input
                id="adminLogoUrl"
                placeholder="https://yourbrand.com/logo.png"
                value={brandingLogoUrl}
                onChange={e => { setBrandingLogoUrl(e.target.value); setBrandingLogoError(false); }}
              />
              {brandingLogoUrl && (
                <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border/50">
                  <p className="text-xs text-muted-foreground shrink-0">Preview:</p>
                  {brandingLogoError ? (
                    <span className="text-xs text-rose-400">Could not load image</span>
                  ) : (
                    <img
                      src={brandingLogoUrl}
                      alt="logo"
                      className="h-8 max-w-[120px] object-contain rounded"
                      onError={() => setBrandingLogoError(true)}
                      onLoad={() => setBrandingLogoError(false)}
                    />
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminBrandColor">Brand Colour</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={brandingColor && /^#[0-9a-f]{3,8}$/i.test(brandingColor) ? brandingColor : "#6366f1"}
                  onChange={e => setBrandingColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-input bg-transparent p-0.5"
                />
                <Input
                  id="adminBrandColor"
                  placeholder="#6366f1"
                  value={brandingColor}
                  onChange={e => setBrandingColor(e.target.value)}
                  className="max-w-[160px] font-mono"
                />
                {brandingColor && /^#[0-9a-f]{3,8}$/i.test(brandingColor) && (
                  <div className="w-6 h-6 rounded-full border border-white/20" style={{ background: brandingColor }} />
                )}
              </div>
            </div>
            {(brandingMerchant?.logoUrl || brandingMerchant?.brandColor) && (
              <div className="rounded-lg bg-muted/20 border border-border/50 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Current saved values:</p>
                <p>Logo: {brandingMerchant.logoUrl ?? <em>none</em>}</p>
                <p>Colour: {brandingMerchant.brandColor ?? <em>none</em>}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBranding}>Cancel</Button>
            <Button onClick={handleSaveBranding} disabled={updateBrandingMutation.isPending}>
              {updateBrandingMutation.isPending ? "Saving…" : "Save Branding"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Status Action Confirmation Dialog */}
      <Dialog open={!!bulkStatusAction} onOpenChange={open => { if (!open) setBulkStatusAction(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {bulkStatusAction === "approve" && <UserCheck className="w-4 h-4 text-emerald-400" />}
              {bulkStatusAction === "suspend" && <UserX className="w-4 h-4 text-orange-400" />}
              {bulkStatusAction === "reinstate" && <RotateCcw className="w-4 h-4 text-sky-400" />}
              {bulkStatusAction === "approve" && "Approve Merchants"}
              {bulkStatusAction === "suspend" && "Suspend Merchants"}
              {bulkStatusAction === "reinstate" && "Reinstate Merchants"}
            </DialogTitle>
            <DialogDescription>
              {bulkStatusAction === "approve" && `Approve ${selected.size} selected merchant${selected.size !== 1 ? "s" : ""}? Their accounts will become active.`}
              {bulkStatusAction === "suspend" && `Suspend ${selected.size} selected merchant${selected.size !== 1 ? "s" : ""}? They will lose access until reinstated.`}
              {bulkStatusAction === "reinstate" && `Reinstate ${selected.size} selected merchant${selected.size !== 1 ? "s" : ""}? Their accounts will be reactivated.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkStatusAction(null)} disabled={isBulkStatusPending}>Cancel</Button>
            <Button
              onClick={handleBulkStatusAction}
              disabled={isBulkStatusPending}
              className={
                bulkStatusAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700 text-white" :
                bulkStatusAction === "suspend" ? "bg-orange-600 hover:bg-orange-700 text-white" :
                "bg-sky-600 hover:bg-sky-700 text-white"
              }
            >
              {isBulkStatusPending ? "Processing..." :
                bulkStatusAction === "approve" ? `Approve ${selected.size}` :
                bulkStatusAction === "suspend" ? `Suspend ${selected.size}` :
                `Reinstate ${selected.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Assign Plan Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={open => { if (!open) closeBulkDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk Assign Plan</DialogTitle>
            <DialogDescription>
              Assign a plan to {selected.size} selected merchant{selected.size !== 1 ? "s" : ""}. This will replace any existing plan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Select Plan *</Label>
              <Select value={bulkPlanId} onValueChange={setBulkPlanId}>
                <SelectTrigger><SelectValue placeholder="Choose a plan..." /></SelectTrigger>
                <SelectContent>
                  {plans?.map(plan => (
                    <SelectItem key={plan.id} value={String(plan.id)}>
                      {plan.name}
                      {plan.monthlyFee !== "0" ? ` — ₹${parseInt(plan.monthlyFee).toLocaleString()}/mo` : " — Free"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {bulkPlanId && plans && (() => {
              const plan = plans.find(p => String(p.id) === bulkPlanId);
              if (!plan) return null;
              return (
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                  <p className="text-sm font-medium">{plan.name}</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>Dynamic QR: {plan.dynamicQrLimit >= 999 ? "∞" : plan.dynamicQrLimit}</span>
                    <span>Virtual Accounts: {plan.virtualAccountLimit >= 999 ? "∞" : plan.virtualAccountLimit}</span>
                    <span>Settlement: {plan.settlementFee}%</span>
                    <span>Daily Tx: {plan.dailyTransactionLimit >= 999 ? "∞" : plan.dailyTransactionLimit}</span>
                    <span>API: {plan.apiAccess ? "✓ Enabled" : "✗ Disabled"}</span>
                    <span>Webhooks: {plan.webhookAccess ? "✓ Enabled" : "✗ Disabled"}</span>
                  </div>
                </div>
              );
            })()}

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Plan Expiry Date (optional)</Label>
              <Input type="date" value={bulkExpiresAt} onChange={e => setBulkExpiresAt(e.target.value)} min={new Date().toISOString().split("T")[0]} />
              <p className="text-xs text-muted-foreground">Leave empty for no expiry.</p>
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea placeholder="e.g. Batch onboarding, promo upgrade..." rows={2} value={bulkNotes} onChange={e => setBulkNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBulkDialog}>Cancel</Button>
            <Button onClick={handleBulkAssign} disabled={!bulkPlanId || bulkAssignMutation.isPending}>
              {bulkAssignMutation.isPending ? "Assigning..." : `Assign to ${selected.size} Merchant${selected.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Plan Dialog */}
      <Dialog open={!!assignPlanMerchant} onOpenChange={closeAssignPlan}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Assign Plan — {assignPlanMerchant?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* Current Plan */}
            {planLoading ? (
              <div className="rounded-lg border border-border/50 bg-muted/10 p-3 animate-pulse h-12" />
            ) : currentMerchantPlan ? (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">Current Plan</p>
                    <p className="text-sm font-semibold">{currentMerchantPlan.planName}</p>
                  </div>
                  {currentMerchantPlan.isExpired && <Badge variant="destructive" className="text-xs">Expired</Badge>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="block font-medium text-foreground">{currentMerchantPlan.settlementFee}%</span>
                    Settlement
                  </div>
                  <div>
                    <span className="block font-medium text-foreground">{currentMerchantPlan.apiAccess ? "✓" : "✗"}</span>
                    API Access
                  </div>
                  <div>
                    <span className="block font-medium text-foreground">
                      {currentMerchantPlan.expiresAt
                        ? (currentMerchantPlan.isExpired ? "Expired" : format(new Date(currentMerchantPlan.expiresAt), "MMM d, yyyy"))
                        : "No expiry"}
                    </span>
                    Expiry
                  </div>
                </div>

                {/* QR Code lifecycle breakdown */}
                {merchantPlanUsage && (
                  <div className="border-t border-primary/10 pt-2 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">QR Code Usage</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md bg-background/50 border border-border/40 px-2.5 py-2 space-y-1.5">
                        <p className="text-xs font-medium text-foreground">Dynamic QR</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-emerald-400">
                            <span className="font-semibold">{merchantPlanUsage.dynamicQr.used}</span>
                            <span className="text-muted-foreground"> active</span>
                          </span>
                          <span className="text-sky-400">
                            <span className="font-semibold">{merchantPlanUsage.dynamicQr.usedCount ?? 0}</span>
                            <span className="text-muted-foreground"> used</span>
                          </span>
                          <span className="text-rose-400">
                            <span className="font-semibold">{merchantPlanUsage.dynamicQr.expiredCount ?? 0}</span>
                            <span className="text-muted-foreground"> expired</span>
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Limit: {merchantPlanUsage.dynamicQr.limit >= 999 ? "∞" : merchantPlanUsage.dynamicQr.limit}
                        </div>
                      </div>
                      <div className="rounded-md bg-background/50 border border-border/40 px-2.5 py-2 space-y-1.5">
                        <p className="text-xs font-medium text-foreground">Static QR</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                          <span className="text-emerald-400">
                            <span className="font-semibold">{merchantPlanUsage.staticQr.used}</span>
                            <span className="text-muted-foreground"> active</span>
                          </span>
                          <span className="text-sky-400">
                            <span className="font-semibold">{merchantPlanUsage.staticQr.usedCount ?? 0}</span>
                            <span className="text-muted-foreground"> used</span>
                          </span>
                          <span className="text-rose-400">
                            <span className="font-semibold">{merchantPlanUsage.staticQr.expiredCount ?? 0}</span>
                            <span className="text-muted-foreground"> expired</span>
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Limit: {merchantPlanUsage.staticQr.limit >= 999 ? "∞" : merchantPlanUsage.staticQr.limit}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/5 p-3 flex items-center gap-2 text-muted-foreground">
                <CreditCard className="w-4 h-4 shrink-0" />
                <p className="text-xs">No plan currently assigned</p>
              </div>
            )}

            {/* Plan Actions (if plan exists) */}
            {currentMerchantPlan && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Actions</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => { setConfirmAction("upgrade"); setSelectedPlanId(""); setActionNotes(""); }}>
                    <TrendingUp className="w-3.5 h-3.5 mr-1" />Upgrade
                  </Button>
                  <Button size="sm" variant="outline" className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={() => { setConfirmAction("downgrade"); setSelectedPlanId(""); setActionNotes(""); }}>
                    <TrendingDown className="w-3.5 h-3.5 mr-1" />Downgrade
                  </Button>
                  {currentMerchantPlan.status !== "suspended" ? (
                    <Button size="sm" variant="outline" className="text-orange-400 border-orange-500/30 hover:bg-orange-500/10" onClick={() => { setConfirmAction("suspend"); setActionNotes(""); }}>
                      <PauseCircle className="w-3.5 h-3.5 mr-1" />Suspend
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" onClick={() => { setConfirmAction("reinstate"); setActionNotes(""); }}>
                      <PlayCircle className="w-3.5 h-3.5 mr-1" />Reinstate
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="text-violet-400 border-violet-500/30 hover:bg-violet-500/10" onClick={() => { setConfirmAction("renew"); setRenewExpiresAt(""); setActionNotes(""); }}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />Renew
                  </Button>
                </div>

                {/* Inline action confirmation */}
                {confirmAction && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                    <p className="text-sm font-medium capitalize">{confirmAction} Plan</p>
                    {(confirmAction === "upgrade" || confirmAction === "downgrade") && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Select Target Plan</Label>
                        <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Choose plan..." /></SelectTrigger>
                          <SelectContent>
                            {plans?.filter(p => String(p.id) !== String(currentMerchantPlan.planId))
                              .map(plan => (
                              <SelectItem key={plan.id} value={String(plan.id)}>
                                {plan.name}{plan.monthlyFee !== "0" ? ` — ₹${parseInt(plan.monthlyFee).toLocaleString()}/mo` : " — Free"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {confirmAction === "renew" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">New Expiry Date</Label>
                        <Input type="date" className="h-8 text-sm" value={renewExpiresAt} onChange={e => setRenewExpiresAt(e.target.value)} min={new Date().toISOString().split("T")[0]} />
                        <p className="text-xs text-muted-foreground">Required. Set the new expiry date for the plan.</p>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Notes (optional)</Label>
                      <Input className="h-8 text-sm" value={actionNotes} onChange={e => setActionNotes(e.target.value)} placeholder="Internal note..." />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setConfirmAction(null); setActionNotes(""); }}>Cancel</Button>
                      <Button size="sm" onClick={() => handlePlanAction(confirmAction)} disabled={isActionPending || ((confirmAction === "upgrade" || confirmAction === "downgrade") && !selectedPlanId)}>
                        {isActionPending ? "Processing..." : `Confirm ${confirmAction.charAt(0).toUpperCase() + confirmAction.slice(1)}`}
                      </Button>
                    </div>
                  </div>
                )}
                <Separator />
              </div>
            )}

            {/* Plan selector (initial assign) */}
            <div className="space-y-2">
              <Label>{currentMerchantPlan ? "Force Change Plan" : "Select Plan"}</Label>
              <Select value={selectedPlanId} onValueChange={v => { setSelectedPlanId(v); setConfirmAction(null); }}>
                <SelectTrigger><SelectValue placeholder="Choose a plan..." /></SelectTrigger>
                <SelectContent>
                  {plans?.map(plan => (
                    <SelectItem key={plan.id} value={String(plan.id)}>
                      {plan.name}
                      {plan.monthlyFee !== "0" ? ` — ₹${parseInt(plan.monthlyFee).toLocaleString()}/mo` : " — Free"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preview selected plan */}
            {selectedPlanId && plans && (() => {
              const plan = plans.find(p => String(p.id) === selectedPlanId);
              if (!plan) return null;
              return (
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                  <p className="text-sm font-medium">{plan.name}</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>Dynamic QR: {plan.dynamicQrLimit >= 999 ? "∞" : plan.dynamicQrLimit}</span>
                    <span>Virtual Accounts: {plan.virtualAccountLimit >= 999 ? "∞" : plan.virtualAccountLimit}</span>
                    <span>Settlement: {plan.settlementFee}%</span>
                    <span>Daily Tx: {plan.dailyTransactionLimit >= 999 ? "∞" : plan.dailyTransactionLimit}</span>
                    <span>API: {plan.apiAccess ? "✓ Enabled" : "✗ Disabled"}</span>
                    <span>Webhooks: {plan.webhookAccess ? "✓ Enabled" : "✗ Disabled"}</span>
                  </div>
                </div>
              );
            })()}

            {/* Expiry Date */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Plan Expiry Date (optional)</Label>
              <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} min={new Date().toISOString().split("T")[0]} />
              <p className="text-xs text-muted-foreground">Leave empty for no expiry.</p>
            </div>

            {/* No-expiry warning for paid plans */}
            {selectedPlanId && !expiresAt && (() => {
              const plan = plans?.find(p => String(p.id) === selectedPlanId);
              if (!plan || plan.monthlyFee === "0") return null;
              return (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">
                    <span className="font-semibold">No expiry date set.</span>{" "}
                    This paid plan ({plan.name}) will never expire — the merchant will not be prompted to renew.
                  </p>
                </div>
              );
            })()}

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea placeholder="e.g. Trial period, special arrangement..." rows={2} value={assignNotes} onChange={e => setAssignNotes(e.target.value)} />
            </div>

            <Separator />

            {/* Plan History toggle */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => setShowHistory(h => !h)}
            >
              <History className="w-4 h-4 mr-2" />
              {showHistory ? "Hide" : "Show"} Plan History
            </Button>

            {showHistory && (
              <div className="space-y-2">
                {!planHistory || planHistory.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">No plan history for this merchant.</p>
                ) : planHistory.map(entry => (
                  <div key={entry.id} className="flex items-start gap-3 text-xs">
                    <div className="w-1 h-1 rounded-full bg-primary/40 mt-1.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium capitalize ${ACTION_COLOR[entry.action] ?? "text-muted-foreground"}`}>{entry.action}</span>
                        {entry.toPlanName && <Badge variant="outline" className="text-xs py-0">{entry.toPlanName}</Badge>}
                        <span className="text-muted-foreground ml-auto">{formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</span>
                      </div>
                      {entry.adminEmail && <p className="text-muted-foreground">by {entry.adminEmail}</p>}
                      {entry.notes && <p className="text-muted-foreground italic">"{entry.notes}"</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAssignPlan}>Cancel</Button>
            <Button onClick={handleAssignPlan} disabled={!selectedPlanId || assignPlanMutation.isPending}>
              {assignPlanMutation.isPending ? "Assigning..." : currentMerchantPlan ? "Change Plan" : "Assign Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
