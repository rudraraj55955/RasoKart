import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyVerification,
  useSubmitVerification,
  useListVerificationDocuments,
  useRequestVerificationUploadUrl,
  useAddVerificationDocument,
  useDeleteVerificationDocument,
  getGetMyVerificationQueryKey,
  getListVerificationDocumentsQueryKey,
  SubmitVerificationInputBusinessType,
  AddVerificationDocumentInputDocType,
  type MerchantVerification,
  type MerchantDocument,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  ShieldCheck, ShieldAlert, ShieldOff, Clock, CheckCircle2, AlertTriangle,
  Upload, Trash2, Loader2, FileText, Eye, Building2, CreditCard,
  User, Phone, Mail, Globe, MapPin, Banknote, Info, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getApiErrorMessage } from "@/lib/utils";

const ALLOWED_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

const DOC_TYPE_LABELS: Record<string, string> = {
  pan: "PAN Card",
  gst: "GST Certificate",
  bank_statement: "Bank Statement",
  address_proof: "Address Proof",
  business_registration: "Business Registration",
  cancelled_cheque: "Cancelled Cheque",
  other: "Other Document",
};

const BUSINESS_TYPES = [
  { value: "sole_proprietorship", label: "Sole Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "private_limited", label: "Private Limited (Pvt Ltd)" },
  { value: "llp", label: "LLP (Limited Liability Partnership)" },
  { value: "other", label: "Other" },
];

const VOLUME_OPTIONS = [
  { value: "<1L", label: "Less than ₹1 Lakh/month" },
  { value: "1L-10L", label: "₹1 Lakh – ₹10 Lakhs/month" },
  { value: "10L-1Cr", label: "₹10 Lakhs – ₹1 Crore/month" },
  { value: ">1Cr", label: "More than ₹1 Crore/month" },
];

function VerificationStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    rejected: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    under_review: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    needs_info: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    suspended: "bg-red-500/15 text-red-400 border-red-500/30",
    pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  };
  const labels: Record<string, string> = {
    approved: "Approved",
    rejected: "Rejected",
    under_review: "Under Review",
    needs_info: "Info Required",
    suspended: "Suspended",
    pending: "Pending",
  };
  return (
    <Badge variant="outline" className={styles[status] ?? "bg-muted/20 text-muted-foreground"}>
      {labels[status] ?? status}
    </Badge>
  );
}

function StatusBanner({ verification }: { verification: MerchantVerification | null }) {
  if (!verification) {
    return (
      <Alert className="border-muted/50 bg-muted/10">
        <Info className="w-4 h-4 text-muted-foreground" />
        <AlertDescription className="text-muted-foreground">
          Complete your business verification to unlock all platform features including live payments, API access, and payouts.
        </AlertDescription>
      </Alert>
    );
  }

  const configs: Record<string, { icon: typeof ShieldCheck; bg: string; text: string; title: string }> = {
    approved: {
      icon: ShieldCheck,
      bg: "border-emerald-500/40 bg-emerald-950/20",
      text: "text-emerald-300",
      title: "Verification Approved",
    },
    rejected: {
      icon: ShieldAlert,
      bg: "border-rose-500/40 bg-rose-950/20",
      text: "text-rose-300",
      title: "Verification Rejected",
    },
    under_review: {
      icon: Clock,
      bg: "border-blue-500/40 bg-blue-950/20",
      text: "text-blue-300",
      title: "Under Review",
    },
    needs_info: {
      icon: AlertTriangle,
      bg: "border-orange-500/40 bg-orange-950/20",
      text: "text-orange-300",
      title: "Additional Info Required",
    },
    suspended: {
      icon: ShieldOff,
      bg: "border-red-500/40 bg-red-950/20",
      text: "text-red-300",
      title: "Account Suspended",
    },
    pending: {
      icon: Clock,
      bg: "border-amber-500/40 bg-amber-950/20",
      text: "text-amber-300",
      title: "Verification Pending",
    },
  };

  const cfg = configs[verification.status] ?? configs["pending"]!;
  const Icon = cfg.icon;

  const messages: Record<string, string> = {
    approved: "Your business verification is complete. You have full access to all platform services.",
    rejected: verification.adminNote
      ? `Reason: ${verification.adminNote}. Please update your information and resubmit.`
      : "Your verification was rejected. Please review and resubmit with the correct information.",
    under_review: "Your application is under review. We'll notify you once a decision is made, typically within 1–2 business days.",
    needs_info: verification.adminNote
      ? `Additional information needed: ${verification.adminNote}`
      : "Please update your application with the requested information and resubmit.",
    suspended: verification.adminNote
      ? `Account suspended: ${verification.adminNote}. Contact support for assistance.`
      : "Your account is suspended. Please contact support for assistance.",
    pending: verification.submittedAt
      ? `Application submitted ${format(new Date(verification.submittedAt), "dd MMM yyyy")}. Waiting for admin review.`
      : "Your application is saved as a draft. Submit it to begin the review process.",
  };

  return (
    <Alert className={cfg.bg}>
      <Icon className={`w-4 h-4 ${cfg.text}`} />
      <AlertDescription className={cfg.text}>
        <span className="font-semibold">{cfg.title} — </span>
        {messages[verification.status] ?? ""}
      </AlertDescription>
    </Alert>
  );
}

interface FormData {
  businessName: string;
  ownerName: string;
  mobile: string;
  email: string;
  pan: string;
  gst: string;
  businessType: string;
  websiteUrl: string;
  address: string;
  expectedMonthlyVolume: string;
  useCase: string;
  bankAccountName: string;
  bankAccountNumber: string;
  ifscCode: string;
  upiId: string;
}

function initForm(v: MerchantVerification | null | undefined): FormData {
  return {
    businessName: v?.businessName ?? "",
    ownerName: v?.ownerName ?? "",
    mobile: v?.mobile ?? "",
    email: v?.email ?? "",
    pan: v?.pan ?? "",
    gst: v?.gst ?? "",
    businessType: v?.businessType ?? "",
    websiteUrl: v?.websiteUrl ?? "",
    address: v?.address ?? "",
    expectedMonthlyVolume: v?.expectedMonthlyVolume ?? "",
    useCase: v?.useCase ?? "",
    bankAccountName: v?.bankAccountName ?? "",
    bankAccountNumber: v?.bankAccountNumber ?? "",
    ifscCode: v?.ifscCode ?? "",
    upiId: v?.upiId ?? "",
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MerchantVerification() {
  const qc = useQueryClient();

  const { data: verData, isLoading } = useGetMyVerification({
    query: { queryKey: getGetMyVerificationQueryKey(), refetchInterval: 30_000 },
  });
  const { data: docsData } = useListVerificationDocuments({
    query: { queryKey: getListVerificationDocumentsQueryKey() },
  });

  const submitVerification = useSubmitVerification();
  const requestUploadUrl = useRequestVerificationUploadUrl();
  const addDocument = useAddVerificationDocument();
  const deleteDocument = useDeleteVerificationDocument();

  const verification = verData?.verification ?? null;
  const documents = docsData?.documents ?? [];

  const [form, setForm] = useState<FormData>(() => initForm(verification));
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Sync form when verification data loads
  useEffect(() => {
    if (verification) setForm(initForm(verification));
  }, [verification?.id]);

  // Upload dialog state
  const [showUpload, setShowUpload] = useState(false);
  const [docType, setDocType] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canEdit = !verification || ["pending", "rejected", "needs_info"].includes(verification.status);
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  function fieldChange(field: keyof FormData) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSave(submit = false) {
    setSaving(true);
    try {
      const payload = { ...form };
      // strip masked values before submitting (bank account masked = starts with ••••)
      if (payload.bankAccountNumber.includes("•")) payload.bankAccountNumber = "";
      if (payload.pan.includes("•")) payload.pan = "";
      if (payload.gst.includes("•")) payload.gst = "";

      await submitVerification.mutateAsync({
        data: {
          ...payload,
          businessType: payload.businessType ? (payload.businessType as SubmitVerificationInputBusinessType) : undefined,
          expectedMonthlyVolume: (payload.expectedMonthlyVolume as any) || undefined,
        },
      });
      toast.success(submit ? "Verification application submitted!" : "Application saved");
      qc.invalidateQueries({ queryKey: getGetMyVerificationQueryKey() });
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to save verification"));
    } finally {
      setSaving(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      toast.error("Only PNG, JPEG, WebP, and PDF files are allowed");
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      toast.error("File too large. Maximum size is 10 MB");
      return;
    }
    setSelectedFile(file);
  }

  async function handleUploadDocument() {
    if (!docType || !selectedFile) {
      toast.error("Select a document type and file");
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
      await addDocument.mutateAsync({
        data: {
          docType: docType as AddVerificationDocumentInputDocType,
          fileUrl: objectPath,
          fileName: selectedFile.name,
        },
      });
      toast.success("Document uploaded");
      qc.invalidateQueries({ queryKey: getListVerificationDocumentsQueryKey() });
      setShowUpload(false);
      setDocType("");
      setSelectedFile(null);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Upload failed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDocument(id: number) {
    try {
      await deleteDocument.mutateAsync({ id });
      toast.success("Document removed");
      qc.invalidateQueries({ queryKey: getListVerificationDocumentsQueryKey() });
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to remove document"));
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const completionChecks = [
    { label: "Business Info", done: !!(form.businessName && form.ownerName && form.mobile && form.email) },
    { label: "Business Type & Category", done: !!(form.businessType && form.useCase) },
    { label: "Tax Details (PAN/GST)", done: !!(form.pan || form.gst) },
    { label: "Banking Details", done: !!(form.bankAccountName && form.bankAccountNumber && form.ifscCode) },
    { label: "Documents Uploaded", done: documents.length > 0 },
  ];
  const completedCount = completionChecks.filter(c => c.done).length;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Business Verification</h1>
          <p className="text-muted-foreground mt-1">Complete your KYC to unlock all platform features.</p>
        </div>
        {verification && <VerificationStatusBadge status={verification.status} />}
      </div>

      <StatusBanner verification={verification} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="business">Business Info</TabsTrigger>
          <TabsTrigger value="banking">Banking</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {/* Progress card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                Application Progress
                <span className="text-sm font-normal text-muted-foreground">
                  {completedCount}/{completionChecks.length} sections complete
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {completionChecks.map(c => (
                <div key={c.label} className="flex items-center gap-3">
                  {c.done ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                  )}
                  <span className={`text-sm ${c.done ? "text-foreground" : "text-muted-foreground"}`}>
                    {c.label}
                  </span>
                </div>
              ))}
              <div className="pt-2">
                <div className="w-full bg-muted/30 rounded-full h-1.5">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all"
                    style={{ width: `${(completedCount / completionChecks.length) * 100}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick info if submitted */}
          {verification && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Application Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Business Name</p>
                    <p>{verification.businessName ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Owner Name</p>
                    <p>{verification.ownerName ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Business Type</p>
                    <p>{BUSINESS_TYPES.find(b => b.value === verification.businessType)?.label ?? verification.businessType ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">PAN</p>
                    <p className="font-mono text-xs">{verification.pan ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Bank Account</p>
                    <p className="font-mono text-xs">{verification.bankAccountNumber ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Documents</p>
                    <p>{documents.length} uploaded</p>
                  </div>
                </div>
                {verification.submittedAt && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Last submitted: {format(new Date(verification.submittedAt), "dd MMM yyyy, hh:mm a")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Submit button */}
          {canEdit && (
            <div className="flex gap-3">
              <Button
                className="flex-1 gap-2"
                onClick={() => handleSave(true)}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {verification?.submittedAt ? "Resubmit Application" : "Submit for Verification"}
              </Button>
              <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
                Save Draft
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── Business Info Tab ────────────────────────────────────────────── */}
        <TabsContent value="business" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Business Details
              </CardTitle>
              <CardDescription>Legal information about your business entity.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Business Name *</Label>
                  <Input
                    placeholder="Legal business name"
                    value={form.businessName}
                    onChange={fieldChange("businessName")}
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Business Type *</Label>
                  <Select
                    value={form.businessType}
                    onValueChange={v => setForm(f => ({ ...f, businessType: v }))}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {BUSINESS_TYPES.map(bt => (
                        <SelectItem key={bt.value} value={bt.value}>{bt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label>Legal Address *</Label>
                <Textarea
                  placeholder="Registered business address (street, city, state, pincode)"
                  value={form.address}
                  onChange={fieldChange("address")}
                  disabled={!canEdit}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Website URL</Label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="https://yourwebsite.com"
                      className="pl-8"
                      value={form.websiteUrl}
                      onChange={fieldChange("websiteUrl")}
                      disabled={!canEdit}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Expected Monthly Volume *</Label>
                  <Select
                    value={form.expectedMonthlyVolume}
                    onValueChange={v => setForm(f => ({ ...f, expectedMonthlyVolume: v }))}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select range…" />
                    </SelectTrigger>
                    <SelectContent>
                      {VOLUME_OPTIONS.map(vo => (
                        <SelectItem key={vo.value} value={vo.value}>{vo.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Business Use Case *</Label>
                <Textarea
                  placeholder="Describe your products/services and how you plan to use the payment gateway"
                  value={form.useCase}
                  onChange={fieldChange("useCase")}
                  disabled={!canEdit}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="w-4 h-4" />
                Owner / Proprietor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Full Name *</Label>
                  <Input
                    placeholder="Owner's legal name"
                    value={form.ownerName}
                    onChange={fieldChange("ownerName")}
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Mobile *</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="+91 98XXXXXXXX"
                      className="pl-8"
                      value={form.mobile}
                      onChange={fieldChange("mobile")}
                      disabled={!canEdit}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Business Email *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="business@example.com"
                      className="pl-8"
                      value={form.email}
                      onChange={fieldChange("email")}
                      disabled={!canEdit}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Tax Identification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>PAN Number *</Label>
                  <Input
                    placeholder="ABCDE1234F"
                    className="font-mono tracking-widest"
                    value={form.pan}
                    onChange={e => setForm(f => ({ ...f, pan: e.target.value.toUpperCase() }))}
                    disabled={!canEdit}
                    maxLength={10}
                  />
                  <p className="text-xs text-muted-foreground">10-character alphanumeric PAN</p>
                </div>
                <div className="space-y-1.5">
                  <Label>GST Number</Label>
                  <Input
                    placeholder="22AAAAA0000A1Z5"
                    className="font-mono tracking-widest"
                    value={form.gst}
                    onChange={e => setForm(f => ({ ...f, gst: e.target.value.toUpperCase() }))}
                    disabled={!canEdit}
                    maxLength={15}
                  />
                  <p className="text-xs text-muted-foreground">15-character GSTIN (optional if exempt)</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {canEdit && (
            <div className="flex gap-3 pt-2">
              <Button className="gap-2" onClick={() => setActiveTab("banking")}>
                Continue to Banking <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Draft
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── Banking Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="banking" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Banknote className="w-4 h-4" />
                Bank Account Details
              </CardTitle>
              <CardDescription>
                Payouts will be credited to this account. Ensure all details are accurate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Account Holder Name *</Label>
                <Input
                  placeholder="Name as registered with the bank"
                  value={form.bankAccountName}
                  onChange={fieldChange("bankAccountName")}
                  disabled={!canEdit}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Account Number *</Label>
                  <Input
                    placeholder="Enter account number"
                    className="font-mono tracking-widest"
                    value={form.bankAccountNumber}
                    onChange={fieldChange("bankAccountNumber")}
                    disabled={!canEdit}
                    type="text"
                    inputMode="numeric"
                  />
                  {!canEdit && form.bankAccountNumber.includes("•") && (
                    <p className="text-xs text-muted-foreground">Account number is partially hidden for security.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>IFSC Code *</Label>
                  <Input
                    placeholder="e.g. HDFC0001234"
                    className="font-mono tracking-widest"
                    value={form.ifscCode}
                    onChange={e => setForm(f => ({ ...f, ifscCode: e.target.value.toUpperCase() }))}
                    disabled={!canEdit}
                    maxLength={11}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="w-4 h-4" />
                UPI Details
              </CardTitle>
              <CardDescription>Optional — used for instant payment confirmation.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>UPI ID</Label>
                <Input
                  placeholder="yourname@bank"
                  value={form.upiId}
                  onChange={fieldChange("upiId")}
                  disabled={!canEdit}
                />
              </div>
            </CardContent>
          </Card>

          <Alert className="border-amber-500/30 bg-amber-950/20">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <AlertDescription className="text-amber-300 text-sm">
              Ensure the bank account belongs to the registered business entity. Personal accounts may cause delays in verification.
            </AlertDescription>
          </Alert>

          {canEdit && (
            <div className="flex gap-3 pt-2">
              <Button className="gap-2" onClick={() => setActiveTab("documents")}>
                Continue to Documents <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Save Draft
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── Documents Tab ───────────────────────────────────────────────── */}
        <TabsContent value="documents" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Verification Documents</CardTitle>
                <CardDescription>Upload clear copies of your business documents.</CardDescription>
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => {
                setDocType("");
                setSelectedFile(null);
                setShowUpload(true);
              }}>
                <Upload className="w-3.5 h-3.5" />
                Upload
              </Button>
            </CardHeader>
            <CardContent>
              {documents.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">No documents uploaded yet</p>
                  <p className="text-xs mt-1 mb-4">Upload your PAN, GST certificate, bank statement, and address proof.</p>
                  <Button size="sm" className="gap-1.5" onClick={() => setShowUpload(true)}>
                    <Upload className="w-3.5 h-3.5" />
                    Upload First Document
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      base={base}
                      onDelete={handleDeleteDocument}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-dashed border-border/40">
            <CardContent className="pt-4 pb-4">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Required documents:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-muted-foreground/60" />
                  PAN Card (front &amp; back)
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-muted-foreground/60" />
                  GST Certificate (if GST-registered)
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-muted-foreground/60" />
                  Cancelled cheque or recent bank statement
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-muted-foreground/60" />
                  Business registration document (Incorporation certificate, Trade licence, or Partnership deed)
                </li>
              </ul>
            </CardContent>
          </Card>

          {canEdit && (
            <div className="flex gap-3 pt-2">
              <Button
                className="flex-1 gap-2"
                onClick={() => handleSave(true)}
                disabled={saving}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {verification?.submittedAt ? "Resubmit Application" : "Submit for Verification"}
              </Button>
              <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
                Save Draft
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Upload Dialog */}
      <Dialog open={showUpload} onOpenChange={open => {
        if (!open) { setDocType(""); setSelectedFile(null); }
        setShowUpload(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Document Type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select document type…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <Button onClick={handleUploadDocument} disabled={!docType || !selectedFile || uploading}>
              {uploading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Uploading…</>
                : "Upload Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentRow({
  doc,
  base,
  onDelete,
}: {
  doc: MerchantDocument;
  base: string;
  onDelete: (id: number) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const fileUrl = doc.fileUrl.startsWith("/") ? `${base}/api/storage${doc.fileUrl}` : doc.fileUrl;

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(doc.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/50">
      <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{DOC_TYPE_LABELS[doc.docType] ?? doc.docType}</p>
        {doc.fileName && <p className="text-xs text-muted-foreground truncate">{doc.fileName}</p>}
        <p className="text-xs text-muted-foreground">
          {format(new Date(doc.createdAt), "dd MMM yyyy")}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <a href={fileUrl} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
            <Eye className="w-4 h-4" />
          </Button>
        </a>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-rose-400/60 hover:text-rose-400"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
