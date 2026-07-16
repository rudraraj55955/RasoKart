import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Paintbrush, Save, ShieldAlert, Lock } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/utils";
import {
  useGetMe,
  useGetAdminCompanySettings,
  useUpdateAdminCompanySettings,
  getGetAdminCompanySettingsQueryKey,
  getGetPublicCompanySettingsQueryKey,
} from "@workspace/api-client-react";

const PHONE_REGEX = /^[0-9]{10,15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
  companyName: string;
  supportPhone: string;
  supportEmail: string;
  whatsappPhone: string;
  companyAddress: string;
  footerText: string;
  grievanceOfficerName: string;
}

const EMPTY_FORM: FormState = {
  companyName: "",
  supportPhone: "",
  supportEmail: "",
  whatsappPhone: "",
  companyAddress: "",
  footerText: "",
  grievanceOfficerName: "",
};

export default function AdminCompanyBranding() {
  const qc = useQueryClient();
  const { data: me } = useGetMe();
  const isSuperAdmin = me?.isSuperAdmin === true;

  const { data: settings, isLoading } = useGetAdminCompanySettings();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [initialized, setInitialized] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  useEffect(() => {
    if (settings && !initialized) {
      setForm({
        companyName: settings.companyName ?? "",
        supportPhone: settings.supportPhone ?? "",
        supportEmail: settings.supportEmail ?? "",
        whatsappPhone: settings.whatsappPhone ?? "",
        companyAddress: settings.companyAddress ?? "",
        footerText: settings.footerText ?? "",
        grievanceOfficerName: (settings as any).grievanceOfficerName ?? "",
      });
      setInitialized(true);
    }
  }, [settings, initialized]);

  const { mutate: save, isPending: saving } = useUpdateAdminCompanySettings({
    mutation: {
      onSuccess: () => {
        toast.success("Company branding settings updated");
        qc.invalidateQueries({ queryKey: getGetAdminCompanySettingsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPublicCompanySettingsQueryKey() });
      },
      onError: (err: unknown) => {
        if (err && typeof err === "object" && "status" in err && (err as any).status === 403) {
          toast.error("Only the Super Admin can update company settings");
        } else {
          toast.error(getApiErrorMessage(err, "Failed to update company settings"));
        }
      },
    },
  });

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.companyName.trim()) next.companyName = "Company name is required";
    if (!form.supportPhone.trim()) {
      next.supportPhone = "Support phone is required";
    } else if (!PHONE_REGEX.test(form.supportPhone.trim())) {
      next.supportPhone = "Must be 10-15 digits";
    }
    if (form.supportEmail.trim() && !EMAIL_REGEX.test(form.supportEmail.trim())) {
      next.supportEmail = "Enter a valid email address";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSave() {
    if (!isSuperAdmin) {
      toast.error("Only the Super Admin can update company settings");
      return;
    }
    if (!validate()) return;
    save({
      data: {
        companyName: form.companyName.trim(),
        supportPhone: form.supportPhone.trim(),
        supportEmail: form.supportEmail.trim() || null,
        whatsappPhone: form.whatsappPhone.trim() || null,
        companyAddress: form.companyAddress.trim() || null,
        footerText: form.footerText.trim() || null,
        grievanceOfficerName: form.grievanceOfficerName.trim() || null,
      } as any,
    });
  }

  function field<K extends keyof FormState>(key: K) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((prev) => ({ ...prev, [key]: e.target.value })),
      disabled: !isSuperAdmin,
    };
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Paintbrush className="w-6 h-6" />
          Company Branding
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Company name and support contact info shown across the public site, merchant portal, and admin footer.
          "RasoKart" remains the product name — this is shown separately as "Operated by {"{company name}"}".
        </p>
      </div>

      {!isSuperAdmin && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            You have read-only access to these settings. Only the Super Admin can edit company branding and support contact info.
          </span>
        </div>
      )}

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Company Profile</CardTitle>
          <CardDescription className="text-sm">
            Required fields are marked with an asterisk.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input id="companyName" placeholder="Nickey Collection Private Limited" {...field("companyName")} />
                {errors.companyName && <p className="text-xs text-destructive">{errors.companyName}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="supportPhone">Support Phone *</Label>
                  <Input id="supportPhone" placeholder="9358774496" {...field("supportPhone")} />
                  {errors.supportPhone && <p className="text-xs text-destructive">{errors.supportPhone}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="whatsappPhone">WhatsApp Phone</Label>
                  <Input id="whatsappPhone" placeholder="Optional" {...field("whatsappPhone")} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="supportEmail">Support Email</Label>
                <Input id="supportEmail" placeholder="support@example.com" {...field("supportEmail")} />
                {errors.supportEmail && <p className="text-xs text-destructive">{errors.supportEmail}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="companyAddress">Company Address</Label>
                <Textarea id="companyAddress" placeholder="Optional" rows={2} {...field("companyAddress")} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="footerText">Footer Text</Label>
                <Textarea id="footerText" placeholder="Optional custom footer note" rows={2} {...field("footerText")} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="grievanceOfficerName">Grievance Officer Name</Label>
                <Input
                  id="grievanceOfficerName"
                  placeholder="e.g. Rahul Sharma"
                  {...field("grievanceOfficerName")}
                />
                <p className="text-xs text-muted-foreground">
                  Displayed on the public Privacy Policy page. Leave blank to show a generic contact notice.
                </p>
              </div>

              {settings?.updatedByEmail && (
                <p className="text-xs text-muted-foreground">
                  Last updated by {settings.updatedByEmail} on{" "}
                  {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(settings.updatedAt))}
                </p>
              )}

              {isSuperAdmin ? (
                <Button onClick={handleSave} disabled={saving}>
                  <Save className="w-4 h-4 mr-1.5" />
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Editing is restricted to the Super Admin.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
