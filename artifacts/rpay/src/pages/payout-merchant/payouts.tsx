import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowRightLeft, Plus, ChevronLeft, ChevronRight, Clock, CheckCircle2, XCircle, Zap, PauseCircle, ShieldAlert, MoreHorizontal, FileText, Download, Share2, Copy } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { PayoutSlipModal } from "@/components/payout-slip-modal";

const MIN_PAYOUT_AMOUNT = 1;

function maskAccountNumber(acct: string | null | undefined): string {
  if (!acct) return "—";
  if (acct.length <= 4) return "****";
  return "*".repeat(Math.max(acct.length - 4, 4)) + acct.slice(-4);
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error ?? "Request failed"); }
  return res.json();
}

function fmtAmount(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Sent": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    "Processing": "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "Failed": "bg-red-500/15 text-red-400 border-red-500/30",
    "Reversed": "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "Rejected": "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`text-[10px] border ${map[status] ?? "bg-muted/30 text-muted-foreground border-border"}`}>
      {status}
    </Badge>
  );
}

async function downloadPdf(id: number, receiptId?: string) {
  try {
    const token = getToken();
    const resp = await fetch(`/api/withdrawals/${id}/slip.pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error("Download failed");
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `RasoKart-Payout-${receiptId ?? `RK-PO-${String(id).padStart(6, "0")}`}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("PDF downloaded");
  } catch {
    toast.error("Failed to download PDF");
  }
}

async function shareSlip(id: number) {
  try {
    const token = getToken();
    const resp = await fetch(`/api/withdrawals/${id}/slip/share-link`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) throw new Error("Share failed");
    const { url } = await resp.json() as { url: string };
    const full = `${window.location.origin}${url}`;
    await navigator.clipboard.writeText(full);
    toast.success("Share link copied to clipboard");
  } catch {
    toast.error("Failed to generate share link");
  }
}

export default function PayoutMerchantPayouts() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [slipPayoutId, setSlipPayoutId] = useState<number | null>(null);
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string>("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [form, setForm] = useState({
    amount: "",
    payoutMode: "IMPS",
    remarks: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["payout-merchant-payouts", page],
    queryFn: () => apiFetch<any>(`/api/payout-merchant/payouts?page=${page}&limit=25`),
  });

  const { data: bens } = useQuery({
    queryKey: ["payout-merchant-bens"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/beneficiaries"),
  });

  const { data: apStatus } = useQuery({
    queryKey: ["payout-merchant-auto-payout"],
    queryFn: () => apiFetch<any>("/api/payout-merchant/auto-payout"),
    staleTime: 60_000,
  });

  const allBeneficiaries: any[] = bens?.beneficiaries ?? [];
  const verifiedBeneficiaries = allBeneficiaries.filter((b) => b.verificationStatus === "VERIFIED");
  const selectedBeneficiary = allBeneficiaries.find((b) => String(b.id) === selectedBeneficiaryId) ?? null;

  const openCreateDialog = () => {
    setSelectedBeneficiaryId(verifiedBeneficiaries.length === 1 ? String(verifiedBeneficiaries[0].id) : "");
    setForm({ amount: "", payoutMode: verifiedBeneficiaries.length === 1 ? verifiedBeneficiaries[0].payoutMode : "IMPS", remarks: "" });
    setIdempotencyKey(crypto.randomUUID());
    setShowCreate(true);
  };

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      apiFetch<any>("/api/payout-merchant/payouts", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Payout submitted successfully");
      setShowCreate(false);
      setSelectedBeneficiaryId("");
      setForm({ amount: "", payoutMode: "IMPS", remarks: "" });
      qc.invalidateQueries({ queryKey: ["payout-merchant-payouts"] });
      qc.invalidateQueries({ queryKey: ["payout-merchant-stats"] });
      qc.invalidateQueries({ queryKey: ["payout-merchant-wallet"] });
    },
    onError: (err: any) => toast.error(err.message ?? "Failed to submit payout"),
  });

  const handleCreate = () => {
    if (createMutation.isPending) return; // extra guard against double-click races
    if (verifiedBeneficiaries.length === 0) {
      toast.error("Add and verify a beneficiary first.");
      setShowCreate(false);
      setLocation("/payout-merchant/beneficiaries");
      return;
    }
    if (!selectedBeneficiary || selectedBeneficiary.verificationStatus !== "VERIFIED") {
      toast.error("Select a verified beneficiary to continue");
      return;
    }
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (amt < MIN_PAYOUT_AMOUNT) { toast.error(`Minimum payout amount is ₹${MIN_PAYOUT_AMOUNT}`); return; }
    createMutation.mutate({
      amount: amt,
      beneficiaryId: selectedBeneficiary.id,
      payoutMode: form.payoutMode,
      remarks: form.remarks || undefined,
      idempotencyKey,
    });
  };

  const payouts = data?.payouts ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payouts</h1>
          <p className="text-sm text-muted-foreground mt-1">Send and track payout transfers</p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="w-4 h-4" /> New Payout
        </Button>
      </div>

      {apStatus?.autoPayoutEnabled && !apStatus?.autoPayoutPaused && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-center gap-3 text-sm">
          <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
          <div>
            <span className="font-medium text-emerald-400">Auto Payout Active</span>
            <span className="text-emerald-400/70 ml-2 text-xs">Your eligible payouts are automatically approved and dispatched without manual review.</span>
          </div>
        </div>
      )}
      {apStatus?.autoPayoutEnabled && apStatus?.autoPayoutPaused && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center gap-3 text-sm">
          <PauseCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <div>
            <span className="font-medium text-amber-400">Auto Payout Paused</span>
            <span className="text-amber-400/70 ml-2 text-xs">Auto-approval is temporarily suspended. Payouts will go to manual review.</span>
          </div>
        </div>
      )}

      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Spinner className="w-6 h-6 text-muted-foreground" /></div>
          ) : payouts.length === 0 ? (
            <div className="py-14 text-center">
              <ArrowRightLeft className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No payouts yet</p>
              <Button className="mt-4" onClick={openCreateDialog}>Send First Payout</Button>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border/40">
                {/* Header */}
                <div className="grid grid-cols-[1fr_120px_100px_100px_40px] gap-4 px-4 py-2 text-xs text-muted-foreground font-medium">
                  <span>Recipient</span>
                  <span>Amount</span>
                  <span>Mode</span>
                  <span>Status</span>
                  <span />
                </div>
                {payouts.map((p: any) => (
                  <div key={p.id} className="grid grid-cols-[1fr_120px_100px_100px_40px] gap-4 px-4 py-3 items-center hover:bg-muted/10 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.accountHolder ?? p.upiId ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(p.createdAt), "dd MMM yyyy, HH:mm")}</p>
                      {p.utr && <p className="text-[10px] text-emerald-400 font-mono mt-0.5">UTR: {p.utr}</p>}
                      {p.failureReason && <p className="text-[10px] text-red-400 mt-0.5 truncate">{p.failureReason}</p>}
                    </div>
                    <p className="text-sm font-semibold text-foreground">{fmtAmount(p.amount)}</p>
                    <p className="text-xs text-muted-foreground">{p.payoutMode}</p>
                    <StatusBadge status={p.displayStatus} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setSlipPayoutId(p.id)}>
                          <FileText className="w-4 h-4 mr-2" />
                          View Slip
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => downloadPdf(p.id, `RK-PO-${String(p.id).padStart(6, "0")}`)}>
                          <Download className="w-4 h-4 mr-2" />
                          Download PDF
                        </DropdownMenuItem>
                        {p.displayStatus === "Sent" && (
                          <DropdownMenuItem onClick={() => shareSlip(p.id)}>
                            <Share2 className="w-4 h-4 mr-2" />
                            Share Link
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => {
                          navigator.clipboard.writeText(String(p.id));
                          toast.success("Payout ID copied");
                        }}>
                          <Copy className="w-4 h-4 mr-2" />
                          Copy ID
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
                  <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="w-4 h-4" /></Button>
                    <Button size="sm" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}><ChevronRight className="w-4 h-4" /></Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Payout slip modal */}
      <PayoutSlipModal
        payoutId={slipPayoutId}
        open={slipPayoutId !== null}
        onClose={() => setSlipPayoutId(null)}
      />

      {/* Create payout dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Payout</DialogTitle>
          </DialogHeader>

          {verifiedBeneficiaries.length === 0 ? (
            <div className="space-y-4 py-2">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-start gap-3 text-sm">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-amber-400">Add and verify a beneficiary first.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={() => { setShowCreate(false); setLocation("/payout-merchant/beneficiaries"); }}>
                  Go to Beneficiaries
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Select Saved Beneficiary</Label>
                <Select value={selectedBeneficiaryId} onValueChange={(v) => {
                  setSelectedBeneficiaryId(v);
                  const b = allBeneficiaries.find((x) => String(x.id) === v);
                  if (b) setForm((f) => ({ ...f, payoutMode: b.payoutMode }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Choose a verified beneficiary" /></SelectTrigger>
                  <SelectContent>
                    {allBeneficiaries.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)} disabled={b.verificationStatus !== "VERIFIED"}>
                        {b.accountHolder ?? b.upiId ?? "Beneficiary"} — {b.payoutMode === "UPI" ? b.upiId : `${b.bankName ?? ""} ${b.bankAccountMasked ?? maskAccountNumber(b.bankAccount)}`}
                        {" "}({b.verificationStatus === "VERIFIED" ? "Verified" : b.verificationStatus === "FAILED" ? "Failed" : "Pending"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedBeneficiary && (
                <div className="rounded-md border border-border/50 bg-muted/10 p-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Account Holder</span>
                    <span className="font-medium">{selectedBeneficiary.accountHolder ?? "—"}</span>
                  </div>
                  {selectedBeneficiary.payoutMode === "UPI" ? (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">UPI ID</span>
                      <span className="font-mono text-xs">{selectedBeneficiary.upiId}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">Bank</span>
                        <span>{selectedBeneficiary.bankName ?? "—"}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">Account Number</span>
                        <span className="font-mono text-xs">{selectedBeneficiary.bankAccountMasked ?? maskAccountNumber(selectedBeneficiary.bankAccount)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">IFSC</span>
                        <span className="font-mono text-xs">{selectedBeneficiary.ifscCode ?? "—"}</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Status</span>
                    <Badge variant="outline" className="text-[10px] border-emerald-500/30 bg-emerald-500/15 text-emerald-400">Verified</Badge>
                  </div>
                </div>
              )}

              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Amount (₹)</Label>
                <Input type="number" min={MIN_PAYOUT_AMOUNT} placeholder="e.g. 5000" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                <p className="text-[10px] text-muted-foreground mt-1">Minimum payout amount is ₹{MIN_PAYOUT_AMOUNT}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Payout Mode</Label>
                <Select value={form.payoutMode} onValueChange={v => setForm(f => ({ ...f, payoutMode: v }))} disabled={selectedBeneficiary?.payoutMode === "UPI"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {selectedBeneficiary?.payoutMode === "UPI" ? (
                      <SelectItem value="UPI">UPI</SelectItem>
                    ) : (
                      <>
                        <SelectItem value="IMPS">IMPS (Instant)</SelectItem>
                        <SelectItem value="NEFT">NEFT</SelectItem>
                        <SelectItem value="RTGS">RTGS</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5">Remarks (optional)</Label>
                <Input placeholder="Internal note" value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending || !selectedBeneficiary}>
                  {createMutation.isPending ? <Spinner className="w-4 h-4 mr-2" /> : null}
                  Submit Payout
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
