import { useMemo } from "react";
import { useSearch } from "wouter";

interface ParamConfig {
  default: string;
  allow?: string[];
}

type Config = Record<string, ParamConfig>;
type Filters<C extends Config> = { [K in keyof C]: string };

export function useUrlFilters<C extends Config>(
  config: C
): Filters<C> & { set: (key: keyof C, value: string) => void } {
  const searchStr = useSearch();

  const filters = useMemo<Filters<C>>(() => {
    const params = new URLSearchParams(searchStr);
    const out = {} as Filters<C>;
    for (const key of Object.keys(config) as (keyof C & string)[]) {
      const { default: def, allow } = config[key]!;
      const raw = params.get(key) ?? "";
      (out as any)[key] = raw !== "" && (!allow || allow.includes(raw)) ? raw : def;
    }
    return out;
  }, [searchStr]);

  function set(key: keyof C, value: string): void {
    const cfg = config[key as string];
    if (!cfg) return;
    const safe = !cfg.allow || cfg.allow.includes(value) ? value : cfg.default;
    const params = new URLSearchParams(window.location.search);
    if (safe && safe !== cfg.default) params.set(key as string, safe);
    else params.delete(key as string);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return { ...filters, set };
}
