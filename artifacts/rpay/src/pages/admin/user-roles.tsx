import { useState } from "react";
import { useListUsers, useUpdateUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Shield, Search, Users, Edit2, ShieldCheck, ShieldAlert, User } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  admin:    { label: "Admin",    icon: ShieldCheck, color: "bg-rose-500/10 text-rose-400 border-rose-500/20" },
  merchant: { label: "Merchant", icon: ShieldAlert, color: "bg-primary/10 text-primary border-primary/20" },
  viewer:   { label: "Viewer",   icon: User,        color: "bg-muted/30 text-muted-foreground border-border" },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.viewer;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function exportCsv(data: any[]) {
  if (!data.length) return;
  const rows = [["ID", "Name", "Email", "Role", "Merchant ID", "Created"]];
  data.forEach(u => rows.push([
    String(u.id), u.name, u.email, u.role,
    u.merchantId ? String(u.merchantId) : "", u.createdAt,
  ]));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "user-roles.csv";
  a.click();
}

export default function AdminUserRoles() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [newRole, setNewRole] = useState("");

  const { data, isLoading } = useListUsers({ search: search || undefined, role: roleFilter === "all" ? undefined : (roleFilter as any), page, limit: 20 } as any);
  const updateMutation = useUpdateUser();

  const users = (data as any)?.data ?? data ?? [];
  const total = (data as any)?.total ?? (Array.isArray(data) ? data.length : 0);

  const adminCount = (Array.isArray(users) ? users : []).filter((u: any) => u.role === "admin").length;
  const merchantCount = (Array.isArray(users) ? users : []).filter((u: any) => u.role === "merchant").length;

  const handleRoleUpdate = () => {
    if (!editUser || !newRole) return;
    updateMutation.mutate({ id: editUser.id, data: { role: newRole as any } }, {
      onSuccess: () => {
        toast.success(`Role updated to ${newRole}`);
        setEditUser(null);
        setNewRole("");
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => toast.error("Failed to update role"),
    });
  };

  const userList = Array.isArray(users) ? users : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Roles</h1>
          <p className="text-muted-foreground mt-1">Manage user access levels and permissions</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportCsv(userList)}>Export CSV</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Users</p>
                <p className="text-lg font-bold">{total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-500/10 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-rose-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Admins</p>
                <p className="text-lg font-bold">{adminCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <ShieldAlert className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Merchants</p>
                <p className="text-lg font-bold">{merchantCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by name or email..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Select value={roleFilter} onValueChange={v => { setRoleFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="merchant">Merchant</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Merchant ID</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : !userList.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    No users found
                  </TableCell>
                </TableRow>
              ) : userList.map((user: any) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                        {user.name?.[0]?.toUpperCase() ?? "U"}
                      </div>
                      <span className="font-medium text-sm">{user.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{user.email}</TableCell>
                  <TableCell><RoleBadge role={user.role} /></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {user.merchantId ? `#${user.merchantId}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {user.createdAt ? format(new Date(user.createdAt), "MMM d, yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => { setEditUser(user); setNewRole(user.role); }}
                    >
                      <Edit2 className="w-3.5 h-3.5 mr-1" />
                      Edit Role
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > 20 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{total} total users</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={!!editUser} onOpenChange={() => { setEditUser(null); setNewRole(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Change Role — {editUser?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Current role: <RoleBadge role={editUser?.role ?? ""} />
            </p>
            <div className="space-y-2">
              <Label>New Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger><SelectValue placeholder="Select role..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin — Full platform access</SelectItem>
                  <SelectItem value="merchant">Merchant — Merchant portal access</SelectItem>
                  <SelectItem value="viewer">Viewer — Read-only access</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newRole === "admin" && (
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
                ⚠️ Admins have full access to all platform data and settings.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditUser(null); setNewRole(""); }}>Cancel</Button>
            <Button
              onClick={handleRoleUpdate}
              disabled={!newRole || newRole === editUser?.role || updateMutation.isPending}
            >
              {updateMutation.isPending ? "Updating..." : "Update Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
