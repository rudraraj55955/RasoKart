import { useState, useEffect } from "react";
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp, ArrowRight, X, Rocket,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProgressStep {
  id: string;
  label: string;
  description: string;
  done: boolean;
  /** optional steps (API Setup, Callback) are skipped for non-API merchants */
  optional: boolean;
  href?: string;
  cta?: string;
}

export interface OnboardingProgressProps {
  /** user.id — used to namespace the localStorage dismiss key */
  userId?: number;
  /** merchant account exists = always true when logged in */
  accountCreated?: boolean;
  /** any merchantStatus value means contact is on file */
  contactVerified?: boolean;
  /** at least one KYC document type has been submitted */
  kycSubmitted?: boolean;
  /** admin has approved all KYC docs */
  kycApproved?: boolean;
  /** merchant has an active, non-expired, non-suspended plan */
  planAssigned?: boolean;
  /** plan includes API access (Silver+) */
  hasApiAccess?: boolean;
  /** callback signing secret has been generated */
  callbackSecretSet?: boolean;
  /** at least one payment provider connection is active */
  paymentServiceLive?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DISMISS_SUFFIX = "rasokart_onboarding_dismiss";

// ── Component ─────────────────────────────────────────────────────────────────

export function OnboardingProgress({
  userId,
  accountCreated = true,
  contactVerified = true,
  kycSubmitted = false,
  kycApproved = false,
  planAssigned = false,
  hasApiAccess = false,
  callbackSecretSet = false,
  paymentServiceLive = false,
}: OnboardingProgressProps) {
  const dismissKey = userId ? `${DISMISS_SUFFIX}_${userId}` : null;

  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!dismissKey) return;
    setDismissed(localStorage.getItem(dismissKey) === "1");
  }, [dismissKey]);

  const steps: ProgressStep[] = [
    {
      id: "account",
      label: "Account Created",
      description: "Your RasoKart merchant account is set up and active.",
      done: accountCreated,
      optional: false,
    },
    {
      id: "contact",
      label: "Contact Verified",
      description: "Email and contact details are confirmed on your account.",
      done: contactVerified,
      optional: false,
    },
    {
      id: "kyc_submitted",
      label: "KYC Submitted",
      description: kycSubmitted
        ? "Your business documents have been submitted for review."
        : "Submit your business verification documents to proceed.",
      done: kycSubmitted,
      optional: false,
      href: "/merchant/verification",
      cta: kycSubmitted ? "View Status" : "Submit Documents",
    },
    {
      id: "kyc_approved",
      label: "KYC Approved",
      description: kycApproved
        ? "Your identity and business have been verified."
        : "Awaiting admin review of your submitted documents.",
      done: kycApproved,
      optional: false,
      href: "/merchant/verification",
      cta: "Check Status",
    },
    {
      id: "plan",
      label: "Plan Assigned",
      description: planAssigned
        ? "A payment plan with your limits and fees is active."
        : "Contact support — a plan will be assigned after KYC approval.",
      done: planAssigned,
      optional: false,
      href: "/merchant/plan",
      cta: "View Plan",
    },
    {
      id: "api_setup",
      label: "API Setup",
      description: hasApiAccess
        ? "Your plan includes API access. Generate an API key to integrate."
        : "Upgrade to Silver or higher to unlock API integration.",
      done: hasApiAccess,
      optional: true,
      href: hasApiAccess ? "/merchant/api-keys" : "/merchant/plan",
      cta: hasApiAccess ? "Manage API Keys" : "Upgrade Plan",
    },
    {
      id: "callback",
      label: "Callback Verified",
      description: callbackSecretSet
        ? "Callback signing secret is configured for secure webhook delivery."
        : "Set up your callback URL and signing secret for payment notifications.",
      done: callbackSecretSet,
      optional: true,
      href: "/merchant/webhook",
      cta: callbackSecretSet ? "View Settings" : "Configure",
    },
    {
      id: "live",
      label: "Payment Service Live",
      description: paymentServiceLive
        ? "At least one payment provider is active. You can collect payments."
        : "Awaiting admin activation of your payment collection service.",
      done: paymentServiceLive,
      optional: false,
      href: "/merchant/connect",
      cta: "View Providers",
    },
  ];

  const requiredSteps = steps.filter(s => !s.optional);
  const allRequiredDone = requiredSteps.every(s => s.done);
  const completedCount = steps.filter(s => s.done).length;
  const nextStep = steps.find(s => !s.done && !s.optional) ?? steps.find(s => !s.done);

  // Hide widget once all required steps pass, or if merchant dismissed it
  if (allRequiredDone || dismissed) return null;

  return (
    <Card className="border-primary/25 bg-primary/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Rocket className="w-4 h-4 text-primary shrink-0" />
              <CardTitle className="text-base">Onboarding Progress</CardTitle>
            </div>
            <Badge
              variant="outline"
              className="text-xs border-primary/30 text-primary bg-primary/10"
            >
              {completedCount}/{steps.length} complete
            </Badge>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setCollapsed(c => !c)}
              aria-label={collapsed ? "Expand onboarding progress" : "Collapse onboarding progress"}
            >
              {collapsed ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (dismissKey) localStorage.setItem(dismissKey, "1");
                setDismissed(true);
              }}
              aria-label="Dismiss onboarding progress"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Next action hint — only when expanded */}
        {!collapsed && nextStep && (
          <p className="text-xs text-muted-foreground mt-1.5">
            {"Next: "}
            <span className="text-foreground font-medium">{nextStep.label}</span>
            {nextStep.href && (
              <Link href={nextStep.href}>
                <span className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline cursor-pointer">
                  {nextStep.cta ?? "Get Started"}
                  <ArrowRight className="w-3 h-3" />
                </span>
              </Link>
            )}
          </p>
        )}
      </CardHeader>

      {!collapsed && (
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {steps.map(step => (
              <StepCard key={step.id} step={step} />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Step Card ─────────────────────────────────────────────────────────────────

function StepCard({ step }: { step: ProgressStep }) {
  const cardCls = step.done
    ? "bg-emerald-500/5 border border-emerald-500/20"
    : step.optional
    ? "bg-muted/20 border border-border/40 opacity-75"
    : "bg-amber-500/5 border border-amber-500/20";

  return (
    <div className={`flex items-start gap-2.5 rounded-lg p-3 ${cardCls}`}>
      <div className="shrink-0 mt-0.5">
        {step.done ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : (
          <Circle
            className={`w-4 h-4 ${step.optional ? "text-muted-foreground/35" : "text-amber-400"}`}
          />
        )}
      </div>
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`text-xs font-semibold leading-tight ${
              step.done
                ? "text-emerald-300"
                : step.optional
                ? "text-muted-foreground"
                : "text-foreground"
            }`}
          >
            {step.label}
          </span>
          {step.optional && (
            <span className="text-[10px] text-muted-foreground/55 border border-border/35 rounded px-1 leading-tight">
              optional
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">{step.description}</p>
        {!step.done && step.href && (
          <Link href={step.href}>
            <span className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5 mt-1 cursor-pointer">
              {step.cta ?? "Get Started"}
              <ArrowRight className="w-2.5 h-2.5" />
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
