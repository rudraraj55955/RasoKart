import { useState } from "react";
import { useGetGatewayUsage } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, KeyRound } from "lucide-react";

const authHeader = () => ({ Authorization: `Bearer ${getToken()}` });

// Built-in providers plus any custom provider key created via the "Add Gateway"
// flow (Provider Integrations). Custom keys are arbitrary strings, so this is
// intentionally widened beyond a strict union.
export type GatewayUsageProvider = "ekqr" | "cashfree" | "cashfree-payout" | (string & {});

export interface GatewayCredentialFlags {
  apiKeySet?: boolean;
  apiSecretSet?: boolean;
  webhookSecretSet?: boolean;
}

const GATEWAY_LABELS: Record<string, string> = {
  ekqr: "UPI Gateway",
  cashfree: "Payin Gateway",
  "cashfree-payout": "Payout Gateway",
};

/**
 * Guards a gateway-config save behind a confirmation dialog whenever the save
 * would flip `enabled: true -> false`. Renders `dialog` wherever the panel's
 * JSX lives, and call `guardSave(willDisable, save)` from the Save handler.
 *
 * `label` is optional for the built-in providers (ekqr/cashfree/cashfree-payout)
 * since they have a known display name; pass it for custom gateways so the
 * dialog reads naturally (e.g. the custom gateway's display name).
 *
 * `credentials` is optional — when provided for a custom gateway the dialog
 * will note which credential types are still configured so the admin is aware
 * before disabling or removing.
 */
export function useDisableGatewayGuard(
  provider: GatewayUsageProvider,
  label?: string,
  credentials?: GatewayCredentialFlags,
) {
  const [pendingSave, setPendingSave] = useState<(() => void) | null>(null);

  function guardSave(willDisable: boolean, save: () => void) {
    if (willDisable) {
      setPendingSave(() => save);
    } else {
      save();
    }
  }

  const dialog = (
    <DisableGatewayDialog
      provider={provider}
      label={label ?? GATEWAY_LABELS[provider] ?? "this gateway"}
      credentials={credentials}
      open={pendingSave !== null}
      onCancel={() => setPendingSave(null)}
      onConfirm={() => {
        const save = pendingSave;
        setPendingSave(null);
        save?.();
      }}
    />
  );

  return { guardSave, dialog };
}

function DisableGatewayDialog({
  provider, label, credentials, open, onCancel, onConfirm,
}: {
  provider: GatewayUsageProvider;
  label: string;
  credentials?: GatewayCredentialFlags;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { data, isLoading } = useGetGatewayUsage(provider, {
    query: { enabled: open },
    request: { headers: authHeader() },
  } as any);

  const merchantCount = data?.merchantCount ?? 0;
  const qrCodeCount = data?.qrCodeCount ?? 0;
  const hasUsage = merchantCount > 0 || qrCodeCount > 0;

  const credentialNames: string[] = [];
  if (credentials?.apiKeySet) credentialNames.push("API key");
  if (credentials?.apiSecretSet) credentialNames.push("API secret");
  if (credentials?.webhookSecretSet) credentialNames.push("webhook secret");
  const hasCredentials = credentialNames.length > 0;

  function formatCredentialList(names: string[]) {
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Disable {label}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              {isLoading ? (
                <p>Checking active usage…</p>
              ) : hasUsage ? (
                <>
                  <p>
                    This gateway is currently in use by{" "}
                    <strong className="text-foreground">{merchantCount}</strong>{" "}
                    {merchantCount === 1 ? "merchant" : "merchants"}
                    {qrCodeCount > 0 && (
                      <>
                        {" "}with <strong className="text-foreground">{qrCodeCount}</strong> active QR{" "}
                        {qrCodeCount === 1 ? "code" : "codes"}
                      </>
                    )}
                    .
                  </p>
                  <p>Disabling it now will immediately break their live payment collection. Are you sure you want to continue?</p>
                </>
              ) : (
                <p>No merchants currently appear to be actively relying on this gateway. Disabling it will still stop it immediately for any in-flight integrations.</p>
              )}
              {hasCredentials && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  <KeyRound className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    This gateway still has a saved{" "}
                    <strong className="text-amber-200">{formatCredentialList(credentialNames)}</strong>
                    {" "}— those credentials will remain stored but inactive until the gateway is re-enabled or removed.
                  </span>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Disable Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
