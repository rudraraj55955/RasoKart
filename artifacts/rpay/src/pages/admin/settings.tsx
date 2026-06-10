import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Mail, Save, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { getToken } from "@/lib/auth";

async function apiGet(path: string) {
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

async function apiPut(path: string, body: object) {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export default function AdminSettings() {
  const qc = useQueryClient();
  const [financeEmail, setFinanceEmail] = useState<string>("");
  const [initialized, setInitialized] = useState(false);

  const { data, isLoading } = useQuery<{ finance_report_email: string | null }>({
    queryKey: ["/api/settings"],
    queryFn: () => apiGet("/settings"),
    onSuccess: (d: { finance_report_email: string | null }) => {
      if (!initialized) {
        setFinanceEmail(d.finance_report_email ?? "");
        setInitialized(true);
      }
    },
  } as any);

  const { mutate: saveEmail, isPending: saving } = useMutation({
    mutationFn: () => apiPut("/settings/finance_report_email", { value: financeEmail || null }),
    onSuccess: () => {
      toast.success("Finance report email saved");
      qc.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const currentEmail = data?.finance_report_email ?? null;
  const emailUnchanged = financeEmail === (currentEmail ?? "");

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
          <Settings className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">System Settings</h1>
          <p className="text-sm text-muted-foreground">Configure platform-wide operational settings</p>
        </div>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Finance Report Email</CardTitle>
          </div>
          <CardDescription className="text-sm">
            After each reconciliation run completes, a summary email with the full CSV report attached
            will be sent to this address. Leave blank to disable automatic emails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLoading && currentEmail && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Reports are currently being sent to <strong>{currentEmail}</strong></span>
            </div>
          )}
          {!isLoading && !currentEmail && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>No finance email configured — automatic reports are disabled</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="finance-email" className="text-sm">Recipient email address</Label>
            <Input
              id="finance-email"
              type="email"
              placeholder="finance@company.com"
              value={financeEmail}
              onChange={e => setFinanceEmail(e.target.value)}
              disabled={isLoading}
              className="max-w-sm"
            />
            <p className="text-xs text-muted-foreground">
              Must be a valid email address. Reports include run stats and a full CSV attachment.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => saveEmail()}
              disabled={saving || isLoading || emailUnchanged}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {saving ? "Saving…" : "Save"}
            </Button>
            {!emailUnchanged && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFinanceEmail(currentEmail ?? "")}
                disabled={saving}
              >
                Cancel
              </Button>
            )}
          </div>

          <div className="border-t border-border/50 pt-4">
            <p className="text-xs text-muted-foreground font-medium mb-1">SMTP requirement</p>
            <p className="text-xs text-muted-foreground">
              Emails are sent via SMTP. Ensure the server has{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">SMTP_HOST</code>,{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">SMTP_USER</code>, and{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">SMTP_PASS</code> environment
              variables set. Optionally set{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">SMTP_PORT</code> (default 587) and{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">SMTP_FROM</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
