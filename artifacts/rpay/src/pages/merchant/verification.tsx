import { useState, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  useListKycDocuments,
  useSubmitKycDocument,
  useDeleteKycDocument,
  useRequestKycUploadUrl,
  useGetKycSummary,
  getListKycDocumentsQueryKey,
  type KycDocument,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Upload, Trash2, Loader2, FileText, CheckCircle2, Clock, XCircle, AlertTriangle, Eye, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getApiErrorMessage } from "@/lib/utils";

const DOC_TYPES = [
  { value: "pan", label: "PAN Card", description: "Permanent Account Number card (front & back)" },
  { value: "gst", label: "GST Certificate", description: "Goods and Services Tax registration certificate" },
  { value: "bank_details", label: "Bank Details", description: "Cancelled cheque or bank statement with IFSC" },
  { value: "business_proof", label: "Business Proof", description: "Certificate of incorporation, trade licence, or partnership deed" },
];

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_SIZE = 10 * 1024 * 1024;

function statusBadge(status: string) {
  if (status === "approved") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Approved</Badge>;
  if (status === "rejected") return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30">Rejected</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">Pending Review</Badge>;
}

function DocRow({
  doc,
  onDelete,
  onResubmit,
}: {
  doc: KycDocument;
  onDelete: (id: number) => void;
  onResubmit: (docType: string) => void;
}) {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  const typeLabel = DOC_TYPES.find(d => d.value === doc.docType)?.label ?? doc.docType;
  const fileUrl = doc.fileUrl.startsWith("/") ? `${base}/api/storage${doc.fileUrl}` : doc.fileUrl;
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(doc.id);
    } finally {
      setDeleting(false);
    }
  }

  const isRejected = doc.status === "rejected";

  return (
    <div className={`rounded-lg border bg-card/50 overflow-hidden ${isRejected ? "border-rose-500/40" : "border-border/50"}`}>
      <div className="flex items-center gap-3 p-3">
        <FileText className={`w-4 h-4 shrink-0 ${isRejected ? "text-rose-400" : "text-muted-foreground"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{typeLabel}</span>
            {statusBadge(doc.status)}
          </div>
          {doc.fileName && <p className="text-xs text-muted-foreground truncate mt-0.5">{doc.fileName}</p>}
          <p className="text-xs text-muted-foreground mt-0.5">Submitted {format(new Date(doc.createdAt), "dd MMM yyyy")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={fileUrl} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
              <Eye className="w-4 h-4" />
            </Button>
          </a>
          {doc.status === "pending" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-rose-400/60 hover:text-rose-400"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </Button>
          )}
        </div>
      </div>

      {/* Rejection reason banner */}
      {isRejected && (
        <div className="border-t border-rose-500/30 bg-rose-950/30 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-rose-300 mb-0.5">Rejection reason</p>
              <p className="text-xs text-rose-200/80">
                {doc.adminNote ?? "No reason provided. Please resubmit with the correct document."}
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs border-rose-500/40 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
              onClick={() => onResubmit(doc.docType)}
            >
              <RefreshCw className="w-3 h-3" />
              Resubmit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MerchantVerification() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const merchantId = (user as any)?.merchantId as number | undefined;

  const { data: kycData, isLoading } = useListKycDocuments();
  const { data: summaryData } = useGetKycSummary(merchantId ?? 0, {
    query: { enabled: !!merchantId, queryKey: ["/api/kyc/summary", merchantId] },
  });
  const requestUploadUrl = useRequestKycUploadUrl();
  const submitDoc = useSubmitKycDocument();
  const deleteDoc = useDeleteKycDocument();

  const [showUpload, setShowUpload] = useState(false);
  const [docType, setDocType] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  const docs = kycData?.data ?? [];
  const summary = summaryData;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Only PNG, JPEG, WebP, and PDF files are allowed");
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error("File too large. Maximum size is 10 MB");
      return;
    }
    setSelectedFile(file);
  }

  async function handleUploadAndSubmit() {
    if (!docType || !selectedFile) {
      toast.error("Please select a document type and file");
      return;
    }
    setUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
        data: { name: selectedFile.name, size: selectedFile.size, contentType: selectedFile.type },
      });

      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": selectedFile.type },
        body: selectedFile,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");

      await submitDoc.mutateAsync({
        data: { docType, fileUrl: objectPath, fileName: selectedFile.name },
      });

      toast.success("Document submitted for review");
      qc.invalidateQueries({ queryKey: getListKycDocumentsQueryKey() });
      qc.invalidateQueries({ queryKey: ["/api/kyc/summary"] });
      setShowUpload(false);
      setDocType("");
      setSelectedFile(null);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to submit document"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteDoc.mutateAsync({ id });
      toast.success("Document deleted");
      qc.invalidateQueries({ queryKey: getListKycDocumentsQueryKey() });
      qc.invalidateQueries({ queryKey: ["/api/kyc/summary"] });
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to delete document"));
    }
  }

  function openUpload(prefilledType?: string) {
    setDocType(prefilledType ?? "");
    setSelectedFile(null);
    setShowUpload(true);
  }

  // Types blocked from new upload: already pending or approved (rejected ones can be resubmitted)
  const blockedTypes = new Set(docs.filter(d => d.status !== "rejected").map(d => d.docType));
  const availableDocTypes = DOC_TYPES.filter(dt => !blockedTypes.has(dt.value));

  // Determine overall KYC status
  const hasRejections = (summary?.rejectedCount ?? 0) > 0;
  const isVerified = summary?.isVerified ?? false;
  const hasPending = (summary?.pendingCount ?? 0) > 0;

  // Banner variant: verified → emerald, action required → rose, pending → amber
  const bannerVariant = isVerified ? "verified" : hasRejections ? "action_required" : "pending";

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">KYC Verification</h1>
        <p className="text-muted-foreground mt-1">Submit identity and business documents to verify your account.</p>
      </div>

      {/* Overall Status Banner */}
      {summary && (
        <Alert className={
          bannerVariant === "verified"
            ? "border-emerald-500/40 bg-emerald-950/20"
            : bannerVariant === "action_required"
            ? "border-rose-500/40 bg-rose-950/20"
            : "border-amber-500/40 bg-amber-950/20"
        }>
          {bannerVariant === "verified" ? (
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          ) : bannerVariant === "action_required" ? (
            <XCircle className="w-4 h-4 text-rose-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          )}
          <AlertDescription className={
            bannerVariant === "verified"
              ? "text-emerald-300"
              : bannerVariant === "action_required"
              ? "text-rose-300"
              : "text-amber-300"
          }>
            {bannerVariant === "verified" && (
              "Your account is fully verified. All required documents have been approved."
            )}
            {bannerVariant === "action_required" && (
              <>
                <span className="font-semibold">Action Required —</span>{" "}
                {summary.rejectedCount === 1
                  ? "1 document was rejected."
                  : `${summary.rejectedCount} documents were rejected.`}{" "}
                Review the rejection reason(s) below and resubmit the correct documents.
              </>
            )}
            {bannerVariant === "pending" && (
              `${summary.approvedCount} of ${summary.requiredDocTypes.length} required documents approved.${hasPending ? " Documents are under review." : " Upload all required documents to get verified."}`
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Required Documents Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Required Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {DOC_TYPES.map(dt => {
            const submitted = docs.filter(d => d.docType === dt.value);
            const approved = submitted.find(d => d.status === "approved");
            const pending = submitted.find(d => d.status === "pending");
            const rejected = submitted.find(d => d.status === "rejected");
            const latestRejected = rejected && !approved && !pending ? rejected : null;

            return (
              <div key={dt.value}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {approved ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : pending ? (
                      <Clock className="w-4 h-4 text-amber-400" />
                    ) : rejected ? (
                      <XCircle className="w-4 h-4 text-rose-400" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{dt.label}</p>
                    <p className="text-xs text-muted-foreground">{dt.description}</p>
                    {latestRejected?.adminNote && (
                      <p className="text-xs text-rose-400 mt-1">
                        Rejected: {latestRejected.adminNote}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Submitted Documents */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Submitted Documents</CardTitle>
          {availableDocTypes.length > 0 && (
            <Button size="sm" onClick={() => openUpload()} className="gap-1.5">
              <Upload className="w-3.5 h-3.5" />
              Upload Document
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No documents submitted yet.</p>
              <Button size="sm" className="mt-3 gap-1.5" onClick={() => openUpload()}>
                <Upload className="w-3.5 h-3.5" />
                Upload Your First Document
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {docs.map(doc => (
                <DocRow key={doc.id} doc={doc} onDelete={handleDelete} onResubmit={openUpload} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload / Resubmit Dialog */}
      <Dialog open={showUpload} onOpenChange={open => {
        if (!open) { setDocType(""); setSelectedFile(null); }
        setShowUpload(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {docType && docs.some(d => d.docType === docType && d.status === "rejected")
                ? "Resubmit KYC Document"
                : "Upload KYC Document"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Document Type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select document type…" />
                </SelectTrigger>
                <SelectContent>
                  {availableDocTypes.map(dt => (
                    <SelectItem key={dt.value} value={dt.value}>{dt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {docType && (
                <p className="text-xs text-muted-foreground">{DOC_TYPES.find(d => d.value === docType)?.description}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>File</Label>
              <div
                className="border-2 border-dashed border-border/50 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {selectedFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium truncate max-w-[200px]">{selectedFile.name}</span>
                  </div>
                ) : (
                  <>
                    <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click to select a file</p>
                    <p className="text-xs text-muted-foreground mt-1">PNG, JPEG, WebP, or PDF · max 10 MB</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.pdf"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpload(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleUploadAndSubmit} disabled={!docType || !selectedFile || uploading}>
              {uploading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Uploading…</>
                : docs.some(d => d.docType === docType && d.status === "rejected")
                ? "Resubmit Document"
                : "Submit Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
