import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Cookie, X, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

type ConsentChoice = "all" | "essential" | null;

const STORAGE_KEY = "rasokart_cookie_consent";

function getStoredConsent(): ConsentChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "all" || v === "essential") return v;
  } catch {
    // ignore
  }
  return null;
}

function storeConsent(choice: "all" | "essential") {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // ignore
  }
}

export function CookieConsent() {
  const [choice, setChoice] = useState<ConsentChoice>("all"); // default hidden until loaded
  const [loaded, setLoaded] = useState(false);
  const [showManage, setShowManage] = useState(false);

  useEffect(() => {
    // Suppress banner in automated browser sessions (Playwright, Selenium, etc.)
    if (typeof navigator !== "undefined" && navigator.webdriver) {
      setChoice("essential");
      setLoaded(true);
      return;
    }
    const stored = getStoredConsent();
    setChoice(stored);
    setLoaded(true);
  }, []);

  if (!loaded || choice !== null) return null;

  const handleAcceptAll = () => {
    storeConsent("all");
    setChoice("all");
  };

  const handleEssentialOnly = () => {
    storeConsent("essential");
    setChoice("essential");
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] p-4 pointer-events-none">
      <div className="mx-auto max-w-3xl pointer-events-auto">
        <div className="rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-2xl p-4 sm:p-5">
          {!showManage ? (
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
                  <Cookie className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground mb-0.5">We use cookies</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    We use essential cookies to operate the platform, and optional analytics cookies to improve
                    your experience. See our{" "}
                    <Link href="/cookie-policy" className="text-primary hover:underline">
                      Cookie Policy
                    </Link>{" "}
                    for details.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-8 text-muted-foreground"
                  onClick={() => setShowManage(true)}
                >
                  <Settings className="w-3 h-3 mr-1" />
                  Manage
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={handleEssentialOnly}
                >
                  Essential only
                </Button>
                <Button size="sm" className="text-xs h-8" onClick={handleAcceptAll}>
                  Accept all
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cookie className="w-4 h-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Cookie Preferences</p>
                </div>
                <button
                  onClick={() => setShowManage(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border/50 bg-card/40">
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-0.5">Essential Cookies</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Required for login, session management, and core platform functionality. Cannot be
                      disabled.
                    </p>
                  </div>
                  <div className="shrink-0 text-xs text-emerald-400 font-medium pt-0.5">Always on</div>
                </div>

                <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-border/50 bg-card/40">
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-0.5">Analytics Cookies</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Help us understand how you use the platform so we can improve features and performance.
                    </p>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground pt-0.5">Optional</div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={handleEssentialOnly}
                >
                  Essential only
                </Button>
                <Button size="sm" className="text-xs h-8" onClick={handleAcceptAll}>
                  Accept all
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
