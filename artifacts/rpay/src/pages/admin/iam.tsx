import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ShieldCheck, Users, Lock, ScrollText, RefreshCw } from "lucide-react";
import {
  useGetIamMigrationStatus,
  useGetIamPermissions,
  useGetIamRoles,
  useGetIamUsers,
  useGetIamUsersUserIdPermissions,
  useGetIamAudit,
  usePostIamMigrationRun,
  usePostIamMigrationRollback,
  usePutIamRolesRolePermissionKey,
  usePutIamUsersUserIdPermissionsPermissionKey,
  useDeleteIamUsersUserIdPermissionsPermissionKey,
  getGetIamMigrationStatusQueryKey,
  getGetIamPermissionsQueryKey,
  getGetIamRolesQueryKey,
  getGetIamUsersQueryKey,
  getGetIamUsersUserIdPermissionsQueryKey,
  getGetIamAuditQueryKey,
} from "@workspace/api-client-react";

const KNOWN_ROLES = ["admin", "merchant", "payout_merchant", "payout_admin", "payout_super_admin", "agent"];

// ── Migration panel ──────────────────────────────────────────────────────────

function MigrationPanel() {
  const { data, isLoading, refetch } = useGetIamMigrationStatus();
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: getGetIamMigrationStatusQueryKey() });
    qc.invalidateQueries({ queryKey: getGetIamPermissionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetIamRolesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetIamUsersQueryKey() });
  };

  const runMutation = usePostIamMigrationRun({
    mutation: {
      onSuccess: () => {
        toast.success("IAM migration complete — catalog synced, role templates seeded.");
        invalidateAll();
      },
      onError: (e: Error) => toast.error(e.message),
    },
  });

  const rollbackMutation = usePostIamMigrationRollback({
    mutation: {
      onSuccess: () => {
        toast.success("IAM migration rolled back. System in legacy role-based mode.");
        invalidateAll();
      },
      onError: (e: Error) => toast.error(e.message),
    },
  });

  if (isLoading) return <Skeleton className="h-36 w-full" />;

  const migrated = (data as any)?.migrated ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {migrated ? <CheckCircle2 className="text-emerald-400 w-5 h-5" /> : <AlertTriangle className="text-amber-400 w-5 h-5" />}
          IAM Migration Status
        </CardTitle>
        <CardDescription>
          {migrated
            ? `Migration ran on ${new Date((data as any).migratedAt).toLocaleString()}. ${(data as any).templateRows} role–permission rows. ${(data as any).catalogRows ?? 0} catalog keys in DB.`
            : "Migration not yet run. System is in soft/legacy mode — all roles have full access."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        {!migrated ? (
          <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700">
            {runMutation.isPending ? "Running…" : "Run IAM Migration"}
          </Button>
        ) : (
          <Button variant="destructive" onClick={() => {
            if (!window.confirm("Roll back IAM migration? All role templates and per-user overrides will be erased.")) return;
            rollbackMutation.mutate();
          }} disabled={rollbackMutation.isPending}>
            {rollbackMutation.isPending ? "Rolling back…" : "Rollback Migration"}
          </Button>
        )}
        <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
        {migrated && (
          <div className="ml-auto text-xs text-muted-foreground">
            {(data as any).overrideRows} per-user overrides active
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Role templates panel ──────────────────────────────────────────────────────

type RolePermMap = { role: string; permissions: Record<string, boolean> };

function RoleTemplatesPanel() {
  const { data: rolesData, isLoading: rolesLoading } = useGetIamRoles();
  const { data: catalogData, isLoading: catalogLoading } = useGetIamPermissions();
  const { data: migData } = useGetIamMigrationStatus();
  const qc = useQueryClient();
  const [activeRole, setActiveRole] = useState("admin");
  const [optimisticState, setOptimisticState] = useState<Record<string, boolean>>({});
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());

  const updateMutation = usePutIamRolesRolePermissionKey();

  if (rolesLoading || catalogLoading) return <Skeleton className="h-64 w-full" />;

  const migrated = (migData as any)?.migrated ?? false;
  const roleMap: Record<string, Record<string, boolean>> = {};
  for (const r of ((rolesData as any)?.roles ?? []) as RolePermMap[]) {
    roleMap[r.role] = r.permissions;
  }
  const catalogKeys: { key: string; isSuperAdminOnly: boolean; category: string }[] = (catalogData as any)?.permissions ?? [];
  const categories = Array.from(new Set(catalogKeys.map((k) => k.category)));

  const activePerms = roleMap[activeRole] ?? {};

  function handleToggle(role: string, permKey: string, newVal: boolean) {
    const optKey = `${role}.${permKey}`;
    setOptimisticState(prev => ({ ...prev, [optKey]: newVal }));
    setPendingKeys(prev => new Set(prev).add(optKey));
    updateMutation.mutate(
      { role, permissionKey: permKey, data: { isEnabled: newVal } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetIamRolesQueryKey() });
          toast.success("Role template updated");
          setOptimisticState(prev => { const n = { ...prev }; delete n[optKey]; return n; });
          setPendingKeys(prev => { const ns = new Set(prev); ns.delete(optKey); return ns; });
        },
        onError: (e: Error) => {
          toast.error(e.message || "Save failed — change reverted");
          setOptimisticState(prev => { const n = { ...prev }; delete n[optKey]; return n; });
          setPendingKeys(prev => { const ns = new Set(prev); ns.delete(optKey); return ns; });
        },
      }
    );
  }

  return (
    <div className="space-y-4">
      {!migrated && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-400">
          IAM migration not run — showing catalog defaults. Run migration to activate enforcement.
        </div>
      )}
      <Tabs value={activeRole} onValueChange={setActiveRole}>
        <TabsList className="flex-wrap h-auto gap-1">
          {KNOWN_ROLES.map((r) => (
            <TabsTrigger key={r} value={r} className="text-xs">{r}</TabsTrigger>
          ))}
        </TabsList>
        {KNOWN_ROLES.map((r) => (
          <TabsContent key={r} value={r} className="mt-4">
            <div className="space-y-4">
              {categories.map((cat) => {
                const keys = catalogKeys.filter((k) => k.category === cat);
                return (
                  <Card key={cat}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm capitalize">{cat.replace(/_/g, " ")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {keys.map((k) => {
                          const optKey = `${r}.${k.key}`;
                          const displayVal = optKey in optimisticState ? optimisticState[optKey] : (activePerms[k.key] ?? false);
                          const isSaving = pendingKeys.has(optKey);
                          return (
                            <div key={k.key} className="flex items-center justify-between gap-3 min-h-[48px] py-1 border-b border-white/5 last:border-0">
                              <div className="flex items-center gap-2 min-w-0">
                                {k.isSuperAdminOnly && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                                <span className="text-xs font-mono truncate text-muted-foreground">{k.key}</span>
                              </div>
                              <Switch
                                checked={displayVal}
                                disabled={!migrated || k.isSuperAdminOnly}
                                className={isSaving ? "opacity-60" : ""}
                                onCheckedChange={(checked) => handleToggle(r, k.key, checked)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// ── User overrides panel ──────────────────────────────────────────────────────

function UserOverridesPanel() {
  const { data, isLoading } = useGetIamUsers({ limit: 100 });
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const { data: userPerms, isLoading: permsLoading } = useGetIamUsersUserIdPermissions(
    selectedUserId ?? 0,
    { query: { enabled: !!selectedUserId, queryKey: getGetIamUsersUserIdPermissionsQueryKey(selectedUserId ?? 0) } },
  );
  const qc = useQueryClient();

  const setOverride = usePutIamUsersUserIdPermissionsPermissionKey({
    mutation: {
      onSuccess: () => {
        if (selectedUserId) {
          qc.invalidateQueries({ queryKey: getGetIamUsersUserIdPermissionsQueryKey(selectedUserId) });
        }
        qc.invalidateQueries({ queryKey: getGetIamUsersQueryKey() });
        toast.success("Permission override saved");
      },
      onError: (e: Error) => toast.error(e.message),
    },
  });

  const removeOverride = useDeleteIamUsersUserIdPermissionsPermissionKey({
    mutation: {
      onSuccess: () => {
        if (selectedUserId) {
          qc.invalidateQueries({ queryKey: getGetIamUsersUserIdPermissionsQueryKey(selectedUserId) });
        }
        qc.invalidateQueries({ queryKey: getGetIamUsersQueryKey() });
        toast.success("Override removed — reverted to role default");
      },
      onError: (e: Error) => toast.error(e.message),
    },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const users = (data as any)?.users ?? [];
  const ud = userPerms as any;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-1">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" /> Users ({users.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
            {users.map((u: any) => (
              <button
                key={u.id}
                onClick={() => setSelectedUserId(u.id)}
                className={`w-full text-left px-4 py-3 hover:bg-white/5 transition-colors ${selectedUserId === u.id ? "bg-white/10" : ""}`}
              >
                <div className="text-sm font-medium truncate">{u.name || u.email}</div>
                <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                <div className="flex items-center gap-1 mt-1">
                  <Badge variant="outline" className="text-[10px] px-1 py-0">{u.role}</Badge>
                  {u.isSuperAdmin && <Badge className="text-[10px] px-1 py-0 bg-amber-500 text-black">Super Admin</Badge>}
                  {u.overrideCount > 0 && <Badge variant="secondary" className="text-[10px] px-1 py-0">{u.overrideCount} overrides</Badge>}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm">
            {selectedUserId
              ? `Permissions — ${ud?.user?.email ?? "…"}`
              : "Select a user to view permissions"}
          </CardTitle>
          {selectedUserId && ud?.user?.isSuperAdmin && (
            <CardDescription className="text-amber-400 flex items-center gap-1">
              <ShieldCheck className="w-4 h-4" /> Super Admin — all permissions always granted
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {!selectedUserId && <div className="text-muted-foreground text-sm">No user selected.</div>}
          {selectedUserId && permsLoading && <Skeleton className="h-48 w-full" />}
          {selectedUserId && ud && !ud.user?.isSuperAdmin && (
            <>
              {ud.overrides?.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs text-muted-foreground uppercase mb-2">Active Overrides</div>
                  <div className="space-y-1">
                    {ud.overrides.map((o: any) => (
                      <div key={o.permissionKey} className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{o.permissionKey}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={o.effect === "ALLOW" ? "default" : "destructive"} className="text-[10px]">{o.effect}</Badge>
                          <button
                            className="text-red-400 hover:text-red-300 text-xs"
                            onClick={() => removeOverride.mutate({ userId: selectedUserId, permissionKey: o.permissionKey })}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Permission</TableHead>
                    <TableHead className="text-xs">Role Default</TableHead>
                    <TableHead className="text-xs">Effective</TableHead>
                    <TableHead className="text-xs">Override</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(ud.effectivePermissions ?? {}).map(([key, effective]) => {
                    const roleDefault = ud.roleTemplate?.[key] ?? false;
                    const override = ud.overrides?.find((o: any) => o.permissionKey === key);
                    return (
                      <TableRow key={key} className={override ? "bg-amber-500/5" : ""}>
                        <TableCell className="text-xs font-mono py-1">{key}</TableCell>
                        <TableCell className="py-1">
                          <Badge variant={roleDefault ? "default" : "secondary"} className="text-[10px]">
                            {roleDefault ? "✓" : "✗"}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1">
                          <Badge variant={(effective as boolean) ? "default" : "secondary"} className="text-[10px]">
                            {(effective as boolean) ? "✓" : "✗"}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1">
                          <div className="flex gap-1">
                            <button
                              className="text-[10px] px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40"
                              onClick={() => setOverride.mutate({ userId: selectedUserId, permissionKey: key, data: { effect: "ALLOW" } })}
                              disabled={setOverride.isPending}
                            >
                              Allow
                            </button>
                            <button
                              className="text-[10px] px-2 py-0.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/40"
                              onClick={() => setOverride.mutate({ userId: selectedUserId, permissionKey: key, data: { effect: "DENY" } })}
                              disabled={setOverride.isPending}
                            >
                              Deny
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Audit trail panel ─────────────────────────────────────────────────────────

function AuditTrailPanel() {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useGetIamAudit({ page, limit: 50 });

  const entries: any[] = (data as any)?.entries ?? [];
  const total: number = (data as any)?.total ?? 0;
  const limit: number = (data as any)?.limit ?? 50;
  const totalPages = Math.ceil(total / limit);

  const ACTION_COLOR: Record<string, string> = {
    iam_migration_run: "text-emerald-400",
    iam_migration_rollback: "text-red-400",
    iam_permissions_synced: "text-blue-400",
    iam_role_template_updated: "text-purple-400",
    iam_user_override_set: "text-amber-400",
    iam_user_override_removed: "text-orange-400",
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">{total} IAM audit entries total</div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>

      {entries.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No IAM audit entries yet. Run a migration or modify permissions to start the audit trail.
        </div>
      )}

      {entries.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Timestamp</TableHead>
                <TableHead className="text-xs">Action</TableHead>
                <TableHead className="text-xs">By</TableHead>
                <TableHead className="text-xs">Target</TableHead>
                <TableHead className="text-xs">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap py-2">
                    {new Date(e.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="py-2">
                    <span className={`text-xs font-mono ${ACTION_COLOR[e.action] ?? "text-foreground"}`}>
                      {e.action}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs truncate max-w-[150px] py-2">{e.adminEmail}</TableCell>
                  <TableCell className="text-xs text-muted-foreground py-2">
                    {e.targetType}{e.targetId ? ` #${e.targetId}` : ""}
                  </TableCell>
                  <TableCell className="py-2">
                    <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap max-w-[300px] overflow-hidden">
                      {e.details ? JSON.stringify(e.details, null, 2) : "—"}
                    </pre>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminIam() {
  const { user } = useAuth();
  const hasIamRead = useHasPermission("iam_read");

  if (!user?.isSuperAdmin && !hasIamRead) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-6 text-center text-red-400">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2" />
          <div className="font-semibold">Access Restricted</div>
          <div className="text-sm mt-1">IAM control panel requires the <code>iam_read</code> permission.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-amber-400" />
          IAM &amp; RBAC
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage role permission templates, per-user overrides, and review the full IAM audit trail.
          Super Admin always has unrestricted access to all permissions.
        </p>
      </div>

      <MigrationPanel />

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="roles">Role Templates</TabsTrigger>
          <TabsTrigger value="users">User Overrides</TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-1">
            <ScrollText className="w-3 h-3" /> Audit Trail
          </TabsTrigger>
        </TabsList>
        <TabsContent value="roles" className="mt-4">
          <RoleTemplatesPanel />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UserOverridesPanel />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditTrailPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
