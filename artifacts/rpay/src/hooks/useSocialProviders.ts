/**
 * Fetches the list of enabled social auth providers from the backend.
 * Used by login pages to conditionally show OAuth buttons.
 */
import { useEffect, useState } from "react";

function apiUrl(path: string): string {
  const base = (import.meta as any)?.env?.BASE_URL ?? "/";
  return `${base}api${path}`.replace(/\/+/g, "/");
}

export interface SocialProviders {
  google: { enabled: boolean; clientId: string | null };
  apple: { enabled: boolean };
  microsoft: { enabled: boolean };
  facebook: { enabled: boolean };
}

const DEFAULT: SocialProviders = {
  google: { enabled: false, clientId: null },
  apple: { enabled: false },
  microsoft: { enabled: false },
  facebook: { enabled: false },
};

export function useSocialProviders(): { providers: SocialProviders; loading: boolean } {
  const [providers, setProviders] = useState<SocialProviders>(DEFAULT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/auth/social-providers"))
      .then(r => r.ok ? r.json() : null)
      .then((data: { providers?: SocialProviders } | null) => {
        if (!cancelled && data?.providers) setProviders(data.providers);
      })
      .catch(() => {/* silently fail — no OAuth buttons shown */})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { providers, loading };
}
