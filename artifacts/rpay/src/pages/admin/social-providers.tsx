/**
 * Super Admin — Social Authentication Providers
 * Allows Super Admins to enable/disable social login providers (Google, Apple,
 * Microsoft, Facebook). Apple, Microsoft, and Facebook are UI-only placeholders
 * until credentials are configured. Google requires GOOGLE_CLIENT_ID env var.
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getToken } from "@/lib/auth";

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {} as Record<string, string>;
}

function apiUrl(path: string): string {
  const base = (import.meta as any)?.env?.BASE_URL ?? "/";
  return `${base}api${path}`.replace(/\/+/g, "/");
}

interface ProviderRow {
  provider: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

const PROVIDER_META: Record<string, { label: string; description: string; requiresEnv: string }> = {
  google: {
    label: "Google",
    description: "Sign in with Google (requires GOOGLE_CLIENT_ID environment variable).",
    requiresEnv: "GOOGLE_CLIENT_ID",
  },
  apple: {
    label: "Apple",
    description: "Sign in with Apple (requires Apple Developer credentials — disabled until configured).",
    requiresEnv: "APPLE_CLIENT_ID",
  },
  microsoft: {
    label: "Microsoft",
    description: "Sign in with Microsoft / Azure AD (requires MICROSOFT_CLIENT_ID — disabled until configured).",
    requiresEnv: "MICROSOFT_CLIENT_ID",
  },
  facebook: {
    label: "Facebook",
    description: "Sign in with Facebook (requires FACEBOOK_APP_ID — disabled until configured).",
    requiresEnv: "FACEBOOK_APP_ID",
  },
};

const PROVIDER_ORDER = ["google", "apple", "microsoft", "facebook"];

export default function AdminSocialProviders() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(apiUrl("/auth/social-providers/admin"), { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load providers");
      const data = await r.json();
      setProviders(data.providers ?? []);
    } catch {
      toast.error("Failed to load social providers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (provider: string, enabled: boolean) => {
    setSaving(provider);
    try {
      const r = await fetch(apiUrl(`/auth/social-providers/${provider}`), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(data.error ?? "Failed to update provider.");
        return;
      }
      toast.success(`${PROVIDER_META[provider]?.label ?? provider} ${enabled ? "enabled" : "disabled"}.`);
      setProviders(prev => prev.map(p => p.provider === provider ? { ...p, enabled } : p));
    } catch {
      toast.error("Failed to update provider.");
    } finally {
      setSaving(null);
    }
  };

  const orderedProviders = PROVIDER_ORDER.map(p => providers.find(r => r.provider === p)).filter(Boolean) as ProviderRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Social Authentication</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Enable or disable social login providers for merchants and admins. Only providers
          with configured credentials will work in practice.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {PROVIDER_ORDER.map(p => (
            <div key={p} className="h-32 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {orderedProviders.map(row => {
            const meta = PROVIDER_META[row.provider];
            const isAppleOrMsOrFb = ["apple", "microsoft", "facebook"].includes(row.provider);
            return (
              <Card key={row.provider} className="border-border/60">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        {meta?.label ?? row.provider}
                        {isAppleOrMsOrFb && (
                          <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                            Credentials required
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-1 text-xs leading-relaxed">
                        {meta?.description}
                      </CardDescription>
                    </div>
                    <Switch
                      checked={row.enabled}
                      disabled={saving === row.provider || (isAppleOrMsOrFb && !row.enabled)}
                      onCheckedChange={(v) => toggle(row.provider, v)}
                      aria-label={`Toggle ${meta?.label ?? row.provider}`}
                    />
                  </div>
                </CardHeader>
                {row.updatedByEmail && (
                  <CardContent className="pt-0">
                    <p className="text-xs text-muted-foreground">
                      Last changed by <span className="text-foreground">{row.updatedByEmail}</span>
                      {row.updatedAt ? ` on ${new Date(row.updatedAt).toLocaleDateString()}` : ""}
                    </p>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-amber-400">Note on Apple, Microsoft &amp; Facebook</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground leading-relaxed">
            These providers require server-side credentials before they can be enabled.
            Add the required environment variables (e.g. <code className="font-mono bg-muted px-1 rounded">APPLE_CLIENT_ID</code>) to
            the Replit secrets, then re-enable the provider here. Toggling them without
            credentials will fail at login time.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
