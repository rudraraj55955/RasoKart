import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Trash2, History, RefreshCw, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useDryRunDummyDataCleanup,
  useConfirmDummyDataCleanup,
  useGetDummyDataCleanupHistory,
  useGetMe,
} from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";

const CONFIRM_PHRASE = "CLEAN_DUMMY_DATA";

type DeliveryRetention = {
  retentionDays: number;
  minimumRetentionDays: number;
  schedule: string;
  history: Array<{
    id: number;
    trigger: string;
    ranAt: string;
    status: "success" | "failed";
    summary: string | null;
    deleted: number;
    retentionDays: number;
  }>;
};

async function retentionRequest(path: string, init?: RequestInit) {
  const response = await fetch(`/api/system-config/password-reset-delivery-retention${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Password reset delivery cleanup request failed");
  }
  return response.json();
}

export default function AdminDataHygiene() {
  const { data: me } = useGetMe();
  const isSuperAdmin = me?.isSuperAdmin ?? false;
  const [confirmText, setConfirmText] = useState("");
  const [hasRunDryRun, setHasRunDryRun] = useState(false);
  const [deliveryRetentionDays, setDeliveryRetentionDays] = useState(30);
  const queryClient = useQueryClient();

  const dryRun = useDryRunDummyDataCleanup({ query: { enabled: false, queryKey: ["dummy-data-dry-run"] } });
  const history = useGetDummyDataCleanupHistory();
  const confirmCleanup = useConfirmDummyDataCleanup();
  const deliveryRetention = useQuery<DeliveryRetention>({
    queryKey: ["password-reset-delivery-retention"],
    queryFn: () => retentionRequest(""),
    enabled: isSuperAdmin,
  });
  useEffect(() => {
    if (deliveryRetention.data) setDeliveryRetentionDays(deliveryRetention.data.retentionDays);
  }, [deliveryRetention.data]);
  const saveDeliveryRetention = useMutation({
    mutationFn: () => retentionRequest("", {
      method: "PUT",
      body: JSON.stringify({ retentionDays: deliveryRetentionDays }),
    }),
    onSuccess: () => {
      toast.success("Password reset delivery retention saved");
      queryClient.invalidateQueries({ queryKey: ["password-reset-delivery-retention"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const runDeliveryCleanup = useMutation({
    mutationFn: () => retentionRequest("/run", { method: "POST" }),
    onSuccess: (result: { deleted: number }) => {
      toast.success(`Cleanup complete — deleted ${result.deleted} expired delivery record${result.deleted === 1 ? "" : "s"}.`);
      queryClient.invalidateQueries({ queryKey: ["password-reset-delivery-retention"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Super Admin only</AlertTitle>
          <AlertDescription>This section is restricted to Super Admin accounts.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const findings = dryRun.data?.findings ?? [];
  const totalRows = dryRun.data?.totalRows ?? 0;
  const latestDeliveryCleanup = deliveryRetention.data?.history[0];

  async function runDryRun() {
    setHasRunDryRun(false);
    const res = await dryRun.refetch();
    if (res.data) setHasRunDryRun(true);
  }

  function handleConfirm() {
    if (confirmText !== CONFIRM_PHRASE) {
      toast.error(`Type exactly "${CONFIRM_PHRASE}" to confirm`);
      return;
    }
    confirmCleanup.mutate(
      { data: { confirm: CONFIRM_PHRASE } },
      {
        onSuccess: (data) => {
          toast.success(`Deleted ${data.totalRowsDeleted} dummy rows across ${data.results.length} tables`);
          setConfirmText("");
          setHasRunDryRun(false);
          dryRun.refetch();
          history.refetch();
        },
        onError: () => toast.error("Cleanup failed. No changes were made outside the affected tables."),
      }
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" /> Data Hygiene — Dummy Data Cleanup
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Detect and remove seeded/demo/test data. The 3 documented demo merchant logins are never deleted
          (required for docs/health checks) — only their seeded transaction/payout/wallet history is cleaned.
          Real merchants, admins, provider settings, and live payout rows (including small ₹1/₹10 test amounts) are never touched.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step 1 — Dry Run</CardTitle>
          <CardDescription>Shows exactly what would be deleted. Nothing is deleted at this step.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={runDryRun} disabled={dryRun.isFetching}>
            {dryRun.isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Run Dry Run
          </Button>

          {hasRunDryRun && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <Badge variant={totalRows > 0 ? "destructive" : "secondary"}>{totalRows} dummy rows detected</Badge>
                <span className="text-muted-foreground">
                  {dryRun.data?.protectedDemoMerchantCount ?? 0} protected demo merchant(s) kept ·{" "}
                  {dryRun.data?.deletableDummyMerchantCount ?? 0} dummy merchant(s) eligible for deletion
                </span>
              </div>

              {findings.length === 0 ? (
                <Alert>
                  <AlertTitle>No dummy data found</AlertTitle>
                  <AlertDescription>Database is already clean.</AlertDescription>
                </Alert>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Table</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Sample IDs</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {findings.map((f) => (
                      <TableRow key={f.table}>
                        <TableCell className="font-medium">{f.table}</TableCell>
                        <TableCell>{f.count}</TableCell>
                        <TableCell className="text-muted-foreground">{f.sampleIds.join(", ")}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{f.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password Reset Delivery Retention</CardTitle>
          <CardDescription>
            Sanitized recipient and provider metadata is removed nightly after its last delivery activity.
            A minimum of 7 days is always retained for current troubleshooting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="delivery-retention-days">Retention period (days)</Label>
              <Input
                id="delivery-retention-days"
                type="number"
                min={7}
                max={365}
                className="w-36"
                value={deliveryRetentionDays}
                onChange={(event) => setDeliveryRetentionDays(Number(event.target.value))}
              />
            </div>
            <Button
              onClick={() => saveDeliveryRetention.mutate()}
              disabled={saveDeliveryRetention.isPending || deliveryRetentionDays < 7 || deliveryRetentionDays > 365}
            >
              Save retention
            </Button>
            <Button
              variant="outline"
              onClick={() => runDeliveryCleanup.mutate()}
              disabled={runDeliveryCleanup.isPending}
            >
              {runDeliveryCleanup.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Run cleanup now
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {deliveryRetention.data?.schedule ?? "Nightly cleanup"} · Current policy: {deliveryRetention.data?.retentionDays ?? 30} days
          </p>
          {latestDeliveryCleanup?.status === "failed" && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Password reset delivery cleanup failed</AlertTitle>
              <AlertDescription>
                {new Date(latestDeliveryCleanup.ranAt).toLocaleString()} · {latestDeliveryCleanup.summary}
              </AlertDescription>
            </Alert>
          )}
          {(deliveryRetention.data?.history.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No password reset delivery cleanup runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Trigger</TableHead>
                   <TableHead>Status</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>Deleted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveryRetention.data!.history.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{new Date(run.ranAt).toLocaleString()}</TableCell>
                    <TableCell className="capitalize">{run.trigger}</TableCell>
                     <TableCell>
                       <Badge variant={run.status === "failed" ? "destructive" : "secondary"}>
                         {run.status === "failed" ? "Failed" : "Succeeded"}
                       </Badge>
                     </TableCell>
                     <TableCell>{run.retentionDays > 0 ? `${run.retentionDays} days` : "Unavailable"}</TableCell>
                     <TableCell>{run.status === "failed" ? "—" : run.deleted}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {hasRunDryRun && totalRows > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" /> Step 2 — Confirm Cleanup
            </CardTitle>
            <CardDescription>
              This permanently deletes the {totalRows} rows shown above. This action is audit-logged and cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="confirm-phrase">Type "{CONFIRM_PHRASE}" to confirm</Label>
              <Input
                id="confirm-phrase"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_PHRASE}
              />
            </div>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={confirmCleanup.isPending || confirmText !== CONFIRM_PHRASE}
            >
              {confirmCleanup.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Confirm & Delete
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Cleanup History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(history.data?.history?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No cleanup runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Performed By</TableHead>
                  <TableHead>Table</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data!.history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{new Date(h.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{h.adminEmail}</TableCell>
                    <TableCell>{h.targetType}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{h.details}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
