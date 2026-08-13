import { useState } from "react";
import { Link } from "wouter";
import { useListApiKeys, useGenerateApiKey, useRevokeApiKey, getListApiKeysQueryKey, useGetMyPlanUsage } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Copy, Trash2, Eye, AlertTriangle, Tag, Loader2, Lock, ArrowUpRight, Globe, Key, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/utils";
import { format } from "date-fns";
import { RasoConfirmModal } from "@/components/ui/raso-confirm-modal";

function is403(err: unknown): boolean {
  if (err && typeof err === "object") {
    return (err as Record<string, unknown>)["status"] === 403;
  }
  return false;
}

export default function MerchantApiKeys() {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState<{ apiKey: string; secretKey: string; label: string | null } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<number | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Generate dialog state
  const [generateOpen, setGenerateOpen] = useState(false);
  const [labelInput, setLabelInput] = useState("");

  const { data: usage } = useGetMyPlanUsage();
  const planBlocked = usage !== undefined && !usage.apiAccess;

  const { data: keys, isLoading } = useListApiKeys();
  const generateMutation = useGenerateApiKey();
  const revokeMutation = useRevokeApiKey();

  const openGenerate = () => {
    if (planBlocked) { setUpgradeOpen(true); return; }
    setLabelInput("");
    setGenerateOpen(true);
  };

  const handleGenerate = () => {
    const label = labelInput.trim() || undefined;
    generateMutation.mutate({ data: label ? { label } : {} }, {
      onSuccess: (key) => {
        setGenerateOpen(false);
        setNewKey({ apiKey: key.apiKey, secretKey: key.secretKey, label: key.label ?? null });
        qc.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
      },
      onError: (err: unknown) => {
        if (is403(err)) { setGenerateOpen(false); setUpgradeOpen(true); return; }
        toast.error(getApiErrorMessage(err, "Failed to generate API key"));
      },
    });
  };

  const handleRevoke = (id: number) => {
    setConfirmRevoke(id);
  };

  const doRevoke = () => {
    if (confirmRevoke === null) return;
    revokeMutation.mutate({ id: confirmRevoke }, {
      onSuccess: () => {
        toast.success("API key revoked");
        qc.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
        setConfirmRevoke(null);
      },
      onError: () => toast.error("Failed to revoke"),
    });
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const copyBoth = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(`API Key: ${newKey.apiKey}\nSecret Key: ${newKey.secretKey}`);
    toast.success("Both credentials copied");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground mt-1">Manage your integration credentials</p>
        </div>
        <Button onClick={openGenerate} disabled={generateMutation.isPending}>
          <Plus className="w-4 h-4 mr-2" />Generate Key
        </Button>
      </div>

      {planBlocked && (
        <Alert className="border-violet-500/40 bg-violet-950/20">
          <Lock className="w-4 h-4 text-violet-400" />
          <AlertDescription className="text-violet-300/90 flex items-center justify-between gap-4 flex-wrap">
            <span>API key access is not included in your current plan. Upgrade to generate and manage API keys.</span>
            <Link href="/merchant/plan">
              <Button size="sm" variant="outline" className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10 shrink-0">
                View Plans <ArrowUpRight className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Alert className="border-amber-500/30 bg-amber-500/5">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        <AlertDescription className="text-amber-200/80">
          Keep your secret key safe. Never expose it in client-side code or public repositories.
        </AlertDescription>
      </Alert>

      {/* Quick Integration Reference */}
      {!planBlocked && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">Integration Quick Reference</span>
              <Link href="/merchant/api-docs">
                <span className="ml-auto text-xs text-primary hover:underline inline-flex items-center gap-1 cursor-pointer">
                  Full API Docs <BookOpen className="w-3 h-3" />
                </span>
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Base URL</p>
                <code className="text-xs font-mono bg-muted/40 px-2 py-1 rounded block break-all">
                  https://rasokart.com/api
                </code>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Authentication Header</p>
                <code className="text-xs font-mono bg-muted/40 px-2 py-1 rounded block break-all">
                  X-Api-Key: {"<your-api-key>"}
                </code>
              </div>
              <div className="col-span-full space-y-1">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Example Request</p>
                <code className="text-xs font-mono bg-muted/40 px-2 py-1.5 rounded block whitespace-pre-wrap break-all leading-relaxed">
                  {`curl -X GET https://rasokart.com/api/merchant/transactions \\
  -H "X-Api-Key: rasokart_live_..." \\
  -H "X-Api-Secret: rasokart_secret_..."`}
                </code>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1">
                <Key className="w-3 h-3 text-emerald-400" />
                Secret key shown only once at generation
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 rounded px-2 py-1">
                <Key className="w-3 h-3 text-amber-400" />
                Never expose secret in client-side code
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>API Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : !keys?.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-14">
                      <Tag className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No API keys generated yet</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Generate a key to start integrating</p>
                    </TableCell>
                  </TableRow>
                ) : keys.map(key => (
                  <TableRow key={key.id}>
                    <TableCell>
                      {key.label ? (
                        <span className="font-medium text-sm">{key.label}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{key.keyPrefix}</TableCell>
                    <TableCell>
                      <Badge variant={key.isActive ? "default" : "secondary"} className={key.isActive ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20" : ""}>
                        {key.isActive ? "Active" : "Revoked"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {key.lastUsedAt ? format(new Date(key.lastUsedAt), "MMM d, HH:mm") : "Never"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(key.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      {key.isActive && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                          onClick={() => handleRevoke(key.id)}
                          title="Revoke key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Generate Key Dialog */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-primary" />
              Generate API Key
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="key-label">Key Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="key-label"
                placeholder="e.g. Production App, Mobile Backend..."
                value={labelInput}
                onChange={e => setLabelInput(e.target.value.slice(0, 64))}
                maxLength={64}
                onKeyDown={e => { if (e.key === "Enter" && !generateMutation.isPending) handleGenerate(); }}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">A friendly name to help identify this key later.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)} disabled={generateMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} disabled={generateMutation.isPending}>
              {generateMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating…</> : "Generate Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirm */}
      <RasoConfirmModal
        open={confirmRevoke !== null}
        onOpenChange={open => { if (!open) setConfirmRevoke(null); }}
        variant="destructive"
        title="Revoke API Key"
        description="This key will stop working immediately. Any integrations or applications using it will begin failing."
        confirmLabel="Revoke Key"
        onConfirm={doRevoke}
        loading={revokeMutation.isPending}
      />

      {/* Upgrade Required Modal */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-violet-400" />
              Upgrade Required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground leading-relaxed">
              API key access is not included in your current plan. Upgrade to a higher plan to generate and manage API keys for your integrations.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setUpgradeOpen(false)}>
                Cancel
              </Button>
              <Link href="/merchant/plan">
                <Button className="bg-violet-600 hover:bg-violet-500 text-white" onClick={() => setUpgradeOpen(false)}>
                  View Plans <ArrowUpRight className="w-4 h-4 ml-1.5" />
                </Button>
              </Link>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Key Reveal Dialog */}
      <Dialog open={!!newKey} onOpenChange={() => setNewKey(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-amber-500" />
              Save your credentials now
              {newKey?.label && <span className="text-sm font-normal text-muted-foreground">— {newKey.label}</span>}
            </DialogTitle>
          </DialogHeader>
          <Alert className="border-rose-500/30 bg-rose-500/5">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <AlertDescription className="text-rose-200/80 font-medium">
              This is the only time the secret key will be shown. Copy it now — it cannot be retrieved later.
            </AlertDescription>
          </Alert>
          {newKey && (
            <div className="space-y-4 mt-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">API Key</p>
                <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-3 border border-border/50">
                  <code className="flex-1 text-sm break-all text-primary">{newKey.apiKey}</code>
                  <Button variant="ghost" size="icon" onClick={() => copy(newKey.apiKey, "API key")}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Secret Key</p>
                <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-3 border border-border/50">
                  <code className="flex-1 text-sm break-all text-amber-400">{newKey.secretKey}</code>
                  <Button variant="ghost" size="icon" onClick={() => copy(newKey.secretKey, "Secret key")}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <Button variant="outline" className="w-full text-xs" onClick={copyBoth}>
                <Copy className="w-3.5 h-3.5 mr-2" />Copy both credentials
              </Button>
            </div>
          )}
          <Button className="w-full mt-2" onClick={() => setNewKey(null)}>I have saved my credentials</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
