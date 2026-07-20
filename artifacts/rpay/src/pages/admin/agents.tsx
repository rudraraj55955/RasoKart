import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { RasoConfirmModal } from "@/components/ui/raso-confirm-modal";
import {
  Plus, UserCheck, UserX, RotateCcw, Send, LogOut, RefreshCw, Pencil,
  Copy, CheckCircle2, AlertTriangle, Shield, Users
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { apiUrl } from "@/lib/api-url";
import { useAuth } from "@/lib/auth-context";
import { getToken } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";

type Agent = {
  id: number;
  userId: number | null;
  name: string;
  email: string;
  mobile: string;
  status: string;
  agentCode: string | null;
  employeeId: string | null;
  department: string | null;
  team: string | null;
  reportingManager: string | null;
  referralCode: string;
  inviteStatus: string;
  firstLoginAt: string | null;
  walletBalance: string;
  totalCommissionEarned: string;
  totalCommissionPaid: string;
  notes: string | null;
  createdAt: string;
};

type CreateAgentForm = {
  name: string;
  email: string;
  mobile: string;
  employeeId: string;
  department: string;
  team: string;
  reportingManager: string;
  notes: string;
};

const EMPTY_FORM: CreateAgentForm = {
  name: "", email: "", mobile: "", employeeId: "",
  department: "", team: "", reportingManager: "", notes: "",
};

function authHeaders(): Record<string, string> {
  const tok = getToken();
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

function useAgents() {
  return useQuery<{ data: Agent[]; total: number }>({
    queryKey: ["admin-agents"],
    queryFn: async () => {
      const r = await fetch(apiUrl("/api/admin/agents"), { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load agents");
      return (await r.json()) as { data: Agent[]; total: number };
    },
  });
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    active: "bg-green-500/20 text-green-400 border-green-500/30",
    suspended: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    deactivated: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${variants[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function InviteBadge({ status }: { status: string }) {
  if (status === "accepted") return <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Activated</span>;
  return <span className="text-xs text-yellow-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Pending invite</span>;
}

export default function AdminAgents() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { data, isLoading, refetch } = useAgents();
  const agents = data?.data ?? [];

  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateAgentForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ inviteLink: string; agentCode: string } | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Agent>>({});

  const [confirmAction, setConfirmAction] = useState<{ agentId: number; action: string; label: string } | null>(null);

  const filtered = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.email.toLowerCase().includes(search.toLowerCase()) ||
      (a.agentCode ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (a.employeeId ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.mobile) return;
    setCreating(true);
    try {
      const r = await fetch(apiUrl("/api/admin/agents"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (r.ok) {
        toast.success("Agent account created");
        setInviteResult({ inviteLink: data.inviteLink, agentCode: data.agent?.agentCode ?? "" });
        setForm(EMPTY_FORM);
        qc.invalidateQueries({ queryKey: ["admin-agents"] });
      } else {
        toast.error(data.error ?? "Failed to create agent");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setCreating(false);
    }
  };

  const doAction = async (agentId: number, action: string) => {
    const endpoints: Record<string, string> = {
      activate: `/api/admin/agents/${agentId}/activate`,
      suspend: `/api/admin/agents/${agentId}/suspend`,
      deactivate: `/api/admin/agents/${agentId}/deactivate`,
      "reset-password": `/api/admin/agents/${agentId}/reset-password`,
      "resend-invite": `/api/admin/agents/${agentId}/resend-invite`,
      "revoke-sessions": `/api/admin/agents/${agentId}/revoke-sessions`,
    };
    const url = endpoints[action];
    if (!url) return;

    try {
      const r = await fetch(apiUrl(url), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
      });
      const data = await r.json();
      if (r.ok) {
        if (data.inviteLink) {
          const agent = agents.find((a) => a.id === agentId);
          setInviteResult({ inviteLink: data.inviteLink, agentCode: agent?.agentCode ?? "" });
        }
        toast.success(data.message ?? "Done");
        qc.invalidateQueries({ queryKey: ["admin-agents"] });
      } else {
        toast.error(data.error ?? "Action failed");
      }
    } catch {
      toast.error("Network error");
    }
    setConfirmAction(null);
  };

  const handleSaveEdit = async () => {
    if (!selectedAgent) return;
    try {
      const r = await fetch(apiUrl(`/api/admin/agents/${selectedAgent.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(editForm),
      });
      const data = await r.json();
      if (r.ok) {
        toast.success("Agent updated");
        setEditOpen(false);
        qc.invalidateQueries({ queryKey: ["admin-agents"] });
      } else {
        toast.error(data.error ?? "Failed to update agent");
      }
    } catch {
      toast.error("Network error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-muted-foreground text-sm">Manage RasoKart agent accounts and access</p>
        </div>
        <Button onClick={() => { setCreateOpen(true); setInviteResult(null); }}>
          <Plus className="h-4 w-4 mr-2" /> Create Agent
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Agents", value: agents.length, icon: Users },
          { label: "Active", value: agents.filter(a => a.status === "active").length, icon: UserCheck },
          { label: "Suspended", value: agents.filter(a => a.status === "suspended").length, icon: UserX },
          { label: "Activated", value: agents.filter(a => a.inviteStatus === "accepted").length, icon: CheckCircle2 },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="border-border/60">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Icon className="h-4 w-4" />
                <span className="text-xs">{label}</span>
              </div>
              <div className="text-2xl font-bold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Search by name, email, agent code, employee ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-12 text-sm">
              {agents.length === 0 ? "No agents yet. Create one to get started." : "No results found."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Agent</TableHead>
                    <TableHead>Agent Code</TableHead>
                    <TableHead>Department / Team</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Invite</TableHead>
                    <TableHead>First Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((agent) => (
                    <TableRow key={agent.id} className="group">
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">{agent.name}</p>
                          <p className="text-xs text-muted-foreground">{agent.email}</p>
                          <p className="text-xs text-muted-foreground">{agent.mobile}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {agent.agentCode ? (
                          <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{agent.agentCode}</span>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs space-y-0.5">
                          {agent.department && <p>{agent.department}</p>}
                          {agent.team && <p className="text-muted-foreground">{agent.team}</p>}
                          {!agent.department && !agent.team && <p className="text-muted-foreground">—</p>}
                        </div>
                      </TableCell>
                      <TableCell><StatusBadge status={agent.status} /></TableCell>
                      <TableCell><InviteBadge status={agent.inviteStatus} /></TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {agent.firstLoginAt ? format(new Date(agent.firstLoginAt), "dd MMM yyyy") : "Not yet"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            title="Edit profile"
                            onClick={() => { setSelectedAgent(agent); setEditForm({ name: agent.name, mobile: agent.mobile, employeeId: agent.employeeId ?? "", department: agent.department ?? "", team: agent.team ?? "", reportingManager: agent.reportingManager ?? "", notes: agent.notes ?? "" }); setEditOpen(true); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {agent.status !== "active" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-green-400" title="Activate"
                              onClick={() => setConfirmAction({ agentId: agent.id, action: "activate", label: `Activate ${agent.name}?` })}>
                              <UserCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {agent.status === "active" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-yellow-400" title="Suspend"
                              onClick={() => setConfirmAction({ agentId: agent.id, action: "suspend", label: `Suspend ${agent.name}? They will immediately lose access.` })}>
                              <UserX className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Reset password / resend invite"
                            onClick={() => setConfirmAction({ agentId: agent.id, action: "reset-password", label: `Generate a new invite link for ${agent.name}?` })}>
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" title="Revoke all sessions"
                            onClick={() => setConfirmAction({ agentId: agent.id, action: "revoke-sessions", label: `Revoke all active sessions for ${agent.name}? They will be logged out immediately.` })}>
                            <LogOut className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Agent Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Agent Account</DialogTitle>
          </DialogHeader>
          {inviteResult ? (
            <div className="space-y-4">
              <Alert className="border-green-500/50 bg-green-500/10">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription className="text-green-600">
                  Agent account created! Share this invite link with the agent.
                </AlertDescription>
              </Alert>
              {inviteResult.agentCode && (
                <div className="flex items-center gap-2 text-sm">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono font-medium">{inviteResult.agentCode}</span>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Invite Link (expires in 72 hours)</Label>
                <div className="flex gap-2">
                  <Input value={inviteResult.inviteLink} readOnly className="font-mono text-xs" />
                  <Button
                    variant="outline" size="icon"
                    onClick={() => { navigator.clipboard.writeText(inviteResult!.inviteLink); toast.success("Copied!"); }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The agent will use this link to set their password and activate their account. The link expires in 72 hours.
                Plain-text passwords are never sent.
              </p>
              <DialogFooter>
                <Button onClick={() => { setCreateOpen(false); setInviteResult(null); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label>Full Name *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Agent full name" required />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Email *</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="agent@company.com" required />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Mobile *</Label>
                  <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+91 9999999999" required />
                </div>
                <div className="space-y-1">
                  <Label>Employee ID</Label>
                  <Input value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} placeholder="EMP-001" />
                </div>
                <div className="space-y-1">
                  <Label>Department</Label>
                  <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Sales" />
                </div>
                <div className="space-y-1">
                  <Label>Team</Label>
                  <Input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="North India" />
                </div>
                <div className="space-y-1">
                  <Label>Reporting Manager</Label>
                  <Input value={form.reportingManager} onChange={(e) => setForm({ ...form, reportingManager: e.target.value })} placeholder="Manager name" />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional internal notes" rows={2} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                An invite link will be generated. No password is set — the agent must use the invite link to activate.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={creating || !form.name || !form.email || !form.mobile}>
                  {creating ? <><Spinner className="w-4 h-4 mr-2" /> Creating…</> : "Create & Get Invite Link"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Agent Sheet */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Agent — {selectedAgent?.name}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            {[
              { key: "name", label: "Full Name" },
              { key: "mobile", label: "Mobile" },
              { key: "employeeId", label: "Employee ID" },
              { key: "department", label: "Department" },
              { key: "team", label: "Team" },
              { key: "reportingManager", label: "Reporting Manager" },
            ].map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <Label>{label}</Label>
                <Input
                  value={(editForm as any)[key] ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                value={editForm.notes ?? ""}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={3}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button className="flex-1" onClick={handleSaveEdit}>Save Changes</Button>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirm Action Modal */}
      {confirmAction && (
        <RasoConfirmModal
          title="Confirm Action"
          description={confirmAction.label}
          onConfirm={() => { void doAction(confirmAction.agentId, confirmAction.action); }}
          onOpenChange={(v) => { if (!v) setConfirmAction(null); }}
          open={!!confirmAction}
        />
      )}
    </div>
  );
}
