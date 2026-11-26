import { useState, useEffect } from "react";
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp, Rocket, ShieldCheck
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { useMerchantReadiness } from "@/hooks/use-merchant-readiness";

export function OnboardingProgress() {
  const { data: readiness, isLoading } = useMerchantReadiness();
  const [collapsed, setCollapsed] = useState(false);

  // Collapse by default if ready
  useEffect(() => {
    if (readiness?.isReady) {
      setCollapsed(true);
    }
  }, [readiness?.isReady]);

  if (isLoading || !readiness) return null;

  // We don't hide it entirely when done, we just collapse it by default,
  // or we can hide it if they've dismissed it explicitly.
  const isAllDone = readiness.isReady;

  return (
    <Card className="border-primary/25 bg-primary/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Rocket className="w-4 h-4 text-primary shrink-0" />
              <CardTitle className="text-base">Merchant Readiness</CardTitle>
            </div>
            <Badge
              variant="outline"
              className={`text-xs ${isAllDone ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10" : "border-primary/30 text-primary bg-primary/10"}`}
            >
              {isAllDone ? "Ready to process" : `${readiness.summary.completedSteps}/${readiness.summary.totalSteps} complete`}
            </Badge>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setCollapsed(c => !c)}
              aria-label={collapsed ? "Expand readiness progress" : "Collapse readiness progress"}
            >
              {collapsed ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Priority action hint — only when expanded, and not done */}
        {!collapsed && readiness.priorityAction && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-start gap-3 p-3 bg-background/50 rounded-md border border-border/50">
            <ShieldCheck className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{readiness.priorityAction.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{readiness.priorityAction.description}</p>
            </div>
            {readiness.priorityAction.href && (
              <Link href={readiness.priorityAction.href} className="w-full sm:w-auto">
                <Button size="sm" className="w-full sm:w-auto min-h-10 shrink-0">
                  {readiness.priorityAction.cta}
                </Button>
              </Link>
            )}
          </div>
        )}
      </CardHeader>

      {!collapsed && (
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-2">
            {readiness.steps.map(step => (
              <div key={step.id} className={`flex items-start gap-2.5 rounded-lg p-3 ${step.isCompleted ? "bg-emerald-500/5 border border-emerald-500/20" : step.isOptional ? "bg-muted/20 border border-border/40 opacity-75" : "bg-amber-500/5 border border-amber-500/20"}`}>
                <div className="shrink-0 mt-0.5">
                  {step.isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Circle className={`w-4 h-4 ${step.isOptional ? "text-muted-foreground/35" : "text-amber-400"}`} />
                  )}
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-semibold leading-tight ${step.isCompleted ? "text-emerald-300" : step.isOptional ? "text-muted-foreground" : "text-foreground"}`}>
                      {step.label}
                    </span>
                    {step.isOptional && (
                      <span className="text-[10px] text-muted-foreground/55 border border-border/35 rounded px-1 leading-tight">
                        optional
                      </span>
                    )}
                  </div>
                  {step.statusText && (
                    <p className="text-[11px] text-muted-foreground leading-snug">{step.statusText}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
