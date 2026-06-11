import { useState } from "react";
import {
  useListPaymentLinks,
  useCreatePaymentLink,
  useUpdatePaymentLink,
  useDeletePaymentLink,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Plus, Trash2, Link2, Copy, ExternalLink, CheckCircle2, XCircle, Hash, Pencil } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getApiErrorMessage } from "@/lib/utils";

type LinkRow = {
  id: number;
  merchantId: number;
  title: string;
  description?: string | null;
  amount?: string | null;
  currency: string;
  slug: string;
  url?: string;
  upiPayload?: string | null;
  status: string;
  paymentCount: number;
  maxPayments?: number | null;
  expiresAt?: string | null;
  callbackUrl?: string | null;
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

function PaymentCountCell({ link }: { link: LinkRow }) {
  const count = link.paymentCount ?? 0;
  const max = link.maxPayments;
  const nearLimit = max != null && count >= max * 0.8;
  const atLimit = max != null && count >= max;

  if (max == null) {
    return (
      <span className={`font-mono text-sm tabular-nums ${count > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
        {count}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className={`font-mono text-sm tabular-nums ${atLimit ? "text-rose-400" : nearLimit ? "text-amber-400" : "text-emerald-400"}`}>
        {count} / {max}
      </span>
      <div className="w-16 h-1 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${atLimit ? "bg-rose-500" : nearLimit ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, (count / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function MerchantPaymentLinks() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [editLink, setEditLink] = useState<LinkRow | null>(null);
  const [editMaxPayments, setEditMaxPayments] = useState("");

  const [form, setForm] = useState({
    title: "",
    description: "",
    amount: "",
    maxPayments: "",
    expiresAt: "",
    callbackUrl: "",
  });

  const { data, isLoading } = useListPaymentLinks({ status: status as any, search, page, limit: 20 });
  const createMutation = useCreatePaymentLink();
  const updateMutation = useUpdatePaymentLink();
  const deleteMutation = useDeletePaymentLink();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/payment-links"] });

  const resetForm = () => setForm({ title: "", description: "", amount: "", maxPayments: "", expiresAt: "", callbackUrl: "" });

  const handleCreate = () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    createMutation.mutate(
      {
        data: {
          title: form.title.trim(),
          description: form.description || null,
          amount: form.amount || null,
          maxPayments: form.maxPayments ? parseInt(form.maxPayments) : null,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
          callbackUrl: form.callbackUrl || null,
        } as any,
      },
      {
        onSuccess: () => {
          toast.success("Payment link created");
          setShowCreate(false);
          resetForm();
          invalidate();
        },
        onError: (err: unknown) => {
          toast.error(getApiErrorMessage(err, "Failed to create payment link"));
        },
      }
    );
  };

  const handleToggleStatus = (link: LinkRow) => {
    const newStatus = link.status === "active" ? "inactive" : "active";
    updateMutation.mutate(
      { id: link.id, data: { status: newStatus as any } },
      {
        onSuccess: () => { toast.success(`Link ${newStatus === "active" ? "activated" : "deactivated"}`); invalidate(); },
        onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to update link")),
      }
    );
  };

  const openEdit = (link: LinkRow) => {
    setEditLink(link);
    setEditMaxPayments(link.maxPayments != null ? String(link.maxPayments) : "");
  };

  const handleSaveEdit = () => {
    if (!editLink) return;
    const maxPayments = editMaxPayments.trim() === "" ? null : parseInt(editMaxPayments.trim());
    if (maxPayments !== null && (isNaN(maxPayments) || maxPayments < 1)) {
      toast.error("Max payments must be a positive number, or leave blank to remove the cap");
      return;
    }
    updateMutation.mutate(
      { id: editLink.id, data: { maxPayments } as any },
      {
        onSuccess: () => {
          toast.success("Payment cap updated");
          setEditLink(null);
          invalidate();
        },
        onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to update payment cap")),
      }
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this payment link? It will no longer be accessible.")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("Payment link deleted"); invalidate(); },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to delete")),
    });
  };

  const links = (data?.data ?? []) as LinkRow[];
  const activeCount = links.filter(l => l.status === "active").length;
  const inactiveCount = links.filter(l => l.status === "inactive").length;
  const totalPayments = links.reduce((sum, l) => sum + (l.paymentCount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payment Links</h1>
          <p className="text-muted-foreground mt-1">Create shareable links customers can open to pay you</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1.5" />New Link
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Links", value: data?.total ?? 0, color: "text-primary", bg: "bg-primary/10", icon: Link2 },
          { label: "Active", value: activeCount, color: "text-emerald-400", bg: "bg-emerald-500/10", icon: Link2 },
          { label: "Inactive", value: inactiveCount, color: "text-amber-400", bg: "bg-amber-500/10", icon: Link2 },
          { label: "Total Payments", value: totalPayments, color: "text-violet-400", bg: "bg-violet-500/10", icon: Hash },
        ].map(stat => (
          <Card key={stat.label}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">{stat.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
                </div>
                <div className={`w-10 h-10 ${stat.bg} rounded-lg flex items-center justify-center`}>
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search title or slug..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
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
                <TableHead>Amount</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Payments</TableHead>
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
              ) : !links.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-14">
                    <Link2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No payment links yet</p>
                    <p className="text-xs mt-1 opacity-60">Create your first link to share with customers</p>
                  </TableCell>
                </TableRow>
              ) : links.map(link => {
                const isExpired = link.expiresAt ? new Date(link.expiresAt) < new Date() : false;
                const payUrl = link.url ?? `${window.location.origin}/pay/${link.slug}`;
                return (
                  <TableRow key={link.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{link.title}</p>
                        {link.description && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{link.description}</p>}
                      </div>
                    </TableCell>
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
                    <TableCell>
                      <PaymentCountCell link={link} />
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
                        <button
                          className={`p-1 rounded hover:bg-muted/50 ${link.status === "active" ? "text-emerald-400 hover:text-emerald-300" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => handleToggleStatus(link)}
                          title={link.status === "active" ? "Deactivate" : "Activate"}
                          disabled={link.status === "expired" || isExpired}>
                          {link.status === "active" ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                        </button>
                        <button className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted/50"
                          onClick={() => openEdit(link)} title="Edit payment cap">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
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

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={v => { setShowCreate(v); if (!v) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Payment Link</DialogTitle>
            <p className="text-sm text-muted-foreground">A shareable URL customers can open to pay you.</p>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title <span className="text-rose-400">*</span></Label>
              <Input placeholder="e.g. Invoice #42 Payment" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea placeholder="What is this payment for?" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="resize-none h-20" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount (₹) <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input type="number" step="0.01" placeholder="e.g. 1500.00" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Max Payments <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input type="number" min="1" step="1" placeholder="e.g. 10" value={form.maxPayments}
                  onChange={e => setForm(f => ({ ...f, maxPayments: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Expiry <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input type="datetime-local" value={form.expiresAt}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Callback URL <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input type="url" placeholder="https://your-site.com/webhook" value={form.callbackUrl}
                onChange={e => setForm(f => ({ ...f, callbackUrl: e.target.value }))} />
            </div>
            {form.maxPayments && (
              <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                This link will automatically expire after <span className="text-foreground font-medium">{form.maxPayments}</span> payment{parseInt(form.maxPayments) !== 1 ? "s" : ""} are recorded.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editLink && (
        <Dialog open onOpenChange={() => setEditLink(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Edit Payment Cap</DialogTitle>
              <p className="text-sm text-muted-foreground">
                Set a maximum number of payments for <span className="text-foreground font-medium">{editLink.title}</span>.
                Leave blank to remove the cap.
              </p>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Max Payments <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 10 — leave blank to remove cap"
                  value={editMaxPayments}
                  onChange={e => setEditMaxPayments(e.target.value)}
                  autoFocus
                />
              </div>
              {editLink.paymentCount > 0 && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  This link already has <span className="text-foreground font-medium">{editLink.paymentCount}</span> payment{editLink.paymentCount !== 1 ? "s" : ""} recorded.
                  {editMaxPayments && parseInt(editMaxPayments) <= editLink.paymentCount
                    ? " The new cap is at or below the current count — the link will not accept further payments."
                    : ""}
                </p>
              )}
              {editMaxPayments && parseInt(editMaxPayments) > 0 && (editLink.paymentCount === 0 || parseInt(editMaxPayments) > editLink.paymentCount) && (
                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                  Link will automatically deactivate after <span className="text-foreground font-medium">{editMaxPayments}</span> payment{parseInt(editMaxPayments) !== 1 ? "s" : ""} are recorded.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditLink(null)}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
