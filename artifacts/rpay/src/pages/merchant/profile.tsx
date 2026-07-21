import { useState, useEffect } from "react";
import { useGetMe, useUpdateMerchantProfile, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2, User, Phone, Globe, Mail, Save, Loader2,
  CheckCircle2, AlertTriangle, Shield, Calendar, Edit3
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getApiErrorMessage } from "@/lib/utils";

function statusBadge(status: string) {
  if (status === "approved") return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">Approved</Badge>;
  if (status === "pending") return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">Pending Review</Badge>;
  if (status === "rejected") return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/20">Rejected</Badge>;
  if (status === "suspended") return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/20">Suspended</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export default function MerchantProfile() {
  const qc = useQueryClient();
  const { data: me, isLoading } = useGetMe();
  const updateMutation = useUpdateMerchantProfile();

  const [editing, setEditing] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [websiteError, setWebsiteError] = useState("");

  useEffect(() => {
    if (me && !editing) {
      setBusinessName((me as any).businessName ?? "");
      setContactName((me as any).contactName ?? "");
      setPhone((me as any).phone ?? "");
      setWebsite((me as any).website ?? "");
    }
  }, [me, editing]);

  const isDirty =
    businessName !== ((me as any)?.businessName ?? "") ||
    contactName !== ((me as any)?.contactName ?? "") ||
    phone !== ((me as any)?.phone ?? "") ||
    website !== ((me as any)?.website ?? "");

  const validatePhone = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "Phone is required";
    if (!/\d/.test(trimmed)) return "Phone must contain at least one digit";
    return "";
  };

  const validateWebsite = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Website must start with http:// or https://";
    } catch {
      return "Website must be a valid URL (e.g. https://yourbusiness.com)";
    }
    return "";
  };

  const handleCancel = () => {
    setEditing(false);
    setPhoneError("");
    setWebsiteError("");
    if (me) {
      setBusinessName((me as any).businessName ?? "");
      setContactName((me as any).contactName ?? "");
      setPhone((me as any).phone ?? "");
      setWebsite((me as any).website ?? "");
    }
  };

  const handleSave = () => {
    if (!businessName.trim()) { toast.error("Business name is required"); return; }
    if (!contactName.trim()) { toast.error("Contact name is required"); return; }
    const pErr = validatePhone(phone);
    const wErr = validateWebsite(website);
    setPhoneError(pErr);
    setWebsiteError(wErr);
    if (pErr || wErr) return;

    const data: Record<string, string | null> = {};
    if (businessName.trim() !== ((me as any)?.businessName ?? "")) data.businessName = businessName.trim();
    if (contactName.trim() !== ((me as any)?.contactName ?? "")) data.contactName = contactName.trim();
    if (phone.trim() !== ((me as any)?.phone ?? "")) data.phone = phone.trim();
    const webVal = website.trim() || null;
    if (webVal !== (((me as any)?.website ?? null))) data.website = webVal;

    if (Object.keys(data).length === 0) { setEditing(false); return; }

    updateMutation.mutate({ data }, {
      onSuccess: () => {
        toast.success("Profile updated successfully");
        qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setEditing(false);
      },
      onError: (err) => toast.error(getApiErrorMessage(err, "Failed to update profile")),
    });
  };

  const merchant = me as any;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Account Profile</h1>
          <p className="text-muted-foreground mt-1">Manage your business information and account details</p>
        </div>
        {!editing && (
          <Button variant="outline" onClick={() => setEditing(true)} disabled={isLoading}>
            <Edit3 className="w-4 h-4 mr-2" />Edit Profile
          </Button>
        )}
      </div>

      {/* Account Status Banner */}
      {!isLoading && merchant && merchant.status !== "approved" && (
        <Alert className={merchant.status === "pending" ? "border-amber-500/30 bg-amber-500/5" : "border-rose-500/30 bg-rose-500/5"}>
          <AlertTriangle className={`w-4 h-4 ${merchant.status === "pending" ? "text-amber-500" : "text-rose-500"}`} />
          <AlertDescription className={merchant.status === "pending" ? "text-amber-200/80" : "text-rose-200/80"}>
            {merchant.status === "pending" && "Your account is pending review. You'll be notified once approved."}
            {merchant.status === "rejected" && `Your account was not approved. Reason: ${merchant.rejectionReason ?? "No reason provided."}`}
            {merchant.status === "suspended" && "Your account has been suspended. Contact support for assistance."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editable Profile Card */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />Business Information
              </CardTitle>
              <CardDescription>Your official business details used in transactions and communications.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {isLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="business-name" className="flex items-center gap-1.5 text-muted-foreground">
                        <Building2 className="w-3.5 h-3.5" />Business Name
                      </Label>
                      {editing ? (
                        <Input
                          id="business-name"
                          value={businessName}
                          onChange={e => setBusinessName(e.target.value.slice(0, 200))}
                          placeholder="Your business name"
                          maxLength={200}
                          autoFocus
                        />
                      ) : (
                        <p className="text-sm font-medium py-2 px-3 bg-muted/30 rounded-md border border-border/50 min-h-[40px]">
                          {merchant?.businessName || <span className="text-muted-foreground italic">Not set</span>}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="contact-name" className="flex items-center gap-1.5 text-muted-foreground">
                        <User className="w-3.5 h-3.5" />Contact Name
                      </Label>
                      {editing ? (
                        <Input
                          id="contact-name"
                          value={contactName}
                          onChange={e => setContactName(e.target.value.slice(0, 200))}
                          placeholder="Primary contact person"
                          maxLength={200}
                        />
                      ) : (
                        <p className="text-sm font-medium py-2 px-3 bg-muted/30 rounded-md border border-border/50 min-h-[40px]">
                          {merchant?.contactName || <span className="text-muted-foreground italic">Not set</span>}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone" className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="w-3.5 h-3.5" />Phone Number
                      </Label>
                      {editing ? (
                        <>
                          <Input
                            id="phone"
                            value={phone}
                            onChange={e => {
                              const v = e.target.value.slice(0, 50);
                              setPhone(v);
                              setPhoneError(validatePhone(v));
                            }}
                            placeholder="+91 98765 43210"
                            maxLength={50}
                            aria-invalid={!!phoneError}
                            className={phoneError ? "border-rose-500 focus-visible:ring-rose-500" : ""}
                          />
                          {phoneError && <p className="text-xs text-rose-400">{phoneError}</p>}
                        </>
                      ) : (
                        <p className="text-sm font-medium py-2 px-3 bg-muted/30 rounded-md border border-border/50 min-h-[40px]">
                          {merchant?.phone || <span className="text-muted-foreground italic">Not set</span>}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="website" className="flex items-center gap-1.5 text-muted-foreground">
                        <Globe className="w-3.5 h-3.5" />Website <span className="text-muted-foreground/60 font-normal">(optional)</span>
                      </Label>
                      {editing ? (
                        <>
                          <Input
                            id="website"
                            value={website}
                            onChange={e => {
                              const v = e.target.value.slice(0, 500);
                              setWebsite(v);
                              setWebsiteError(validateWebsite(v));
                            }}
                            placeholder="https://yourbusiness.com"
                            maxLength={500}
                            aria-invalid={!!websiteError}
                            className={websiteError ? "border-rose-500 focus-visible:ring-rose-500" : ""}
                          />
                          {websiteError && <p className="text-xs text-rose-400">{websiteError}</p>}
                        </>
                      ) : (
                        <p className="text-sm font-medium py-2 px-3 bg-muted/30 rounded-md border border-border/50 min-h-[40px]">
                          {merchant?.website
                            ? <a href={merchant.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{merchant.website}</a>
                            : <span className="text-muted-foreground italic">Not set</span>}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5 text-muted-foreground">
                      <Mail className="w-3.5 h-3.5" />Email Address
                    </Label>
                    <p className="text-sm py-2 px-3 bg-muted/20 rounded-md border border-border/30 text-muted-foreground">
                      {merchant?.email}
                      <span className="ml-2 text-xs text-muted-foreground/60">(contact support to change)</span>
                    </p>
                  </div>

                  {editing && (
                    <>
                      <Separator />
                      <div className="flex items-center gap-3 justify-end">
                        <Button variant="outline" onClick={handleCancel} disabled={updateMutation.isPending}>
                          Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={updateMutation.isPending || !isDirty}>
                          {updateMutation.isPending
                            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                            : <><Save className="w-4 h-4 mr-2" />Save Changes</>}
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: Account Meta */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Account Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    {merchant?.status && statusBadge(merchant.status)}
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Merchant ID</span>
                    <span className="font-mono text-sm font-medium">#{merchant?.id}</span>
                  </div>
                  {merchant?.createdAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />Joined
                      </span>
                      <span className="text-sm">{format(new Date(merchant.createdAt), "MMM d, yyyy")}</span>
                    </div>
                  )}
                  {merchant?.currentPlanName && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Plan</span>
                      <Badge variant="outline" className="text-xs">{merchant.currentPlanName}</Badge>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Verification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
                </div>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    {merchant?.verificationStatus === "approved"
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                      : <Shield className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />}
                    <div>
                      <p className="text-sm font-medium capitalize">
                        {merchant?.verificationStatus?.replace(/_/g, " ") ?? "Pending"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {merchant?.verificationStatus === "approved"
                          ? "KYC documents verified"
                          : "Complete KYC verification to unlock full features"}
                      </p>
                    </div>
                  </div>
                  {merchant?.verificationStatus !== "approved" && (
                    <a href="/merchant/verification" className="text-xs text-primary hover:underline flex items-center gap-1">
                      Complete verification →
                    </a>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Quick Links</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <a href="/merchant/security" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1">
                <Shield className="w-3.5 h-3.5" />Security & Activity
              </a>
              <a href="/merchant/branding" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1">
                <Building2 className="w-3.5 h-3.5" />Branding & Logo
              </a>
              <a href="/merchant/notifications" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1">
                <Mail className="w-3.5 h-3.5" />Notification Preferences
              </a>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
