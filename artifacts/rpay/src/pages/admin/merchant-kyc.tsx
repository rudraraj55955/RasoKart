import { useState, useEffect } from "react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

const auth = () => `Bearer ${localStorage.getItem("rasokart_token")}`;

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/merchant-kyc${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: auth(), ...(opts?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Something went wrong");
  return data as T;
}

interface Row {
  merchantId: number;
  businessName: string;
  email: string;
  verificationStatus: string;
  panVerified: boolean;
  aadhaarVerified: boolean;
  nameMatchScore: number | null;
  failureReason: string | null;
  updatedAt: string;
}

interface Detail extends Row {
  ownerName?: string;
  panNumberMasked?: string;
  panName?: string;
  aadhaarLast4?: string;
  aadhaarName?: string;
  adminDecisionBy?: string;
  adminDecisionNote?: string;
  logs: { id: number; verificationType: string; status: string; errorReason: string | null; createdAt: string }[];
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    APPROVED: "bg-emerald-600",
    REJECTED: "bg-red-600",
    NAME_MISMATCH: "bg-red-600",
    PAN_FAILED: "bg-red-600",
    AADHAAR_FAILED: "bg-red-600",
    NAME_MATCH_PENDING_REVIEW: "bg-amber-600",
  };
  return <Badge className={`${map[status] || "bg-neutral-600"} text-white`}>{status.replace(/_/g, " ")}</Badge>;
}

export default function AdminMerchantKyc() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api<Row[]>("/").then(setRows).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openDetail = async (merchantId: number) => {
    try {
      const d = await api<Detail>(`/${merchantId}`);
      setSelected(d);
      setNote("");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const override = async (decision: "APPROVED" | "REJECTED") => {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/${selected.merchantId}/override`, { method: "POST", body: JSON.stringify({ decision, note }) });
      toast.success(`Merchant ${decision === "APPROVED" ? "approved" : "rejected"}`);
      setSelected(null);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-500" /> Merchant Auto KYC
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Review automated PAN + Aadhaar KYC verification results.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verification Records</CardTitle>
            <CardDescription>All merchants who have started or completed auto-KYC.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No auto-KYC records yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Merchant</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>PAN</TableHead>
                    <TableHead>Aadhaar</TableHead>
                    <TableHead>Match Score</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.merchantId}>
                      <TableCell>
                        <div className="font-medium">{r.businessName}</div>
                        <div className="text-xs text-muted-foreground">{r.email}</div>
                      </TableCell>
                      <TableCell>{statusBadge(r.verificationStatus)}</TableCell>
                      <TableCell>{r.panVerified ? "✓" : "—"}</TableCell>
                      <TableCell>{r.aadhaarVerified ? "✓" : "—"}</TableCell>
                      <TableCell>{r.nameMatchScore ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(r.updatedAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => openDetail(r.merchantId)}>View</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected?.businessName}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Owner name:</span> {selected.ownerName}</div>
                <div><span className="text-muted-foreground">Status:</span> {statusBadge(selected.verificationStatus)}</div>
                <div><span className="text-muted-foreground">PAN:</span> {selected.panNumberMasked ?? "—"} ({selected.panName ?? "—"})</div>
                <div><span className="text-muted-foreground">Aadhaar:</span> ••••{selected.aadhaarLast4 ?? "----"} ({selected.aadhaarName ?? "—"})</div>
                <div><span className="text-muted-foreground">Match score:</span> {selected.nameMatchScore ?? "—"}</div>
                {selected.failureReason && <div className="col-span-2 text-red-500">{selected.failureReason}</div>}
                {selected.adminDecisionBy && (
                  <div className="col-span-2 text-xs text-muted-foreground">Last decision by {selected.adminDecisionBy}{selected.adminDecisionNote ? `: ${selected.adminDecisionNote}` : ""}</div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Audit trail (RasoKart KYC Verification)</p>
                <div className="max-h-40 overflow-y-auto space-y-1 border rounded-md p-2">
                  {selected.logs.length === 0 && <p className="text-xs text-muted-foreground">No log entries.</p>}
                  {selected.logs.map((l) => (
                    <div key={l.id} className="text-xs flex justify-between">
                      <span>{l.verificationType} — {l.status}{l.errorReason ? ` (${l.errorReason})` : ""}</span>
                      <span className="text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Textarea placeholder="Decision note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="destructive" disabled={busy} onClick={() => override("REJECTED")}>Reject</Button>
            <Button disabled={busy} onClick={() => override("APPROVED")}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
