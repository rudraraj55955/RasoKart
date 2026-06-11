import { useState } from "react";
import { useListApiKeys, useGenerateApiKey, useRevokeApiKey, getListApiKeysQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Copy, Trash2, Eye, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/utils";
import { format } from "date-fns";

export default function MerchantApiKeys() {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState<{ apiKey: string; secretKey: string } | null>(null);

  const { data: keys, isLoading } = useListApiKeys();
  const generateMutation = useGenerateApiKey();
  const revokeMutation = useRevokeApiKey();

  const handleGenerate = () => {
    generateMutation.mutate(undefined, {
      onSuccess: (key) => {
        setNewKey({ apiKey: key.apiKey, secretKey: key.secretKey });
        qc.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
      },
      onError: (err: unknown) => toast.error(getApiErrorMessage(err, "Failed to generate API key")),
    });
  };

  const handleRevoke = (id: number) => {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    revokeMutation.mutate({ id }, {
      onSuccess: () => { toast.success("API key revoked"); qc.invalidateQueries({ queryKey: getListApiKeysQueryKey() }); },
      onError: () => toast.error("Failed to revoke"),
    });
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">API Keys</h1><p className="text-muted-foreground mt-1">Manage your integration credentials</p></div>
        <Button onClick={handleGenerate} disabled={generateMutation.isPending}><Plus className="w-4 h-4 mr-2" />Generate Key</Button>
      </div>

      <Alert className="border-amber-500/30 bg-amber-500/5">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        <AlertDescription className="text-amber-200/80">Keep your secret key safe. Never expose it in client-side code or public repositories.</AlertDescription>
      </Alert>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>API Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 2 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : !keys?.length ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">No API keys generated yet</TableCell></TableRow>
              ) : keys.map(key => (
                <TableRow key={key.id}>
                  <TableCell className="font-mono text-sm">{key.keyPrefix}</TableCell>
                  <TableCell><Badge variant={key.isActive ? "default" : "secondary"}>{key.isActive ? "Active" : "Revoked"}</Badge></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{key.lastUsedAt ? format(new Date(key.lastUsedAt), "MMM d, HH:mm") : "Never"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{format(new Date(key.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    {key.isActive && (
                      <Button variant="ghost" size="icon" className="text-rose-500 hover:text-rose-400" onClick={() => handleRevoke(key.id)}><Trash2 className="w-4 h-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!newKey} onOpenChange={() => setNewKey(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="w-5 h-5 text-amber-500" /> Save your credentials now</DialogTitle></DialogHeader>
          <Alert className="border-rose-500/30 bg-rose-500/5">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <AlertDescription className="text-rose-200/80 font-medium">This is the only time the secret key will be shown. Copy it now — it cannot be retrieved later.</AlertDescription>
          </Alert>
          {newKey && (
            <div className="space-y-4 mt-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">API Key</p>
                <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-3 border border-border/50">
                  <code className="flex-1 text-sm break-all text-primary">{newKey.apiKey}</code>
                  <Button variant="ghost" size="icon" onClick={() => copy(newKey.apiKey, "API key")}><Copy className="w-4 h-4" /></Button>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Secret Key</p>
                <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-3 border border-border/50">
                  <code className="flex-1 text-sm break-all text-amber-400">{newKey.secretKey}</code>
                  <Button variant="ghost" size="icon" onClick={() => copy(newKey.secretKey, "Secret key")}><Copy className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          )}
          <Button className="w-full mt-2" onClick={() => setNewKey(null)}>I have saved my credentials</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
