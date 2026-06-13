import { useState } from "react";
import {
  useListKycDocuments,
  useReviewKycDocument,
  useGetKycReviewHistory,
  getListKycDocumentsQueryKey,
  type KycDocument,
  type KycReviewHistoryEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle, XCircle, Eye, Loader2, FileText, Search, ShieldCheck, Clock, AlertTriangle, History } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getApiErrorMessage } from "@/lib/utils";

const DOC_TYPE_LABELS: Record<string, string> = {
  pan: "PAN Card",
  gst: "GST Certificate",
  bank_details: "Bank Details",
  business_proof: "Business Proof",
};

function statusBadge(status: string) {
  if (status === "approved") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Approved</Badge>;
  if (status === "rejected") return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30">Rejected</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">Pending</Badge>;
}

interface ReviewDialogProps {
  doc: KycDocument | null;
  action: "approved" | "rejected" | null;
  onClose: () => void;
  onConfirm: (id: number, status: string, note: string) => Promise<void>;
}

function ReviewDialog({ doc, action, onClose, onConfirm }: ReviewDialogProps) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    if (!doc || !action) return;
    setLoading(true);
    try {
      await onConfirm(doc.id, action, note);
      setNote("");
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!doc && !!action} onOpenChange={() => { setNote(""); onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{action === "approved" ? "Approve Document" : "Reject Document"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {doc && (
            <div className="rounded-lg border border-border/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Document type</span>
                <span className="font-medium">{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Merchant ID</span>
                <span className="font-medium">{doc.merchantId}</span>
              </div>
              {doc.fileName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">File</span>
                  <span className="font-medium truncate max-w-[180px]">{doc.fileName}</span>
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{action === "rejected" ? "Rejection reason (required)" : "Note (optional)"}</Label>
            <Textarea
              placeholder={action === "rejected" ? "Explain why this document is rejected…" : "Add a note for the merchant…"}
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setNote(""); onClose(); }} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || (action === "rejected" && !note.trim())}
            className={action === "approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {action === "approved" ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ReviewHistorySheetProps {
  doc: KycDocument | null;
  onClose: () => void;
}

function ReviewHistorySheet({ doc, onClose }: ReviewHistorySheetProps) {
  const { data, isLoading } = useGetKycReviewHistory(doc?.id ?? 0, {
    query: { enabled: !!doc, queryKey: ["getKycReviewHistory", doc?.id ?? 0] },
  });

  const entries: KycReviewHistoryEntry[] = data?.data ?? [];

  return (
    <Sheet open={!!doc} onOpenChange={() => onClose()}>
      <SheetContent className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <History className="w-4 h-4" />
            Review History
          </SheetTitle>
          {doc && (
            <p className="text-sm text-muted-foreground">
              {DOC_TYPE_LABELS[doc.docType] ?? doc.docType} — Merchant #{doc.merchantId}
            </p>
          )}
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No review decisions recorded yet.</p>
            <p className="text-xs mt-1">This document has not been reviewed.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-border/50 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  {entry.status === "approved" ? (
                    <div className="flex items-center gap-1.5 text-emerald-400 text-sm font-medium">
                      <CheckCircle className="w-4 h-4" />
                      Approved
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-rose-400 text-sm font-medium">
                      <XCircle className="w-4 h-4" />
                      Rejected
                    </div>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(entry.createdAt), "dd MMM yyyy, HH:mm")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Reviewed by{" "}
                  <span className="text-foreground font-medium">
                    {entry.reviewerName ?? entry.reviewerEmail ?? `Admin #${entry.reviewedBy}`}
                  </span>
                  {entry.reviewerEmail && entry.reviewerName && (
                    <span className="ml-1">({entry.reviewerEmail})</span>
                  )}
                </div>
                {entry.adminNote && (
                  <div className="rounded bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                    <span className="text-foreground/60 font-medium">Note: </span>
                    {entry.adminNote}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function AdminKycReview() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [merchantIdFilter, setMerchantIdFilter] = useState("");
  const [reviewDoc, setReviewDoc] = useState<KycDocument | null>(null);
  const [reviewAction, setReviewAction] = useState<"approved" | "rejected" | null>(null);
  const [historyDoc, setHistoryDoc] = useState<KycDocument | null>(null);

  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const params = {
    status: statusFilter !== "all" ? statusFilter : undefined,
    merchantId: merchantIdFilter ? parseInt(merchantIdFilter) : undefined,
  };

  const { data, isLoading } = useListKycDocuments(params);
  const reviewMutation = useReviewKycDocument();

  const docs = data?.data ?? [];

  async function handleReview(id: number, status: string, adminNote: string) {
    try {
      await reviewMutation.mutateAsync({ id, data: { status, adminNote: adminNote || undefined } });
      toast.success(`Document ${status}`);
      qc.invalidateQueries({ queryKey: getListKycDocumentsQueryKey() });
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to review document"));
      throw err;
    }
  }

  function openReview(doc: KycDocument, action: "approved" | "rejected") {
    setReviewDoc(doc);
    setReviewAction(action);
  }

  function closeReview() {
    setReviewDoc(null);
    setReviewAction(null);
  }

  const pendingCount = (data?.total ?? 0);
  const fileUrl = (doc: KycDocument) => doc.fileUrl.startsWith("/") ? `${base}/api/storage${doc.fileUrl}` : doc.fileUrl;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">KYC Review</h1>
          <p className="text-muted-foreground mt-1">Review merchant identity and business documents.</p>
        </div>
        {statusFilter === "pending" && pendingCount > 0 && (
          <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 gap-1.5 px-3 py-1.5 text-sm">
            <Clock className="w-3.5 h-3.5" />
            {pendingCount} pending
          </Badge>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Merchant ID…"
            value={merchantIdFilter}
            onChange={e => setMerchantIdFilter(e.target.value.replace(/\D/g, ""))}
            className="pl-8 w-36"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No documents{statusFilter !== "all" ? ` with status "${statusFilter}"` : ""} found.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Document Type</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map(doc => (
                  <TableRow key={doc.id}>
                    <TableCell className="font-mono text-xs">{doc.merchantId}</TableCell>
                    <TableCell className="font-medium">{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</TableCell>
                    <TableCell>
                      <a
                        href={fileUrl(doc)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-primary hover:underline text-xs"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        {doc.fileName ? (
                          <span className="truncate max-w-[120px]">{doc.fileName}</span>
                        ) : "View file"}
                      </a>
                    </TableCell>
                    <TableCell>{statusBadge(doc.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(doc.createdAt), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {doc.reviewedAt ? format(new Date(doc.reviewedAt), "dd MMM yyyy") : "—"}
                      {doc.adminNote && (
                        <p className="text-rose-400 mt-0.5 truncate max-w-[120px]">{doc.adminNote}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-muted-foreground hover:text-foreground"
                          onClick={() => setHistoryDoc(doc)}
                          title="View review history"
                        >
                          <History className="w-3.5 h-3.5" />
                          History
                        </Button>
                        {doc.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                              onClick={() => openReview(doc, "approved")}
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                              onClick={() => openReview(doc, "rejected")}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ReviewDialog
        doc={reviewDoc}
        action={reviewAction}
        onClose={closeReview}
        onConfirm={handleReview}
      />

      <ReviewHistorySheet
        doc={historyDoc}
        onClose={() => setHistoryDoc(null)}
      />
    </div>
  );
}
