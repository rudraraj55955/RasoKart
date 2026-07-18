import { useState, useEffect } from "react";
import { Link } from "wouter";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getToken } from "@/lib/auth";

function apiBase() {
  const base = (import.meta as any)?.env?.BASE_URL ?? "/";
  return `${base}api`.replace(/\/+/g, "/").replace(/\/$/, "");
}

const POLICIES = [
  { slug: "privacy-policy",                   title: "Privacy Policy",                    updated: "16 July 2026", badge: "Core" },
  { slug: "terms-and-conditions",              title: "Terms & Conditions",                updated: "16 July 2026", badge: "Core" },
  { slug: "merchant-agreement",               title: "Merchant Agreement",                updated: "16 July 2026", badge: "Core" },
  { slug: "refund-cancellation-policy",        title: "Refund & Cancellation Policy",      updated: "16 July 2026", badge: "Merchant" },
  { slug: "service-delivery-policy",          title: "Service Delivery Policy",           updated: "16 July 2026", badge: "Merchant" },
  { slug: "kyc-aml-policy",                   title: "KYC & AML Policy",                 updated: "16 July 2026", badge: "Compliance" },
  { slug: "payment-payout-settlement-policy", title: "Payment, Payout & Settlement",      updated: "16 July 2026", badge: "Finance" },
  { slug: "chargeback-dispute-policy",        title: "Chargeback & Dispute Policy",       updated: "16 July 2026", badge: "Finance" },
  { slug: "pricing-fees-settlement-policy",   title: "Pricing, Fees & Settlement",        updated: "16 July 2026", badge: "Finance" },
  { slug: "prohibited-businesses",            title: "Prohibited Businesses",             updated: "16 July 2026", badge: "Compliance" },
  { slug: "cookie-policy",                    title: "Cookie Policy",                     updated: "16 July 2026", badge: "Privacy" },
  { slug: "security-policy",                  title: "Security & Responsible Disclosure", updated: "16 July 2026", badge: "Security" },
  { slug: "grievance-redressal-policy",       title: "Grievance Redressal Policy",        updated: "16 July 2026", badge: "Compliance" },
  { slug: "contact-us",                       title: "Contact Us",                        updated: "16 July 2026", badge: "Support" },
  { slug: "disclaimer",                       title: "Disclaimer",                        updated: "16 July 2026", badge: "Legal" },
];

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

type Tab = "policies" | "contacts" | "acceptances";

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

export default function AdminLegalPages() {
  const [tab, setTab] = useState<Tab>("policies");
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [acceptances, setAcceptances] = useState<AcceptanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchWithAuth(path: string) {
    const token = getToken();
    const res = await fetch(`${apiBase()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function loadContacts() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWithAuth("/admin/contact-submissions");
      setContacts(data.data ?? []);
    } catch {
      setError("Failed to load contact submissions.");
    } finally {
      setLoading(false);
    }
  }

  async function loadAcceptances() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWithAuth("/admin/policy-acceptances");
      setAcceptances(data.data ?? []);
    } catch {
      setError("Failed to load policy acceptances.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "contacts") loadContacts();
    else if (tab === "acceptances") loadAcceptances();
  }, [tab]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Legal Pages</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage policy pages, review contact form submissions, and monitor policy acceptances.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-border/50 bg-card/30 p-1 w-fit">
        {([
          { key: "policies",    label: "Policy Overview", icon: BookOpen },
          { key: "contacts",    label: "Contact Submissions", icon: Inbox },
          { key: "acceptances", label: "Policy Acceptances", icon: ShieldCheck },
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

      {/* Tab: Policy Overview */}
      {tab === "policies" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {POLICIES.map((p) => (
              <div
                key={p.slug}
                className="flex items-start justify-between gap-3 rounded-xl border border-border/50 bg-card/40 p-4 hover:bg-card/60 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded border font-medium ${
                        BADGE_COLORS[p.badge] ?? BADGE_COLORS["Legal"]
                      }`}
                    >
                      {p.badge}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{p.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Last updated: {p.updated}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 pt-1">
                  <CheckCircle className="w-4 h-4 text-emerald-400" aria-label="Published" />
                  <a
                    href={`/${p.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Open page"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            All {POLICIES.length} policy pages are published. Content is managed in source code.
            Page routes are publicly accessible without authentication.
          </p>
        </div>
      )}

      {/* Tab: Contact Submissions */}
      {tab === "contacts" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Contact form submissions from merchants and visitors.
            </p>
            <Button size="sm" variant="outline" onClick={loadContacts} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          )}

          {!loading && !error && contacts.length === 0 && (
            <div className="rounded-xl border border-border/50 bg-card/40 p-12 text-center">
              <Inbox className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No contact submissions yet.</p>
            </div>
          )}

          {!loading && contacts.length > 0 && (
            <div className="space-y-3">
              {contacts.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-medium text-foreground">{c.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.name} — {c.email}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.ticketRef && (
                        <code className="text-xs bg-muted/40 px-2 py-0.5 rounded font-mono">
                          {c.ticketRef}
                        </code>
                      )}
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                          c.status === "open"
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                    {c.message}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                    <span>Category: {c.category}</span>
                    <span>·</span>
                    <span>{new Date(c.createdAt).toLocaleString("en-IN")}</span>
                    <a
                      href={`mailto:${c.email}?subject=Re: ${encodeURIComponent(c.subject)}&body=Reference: ${c.ticketRef ?? ""}`}
                      className="ml-auto flex items-center gap-1 text-primary hover:underline"
                    >
                      <Mail className="w-3 h-3" />
                      Reply
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Policy Acceptances */}
      {tab === "acceptances" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Records of merchants and users who have accepted platform policies.
            </p>
            <Button size="sm" variant="outline" onClick={loadAcceptances} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          )}

          {!loading && !error && acceptances.length === 0 && (
            <div className="rounded-xl border border-border/50 bg-card/40 p-12 text-center">
              <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No policy acceptances recorded yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Acceptances are recorded when merchants complete registration.
              </p>
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
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {a.merchantId ?? a.userId ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                        {a.ipAddress ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {new Date(a.acceptedAt).toLocaleString("en-IN")}
                      </td>
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
