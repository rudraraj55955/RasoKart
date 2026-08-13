import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CreditCard, Send, Upload, Link, Layout, QrCode, RefreshCw, Landmark,
  Globe, FileText, Plane, Shield, UserCheck, CheckCircle2, Clock, XCircle,
  Sparkles, Zap, ArrowRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Service = {
  productKey: string;
  publicName: string;
  description: string | null;
  iconKey: string | null;
  status: string;
  isEnabled: boolean;
  sortOrder: number;
  visibility: string;
  activationRequest: {
    id: number;
    status: string;
    createdAt: string;
  } | null;
};

type ServicesResponse = {
  services: Service[];
};

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...options.headers },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || res.statusText); }
  return res.json();
}

// ── Icon map ──────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  "credit-card":   CreditCard,
  "send":          Send,
  "upload":        Upload,
  "link":          Link,
  "layout":        Layout,
  "qr-code":       QrCode,
  "refresh-cw":    RefreshCw,
  "landmark":      Landmark,
  "globe":         Globe,
  "file-text":     FileText,
  "plane":         Plane,
  "shield":        Shield,
  "user-check":    UserCheck,
};

function ServiceIcon({ iconKey, className }: { iconKey: string | null; className?: string }) {
  const Icon = (iconKey && ICON_MAP[iconKey]) ? ICON_MAP[iconKey] : Zap;
  return <Icon className={className} />;
}

// ── Status helpers ────────────────────────────────────────────────────────────

function RequestStatusBadge({ status }: { status: string }) {
  if (status === "pending")
    return (
      <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30 gap-1">
        <Clock className="w-3 h-3" /> Pending Approval
      </Badge>
    );
  if (status === "approved")
    return (
      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1">
        <CheckCircle2 className="w-3 h-3" /> Approved
      </Badge>
    );
  if (status === "rejected")
    return (
      <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30 gap-1">
        <XCircle className="w-3 h-3" /> Not Available
      </Badge>
    );
  return null;
}

// ── Request Activation Dialog ─────────────────────────────────────────────────

function RequestDialog({
  service,
  onClose,
}: {
  service: Service;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => apiFetch("/merchant/rasokart-services/request", {
      method: "POST",
      body: JSON.stringify({ productKey: service.productKey, note: note.trim() || undefined }),
    }),
    onSuccess: () => {
      toast.success(`Activation request submitted for ${service.publicName}`);
      qc.invalidateQueries({ queryKey: ["rasokartServices"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ServiceIcon iconKey={service.iconKey} className="w-4 h-4 text-primary" />
            Request Access: {service.publicName}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm pt-1">
            {service.description ?? "Submit a request to activate this service on your account."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-2 text-sm">
            <p className="text-muted-foreground">What happens next:</p>
            <ul className="space-y-1 text-muted-foreground text-xs list-disc list-inside">
              <li>Your request will be reviewed by the RasoKart team</li>
              <li>You'll be notified once it's approved or declined</li>
              <li>Most requests are reviewed within 1–2 business days</li>
            </ul>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              Additional notes <span className="text-muted-foreground/60">(optional)</span>
            </Label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Describe your use case or expected volume…"
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Submitting…" : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Service Card ──────────────────────────────────────────────────────────────

function ServiceCard({ service, onRequest }: { service: Service; onRequest: (s: Service) => void }) {
  const isActive = service.status === "active";
  const isComingSoon = service.status === "coming_soon";
  const hasPendingRequest = service.activationRequest?.status === "pending";
  const hasApproved = service.activationRequest?.status === "approved";
  const hasRejected = service.activationRequest?.status === "rejected";

  return (
    <Card className={`relative overflow-hidden transition-all duration-200 border ${
      isActive
        ? "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50"
        : "border-border bg-card/50 hover:border-border/80"
    }`}>
      {isActive && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500/0 via-emerald-500 to-emerald-500/0" />
      )}

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className={`p-2 rounded-lg ${isActive ? "bg-emerald-500/15" : "bg-muted/40"}`}>
            <ServiceIcon
              iconKey={service.iconKey}
              className={`w-5 h-5 ${isActive ? "text-emerald-400" : "text-muted-foreground"}`}
            />
          </div>
          <div className="shrink-0">
            {isActive && (
              <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1">
                <CheckCircle2 className="w-3 h-3" /> Live
              </Badge>
            )}
            {isComingSoon && !service.activationRequest && (
              <Badge variant="outline" className="text-xs bg-sky-500/10 text-sky-400 border-sky-500/30 gap-1">
                <Sparkles className="w-3 h-3" /> Not Available
              </Badge>
            )}
            {service.activationRequest && (
              <RequestStatusBadge status={service.activationRequest.status} />
            )}
          </div>
        </div>
        <CardTitle className={`text-sm font-semibold mt-2 ${isActive ? "text-foreground" : "text-foreground/80"}`}>
          {service.publicName}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {service.description && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{service.description}</p>
        )}

        {isComingSoon && !hasPendingRequest && !hasApproved && (
          <Button
            size="sm"
            variant="outline"
            className="w-full h-8 text-xs border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50 gap-1.5 mt-2"
            onClick={() => onRequest(service)}
          >
            Request Early Access
            <ArrowRight className="w-3 h-3" />
          </Button>
        )}

        {hasPendingRequest && (
          <p className="text-xs text-amber-400/80 bg-amber-500/5 rounded-md px-3 py-2 border border-amber-500/20">
            Your request is under review. We'll notify you once processed.
          </p>
        )}

        {hasApproved && !isActive && (
          <p className="text-xs text-emerald-400/80 bg-emerald-500/5 rounded-md px-3 py-2 border border-emerald-500/20">
            Request approved. Service will be activated on your account shortly.
          </p>
        )}

        {hasRejected && (
          <div className="space-y-1.5">
            <p className="text-xs text-red-400/80 bg-red-500/5 rounded-md px-3 py-2 border border-red-500/20">
              Your previous request was not approved.
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="w-full h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onRequest(service)}
            >
              Reapply
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MerchantRasokartServices() {
  const [requestTarget, setRequestTarget] = useState<Service | null>(null);

  const { data, isLoading, error } = useQuery<ServicesResponse>({
    queryKey: ["rasokartServices"],
    queryFn: () => apiFetch("/merchant/rasokart-services"),
  });

  const services = data?.services ?? [];
  const activeServices = services.filter(s => s.status === "active");
  const comingSoonServices = services.filter(s => s.status !== "active" && s.status !== "disabled");

  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="h-8 w-48 bg-muted/40 rounded animate-pulse mb-2" />
        <div className="h-4 w-72 bg-muted/30 rounded animate-pulse mb-8" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 rounded-lg bg-muted/20 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-6xl mx-auto text-center py-20">
        <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Failed to load services. Please refresh the page.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">RasoKart Services</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Explore the full suite of RasoKart payment and financial services available for your business.
        </p>
      </div>

      {/* Active Services */}
      {activeServices.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-foreground">Active on Your Account</h2>
            <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              {activeServices.length} service{activeServices.length !== 1 ? "s" : ""}
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeServices.map(service => (
              <ServiceCard key={service.productKey} service={service} onRequest={setRequestTarget} />
            ))}
          </div>
        </section>
      )}

      {/* Coming Soon / Available */}
      {comingSoonServices.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-foreground">Expand Your Capabilities</h2>
            <Badge variant="outline" className="text-xs bg-sky-500/10 text-sky-400 border-sky-500/30">
              {comingSoonServices.length} upcoming
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Request early access to upcoming services. Our team will reach out once your request is reviewed.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {comingSoonServices.map(service => (
              <ServiceCard key={service.productKey} service={service} onRequest={setRequestTarget} />
            ))}
          </div>
        </section>
      )}

      {services.length === 0 && (
        <div className="text-center py-20">
          <Zap className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No services available. Contact RasoKart support.</p>
        </div>
      )}

      {/* Info footer */}
      <div className="rounded-lg border border-border bg-muted/10 p-4 flex items-start gap-3 text-sm">
        <Shield className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-muted-foreground text-xs leading-relaxed">
          All services are powered by <strong className="text-foreground">RasoKart's</strong> secure payment
          infrastructure. For support or questions, contact{" "}
          <a href="mailto:support@rasokart.com" className="text-primary hover:underline underline-offset-2">
            support@rasokart.com
          </a>
        </div>
      </div>

      {requestTarget && (
        <RequestDialog service={requestTarget} onClose={() => setRequestTarget(null)} />
      )}
    </div>
  );
}
