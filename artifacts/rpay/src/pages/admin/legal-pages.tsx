import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Mail,
  ShieldCheck,
  ExternalLink,
  RefreshCw,
  CheckCircle,
  Clock,
  Inbox,
  Users,
  BookOpen,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Eye,
  Send,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getToken } from "@/lib/auth";

function apiBase() {
  const base = (import.meta as any)?.env?.BASE_URL ?? "/";
  return `${base}api`.replace(/\/+/g, "/").replace(/\/$/, "");
}

const POLICY_META: Record<string, { title: string; badge: string }> = {
  "privacy-policy":                   { title: "Privacy Policy",                    badge: "Core" },
  "terms-and-conditions":             { title: "Terms & Conditions",                badge: "Core" },
  "merchant-agreement":               { title: "Merchant Agreement",                badge: "Core" },
  "refund-cancellation-policy":       { title: "Refund & Cancellation Policy",      badge: "Merchant" },
  "service-delivery-policy":         { title: "Service Delivery Policy",           badge: "Merchant" },
  "kyc-aml-policy":                  { title: "KYC & AML Policy",                 badge: "Compliance" },
  "payment-payout-settlement-policy": { title: "Payment, Payout & Settlement",     badge: "Finance" },
  "chargeback-dispute-policy":       { title: "Chargeback & Dispute Policy",       badge: "Finance" },
  "pricing-fees-settlement-policy":  { title: "Pricing, Fees & Settlement",        badge: "Finance" },
  "prohibited-businesses":           { title: "Prohibited Businesses",             badge: "Compliance" },
  "cookie-policy":                   { title: "Cookie Policy",                     badge: "Privacy" },
  "security-policy":                 { title: "Security & Responsible Disclosure", badge: "Security" },
  "grievance-redressal-policy":      { title: "Grievance Redressal Policy",        badge: "Compliance" },
  "contact-us":                      { title: "Contact Us",                        badge: "Support" },
  "disclaimer":                      { title: "Disclaimer",                        badge: "Legal" },
};

const BADGE_COLORS: Record<string, string> = {
  Core:       "bg-primary/10 text-primary border-primary/20",
  Merchant:   "bg-violet-500/10 text-violet-400 border-violet-500/20",
  Compliance: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Finance:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Privacy:    "bg-sky-500/10 text-sky-400 border-sky-500/20",
  Security:   "bg-orange-500/10 text-orange-400 border-orange-500/20",
  Support:    "bg-teal-500/10 text-teal-400 border-teal-500/20",
  Legal:      "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
};

const STATUS_COLORS: Record<string, string> = {
  published: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  draft:     "bg-amber-500/10 text-amber-400 border-amber-500/20",
  archived:  "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
};

type Tab = "policies" | "contacts" | "acceptances";

interface PolicySummary {
  slug: string;
  currentPublished: PolicyVersionRow | null;
  hasDraft: boolean;
  totalVersions: number;
}

interface PolicyVersionRow {
  id: number;
  slug: string;
  versionTag: string;
  title: string;
  status: string;
  effectiveDate: string;
  changelogNotes?: string;
  updatedByEmail?: string;
  createdAt: string;
  publishedAt?: string;
}

interface ContactRow {
  id: number;
  name: string;
  email: string;
  phone?: string;
  subject: string;
  category: string;
  message: string;
  ticketRef?: string;
  status: string;
  createdAt: string;
}

interface AcceptanceRow {
  id: number;
  policySlug: string;
  policyVersion: string;
  userId?: number;
  merchantId?: number;
  ipAddress?: string;
  acceptedAt: string;
}

type DraftForm = {
  slug: string;
  versionTag: string;
  effectiveDate: string;
  changelogNotes: string;
};

export default function AdminLegalPages() {
  const [tab, setTab] = useState<Tab>("policies");

  // Policy versions state
  const [summaries, setSummaries] = useState<PolicySummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<string, PolicyVersionRow[]>>({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [draftForm, setDraftForm] = useState<DraftForm | null>(null);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ slug: string; msg: string; ok: boolean } | null>(null);

  // Contact & acceptance state
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [acceptances, setAcceptances] = useState<AcceptanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchWithAuth(path: string, opts?: RequestInit) {
    const token = getToken();
    const res = await fetch(`${apiBase()}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...((opts?.headers) ?? {}) },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).error ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  const loadSummaries = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const data = await fetchWithAuth("/admin/policy-versions");
      setSummaries(data.data ?? []);
    } catch (e: any) {
      setSummaryError(e.message ?? "Failed to load policy versions.");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const loadHistory = async (slug: string) => {
    setHistoryLoading(slug);
    try {
      const data = await fetchWithAuth(`/admin/policy-versions/${slug}/history`);
      setHistoryMap((prev) => ({ ...prev, [slug]: data.data ?? [] }));
    } finally {
      setHistoryLoading(null);
    }
  };

  const toggleExpand = async (slug: string) => {
    if (expandedSlug === slug) {
      setExpandedSlug(null);
      return;
    }
    setExpandedSlug(slug);
    if (!historyMap[slug]) await loadHistory(slug);
  };

  const handlePublish = async (id: number, slug: string) => {
    try {
      await fetchWithAuth(`/admin/policy-versions/${id}/publish`, { method: "PUT" });
      setActionMsg({ slug, msg: "Draft published successfully.", ok: true });
      await loadSummaries();
      await loadHistory(slug);
      setHistoryMap((prev) => ({ ...prev, [slug]: [] }));
      setTimeout(() => loadHistory(slug), 300);
    } catch (e: any) {
      setActionMsg({ slug, msg: e.message ?? "Failed to publish.", ok: false });
    }
    setTimeout(() => setActionMsg(null), 4000);
  };

  const handleDeleteDraft = async (id: number, slug: string) => {
    try {
      await fetchWithAuth(`/admin/policy-versions/${id}`, { method: "DELETE" });
      setActionMsg({ slug, msg: "Draft deleted.", ok: true });
      await loadSummaries();
      setHistoryMap((prev) => ({ ...prev, [slug]: [] }));
      setTimeout(() => loadHistory(slug), 300);
    } catch (e: any) {
      setActionMsg({ slug, msg: e.message ?? "Failed to delete.", ok: false });
    }
    setTimeout(() => setActionMsg(null), 4000);
  };

  const handleCreateDraft = async () => {
    if (!draftForm) return;
    setDraftSubmitting(true);
    try {
      const title = POLICY_META[draftForm.slug]?.title ?? draftForm.slug;
      await fetchWithAuth("/admin/policy-versions", {
        method: "POST",
        body: JSON.stringify({ ...draftForm, title }),
      });
      setActionMsg({ slug: draftForm.slug, msg: "Draft created.", ok: true });
      setDraftForm(null);
      await loadSummaries();
      setHistoryMap((prev) => ({ ...prev, [draftForm.slug]: [] }));
      setTimeout(() => loadHistory(draftForm.slug), 300);
    } catch (e: any) {
      setActionMsg({ slug: draftForm.slug, msg: e.message ?? "Failed to create draft.", ok: false });
    } finally {
      setDraftSubmitting(false);
    }
    setTimeout(() => setActionMsg(null), 4000);
  };

  async function loadContacts() {
    setLoading(true); setError(null);
    try {
      const data = await fetchWithAuth("/admin/contact-submissions");
      setContacts(data.data ?? []);
    } catch { setError("Failed to load contact submissions."); }
    finally { setLoading(false); }
  }

  async function loadAcceptances() {
    setLoading(true); setError(null);
    try {
      const data = await fetchWithAuth("/admin/policy-acceptances");
      setAcceptances(data.data ?? []);
    } catch { setError("Failed to load policy acceptances."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (tab === "policies") loadSummaries();
    else if (tab === "contacts") loadContacts();
    else if (tab === "acceptances") loadAcceptances();
  }, [tab]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Legal Pages</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage policy versions, review contact submissions, and audit policy acceptances.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-border/50 bg-card/30 p-1 w-fit">
        {([
          { key: "policies",    label: "Policy Management",    icon: BookOpen },
          { key: "contacts",    label: "Contact Submissions",  icon: Inbox },
          { key: "acceptances", label: "Policy Acceptances",   icon: ShieldCheck },
        ] as { key: Tab; label: string; icon: typeof BookOpen }[]).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── POLICY MANAGEMENT TAB ─────────────────────────────────────────── */}
      {tab === "policies" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Manage policy versions — create drafts, publish, and view revision history.
            </p>
            <Button size="sm" variant="outline" onClick={loadSummaries} disabled={summaryLoading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${summaryLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {summaryError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {summaryError}
            </div>
          )}

          {summaryLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {/* Draft creation modal */}
          {draftForm && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-amber-400" />
                  Create Draft — {POLICY_META[draftForm.slug]?.title ?? draftForm.slug}
                </p>
                <button onClick={() => setDraftForm(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">New Version Tag (e.g. 1.1)</label>
                  <input
                    className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={draftForm.versionTag}
                    onChange={(e) => setDraftForm((f) => f && { ...f, versionTag: e.target.value })}
                    placeholder="1.1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Effective Date</label>
                  <input
                    className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={draftForm.effectiveDate}
                    onChange={(e) => setDraftForm((f) => f && { ...f, effectiveDate: e.target.value })}
                    placeholder="18 July 2026"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Changelog / Notes (optional)</label>
                <textarea
                  className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  rows={2}
                  value={draftForm.changelogNotes}
                  onChange={(e) => setDraftForm((f) => f && { ...f, changelogNotes: e.target.value })}
                  placeholder="What changed in this version?"
                />
              </div>
              <div className="flex items-center gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setDraftForm(null)}>Cancel</Button>
                <Button size="sm" onClick={handleCreateDraft} disabled={draftSubmitting}>
                  {draftSubmitting ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5" /> : <Plus className="w-4 h-4 mr-1.5" />}
                  Create Draft
                </Button>
              </div>
            </div>
          )}

          {!summaryLoading && summaries.length > 0 && (
            <div className="space-y-2">
              {summaries.map((s) => {
                const meta = POLICY_META[s.slug];
                const isExpanded = expandedSlug === s.slug;
                const history = historyMap[s.slug] ?? [];

                return (
                  <div key={s.slug} className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
                    {/* Row header */}
                    <div className="flex items-center gap-3 p-4">
                      <button
                        onClick={() => toggleExpand(s.slug)}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      >
                        {isExpanded
                          ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                          : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-foreground">{meta?.title ?? s.slug}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${BADGE_COLORS[meta?.badge ?? "Legal"] ?? BADGE_COLORS["Legal"]}`}>
                              {meta?.badge ?? "Legal"}
                            </span>
                            {s.hasDraft && (
                              <span className="text-xs px-1.5 py-0.5 rounded border font-medium bg-amber-500/10 text-amber-400 border-amber-500/20">
                                Draft pending
                              </span>
                            )}
                          </div>
                          {s.currentPublished && (
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                              <Clock className="w-3 h-3 shrink-0" />
                              v{s.currentPublished.versionTag} · Published {s.currentPublished.effectiveDate}
                              {s.currentPublished.updatedByEmail && ` · ${s.currentPublished.updatedByEmail}`}
                            </p>
                          )}
                        </div>
                      </button>

                      <div className="flex items-center gap-2 shrink-0">
                        {actionMsg?.slug === s.slug && (
                          <span className={`text-xs ${actionMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                            {actionMsg.msg}
                          </span>
                        )}
                        {!s.hasDraft && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => setDraftForm({
                              slug: s.slug,
                              versionTag: s.currentPublished
                                ? `${parseFloat(s.currentPublished.versionTag) + 0.1}`.replace(/(\.\d)0+$/, "$1")
                                : "1.1",
                              effectiveDate: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
                              changelogNotes: "",
                            })}
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            New Draft
                          </Button>
                        )}
                        <a
                          href={`/${s.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Preview live page"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border/50 rounded-md px-2 py-1 h-7"
                        >
                          <Eye className="w-3 h-3" />
                          Preview
                        </a>
                      </div>
                    </div>

                    {/* Expanded revision history */}
                    {isExpanded && (
                      <div className="border-t border-border/40 bg-muted/5">
                        {historyLoading === s.slug ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground p-4 justify-center">
                            <RefreshCw className="w-3 h-3 animate-spin" /> Loading history…
                          </div>
                        ) : history.length === 0 ? (
                          <p className="text-xs text-muted-foreground p-4 text-center">No version history found.</p>
                        ) : (
                          <div className="divide-y divide-border/30">
                            {history.map((v) => (
                              <div key={v.id} className="flex items-start justify-between gap-4 px-6 py-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-foreground">v{v.versionTag}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${STATUS_COLORS[v.status] ?? STATUS_COLORS["archived"]}`}>
                                      {v.status}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      Effective: {v.effectiveDate}
                                    </span>
                                  </div>
                                  {v.changelogNotes && (
                                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{v.changelogNotes}</p>
                                  )}
                                  <p className="text-xs text-muted-foreground/60 mt-0.5">
                                    Created {new Date(v.createdAt).toLocaleDateString("en-IN")}
                                    {v.updatedByEmail ? ` · ${v.updatedByEmail}` : ""}
                                  </p>
                                </div>
                                {v.status === "draft" && (
                                  <div className="flex items-center gap-2 shrink-0">
                                    <Button
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() => handlePublish(v.id, s.slug)}
                                    >
                                      <Send className="w-3 h-3 mr-1" />
                                      Publish
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs text-destructive hover:text-destructive"
                                      onClick={() => handleDeleteDraft(v.id, s.slug)}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!summaryLoading && summaries.length === 0 && !summaryError && (
            <div className="rounded-xl border border-border/50 bg-card/40 p-12 text-center">
              <FileText className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No policy versions found. Restart the server to seed initial versions.</p>
            </div>
          )}
        </div>
      )}

      {/* ── CONTACT SUBMISSIONS TAB ───────────────────────────────────────── */}
      {tab === "contacts" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Contact form submissions from merchants and visitors.</p>
            <Button size="sm" variant="outline" onClick={loadContacts} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
          {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center"><RefreshCw className="w-4 h-4 animate-spin" /> Loading…</div>}
          {!loading && !error && contacts.length === 0 && (
            <div className="rounded-xl border border-border/50 bg-card/40 p-12 text-center">
              <Inbox className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No contact submissions yet.</p>
            </div>
          )}
          {!loading && contacts.length > 0 && (
            <div className="space-y-3">
              {contacts.map((c) => (
                <div key={c.id} className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.subject}</p>
                      <p className="text-xs text-muted-foreground">{c.name} — {c.email}{c.phone ? ` · ${c.phone}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.ticketRef && <code className="text-xs bg-muted/40 px-2 py-0.5 rounded font-mono">{c.ticketRef}</code>}
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${c.status === "open" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}`}>
                        {c.status}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{c.message}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                    <span>Category: {c.category}</span>
                    <span>·</span>
                    <span>{new Date(c.createdAt).toLocaleString("en-IN")}</span>
                    <a href={`mailto:${c.email}?subject=Re: ${encodeURIComponent(c.subject)}&body=Reference: ${c.ticketRef ?? ""}`} className="ml-auto flex items-center gap-1 text-primary hover:underline">
                      <Mail className="w-3 h-3" /> Reply
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── POLICY ACCEPTANCES TAB ────────────────────────────────────────── */}
      {tab === "acceptances" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Records of merchants and users who accepted platform policies.</p>
            <Button size="sm" variant="outline" onClick={loadAcceptances} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
          {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center"><RefreshCw className="w-4 h-4 animate-spin" /> Loading…</div>}
          {!loading && !error && acceptances.length === 0 && (
            <div className="rounded-xl border border-border/50 bg-card/40 p-12 text-center">
              <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No policy acceptances recorded yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Acceptances are recorded when merchants complete registration.</p>
            </div>
          )}
          {!loading && acceptances.length > 0 && (
            <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/20">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Policy</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Version</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Merchant ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">IP</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Accepted At</th>
                  </tr>
                </thead>
                <tbody>
                  {acceptances.map((a) => (
                    <tr key={a.id} className="border-b border-border/30 hover:bg-muted/10">
                      <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{a.policySlug}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.policyVersion}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{a.merchantId ?? a.userId ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">{a.ipAddress ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(a.acceptedAt).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
