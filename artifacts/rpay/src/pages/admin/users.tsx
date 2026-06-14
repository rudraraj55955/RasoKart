import { useState } from "react";
import { useListUsers, useCreateUser, useUpdateUser, useDeleteUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Bell, BellOff, AlertTriangle, Clock, Info } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";

type User = {
  id: number;
  email: string;
  role: string;
  name: string;
  isActive?: boolean;
  merchantId?: number | null;
  reconciliationAlertEmails?: boolean;
  notifPrefsDisabledAt?: string | null;
  notifReminderSentAt?: string | null;
  createdAt: string;
};

export default function AdminUsers() {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const [role, setRole] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "admin" });

  const { data, isLoading } = useListUsers({ role: role as any, page, limit: 20 });
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();

  const noAdminAlerts = !isLoading && data?.data != null && (() => {
    const admins = data.data.filter(u => u.role === "admin" && u.isActive);
    return admins.length > 0 && admins.every(u => u.reconciliationAlertEmails === false);
  })();

  const handleCreate = () => {
    if (!form.email || !form.password || !form.name) return;
    createMutation.mutate({ data: form as any }, {
      onSuccess: () => { toast.success("User created"); setCreateOpen(false); setForm({ email: "", password: "", name: "", role: "admin" }); qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); },
      onError: () => toast.error("Failed to create user"),
    });
  };

  const handleToggle = (id: number, isActive: boolean) => {
    updateMutation.mutate({ id, data: { isActive } }, {
      onSuccess: () => { toast.success(isActive ? "User activated" : "User deactivated"); qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); },
      onError: () => toast.error("Failed to update user"),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this user?")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast.success("User deleted"); qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); },
      onError: () => toast.error("Failed to delete user"),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Team</h1><p className="text-muted-foreground mt-1">Manage admin users and access</p></div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" />Add User</Button>
      </div>

      {noAdminAlerts && (
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-400">
          <AlertTriangle className="h-4 w-4 !text-amber-400" />
          <AlertDescription>
            No active admin has reconciliation alert emails enabled. Unmatched-item alerts won't be delivered to anyone.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-4">
          <Select value={role} onValueChange={v => { setRole(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="merchant">Merchant</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Recon Alerts</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><div className="h-4 bg-muted/50 rounded animate-pulse" /></TableCell>)}</TableRow>
              )) : data?.data?.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No users found</TableCell></TableRow>
              ) : data?.data?.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell><Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge></TableCell>
                  <TableCell>
                    <Switch checked={u.isActive} onCheckedChange={v => handleToggle(u.id, v)} disabled={u.id === currentUser?.id} />
                  </TableCell>
                  <TableCell>
                    {u.role === "admin" ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1.5">
                            {u.reconciliationAlertEmails !== false ? (
                              <Bell className="w-4 h-4 text-emerald-500" />
                            ) : (
                              <BellOff className="w-4 h-4 text-muted-foreground" />
                            )}
                            <span className={`text-xs font-medium ${u.reconciliationAlertEmails !== false ? "text-emerald-500" : "text-muted-foreground"}`}>
                              {u.reconciliationAlertEmails !== false ? "On" : "Off"}
                            </span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {u.reconciliationAlertEmails !== false
                            ? "Receives reconciliation alert emails"
                            : "Has opted out of reconciliation alert emails"}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(u.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setDetailUser(u as User)}>
                            <Info className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>View details</TooltipContent>
                      </Tooltip>
                      {u.id !== currentUser?.id && (
                        <Button variant="ghost" size="icon" className="text-rose-500 hover:text-rose-400" onClick={() => handleDelete(u.id)}><Trash2 className="w-4 h-4" /></Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </TooltipProvider>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div><Label>Name</Label><Input className="mt-1.5" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Email</Label><Input className="mt-1.5" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>Password</Label><Input className="mt-1.5" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></div>
            <div><Label>Role</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="merchant">Merchant</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.email || !form.password || !form.name || createMutation.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!detailUser} onOpenChange={open => { if (!open) setDetailUser(null); }}>
        <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
          {detailUser && (
            <>
              <SheetHeader className="mb-6">
                <SheetTitle>User Details</SheetTitle>
              </SheetHeader>

              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Name</span>
                    <span className="text-sm font-medium">{detailUser.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Email</span>
                    <span className="text-sm font-medium">{detailUser.email}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Role</span>
                    <Badge variant={detailUser.role === "admin" ? "default" : "secondary"}>{detailUser.role}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <Badge variant={detailUser.isActive ? "outline" : "secondary"} className={detailUser.isActive ? "text-emerald-500 border-emerald-500/40" : ""}>
                      {detailUser.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Joined</span>
                    <span className="text-sm">{format(new Date(detailUser.createdAt), "MMM d, yyyy")}</span>
                  </div>
                </div>

                <div className="border-t pt-6 space-y-4">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Bell className="w-4 h-4" />
                    Notification Preferences
                  </h3>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Prefs disabled since</span>
                      <span className="text-sm">
                        {detailUser.notifPrefsDisabledAt
                          ? format(new Date(detailUser.notifPrefsDisabledAt), "MMM d, yyyy, h:mm a")
                          : <span className="text-muted-foreground/50">Never disabled</span>
                        }
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        Last reminder sent
                      </span>
                      <span className="text-sm">
                        {detailUser.notifReminderSentAt
                          ? format(new Date(detailUser.notifReminderSentAt), "MMM d, yyyy, h:mm a")
                          : <span className="text-muted-foreground/50">Never</span>
                        }
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
