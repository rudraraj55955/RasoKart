import { useState, useEffect } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Plus, Pencil, Trash2, Copy, Play, Pause, Clock, XCircle, Eye, Download,
  Megaphone, Image, LayoutTemplate, Timer, Zap, Star, Globe, BarChart3,
  RefreshCw, ChevronDown, ChevronUp, Layers, Settings2, TrendingUp,
} from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PLACEMENTS = [
  { value: "announcement_bar", label: "Announcement Bar (top of page)" },
  { value: "hero_bottom", label: "After Hero Section" },
  { value: "services_bottom", label: "After Services Section" },
  { value: "features_bottom", label: "After Merchant Features Section" },
  { value: "plans_bottom", label: "After Plans Section" },
  { value: "settlement_bottom", label: "After Settlement Section" },
  { value: "api_bottom", label: "After API Section" },
  { value: "payout_bottom", label: "After Payout Section" },
  { value: "trust_bottom", label: "After Trust Strip" },
  { value: "contact_bottom", label: "After Contact Section" },
  { value: "pre_footer", label: "Before Footer" },
];

const TYPES = [
  { value: "text_banner", label: "Text Banner", icon: Megaphone },
  { value: "image_banner", label: "Image Banner", icon: Image },
  { value: "full_width", label: "Full Width Promotion", icon: LayoutTemplate },
  { value: "countdown", label: "Countdown Offer", icon: Timer },
  { value: "feature_launch", label: "Feature Launch", icon: Zap },
  { value: "merchant_offer", label: "Merchant Offer", icon: Star },
  { value: "api_promotion", label: "API Promotion", icon: Globe },
  { value: "security_announcement", label: "Security Announcement", icon: Globe },
  { value: "referral_campaign", label: "Referral Campaign", icon: Globe },
  { value: "announcement_bar", label: "Announcement Bar", icon: Megaphone },
  { value: "carousel", label: "Carousel Slider", icon: Layers },
];

const THEMES = [
  { value: "dark", label: "Dark" },
  { value: "cyan", label: "Cyan / Violet" },
  { value: "emerald", label: "Emerald / Cyan" },
  { value: "amber", label: "Amber / Orange" },
  { value: "violet", label: "Violet / Purple" },
  { value: "light", label: "Light" },
  { value: "gradient", label: "Custom Gradient" },
];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  scheduled: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  published: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  paused: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  expired: "bg-red-500/20 text-red-300 border-red-500/30",
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  draft: Clock,
  scheduled: Clock,
  published: Play,
  paused: Pause,
  expired: XCircle,
};

type Campaign = Record<string, any>;

function emptyCampaign(): Record<string, any> {
  return {
    internalName: "",
    publicTitle: "",
    subtitle: "",
    description: "",
    badge: "",
    ctaText: "",
    ctaUrl: "",
    secondaryCtaText: "",
    secondaryCtaUrl: "",
    desktopImageUrl: "",
    tabletImageUrl: "",
    mobileImageUrl: "",
    videoUrl: "",
    altText: "",
    type: "text_banner",
    theme: "cyan",
    backgroundColor: "",
    gradientFrom: "",
    gradientTo: "",
    overlayOpacity: 40,
    animation: "fade",
    placement: "hero_bottom",
    priority: 0,
    displayOrder: 0,
    audience: "all",
    deviceTargeting: "all",
    language: "en",
    autoplay: true,
    slideSpeedMs: 5000,
    infiniteLoop: true,
    showNavArrows: true,
    showDots: true,
    pauseOnHover: true,
    isSlotEnabled: true,
    startAt: "",
    endAt: "",
    countdownEndAt: "",
  };
}

async function apiFetch(path: string, opts?: RequestInit) {
  const token = localStorage.getItem("rasokart_token");
  const r = await fetch(`${BASE}/api/cms/${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  return r.json();
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiFetch("analytics")
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleExport = () => {
    const token = localStorage.getItem("rasokart_token");
    const url = `${BASE}/api/cms/analytics/export`;
    const a = document.createElement("a");
    a.href = token ? `${url}?token=${token}` : url;
    const link = document.createElement("a");
    link.href = url;
    link.download = "cms-analytics.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = data?.summary ?? {};
  const stats: any[] = data?.stats ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Campaign Analytics</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: "Published", value: summary.active ?? 0, color: "text-emerald-400" },
          { label: "Scheduled", value: summary.scheduled ?? 0, color: "text-blue-400" },
          { label: "Paused", value: summary.paused ?? 0, color: "text-amber-400" },
          { label: "Draft", value: summary.draft ?? 0, color: "text-zinc-400" },
          { label: "Expired", value: summary.expired ?? 0, color: "text-red-400" },
        ].map((s) => (
          <Card key={s.label} className="bg-card/40 border-border/50">
            <CardContent className="pt-4 pb-3">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card/40 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Per-Campaign Performance</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-10 text-muted-foreground text-sm">Loading analytics…</div>
          ) : stats.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">No events tracked yet. Publish a campaign to start collecting data.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Placement</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Mobile</TableHead>
                  <TableHead className="text-right">Desktop</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((s: any) => (
                  <TableRow key={s.campaign_id}>
                    <TableCell className="font-medium text-sm">{s.internal_name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-card/60 px-1.5 py-0.5 rounded">{s.placement}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${STATUS_COLORS[s.status] ?? ""}`}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{s.impressions ?? 0}</TableCell>
                    <TableCell className="text-right">{s.clicks ?? 0}</TableCell>
                    <TableCell className="text-right">{s.ctr != null ? `${s.ctr}%` : "—"}</TableCell>
                    <TableCell className="text-right">{s.mobile_events ?? 0}</TableCell>
                    <TableCell className="text-right">{s.desktop_events ?? 0}</TableCell>
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

// ── Placement Manager Tab ─────────────────────────────────────────────────────

function PlacementManagerTab({ campaigns, onRefresh }: { campaigns: Campaign[]; onRefresh: () => void }) {
  const [saving, setSaving] = useState<number | null>(null);

  const byPlacement = PLACEMENTS.map((p) => ({
    ...p,
    campaigns: campaigns.filter((c) => c.placement === p.value),
  }));

  const toggleSlot = async (id: number, enabled: boolean) => {
    setSaving(id);
    await apiFetch(`campaigns/${id}`, {
      method: "PUT",
      body: JSON.stringify({ isSlotEnabled: enabled }),
    });
    setSaving(null);
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Placement Manager</h3>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Enable or disable promotional slots across the homepage. Each placement shows the active campaigns assigned to it.</p>

      <div className="grid gap-3">
        {byPlacement.map((slot) => (
          <Card key={slot.value} className="bg-card/40 border-border/50">
            <CardContent className="py-4 px-5">
              <div className="flex items-start gap-3">
                <Layers className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{slot.label}</span>
                    <code className="text-xs bg-card/70 px-1.5 py-0.5 rounded text-muted-foreground">{slot.value}</code>
                    <Badge variant="outline" className="text-xs">
                      {slot.campaigns.length} campaign{slot.campaigns.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  {slot.campaigns.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {slot.campaigns.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className={`text-xs ${STATUS_COLORS[c.status] ?? ""}`}>{c.status}</Badge>
                          <span>{c.internalName}</span>
                          <Switch
                            checked={c.isSlotEnabled ?? true}
                            onCheckedChange={(v) => toggleSlot(c.id, v)}
                            disabled={saving === c.id}
                            className="ml-auto scale-75"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {slot.campaigns.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">No campaigns assigned to this slot.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Campaign Form ─────────────────────────────────────────────────────────────

function CampaignForm({ initial, onSave, onCancel, saving }: {
  initial: Record<string, any>;
  onSave: (data: Record<string, any>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Record<string, any>>(initial);
  const [tab, setTab] = useState("basic");

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="basic">Basic</TabsTrigger>
          <TabsTrigger value="media">Media & CTA</TabsTrigger>
          <TabsTrigger value="display">Display</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Internal Name *</Label>
              <Input placeholder="e.g. Zero Setup Fee Q3 2026" value={form.internalName} onChange={(e) => set("internalName", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Public Title</Label>
              <Input placeholder="Headline shown to visitors" value={form.publicTitle} onChange={(e) => set("publicTitle", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Subtitle</Label>
              <Input placeholder="Supporting line under the headline" value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea rows={3} placeholder="Optional body copy" value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Badge / Label</Label>
              <Input placeholder="e.g. Limited Time, New, Hot" value={form.badge} onChange={(e) => set("badge", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Campaign Type</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Placement *</Label>
              <Select value={form.placement} onValueChange={(v) => set("placement", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLACEMENTS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority (lower = higher priority)</Label>
              <Input type="number" min={0} max={999} value={form.priority} onChange={(e) => set("priority", parseInt(e.target.value, 10) || 0)} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="media" className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Desktop Image URL</Label>
              <Input placeholder="https://..." value={form.desktopImageUrl} onChange={(e) => set("desktopImageUrl", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Tablet Image URL</Label>
              <Input placeholder="https://..." value={form.tabletImageUrl} onChange={(e) => set("tabletImageUrl", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Mobile Image URL</Label>
              <Input placeholder="https://..." value={form.mobileImageUrl} onChange={(e) => set("mobileImageUrl", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Video URL (optional)</Label>
              <Input placeholder="https://..." value={form.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Alt Text (for accessibility & SEO)</Label>
              <Input placeholder="Describe the image" value={form.altText} onChange={(e) => set("altText", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>CTA Button Text</Label>
              <Input placeholder="e.g. Apply Now, Learn More" value={form.ctaText} onChange={(e) => set("ctaText", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>CTA URL</Label>
              <Input placeholder="/merchant/apply or https://..." value={form.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Secondary CTA Text</Label>
              <Input placeholder="e.g. View Plans" value={form.secondaryCtaText} onChange={(e) => set("secondaryCtaText", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Secondary CTA URL</Label>
              <Input placeholder="/pricing or https://..." value={form.secondaryCtaUrl} onChange={(e) => set("secondaryCtaUrl", e.target.value)} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="display" className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Theme / Color</Label>
              <Select value={form.theme} onValueChange={(v) => set("theme", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {THEMES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Animation</Label>
              <Select value={form.animation} onValueChange={(v) => set("animation", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["fade", "slide", "zoom", "none"].map((a) => (
                    <SelectItem key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Overlay Opacity (0–100)</Label>
              <Input type="number" min={0} max={100} value={form.overlayOpacity} onChange={(e) => set("overlayOpacity", parseInt(e.target.value, 10) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label>Audience Targeting</Label>
              <Select value={form.audience} onValueChange={(v) => set("audience", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Visitors</SelectItem>
                  <SelectItem value="logged_out">Logged-out Only</SelectItem>
                  <SelectItem value="merchants">Merchants Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Device Targeting</Label>
              <Select value={form.deviceTargeting} onValueChange={(v) => set("deviceTargeting", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Devices</SelectItem>
                  <SelectItem value="mobile">Mobile Only</SelectItem>
                  <SelectItem value="desktop">Desktop Only</SelectItem>
                  <SelectItem value="tablet">Tablet Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Slide Speed (ms, for carousel)</Label>
              <Input type="number" min={1000} max={30000} step={500} value={form.slideSpeedMs} onChange={(e) => set("slideSpeedMs", parseInt(e.target.value, 10) || 5000)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="mb-2 block">Slider Options</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { key: "autoplay", label: "Autoplay" },
                  { key: "infiniteLoop", label: "Infinite Loop" },
                  { key: "showNavArrows", label: "Nav Arrows" },
                  { key: "showDots", label: "Dot Indicators" },
                  { key: "pauseOnHover", label: "Pause on Hover" },
                  { key: "isSlotEnabled", label: "Slot Enabled" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Switch checked={!!form[key]} onCheckedChange={(v) => set(key, v)} id={`switch-${key}`} />
                    <Label htmlFor={`switch-${key}`} className="text-sm cursor-pointer">{label}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Start Date & Time</Label>
              <Input type="datetime-local" value={form.startAt ? form.startAt.slice(0, 16) : ""} onChange={(e) => set("startAt", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date & Time (auto-expire)</Label>
              <Input type="datetime-local" value={form.endAt ? form.endAt.slice(0, 16) : ""} onChange={(e) => set("endAt", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Countdown End (for Countdown type)</Label>
              <Input type="datetime-local" value={form.countdownEndAt ? form.countdownEndAt.slice(0, 16) : ""} onChange={(e) => set("countdownEndAt", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Display Order</Label>
              <Input type="number" min={0} max={999} value={form.displayOrder} onChange={(e) => set("displayOrder", parseInt(e.target.value, 10) || 0)} />
            </div>
          </div>
          <div className="rounded-xl border border-border/40 bg-card/30 p-4 text-sm text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground text-sm">Scheduling Rules</p>
            <ul className="space-y-1 list-disc ml-4 text-xs">
              <li>Set status to <strong>Published</strong> and provide a Start Date to schedule the campaign.</li>
              <li>If End Date is set, the campaign will automatically be filtered off the site after that time.</li>
              <li>You can also manually set the status to <strong>Paused</strong> or <strong>Expired</strong> at any time.</li>
              <li>Countdown End is only used by the Countdown Offer type.</li>
            </ul>
          </div>
        </TabsContent>
      </Tabs>

      <DialogFooter className="gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={() => onSave(form)} disabled={saving || !form.internalName || !form.placement}>
          {saving ? "Saving…" : "Save Campaign"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminCms() {
  const { data: me } = useGetMe();
  const isSuperAdmin = (me as any)?.isSuperAdmin ?? false;

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("campaigns");

  // Create/Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Campaign | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Search
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadCampaigns = () => {
    setLoading(true);
    apiFetch("campaigns")
      .then((d) => setCampaigns(d.campaigns ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (isSuperAdmin) loadCampaigns(); }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">Super Admin Only</h2>
          <p className="text-muted-foreground text-sm">Website CMS is restricted to Super Admins.</p>
        </div>
      </div>
    );
  }

  const filtered = campaigns.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        c.internalName?.toLowerCase().includes(q) ||
        c.publicTitle?.toLowerCase().includes(q) ||
        c.placement?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const openCreate = () => { setEditTarget(null); setEditOpen(true); };
  const openEdit = (c: Campaign) => { setEditTarget(c); setEditOpen(true); };

  const handleSave = async (formData: Record<string, any>) => {
    setSaving(true);
    try {
      if (editTarget) {
        await apiFetch(`campaigns/${editTarget.id}`, {
          method: "PUT",
          body: JSON.stringify(formData),
        });
      } else {
        await apiFetch("campaigns", {
          method: "POST",
          body: JSON.stringify(formData),
        });
      }
      setEditOpen(false);
      loadCampaigns();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    await apiFetch(`campaigns/${deleteId}`, { method: "DELETE" });
    setDeleting(false);
    setDeleteId(null);
    loadCampaigns();
  };

  const handleDuplicate = async (id: number) => {
    await apiFetch(`campaigns/${id}/duplicate`, { method: "POST" });
    loadCampaigns();
  };

  const handleStatus = async (id: number, status: string) => {
    await apiFetch(`campaigns/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    loadCampaigns();
  };

  const initialFormData = editTarget
    ? {
        ...editTarget,
        startAt: editTarget.startAt ? String(editTarget.startAt) : "",
        endAt: editTarget.endAt ? String(editTarget.endAt) : "",
        countdownEndAt: editTarget.countdownEndAt ? String(editTarget.countdownEndAt) : "",
      }
    : emptyCampaign();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Website CMS</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage promotional campaigns, banners, and sliders for the public site.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Create Campaign
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="campaigns" className="gap-2">
            <Megaphone className="h-4 w-4" /> Campaigns
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="placements" className="gap-2">
            <Layers className="h-4 w-4" /> Placement Manager
          </TabsTrigger>
        </TabsList>

        {/* ── Campaigns Tab ── */}
        <TabsContent value="campaigns" className="space-y-4 mt-4">
          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="Search campaigns…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {["draft", "scheduled", "published", "paused", "expired"].map((s) => (
                  <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={loadCampaigns} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-16 text-muted-foreground text-sm">Loading campaigns…</div>
          ) : filtered.length === 0 ? (
            <Card className="bg-card/40 border-border/50">
              <CardContent className="py-16 text-center">
                <Megaphone className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                <h3 className="font-semibold mb-1">No campaigns found</h3>
                <p className="text-sm text-muted-foreground mb-4">Create your first promotional campaign to start engaging visitors.</p>
                <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Create Campaign</Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card/40 border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Placement</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => {
                    const StatusIcon = STATUS_ICONS[c.status] ?? Clock;
                    const TypeIcon = TYPES.find((t) => t.value === c.type)?.icon ?? Megaphone;
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{c.internalName}</div>
                          {c.publicTitle && <div className="text-xs text-muted-foreground truncate max-w-[180px]">{c.publicTitle}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <TypeIcon className="h-3.5 w-3.5" />
                            {TYPES.find((t) => t.value === c.type)?.label ?? c.type}
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs bg-card/60 px-1.5 py-0.5 rounded">{c.placement}</code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs gap-1 ${STATUS_COLORS[c.status] ?? ""}`}>
                            <StatusIcon className="h-3 w-3" />{c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{c.priority ?? 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.updatedAt ? format(new Date(c.updatedAt), "dd MMM yy") : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {c.status !== "published" && (
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-400" title="Publish" onClick={() => handleStatus(c.id, "published")}>
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {c.status === "published" && (
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-amber-400" title="Pause" onClick={() => handleStatus(c.id, "paused")}>
                                <Pause className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => openEdit(c)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Duplicate" onClick={() => handleDuplicate(c.id)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-300" title="Delete" onClick={() => setDeleteId(c.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <AnalyticsTab />
        </TabsContent>

        <TabsContent value="placements" className="mt-4">
          <PlacementManagerTab campaigns={campaigns} onRefresh={loadCampaigns} />
        </TabsContent>
      </Tabs>

      {/* Create / Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => { if (!saving) setEditOpen(v); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Campaign" : "Create Campaign"}</DialogTitle>
          </DialogHeader>
          <CampaignForm
            initial={initialFormData}
            onSave={handleSave}
            onCancel={() => setEditOpen(false)}
            saving={saving}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(v) => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the campaign and all its analytics data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-500 hover:bg-red-600">
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
