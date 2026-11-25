import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Headphones, Mail, Phone, MessageSquare, X, ArrowUpRight } from "lucide-react";
import { useCompanySettings } from "@/lib/company-settings";
import { SUPPORT_EMAIL } from "@/lib/support-config";

const WIDGET_SCRIPT_ID = "helpkart365-widget-script";
const DEFAULT_WIDGET_URL = "https://widget.helpkart365.com/widget.js";

const SUPPRESSED_PREFIXES = [
  "/pay/",
  "/qr/",
  "/va/",
  "/checkout",
  "/payout-slip/",
  "/verify-payout/",
];

function isSuppressedPath(pathname: string): boolean {
  return SUPPRESSED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function HelpKartWidget() {
  const [location] = useLocation();
  const { supportPhone, supportEmail } = useCompanySettings();
  const [open, setOpen] = useState(false);
  const [externalActive, setExternalActive] = useState(false);

  const siteKey = (import.meta.env.VITE_HELPKART_SITE_KEY ?? "").trim();
  const widgetUrl = (import.meta.env.VITE_HELPKART_WIDGET_URL ?? DEFAULT_WIDGET_URL).trim();
  const hidden =
    isSuppressedPath(location) ||
    (typeof navigator !== "undefined" && Boolean(navigator.webdriver));

  useEffect(() => {
    if (hidden || !siteKey) return;

    const existing = document.getElementById(WIDGET_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      setExternalActive(true);
      return;
    }

    const script = document.createElement("script");
    script.id = WIDGET_SCRIPT_ID;
    script.src = widgetUrl;
    script.async = true;
    script.dataset.siteKey = siteKey;
    script.dataset.position = "bottom-right";

    const handleLoad = () => setExternalActive(true);
    const handleError = () => {
      setExternalActive(false);
      script.remove();
    };

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);
    document.body.appendChild(script);

    return () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
  }, [hidden, siteKey, widgetUrl]);

  if (hidden || externalActive) return null;

  const contactEmail = supportEmail || SUPPORT_EMAIL;

  return (
    <div className="fixed bottom-4 right-4 z-[85] flex flex-col items-end gap-2.5">
      {open && (
        <div
          role="dialog"
          aria-label="RasoKart Support Desk"
          className="w-72 sm:w-80 rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-border/40 bg-gradient-to-r from-cyan-500/15 to-violet-500/15 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400">
                <Headphones className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-tight">RasoKart Support</p>
                <p className="text-[11px] text-muted-foreground">Merchant & API Help Desk</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close support menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-3 space-y-1.5">
            <Link
              href="/support-center"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-xl border border-border/40 bg-card/40 px-3 py-2.5 text-xs hover:bg-card/80 transition-colors"
            >
              <span className="flex items-center gap-2.5 text-foreground font-medium">
                <MessageSquare className="h-4 w-4 text-cyan-400 shrink-0" />
                Support Center & Tickets
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
            </Link>

            <a
              href={`mailto:${contactEmail}`}
              className="flex items-center justify-between rounded-xl border border-border/40 bg-card/40 px-3 py-2.5 text-xs hover:bg-card/80 transition-colors"
            >
              <span className="flex items-center gap-2.5 text-foreground font-medium truncate">
                <Mail className="h-4 w-4 text-violet-400 shrink-0" />
                <span className="truncate">{contactEmail}</span>
              </span>
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </a>

            {supportPhone && (
              <a
                href={`tel:${supportPhone}`}
                className="flex items-center justify-between rounded-xl border border-border/40 bg-card/40 px-3 py-2.5 text-xs hover:bg-card/80 transition-colors"
              >
                <span className="flex items-center gap-2.5 text-foreground font-medium">
                  <Phone className="h-4 w-4 text-emerald-400 shrink-0" />
                  Call {supportPhone}
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
              </a>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? "Close support widget" : "Open support widget"}
        className="flex h-12 items-center gap-2 rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 px-4 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 hover:opacity-95 transition-opacity"
      >
        {open ? <X className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
        <span className="hidden sm:inline">{open ? "Close" : "Support"}</span>
      </button>
    </div>
  );
}
