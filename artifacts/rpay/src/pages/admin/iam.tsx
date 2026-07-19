import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { AlertTriangle, CheckCircle2, ShieldCheck, Users, Lock, ScrollText, RefreshCw } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...((opts?.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

const KNOWN_ROLES = ["admin", "merchant", "payout_merchant", "payout_admin", "payout_super_admin", "agent"];

function useMigrationStatus() {
  return useQuery({
    queryKey: ["iam", "migration", "status"],
    queryFn: () => apiFetch("/iam/migration/status"),
    refetchInterval: false,
  });
}

function usePermissionCatalog() {
  return useQuery({
    queryKey: ["iam", "permissions"],
    queryFn: () => apiFetch("/iam/permissions"),
  });
}

function useRoles() {
  return useQuery({
    queryKey: ["iam", "roles"],
    queryFn: () => apiFetch("/iam/roles"),
  });
}

function useIamUsers() {
  return useQuery({
    queryKey: ["iam", "users"],
    queryFn: () => apiFetch("/iam/users?limit=100"),
  });
}

function useUserPermissions(userId: number | null) {
  return useQuery({
    queryKey: ["iam", "users", userId, "permissions"],
    queryFn: () => apiFetch(`/iam/users/${userId}/permissions`),
    enabled: !!userId,
  });
}

function useIamAudit(page: number) {
  return useQuery({
    queryKey: ["iam", "audit", page],
    queryFn: () => apiFetch(`/iam/audit?page=${page}&limit=50`),
  });
}

// ── Migration panel ──────────────────────────────────────────────────────────

function MigrationPanel() {
  const { data, isLoading, refetch } = useMigrationStatus();
  const qc = useQueryClient();

  const runMutation = useMutation({
    mutationFn: () => apiFetch("/iam/migration/run", { method: "POST" }),
    onSuccess: () => {
      toast.success("IAM migration complete — catalog synced, role templates seeded.");
      qc.invalidateQueries({ queryKey: ["iam"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rollbackMutation = useMutation({
    mutationFn: () => apiFetch("/iam/migration/rollback", { method: "POST" }),
    onSuccess: () => {
      toast.success("IAM migration rolled back. System in legacy role-based mode.");
      qc.invalidateQueries({ queryKey: ["iam"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const syncCatalogMutation = useMutation({
    mutationFn: () => apiFetch("/iam/permissions/sync", { method: "POST" }),
    onSuccess: (d: any) => {
      toast.success(`Permissions catalog synced — ${d.upserted} keys.`);
      qc.invalidateQueries({ queryKey: ["iam", "permissions"] });
      qc.invalidateQueries({ queryKey: ["iam", "migration", "status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-36 w-full" />;

  const migrated = data?.migrated ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {migrated ? <CheckCircle2 className="text-emerald-400 w-5 h-5" /> : <AlertTriangle className="text-amber-400 w-5 h-5" />}
          IAM Migration Status
        </CardTitle>
        <CardDescription>
          {migrated
            ? `Migration ran on ${new Date(data.migratedAt).toLocaleString()}. ${data.templateRows} role–permission rows. ${data.catalogRows ?? 0} catalog keys in DB.`
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
        <Button variant="outline" size="sm" onClick={() => syncCatalogMutation.mutate()} disabled={syncCatalogMutation.isPending}>
          <RefreshCw className={`w-3 h-3 mr-1 ${syncCatalogMutation.isPending ? "animate-spin" : ""}`} />
          Sync Catalog to DB
        </Button>
        <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
        {migrated && (
          <div className="ml-auto text-xs text-muted-foreground">
            {data.overrideRows} per-user overrides active
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Role templates panel ──────────────────────────────────────────────────────

type RolePermMap = { role: string; permissions: Record<string, boolean> };

function RoleTemplatesPanel() {
  const { data: rolesData, isLoading: rolesLoading } = useRoles();
  const { data: catalogData, isLoading: catalogLoading } = usePermissionCatalog();
  const { data: migData } = useMigrationStatus();
  const qc = useQueryClient();
  const [activeRole, setActiveRole] = useState("admin");

  const updateMutation = useMutation({
    mutationFn: ({ role, key, isEnabled }: { role: string; key: string; isEnabled: boolean }) =>
      apiFetch(`/iam/roles/${role}/${key}`, { method: "PUT", body: JSON.stringify({ isEnabled }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iam", "roles"] });
      toast.success("Role template updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (rolesLoading || catalogLoading) return <Skeleton className="h-64 w-full" />;

  const migrated = migData?.migrated ?? false;
  const roleMap: Record<string, Record<string, boolean>> = {};
  for (const r of (rolesData?.roles ?? []) as RolePermMap[]) {
    roleMap[r.role] = r.permissions;
  }
  const catalogKeys: { key: string; isSuperAdminOnly: boolean; category: string }[] = catalogData?.permissions ?? [];
  const categories = Array.from(new Set(catalogKeys.map((k) => k.category)));

  const activePerms = roleMap[activeRole] ?? {};

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
                        {keys.map((k) => (
                          <div key={k.key} className="flex items-center justify-between gap-2 py-1 border-b border-white/5 last:border-0">
                            <div className="flex items-center gap-2 min-w-0">
                              {k.isSuperAdminOnly && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                              <span className="text-xs font-mono truncate text-muted-foreground">{k.key}</span>
                            </div>
                            <Switch
                              checked={activePerms[k.key] ?? false}
                              disabled={!migrated || k.isSuperAdminOnly || updateMutation.isPending}
                              onCheckedChange={(checked) =>
                                updateMutation.mutate({ role: r, key: k.key, isEnabled: checked })
                              }
                            />
                          </div>
                        ))}
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
  const { data, isLoading } = useIamUsers();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const { data: userPerms, isLoading: permsLoading } = useUserPermissions(selectedUserId);
  const qc = useQueryClient();

  const setOverride = useMutation({
    mutationFn: ({ userId, key, effect }: { userId: number; key: string; effect: "ALLOW" | "DENY" }) =>
      apiFetch(`/iam/users/${userId}/permissions/${key}`, { method: "PUT", body: JSON.stringify({ effect }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iam", "users", selectedUserId, "permissions"] });
      qc.invalidateQueries({ queryKey: ["iam", "users"] });
      toast.success("Permission override saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeOverride = useMutation({
    mutationFn: ({ userId, key }: { userId: number; key: string }) =>
      apiFetch(`/iam/users/${userId}/permissions/${key}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iam", "users", selectedUserId, "permissions"] });
      qc.invalidateQueries({ queryKey: ["iam", "users"] });
      toast.success("Override removed — reverted to role default");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const users = data?.users ?? [];

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
              ? `Permissions — ${userPerms?.user?.email ?? "…"}`
              : "Select a user to view permissions"}
          </CardTitle>
          {selectedUserId && userPerms?.user?.isSuperAdmin && (
            <CardDescription className="text-amber-400 flex items-center gap-1">
              <ShieldCheck className="w-4 h-4" /> Super Admin — all permissions always granted
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {!selectedUserId && <div className="text-muted-foreground text-sm">No user selected.</div>}
          {selectedUserId && permsLoading && <Skeleton className="h-48 w-full" />}
          {selectedUserId && userPerms && !userPerms.user?.isSuperAdmin && (
            <>
              {userPerms.overrides?.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs text-muted-foreground uppercase mb-2">Active Overrides</div>
                  <div className="space-y-1">
                    {userPerms.overrides.map((o: any) => (
                      <div key={o.permissionKey} className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{o.permissionKey}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={o.effect === "ALLOW" ? "default" : "destructive"} className="text-[10px]">{o.effect}</Badge>
                          <button
                            className="text-red-400 hover:text-red-300 text-xs"
                            onClick={() => removeOverride.mutate({ userId: selectedUserId, key: o.permissionKey })}
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
                  {Object.entries(userPerms.effectivePermissions ?? {}).map(([key, effective]) => {
                    const roleDefault = userPerms.roleTemplate?.[key] ?? false;
                    const override = userPerms.overrides?.find((o: any) => o.permissionKey === key);
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
                              onClick={() => setOverride.mutate({ userId: selectedUserId, key, effect: "ALLOW" })}
                              disabled={setOverride.isPending}
                            >
                              Allow
                            </button>
                            <button
                              className="text-[10px] px-2 py-0.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/40"
                              onClick={() => setOverride.mutate({ userId: selectedUserId, key, effect: "DENY" })}
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
  const { data, isLoading, refetch } = useIamAudit(page);

  const entries: any[] = data?.entries ?? [];
  const total: number = data?.total ?? 0;
  const limit: number = data?.limit ?? 50;
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

  if (!user?.isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-6 text-center text-red-400">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2" />
          <div className="font-semibold">Access Restricted</div>
          <div className="text-sm mt-1">IAM control panel is only accessible to Super Admin.</div>
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
